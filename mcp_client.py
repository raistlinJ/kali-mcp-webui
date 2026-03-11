#!/usr/bin/env python3
"""
mcp_client.py — Pure-Python MCP agent loop.

Uses the official `mcp` SDK to connect to an MCP server via stdio,
and the `ollama` library to drive LLM chat completions with tool use.

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
        # tool_calls can add content too
        tcs = msg.get("tool_calls")
        if tcs:
            total_chars += len(json.dumps(tcs))
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
                func = tc.get("function", tc)
                history_text += f"[tool_call]: {func.get('name', '?')}({json.dumps(func.get('arguments', {}))})\n"

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


# ---------------------------------------------------------------------------
# Main agent loop
# ---------------------------------------------------------------------------

async def run_agent(
    *,
    ollama_url: str,
    model: str,
    server_command: str,
    prompt: str,
    run_id: str | None = None,
    event_callback=None,
    cancel_event: asyncio.Event | None = None,
    context_window: int = DEFAULT_CONTEXT_WINDOW,
):
    """
    Execute a single agent turn:
      1. Connect to the MCP server via stdio.
      2. Discover available tools.
      3. Send the user prompt to Ollama with tool definitions.
      4. Loop: execute any tool calls via MCP -> feed results back -> repeat.
      5. Return when the LLM produces a final text answer (no more tool calls).

    Context management:
      - Large tool outputs are truncated.
      - When the conversation exceeds ~75% of `context_window`, older messages
        are summarised by the LLM and replaced with a compact summary.

    Args:
        ollama_url:      Base URL of the Ollama instance.
        model:           Model name to use, e.g. "llama3".
        server_command:  Shell command to launch the MCP server (split via shlex).
        prompt:          The user's natural-language prompt.
        run_id:          Session run ID (auto-generated if None).
        event_callback:  Callable receiving event dicts for SSE broadcast.
        cancel_event:    asyncio.Event that, when set, aborts the loop.
        context_window:  Token budget for the conversation (default 8192).
    """
    if not _HAVE_OLLAMA:
        _emit(event_callback, "error", {"message": "ollama Python library is not installed."})
        return

    # Session setup
    if not run_id:
        run_id = make_run_id("agent")

    logger = SessionLogger(
        run_id=run_id,
        metadata={
            "server_type": "agent",
            "model": model,
            "ollama_url": ollama_url,
            "context_window": context_window,
        },
        event_callback=event_callback,
    )

    _emit(event_callback, "status", {"message": f"Starting agent session {run_id} (context: {context_window} tokens) …"})

    cmd_parts = shlex.split(server_command)
    server_params = StdioServerParameters(
        command=cmd_parts[0],
        args=cmd_parts[1:],
        env={
            **os.environ,
            "MCP_CURRENT_RUN_ID": run_id,
            "MCP_MODEL": model,
            "MCP_OLLAMA_URL": ollama_url,
        },
    )

    # Configure ollama client
    client = _ollama_lib.Client(host=ollama_url)

    # Discover model's actual context length from Ollama
    model_max_ctx = context_window  # fallback
    try:
        model_info = await asyncio.to_thread(client.show, model)
        # model_info may have 'model_info' dict or 'parameters' string
        mi = model_info if isinstance(model_info, dict) else {}
        # Check modelfile parameters for num_ctx
        params = mi.get("model_info", {}) or {}
        for key, val in params.items():
            if "context_length" in key:
                model_max_ctx = int(val)
                break
        _emit(event_callback, "status", {
            "message": f"Model {model} context length: {model_max_ctx} tokens"
        })
    except Exception:
        _emit(event_callback, "status", {
            "message": f"Could not query model context size, using {context_window} as limit."
        })

    # Emit initial context info
    _emit(event_callback, "context_usage", {
        "used": 0,
        "budget": context_window,
        "model_max": model_max_ctx,
    })

    exit_stack = AsyncExitStack()

    try:
        async with exit_stack:
            # Connect to MCP server
            _emit(event_callback, "status", {"message": "Connecting to MCP server …"})
            stdio_transport = await exit_stack.enter_async_context(
                stdio_client(server_params)
            )
            read_stream, write_stream = stdio_transport
            session = await exit_stack.enter_async_context(
                ClientSession(read_stream, write_stream)
            )
            await session.initialize()

            # Discover tools
            tools_result = await session.list_tools()
            mcp_tools = tools_result.tools
            ollama_tools = [_mcp_tool_to_ollama(t) for t in mcp_tools]

            tool_names = [t.name for t in mcp_tools]
            _emit(event_callback, "status", {
                "message": f"MCP server ready — {len(mcp_tools)} tool(s): {', '.join(tool_names)}"
            })

            # --- Agent loop ---
            logger.log_prompt(prompt)

            messages = [{"role": "user", "content": prompt}]

            max_iterations = 20
            for iteration in range(max_iterations):
                # Check for cancellation
                if cancel_event and cancel_event.is_set():
                    _emit(event_callback, "status", {"message": "Session cancelled by user."})
                    logger.finalize("cancelled")
                    return

                # Context management: summarise if needed
                messages = await _maybe_summarise(
                    client, model, messages, context_window, event_callback
                )

                # Emit context usage
                est = _estimate_tokens(messages)
                _emit(event_callback, "context_usage", {
                    "used": est,
                    "budget": context_window,
                    "model_max": model_max_ctx,
                })

                # Call Ollama
                _emit(event_callback, "status", {"message": f"Calling {model} (turn {iteration + 1}) …"})
                response = await asyncio.to_thread(
                    client.chat,
                    model=model,
                    messages=messages,
                    tools=ollama_tools if ollama_tools else None,
                    options={"num_ctx": context_window},
                )

                assistant_message = response.get("message", response)
                content = assistant_message.get("content", "") or ""
                tool_calls = assistant_message.get("tool_calls", None)

                # Append the assistant message to the conversation
                messages.append(assistant_message)

                # Emit text response (even partial)
                if content:
                    logger.log_response(content)

                # If no tool calls, we're done
                if not tool_calls:
                    _emit(event_callback, "done", {"message": "Agent finished."})
                    logger.finalize("completed")
                    return

                # Execute each tool call via MCP
                for tc in tool_calls:
                    if cancel_event and cancel_event.is_set():
                        _emit(event_callback, "status", {"message": "Session cancelled by user."})
                        logger.finalize("cancelled")
                        return

                    func = tc.get("function", tc)
                    tool_name = func.get("name", "unknown")
                    tool_args = func.get("arguments", {})

                    _emit(event_callback, "tool_call", {
                        "tool": tool_name,
                        "args": tool_args,
                    })

                    t0 = time.time()
                    try:
                        result = await session.call_tool(tool_name, tool_args)
                        duration_ms = int((time.time() - t0) * 1000)

                        result_text = ""
                        if result.content:
                            result_text = "\n".join(
                                getattr(c, "text", str(c))
                                for c in result.content
                            )

                        is_error = getattr(result, "isError", False)
                        exit_code = -1 if is_error else 0

                        logger.log_tool_call(
                            name=tool_name,
                            args=tool_args,
                            result=result_text,
                            duration_ms=duration_ms,
                            exit_code=exit_code,
                        )

                        # Truncate large tool outputs before adding to context
                        context_result = _truncate_tool_output(result_text)

                        # Feed tool result back as a tool message
                        messages.append({
                            "role": "tool",
                            "content": context_result,
                        })

                    except Exception as exc:
                        duration_ms = int((time.time() - t0) * 1000)
                        err_msg = f"Tool error: {exc}"
                        logger.log_tool_call(
                            name=tool_name,
                            args=tool_args,
                            result=err_msg,
                            duration_ms=duration_ms,
                            exit_code=-1,
                        )
                        messages.append({
                            "role": "tool",
                            "content": err_msg,
                        })

            # If we hit the iteration limit
            _emit(event_callback, "status", {
                "message": f"Reached maximum iterations ({max_iterations}). Stopping."
            })
            logger.finalize("max_iterations")

    except Exception as exc:
        tb = traceback.format_exc()
        _emit(event_callback, "error", {"message": f"Agent error: {exc}\n{tb}"})
        try:
            logger.finalize("error")
        except Exception:
            pass
