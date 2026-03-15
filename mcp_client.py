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
import json
import os
import shlex
import time
import traceback
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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mcp_tool_to_ollama(tool) -> dict:
    """Convert an MCP Tool object to the Ollama function-calling schema."""
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description or f"Run {tool.name}",
            "parameters": tool.inputSchema if tool.inputSchema else {
                "type": "object",
                "properties": {},
            },
        },
    }


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
        "message": f"Context ~{est_tokens} tokens (budget {context_window}) — summarising older history …"
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
    ):
        self.ollama_url = ollama_url
        self.model = model
        self.server_command = server_command
        self.context_window = context_window
        self.event_callback = event_callback
        self.run_id = run_id or make_run_id("agent")
        
        # Initialize with a strong system prompt to ensure tools aren't sent to the background
        self.messages: list[dict] = [
            {
                "role": "system",
                "content": "You are a network security assistant. You must wait for all tools to finish executing. NEVER attempt to run tools in the background (e.g., using `&` or `nohup`). You MUST allow the system to execute the tool synchronously so you can read and analyze the output before replying."
            }
        ]
        
        self.tool_names: list[str] = []
        self._ollama_tools: list[dict] = []
        self._model_max_ctx: int = context_window

        # Internals
        self._exit_stack: AsyncExitStack | None = None
        self._session: ClientSession | None = None
        self._client = None
        self._logger: SessionLogger | None = None
        self._started = False
        self._chat_lock = asyncio.Lock()

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
            },
            event_callback=self.event_callback,
        )

        _emit(self.event_callback, "status", {
            "message": f"Starting session {self.run_id} (context: {self.context_window} tokens) …"
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
        self.tool_names = [t.name for t in mcp_tools]

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

        max_iterations = 20
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
            response = await asyncio.to_thread(
                self._client.chat,
                model=self.model,
                messages=self.messages,
                tools=self._ollama_tools if self._ollama_tools else None,
                options={"num_ctx": self.context_window},
            )

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
