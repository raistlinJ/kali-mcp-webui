#!/usr/bin/env python3
"""
mcp_client.py — Persistent MCP session with chat-loop support.

Uses the official `mcp` SDK to connect to an MCP server via stdio,
and the `ollama` library to drive LLM chat completions with tool use.

Architecture:
  MCPSession — a long-lived object that manages the MCP server connection
  and conversation state.  Callers use:
      session.start()  → launch MCP server, discover tools
      session.chat()   → send a user prompt, run the agent loop
      session.stop()   → graceful teardown

Every event (prompt, LLM text, tool calls, errors) is pushed through
an `event_callback(event: dict)` so the Flask layer can broadcast it
over SSE and persist it via SessionLogger.

Includes context-window management: when the conversation approaches a
configurable token budget, older messages are summarised by the LLM and
replaced with a compact summary, keeping the most recent turns intact.
"""

import asyncio
import ipaddress
import json
import os
import re
import shlex
import time
import traceback
from urllib.parse import urlparse
from contextlib import AsyncExitStack

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

try:
    import ollama as _ollama_lib
    _HAVE_OLLAMA = True
except ImportError:
    _HAVE_OLLAMA = False

from session_logger import SessionLogger, make_run_id


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Rough chars-per-token ratio (conservative; real ratio is ~3.5–4 for English)
_CHARS_PER_TOKEN = 4

# Default context window budget (tokens).  Can be overridden via `context_window`.
DEFAULT_CONTEXT_WINDOW = 8192

# Default maximum LLM/tool iterations allowed for a single user prompt.
DEFAULT_MAX_TURNS = 20

# When estimated token usage exceeds this fraction of the budget, trigger
# summarisation of older messages.
_SUMMARISE_THRESHOLD = 0.75

# Number of most-recent messages to keep intact (never summarised).
_KEEP_RECENT = 6

_SUMMARISE_SYSTEM_PROMPT = (
    "You are a concise summariser. Condense the following conversation history "
    "into a brief summary that preserves all important facts, decisions, tool "
    "results, and any data the assistant will need to continue working. "
    "Output ONLY the summary, no preamble."
)

_URL_RE = re.compile(r'https?://[^\s]+', re.IGNORECASE)
_CIDR_OR_IP_RE = re.compile(r'\b(?:\d{1,3}\.){3}\d{1,3}(?:/\d{1,2})?\b')
_HOSTNAME_RE = re.compile(r'^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\.?$', re.IGNORECASE)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sanitize_tool_schema_value(value):
    """Normalize tool schema text so XML-based model adapters do not choke on it."""
    if isinstance(value, str):
        return value.replace("<", "[").replace(">", "]")
    if isinstance(value, list):
        return [_sanitize_tool_schema_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _sanitize_tool_schema_value(item) for key, item in value.items()}
    return value

def _mcp_tool_to_ollama(tool) -> dict:
    """Convert an MCP Tool object to the Ollama function-calling schema."""
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": _sanitize_tool_schema_value(tool.description or f"Run {tool.name}"),
            "parameters": _sanitize_tool_schema_value(tool.inputSchema) if tool.inputSchema else {
                "type": "object",
                "properties": {},
            },
        },
    }


def _mcp_tool_to_ollama_minimal(tool) -> dict:
    """Minimal tool schema fallback for models that choke on richer XML/function payloads."""
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": f"Run {tool.name}",
            "parameters": {
                "type": "object",
                "properties": {
                    "args": {"type": "string"},
                },
            },
        },
    }


def _is_xml_schema_error(exc: Exception) -> bool:
    message = str(exc or "")
    return "XML syntax error" in message and "status code: 500" in message


def _normalize_network_policy(policy) -> dict:
    policy = policy or {}
    allow = [str(item).strip() for item in policy.get("allow", ["*"]) if str(item).strip()]
    disallow = [str(item).strip() for item in policy.get("disallow", []) if str(item).strip()]
    if not allow:
        allow = ["*"]
    return {"allow": allow, "disallow": disallow}


def _collect_string_values(value) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        values = []
        for item in value.values():
            values.extend(_collect_string_values(item))
        return values
    if isinstance(value, (list, tuple, set)):
        values = []
        for item in value:
            values.extend(_collect_string_values(item))
        return values
    return []


def _extract_targets_from_args(arguments: dict) -> list[dict]:
    targets = []
    seen = set()

    for text in _collect_string_values(arguments):
        for url in _URL_RE.findall(text):
            host = (urlparse(url).hostname or '').lower()
            target = {"kind": "url", "value": url, "host": host}
            key = (target["kind"], target["value"])
            if key not in seen:
                seen.add(key)
                targets.append(target)

        try:
            tokens = shlex.split(text)
        except Exception:
            tokens = text.split()

        for token in tokens:
            cleaned = token.strip().strip(',;()[]{}')
            if not cleaned or cleaned.startswith('-'):
                continue
            if '://' in cleaned:
                continue

            host_candidate = cleaned
            if '/' in host_candidate and not _CIDR_OR_IP_RE.fullmatch(host_candidate):
                host_candidate = host_candidate.split('/', 1)[0]
            if ':' in host_candidate and host_candidate.count(':') == 1 and not _CIDR_OR_IP_RE.fullmatch(host_candidate):
                host_candidate = host_candidate.rsplit(':', 1)[0]

            if _CIDR_OR_IP_RE.fullmatch(host_candidate):
                kind = 'cidr' if '/' in host_candidate else 'ip'
                key = (kind, host_candidate)
                if key not in seen:
                    seen.add(key)
                    targets.append({"kind": kind, "value": host_candidate})
                continue

            hostname = host_candidate.rstrip('.').lower()
            if _HOSTNAME_RE.fullmatch(hostname):
                key = ('hostname', hostname)
                if key not in seen:
                    seen.add(key)
                    targets.append({"kind": 'hostname', "value": hostname})

    return targets


def _entry_matches_target(entry: str, target: dict) -> bool:
    entry = entry.strip()
    if not entry:
        return False
    if entry == '*':
        return True

    entry_lower = entry.lower().rstrip('.')
    target_kind = target.get('kind')
    target_value = str(target.get('value', '')).lower().rstrip('.')
    target_host = str(target.get('host', '')).lower().rstrip('.')

    if entry_lower.startswith('http://') or entry_lower.startswith('https://'):
        parsed = urlparse(entry_lower)
        if target_kind == 'url':
            return target_value.startswith(entry_lower)
        if target_host:
            return target_host == (parsed.hostname or '').lower().rstrip('.')
        return False

    try:
        if '/' in entry_lower:
            entry_net = ipaddress.ip_network(entry_lower, strict=False)
            if target_kind == 'ip':
                return ipaddress.ip_address(target_value) in entry_net
            if target_kind == 'cidr':
                return ipaddress.ip_network(target_value, strict=False).subnet_of(entry_net)
            return False
        entry_ip = ipaddress.ip_address(entry_lower)
        if target_kind == 'ip':
            return ipaddress.ip_address(target_value) == entry_ip
        if target_kind == 'cidr':
            return ipaddress.ip_network(target_value, strict=False).num_addresses == 1 and ipaddress.ip_network(target_value, strict=False).network_address == entry_ip
        return False
    except ValueError:
        pass

    if target_kind == 'hostname':
        return target_value == entry_lower or target_value.endswith('.' + entry_lower)
    if target_host:
        return target_host == entry_lower or target_host.endswith('.' + entry_lower)
    return False


def _evaluate_network_policy(policy: dict, arguments: dict) -> tuple[bool, str | None]:
    normalized = _normalize_network_policy(policy)
    targets = _extract_targets_from_args(arguments)
    if not targets:
        return True, None

    disallow_entries = normalized['disallow']
    allow_entries = normalized['allow']
    allow_any = '*' in allow_entries

    for target in targets:
        for entry in disallow_entries:
            if _entry_matches_target(entry, target):
                return False, f"Target '{target['value']}' is blocked by disallow rule '{entry}'."

        if not allow_any and not any(_entry_matches_target(entry, target) for entry in allow_entries):
            return False, f"Target '{target['value']}' is outside the allow list."

    return True, None


def _emit(callback, event_type: str, data: dict):
    """Safely call the event callback."""
    if callback:
        try:
            callback({"type": event_type, **data})
        except Exception:
            pass


def _estimate_tokens(messages: list[dict]) -> int:
    """Estimate total token count from a messages list (rough heuristic)."""
    total_chars = 0
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, str):
            total_chars += len(content)
        tcs = msg.get("tool_calls")
        if tcs:
            total_chars += len(str(tcs))
    return total_chars // _CHARS_PER_TOKEN


def _truncate_tool_output(text: str, max_chars: int = 8000) -> str:
    """Truncate large tool outputs to keep context lean."""
    if len(text) <= max_chars:
        return text
    half = max_chars // 2
    return (
        text[:half]
        + f"\n\n... [truncated {len(text) - max_chars} chars] ...\n\n"
        + text[-half:]
    )


def _extract_nmap_summary(result_text: str) -> tuple[str | None, str | None]:
    host_match = re.search(r'Nmap scan report for\s+(.+)', result_text)
    host = host_match.group(1).strip() if host_match else None

    if re.search(r'All\s+\d+\s+scanned\s+ports.*ignored states', result_text, re.IGNORECASE):
        return host, 'no open ports detected'

    open_ports = re.findall(r'^(\d+)/(tcp|udp)\s+open\s+([^\s]+)', result_text, re.MULTILINE)
    if open_ports:
        ports = ', '.join(f"{port}/{proto} ({service})" for port, proto, service in open_ports[:6])
        extra = '' if len(open_ports) <= 6 else f" +{len(open_ports) - 6} more"
        return host, f"open ports: {ports}{extra}"

    if re.search(r'0 hosts up', result_text, re.IGNORECASE):
        return host, 'host did not respond as up during the scan'

    return host, None


def _tool_arg_label(arguments: dict, fallback: str = 'the requested target') -> str:
    label = str((arguments or {}).get('args') or '').strip()
    return label or fallback


def _extract_benign_empty_summary(tool_name: str, result_text: str, arguments: dict) -> str | None:
    normalized = (result_text or '').strip()
    normalized_lower = normalized.lower()
    label = _tool_arg_label(arguments)

    if tool_name == 'msf_search' and 'no results from search' in normalized_lower:
        return f"Metasploit search returned no matching modules for {label}."

    if tool_name == 'msf_run' and 'exploit completed, but no session was created' in normalized_lower:
        return f"Metasploit ran for {label}, but it did not create a session."

    if tool_name == 'searchsploit' and ('no results' in normalized_lower or 'exploits: no results' in normalized_lower):
        return f"Searchsploit returned no matching entries for {label}."

    if tool_name == 'nmap':
        host, summary = _extract_nmap_summary(normalized)
        if summary == 'no open ports detected':
            target_label = host or label
            return f"{target_label}: no open ports detected."

    if tool_name == 'rustscan' and 'no open ports found' in normalized_lower:
        return f"Rustscan found no open ports for {label}."

    if tool_name == 'masscan' and ('found 0 hosts' in normalized_lower or '0 hosts scanned' in normalized_lower):
        return f"Masscan did not identify any responsive hosts or open ports for {label}."

    if tool_name in {'amass', 'subfinder'} and (not normalized or 'no names were discovered' in normalized_lower or 'no assets were discovered' in normalized_lower):
        return f"{tool_name} did not discover any subdomains for {label}."

    if tool_name in {'gobuster', 'dirb', 'ffuf', 'wfuzz'}:
        no_result_markers = [
            'no results',
            '0 hits',
            '0 words found',
            '0 directories found',
            '0 files found',
            'no valid results',
        ]
        if not normalized or any(marker in normalized_lower for marker in no_result_markers):
            return f"{tool_name} did not find any matching paths or content for {label}."

    if tool_name == 'nikto' and ('0 host(s) tested' in normalized_lower or '0 item(s) reported' in normalized_lower):
        return f"Nikto did not report any findings for {label}."

    if tool_name == 'sqlmap' and (
        'all tested parameters do not appear to be injectable' in normalized_lower
        or 'does not seem to be injectable' in normalized_lower
        or 'no injection point found' in normalized_lower
    ):
        return f"sqlmap did not identify injectable parameters for {label}."

    if tool_name == 'wpscan' and 'wordpress not detected' in normalized_lower:
        return f"WPScan did not detect a WordPress target for {label}."

    if tool_name == 'whatweb' and (not normalized or 'unassigned' == normalized_lower):
        return f"WhatWeb did not produce a fingerprint for {label}."

    if tool_name in {'john', 'hashcat'} and (
        '0g' in normalized_lower
        or 'recovered........: 0/' in normalized_lower
        or 'no hashes loaded' in normalized_lower
    ):
        return f"{tool_name} did not recover any credentials for {label}."

    if tool_name in {'hydra', 'medusa', 'crowbar'} and (
        '0 valid password found' in normalized_lower
        or '0 valid passwords found' in normalized_lower
        or 'no valid password found' in normalized_lower
        or 'no credentials were discovered' in normalized_lower
    ):
        return f"{tool_name} did not find valid credentials for {label}."

    if tool_name == 'commix' and (
        'does not seem injectable' in normalized_lower
        or '0 injection point' in normalized_lower
        or 'no injection points found' in normalized_lower
    ):
        return f"Commix did not identify command injection for {label}."

    if tool_name in {'proxychains', 'ssh', 'netcat', 'ncat', 'tcpdump', 'aircrack-ng', 'recon-ng', 'msfconsole', 'shell', 'shell_extended', 'shell_sequence', 'shell_dangerous'} and not normalized:
        return f"{tool_name} completed successfully with no output for {label}."

    if not normalized:
        return f"{tool_name} completed successfully but returned no output for {label}."

    return None


def _can_auto_finalize_benign_empty(tool_results: list[dict]) -> bool:
    if not tool_results:
        return False

    summaries = []
    for item in tool_results:
        if item.get('exit_code', 0) != 0:
            return False
        summary = _extract_benign_empty_summary(
            item.get('tool', 'unknown'),
            item.get('result', '') or '',
            item.get('args', {}) or {},
        )
        if not summary:
            return False
        summaries.append(summary)

    return bool(summaries)


def _build_benign_empty_finalization(tool_results: list[dict]) -> str:
    summaries = []
    for item in tool_results:
        summary = _extract_benign_empty_summary(
            item.get('tool', 'unknown'),
            item.get('result', '') or '',
            item.get('args', {}) or {},
        )
        if summary:
            summaries.append(summary)

    if summaries:
        return ' '.join(summaries)

    return _build_tool_result_fallback('', tool_results)


def _build_tool_result_fallback(prompt: str, tool_results: list[dict]) -> str:
    nmap_findings = []
    generic_findings = []

    for item in tool_results:
        tool_name = item.get('tool', 'unknown')
        result_text = item.get('result', '') or ''
        exit_code = item.get('exit_code', 0)

        if tool_name == 'nmap':
            host, summary = _extract_nmap_summary(result_text)
            if summary:
                label = host or item.get('args', {}).get('args', 'target')
                nmap_findings.append(f"{label}: {summary}")
                continue

        if exit_code == 0:
            preview = result_text.strip().splitlines()
            generic_findings.append(f"{tool_name}: {preview[0] if preview else 'completed with no output'}")
        else:
            generic_findings.append(f"{tool_name}: failed ({result_text.strip() or 'no error text'})")

    if nmap_findings and all('no open ports detected' in finding for finding in nmap_findings):
        joined = '; '.join(nmap_findings)
        return (
            f"I ran the follow-up scans, but they did not reveal any open ports or exposed services. {joined}. "
            "Without reachable services, there is nothing meaningful to vulnerability-scan at the service layer yet. "
            "The next step would be broader host discovery, UDP checks, or validating whether filtering is hiding services."
        )

    findings = nmap_findings + generic_findings
    if findings:
        return "I completed the follow-up tooling. Results: " + '; '.join(findings[:8]) + "."

    return (
        "The requested tools finished successfully, but the model failed to produce a final answer. "
        "The latest tool results are available in the log and can be used to continue from here."
    )


def _extract_tool_info(tc) -> tuple[str, dict]:
    """Safely extract function name and arguments from a tool call (dict or object)."""
    func = getattr(tc, "function", None)
    if func is None and hasattr(tc, "get"):
        func = tc.get("function", tc)
    if func is None:
        func = tc
        
    name = getattr(func, "name", None)
    if name is None and hasattr(func, "get"):
        name = func.get("name", "unknown")
        
    args = getattr(func, "arguments", None)
    if args is None and hasattr(func, "get"):
        args = func.get("arguments", {})
        
    if not isinstance(args, dict):
        try:
            if hasattr(args, "model_dump"):
                args = args.model_dump()
            elif hasattr(args, "dict"):
                args = args.dict()
            else:
                args = dict(args)
        except Exception:
            pass
            
    return str(name or "unknown"), (args if isinstance(args, dict) else {})


async def _maybe_summarise(
    client,
    model: str,
    messages: list[dict],
    context_window: int,
    event_callback,
) -> list[dict]:
    """
    If estimated token usage exceeds the threshold, summarise older messages.

    Strategy:
      1. Split messages into OLD (candidates for summarisation) and RECENT
         (kept intact — the last `_KEEP_RECENT` messages).
      2. Ask the LLM to produce a concise summary of the OLD portion.
      3. Replace OLD messages with a single system message containing the summary.

    Returns the (possibly compacted) messages list.
    """
    est_tokens = _estimate_tokens(messages)
    budget = int(context_window * _SUMMARISE_THRESHOLD)

    if est_tokens <= budget or len(messages) <= _KEEP_RECENT + 1:
        return messages  # no action needed

    _emit(event_callback, "status", {
        "message": f"Context ~{est_tokens} tokens (budget {context_window}) — summarizing older history …"
    })

    # Split: keep the most recent messages intact
    old_messages = messages[:-_KEEP_RECENT]
    recent_messages = messages[-_KEEP_RECENT:]

    # Build a text dump of old messages for summarisation
    history_text = ""
    for msg in old_messages:
        role = msg.get("role", "unknown")
        content = msg.get("content", "")
        if isinstance(content, str) and content.strip():
            history_text += f"[{role}]: {content[:2000]}\n\n"
        tcs = msg.get("tool_calls")
        if tcs:
            for tc in tcs:
                name, args = _extract_tool_info(tc)
                try:
                    args_str = json.dumps(args)
                except Exception:
                    args_str = str(args)
                history_text += f"[tool_call]: {name}({args_str})\n"

    # Ask the LLM to summarise
    try:
        summary_response = await asyncio.to_thread(
            client.chat,
            model=model,
            messages=[
                {"role": "system", "content": _SUMMARISE_SYSTEM_PROMPT},
                {"role": "user", "content": f"Conversation to summarise:\n\n{history_text}"},
            ],
        )
        summary_msg = summary_response.get("message", summary_response)
        summary_text = summary_msg.get("content", "").strip()
    except Exception as exc:
        # If summarisation fails, fall back to a naive truncation
        summary_text = history_text[:2000] + "\n[truncated]"
        _emit(event_callback, "status", {
            "message": f"Summarisation LLM call failed ({exc}), using truncated history."
        })

    if not summary_text:
        summary_text = "(summary unavailable)"

    new_tokens = _estimate_tokens([{"content": summary_text}]) + _estimate_tokens(recent_messages)
    _emit(event_callback, "status", {
        "message": f"Summarised {len(old_messages)} old messages → ~{_estimate_tokens([{'content': summary_text}])} tokens. New total ~{new_tokens} tokens."
    })

    # Rebuild: summary + recent
    compacted = [
        {"role": "system", "content": f"[Conversation summary so far]\n{summary_text}"},
        *recent_messages,
    ]
    return compacted


def _emit_chat_cancelled(event_callback):
    _emit(event_callback, "status", {"message": "Chat cancelled by user."})
    _emit(event_callback, "chat_done", {"message": "Prompt cancelled. Ready for next prompt."})


# ---------------------------------------------------------------------------
# MCPSession — persistent connection with chat loop
# ---------------------------------------------------------------------------

class MCPSession:
    """
    Long-lived MCP session that holds the server connection open and supports
    multiple chat turns with full conversation continuity.

    Usage:
        session = MCPSession(...)
        tool_names = await session.start()
        await session.chat("scan 192.168.1.0/24")
        await session.chat("now check for open web ports")
        await session.stop()
    """

    def __init__(
        self,
        *,
        ollama_url: str,
        model: str,
        server_command: str,
        run_id: str | None = None,
        event_callback=None,
        context_window: int = DEFAULT_CONTEXT_WINDOW,
        max_turns: int = DEFAULT_MAX_TURNS,
        network_policy: dict | None = None,
    ):
        self.ollama_url = ollama_url
        self.model = model
        self.server_command = server_command
        self.context_window = context_window
        self.max_turns = max_turns
        self.event_callback = event_callback
        self.run_id = run_id or make_run_id("agent")
        self.network_policy = _normalize_network_policy(network_policy)
        
        # Initialize with a strong system prompt to ensure tools aren't sent to the background
        allow_text = ", ".join(self.network_policy['allow'])
        disallow_text = ", ".join(self.network_policy['disallow']) if self.network_policy['disallow'] else '(none)'
        self.messages: list[dict] = [
            {
                "role": "system",
                "content": "You are a network security assistant. You must wait for all tools to finish executing. NEVER attempt to run tools in the background (e.g., using `&` or `nohup`). You MUST allow the system to execute the tool synchronously so you can read and analyze the output before replying. The shell_dangerous tool requires explicit user verification before execution; only request it when clearly necessary and expect an approval gate before it runs. You must obey the target access policy without exception. Allowed targets: " + allow_text + ". Disallowed targets: " + disallow_text + ". If a target is out of scope, do not attempt the action."
            }
        ]
        
        self.tool_names: list[str] = []
        self._ollama_tools: list[dict] = []
        self._ollama_tools_minimal: list[dict] = []
        self._model_max_ctx: int = context_window

        # Internals
        self._exit_stack: AsyncExitStack | None = None
        self._session: ClientSession | None = None
        self._client = None
        self._logger: SessionLogger | None = None
        self._started = False
        self._chat_lock = asyncio.Lock()
        self._pending_post_tool_reply = None
        self._pending_dangerous_tool_approval = None

    async def _retry_empty_reply_after_tools(self, prompt: str, tool_results: list[dict]) -> str | None:
        _emit(self.event_callback, "status", {
            "message": "Model returned an empty post-tool reply; retrying once without tools for a final answer …"
        })

        recovery_prompt = (
            "Provide the final user-facing answer based only on these completed tool results. "
            "Do not call tools. Be concise and explicit. If scans show no open ports or exposed services, say that clearly and explain that vulnerability scanning cannot proceed meaningfully without reachable services.\n\n"
            f"Original user request:\n{prompt}\n\n"
            "Completed tool results:\n"
            f"{json.dumps(tool_results[-8:], ensure_ascii=True)}"
        )

        try:
            response = await asyncio.to_thread(
                self._client.chat,
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "You are a network security assistant writing the final answer after tools have already completed. Do not call tools."
                    },
                    {
                        "role": "user",
                        "content": recovery_prompt,
                    },
                ],
                options={"num_ctx": self.context_window},
            )
            message = response.get("message", response)
            content = message.get("content", getattr(message, "content", "")) or ""
            if content.strip():
                return content.strip()
        except Exception as exc:
            _emit(self.event_callback, "status", {
                "message": f"Retry call failed ({exc})."
            })

        return None

    async def _prompt_post_tool_reply_decision(self, prompt: str, tool_results: list[dict], cancel_event: asyncio.Event | None) -> str:
        loop = asyncio.get_running_loop()
        decision_future = loop.create_future()
        self._pending_post_tool_reply = {
            "future": decision_future,
            "loop": loop,
            "prompt": prompt,
            "tool_results": tool_results,
        }

        _emit(self.event_callback, "status", {
            "message": "Model failed to produce a final reply after tools. Waiting for user decision: retry or cancel and restore."
        })
        _emit(self.event_callback, "post_tool_reply_decision", {
            "message": "The model completed the tool calls but returned an empty final reply. Retry the final answer, or cancel and restore to the state before the failed model response.",
            "options": ["retry", "cancel"],
        })

        try:
            while True:
                if cancel_event and cancel_event.is_set():
                    return "cancel"
                try:
                    return await asyncio.wait_for(asyncio.shield(decision_future), timeout=0.25)
                except asyncio.TimeoutError:
                    continue
        finally:
            self._pending_post_tool_reply = None

    async def _prompt_dangerous_tool_approval(self, tool_name: str, tool_args: dict, cancel_event: asyncio.Event | None) -> str:
        loop = asyncio.get_running_loop()
        decision_future = loop.create_future()
        command_text = (tool_args or {}).get("args", "") if isinstance(tool_args, dict) else str(tool_args)
        self._pending_dangerous_tool_approval = {
            "future": decision_future,
            "loop": loop,
            "tool": tool_name,
            "args": tool_args,
            "command": command_text,
        }

        _emit(self.event_callback, "status", {
            "message": f"Dangerous tool approval required before executing {tool_name}."
        })
        _emit(self.event_callback, "dangerous_tool_approval", {
            "tool": tool_name,
            "args": tool_args,
            "command": command_text,
            "message": "The model requested a dangerous shell command. Review the command below and approve or cancel execution.",
            "options": ["approve", "cancel"],
        })

        try:
            while True:
                if cancel_event and cancel_event.is_set():
                    return "cancel"
                try:
                    return await asyncio.wait_for(asyncio.shield(decision_future), timeout=0.25)
                except asyncio.TimeoutError:
                    continue
        finally:
            self._pending_dangerous_tool_approval = None

    def resolve_post_tool_reply_decision(self, action: str) -> bool:
        if action not in {"retry", "cancel"}:
            return False

        pending = self._pending_post_tool_reply
        if not pending:
            return False

        loop = pending.get("loop")
        future = pending.get("future")
        if not loop or not future:
            return False

        def _resolve():
            if not future.done():
                future.set_result(action)

        loop.call_soon_threadsafe(_resolve)
        return True

    def resolve_dangerous_tool_approval(self, action: str) -> bool:
        if action not in {"approve", "cancel"}:
            return False

        pending = self._pending_dangerous_tool_approval
        if not pending:
            return False

        loop = pending.get("loop")
        future = pending.get("future")
        if not loop or not future:
            return False

        if self._logger:
            command_text = pending.get("command", "")
            tool_name = pending.get("tool", "shell_dangerous")
            decision_text = (
                f"Approved dangerous command for {tool_name}: {command_text}"
                if action == "approve"
                else f"Denied dangerous command for {tool_name}: {command_text}"
            )
            self._logger.log_human_decision(decision_text, category="dangerous_tool_approval")

        def _resolve():
            if not future.done():
                future.set_result(action)

        loop.call_soon_threadsafe(_resolve)
        return True

    async def start(self) -> list[str]:
        """
        Launch the MCP server, connect, and discover tools.
        Returns a list of available tool names.
        """
        if not _HAVE_OLLAMA:
            _emit(self.event_callback, "error", {"message": "ollama Python library is not installed."})
            raise RuntimeError("ollama library not installed")

        self._logger = SessionLogger(
            run_id=self.run_id,
            metadata={
                "server_type": "agent",
                "model": self.model,
                "ollama_url": self.ollama_url,
                "context_window": self.context_window,
                "max_turns": self.max_turns,
                "network_policy": self.network_policy,
            },
            event_callback=self.event_callback,
        )

        _emit(self.event_callback, "status", {
            "message": f"Starting session {self.run_id} (context: {self.context_window} tokens, max turns: {self.max_turns}) …"
        })

        # Parse server command
        cmd_parts = shlex.split(self.server_command)
        server_params = StdioServerParameters(
            command=cmd_parts[0],
            args=cmd_parts[1:],
            env={
                **os.environ,
                "MCP_CURRENT_RUN_ID": self.run_id,
                "MCP_MODEL": self.model,
                "MCP_OLLAMA_URL": self.ollama_url,
                "MCP_NETWORK_POLICY": json.dumps(self.network_policy),
            },
        )

        # Configure ollama client
        self._client = _ollama_lib.Client(host=self.ollama_url)

        # Discover model's actual context length
        try:
            model_info = await asyncio.to_thread(self._client.show, self.model)
            mi = model_info if isinstance(model_info, dict) else {}
            params = mi.get("model_info", {}) or {}
            for key, val in params.items():
                if "context_length" in key:
                    self._model_max_ctx = int(val)
                    break
            _emit(self.event_callback, "status", {
                "message": f"Model {self.model} context length: {self._model_max_ctx} tokens"
            })
        except Exception:
            _emit(self.event_callback, "status", {
                "message": f"Could not query model context size, using {self.context_window} as limit."
            })

        _emit(self.event_callback, "context_usage", {
            "used": 0,
            "budget": self.context_window,
            "model_max": self._model_max_ctx,
        })

        # Connect to MCP server
        self._exit_stack = AsyncExitStack()
        _emit(self.event_callback, "status", {"message": "Connecting to MCP server …"})

        stdio_transport = await self._exit_stack.enter_async_context(
            stdio_client(server_params)
        )
        read_stream, write_stream = stdio_transport
        self._session = await self._exit_stack.enter_async_context(
            ClientSession(read_stream, write_stream)
        )
        await self._session.initialize()

        # Discover tools
        tools_result = await self._session.list_tools()
        mcp_tools = tools_result.tools
        self._ollama_tools = [_mcp_tool_to_ollama(t) for t in mcp_tools]
        self._ollama_tools_minimal = [_mcp_tool_to_ollama_minimal(t) for t in mcp_tools]
        self.tool_names = [t.name for t in mcp_tools]

        if self._logger:
            self._logger.update_metadata({
                "available_tools": self.tool_names,
                "available_tool_count": len(self.tool_names),
                "max_turns": self.max_turns,
            })

        if not self.tool_names:
            _emit(self.event_callback, "error", {
                "message": "MCP server started but exposed 0 tools. Configure at least one Kali tool before starting the session."
            })
            raise RuntimeError("MCP server exposed 0 tools")

        _emit(self.event_callback, "status", {
            "message": f"MCP server ready — {len(mcp_tools)} tool(s): {', '.join(self.tool_names)}"
        })
        _emit(self.event_callback, "service_started", {
            "tools": self.tool_names,
            "run_id": self.run_id,
        })

        self._started = True
        return self.tool_names

    async def chat(self, prompt: str, cancel_event: asyncio.Event | None = None):
        """
        Send a user prompt into the running session. Runs the full agent loop
        (LLM → tool calls → LLM … until text-only response), then returns.

        The conversation history carries over between calls.
        """
        if not self._started:
            _emit(self.event_callback, "error", {"message": "Session not started. Call start() first."})
            return

        # Serialise chat calls so two prompts don't overlap
        async with self._chat_lock:
            try:
                await self._run_agent_loop(prompt, cancel_event)
            except Exception as e:
                err_msg = f"Crash in agent loop: {type(e).__name__}: {str(e)}\n{traceback.format_exc()}"
                _emit(self.event_callback, "error", {"message": err_msg})
                print(err_msg)

    async def _run_agent_loop(self, prompt: str, cancel_event: asyncio.Event | None):
        """Core agent loop for a single chat turn."""
        self._logger.log_prompt(prompt)
        self.messages.append({"role": "user", "content": prompt})
        turn_tool_results: list[dict] = []

        max_iterations = self.max_turns
        for iteration in range(max_iterations):
            if cancel_event and cancel_event.is_set():
                _emit_chat_cancelled(self.event_callback)
                return

            # Context management: summarise if needed
            self.messages = await _maybe_summarise(
                self._client, self.model, self.messages,
                self.context_window, self.event_callback,
            )

            # Emit context usage
            est = _estimate_tokens(self.messages)
            _emit(self.event_callback, "context_usage", {
                "used": est,
                "budget": self.context_window,
                "model_max": self._model_max_ctx,
            })

            # Call Ollama
            _emit(self.event_callback, "status", {
                "message": f"Calling {self.model} (turn {iteration + 1}) …"
            })
            try:
                response = await asyncio.to_thread(
                    self._client.chat,
                    model=self.model,
                    messages=self.messages,
                    tools=self._ollama_tools if self._ollama_tools else None,
                    options={"num_ctx": self.context_window},
                )
            except Exception as exc:
                if self._ollama_tools and self._ollama_tools_minimal and _is_xml_schema_error(exc):
                    _emit(self.event_callback, "status", {
                        "message": "Model hit Ollama XML tool-schema bug; retrying with simplified tool metadata …"
                    })
                    response = await asyncio.to_thread(
                        self._client.chat,
                        model=self.model,
                        messages=self.messages,
                        tools=self._ollama_tools_minimal,
                        options={"num_ctx": self.context_window},
                    )
                else:
                    raise

            # Parse original message output
            original_msg = response.get("message", response)
            content = original_msg.get("content", getattr(original_msg, "content", "")) or ""
            tool_calls = original_msg.get("tool_calls", getattr(original_msg, "tool_calls", None))

            # The Ollama PyPI client returns a `Message` object. We must convert it
            # cleanly back to a dict with primitive values so it can be fed back in.
            assistant_message = {"role": "assistant", "content": content}
            if tool_calls:
                # Reconstruct tool_calls cleanly as dicts
                clean_tcs = []
                for tc in tool_calls:
                    tname, targs = _extract_tool_info(tc)
                    clean_tcs.append({
                        "function": {
                            "name": tname,
                            "arguments": targs
                        }
                    })
                assistant_message["tool_calls"] = clean_tcs

            self.messages.append(assistant_message)

            if content:
                self._logger.log_response(content)

            if not tool_calls and not content.strip():
                if turn_tool_results:
                    self.messages.pop()
                    if _can_auto_finalize_benign_empty(turn_tool_results):
                        benign_content = _build_benign_empty_finalization(turn_tool_results)
                        self.messages.append({"role": "assistant", "content": benign_content})
                        self._logger.log_response(benign_content)
                        _emit(self.event_callback, "chat_done", {
                            "message": "Finalized benign no-findings tool result without retry."
                        })
                        return

                    action = await self._prompt_post_tool_reply_decision(prompt, turn_tool_results, cancel_event)
                    if action == "retry":
                        recovered_content = await self._retry_empty_reply_after_tools(prompt, turn_tool_results)
                        if recovered_content:
                            self.messages.append({"role": "assistant", "content": recovered_content})
                            self._logger.log_response(recovered_content)
                            _emit(self.event_callback, "chat_done", {
                                "message": "Recovered final answer after user-approved retry."
                            })
                            return

                        _emit(self.event_callback, "error", {
                            "message": "Retry failed to produce a final answer. The conversation was restored to before the failed model response."
                        })
                        _emit(self.event_callback, "chat_done", {
                            "message": "Retry failed. Conversation restored to before the failed model reply."
                        })
                        return

                    _emit(self.event_callback, "status", {
                        "message": "Discarded the failed post-tool reply and restored the conversation to the last valid state."
                    })
                    _emit(self.event_callback, "chat_done", {
                        "message": "Cancelled retry. Conversation restored to before the failed model reply."
                    })
                    return

                self.messages.pop()

                detail = "Model returned an empty reply with no tool calls."
                if self.tool_names:
                    detail += " This usually indicates the selected model is not reliably using tools with Ollama for this prompt."
                else:
                    detail += " No tools are configured for this session."
                _emit(self.event_callback, "error", {"message": detail})
                _emit(self.event_callback, "chat_done", {
                    "message": "No response generated. Check tool configuration or switch to a stronger tool-calling model."
                })
                return

            # If no tool calls, this turn is done
            if not tool_calls:
                _emit(self.event_callback, "chat_done", {
                    "message": "Ready for next prompt."
                })
                return

            # Execute each tool call via MCP
            for tc in tool_calls:
                if cancel_event and cancel_event.is_set():
                    _emit_chat_cancelled(self.event_callback)
                    return

                tool_name, tool_args = _extract_tool_info(tc)

                policy_allowed, policy_message = _evaluate_network_policy(self.network_policy, tool_args)
                if not policy_allowed:
                    err_msg = f"Policy blocked tool call to {tool_name}: {policy_message}"
                    self._logger.log_tool_call(
                        name=tool_name,
                        args=tool_args,
                        result=err_msg,
                        duration_ms=0,
                        exit_code=-1,
                    )
                    self.messages.append({
                        "role": "tool",
                        "content": err_msg,
                        "name": tool_name,
                    })
                    _emit(self.event_callback, "status", {"message": err_msg})
                    continue

                if tool_name == "shell_dangerous":
                    approval = await self._prompt_dangerous_tool_approval(tool_name, tool_args, cancel_event)
                    if approval != "approve":
                        denial_msg = "Dangerous shell command was cancelled by the user before execution."
                        self._logger.log_tool_call(
                            name=tool_name,
                            args=tool_args,
                            result=denial_msg,
                            duration_ms=0,
                            exit_code=-1,
                        )
                        self.messages.append({
                            "role": "tool",
                            "content": denial_msg,
                            "name": tool_name,
                        })
                        turn_tool_results.append({
                            "tool": tool_name,
                            "args": tool_args,
                            "result": denial_msg,
                            "exit_code": -1,
                            "duration_ms": 0,
                        })
                        _emit(self.event_callback, "status", {"message": denial_msg})
                        continue

                _emit(self.event_callback, "tool_call", {
                    "tool": tool_name,
                    "args": tool_args,
                })

                t0 = time.time()
                try:
                    result = await self._session.call_tool(tool_name, tool_args)
                    duration_ms = int((time.time() - t0) * 1000)

                    result_text = ""
                    if result.content:
                        result_text = "\n".join(
                            getattr(c, "text", str(c))
                            for c in result.content
                        )

                    is_error = getattr(result, "isError", False)
                    exit_code = -1 if is_error else 0

                    self._logger.log_tool_call(
                        name=tool_name,
                        args=tool_args,
                        result=result_text,
                        duration_ms=duration_ms,
                        exit_code=exit_code,
                    )

                    context_result = _truncate_tool_output(result_text)
                    self.messages.append({
                        "role": "tool",
                        "content": context_result,
                        "name": tool_name,
                    })
                    turn_tool_results.append({
                        "tool": tool_name,
                        "args": tool_args,
                        "result": result_text,
                        "exit_code": exit_code,
                        "duration_ms": duration_ms,
                    })

                except Exception as exc:
                    duration_ms = int((time.time() - t0) * 1000)
                    err_msg = f"Tool error: {exc}"
                    self._logger.log_tool_call(
                        name=tool_name,
                        args=tool_args,
                        result=err_msg,
                        duration_ms=duration_ms,
                        exit_code=-1,
                    )
                    self.messages.append({
                        "role": "tool",
                        "content": err_msg,
                    })
                    turn_tool_results.append({
                        "tool": tool_name,
                        "args": tool_args,
                        "result": err_msg,
                        "exit_code": -1,
                        "duration_ms": duration_ms,
                    })

        # Hit iteration limit for this turn
        _emit(self.event_callback, "status", {
            "message": f"Reached maximum iterations ({max_iterations}) for this turn."
        })
        _emit(self.event_callback, "chat_done", {
            "message": "Max iterations reached. Ready for next prompt."
        })

    async def stop(self):
        """Gracefully shut down the MCP connection and finalize logs."""
        if not self._started:
            return

        self._started = False
        _emit(self.event_callback, "status", {"message": "Stopping session …"})

        try:
            if self._exit_stack:
                await self._exit_stack.aclose()
                self._exit_stack = None
        except Exception as exc:
            _emit(self.event_callback, "status", {
                "message": f"Warning during shutdown: {exc}"
            })

        try:
            if self._logger:
                self._logger.finalize("completed")
        except Exception:
            pass

        _emit(self.event_callback, "service_stopped", {"message": "Session stopped."})
        _emit(self.event_callback, "done", {"message": "Session ended."})
