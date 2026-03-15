import json
import sys
import subprocess
import time
import os
import shlex
import re
from mcp.server import Server
from mcp.types import Tool, TextContent

server = Server("mcp-kali")

_ALLOWED_SHELL_COMMANDS = {
    "ls",
    "cat",
    "grep",
    "docker",
    "ip",
    "ss",
    "ps",
    "uname",
    "id",
    "pwd",
    "whoami",
    "find",
}
_DISALLOWED_SHELL_TOKENS = {"|", "||", "&", "&&", ";", ">", ">>", "<", "<<"}
_ANSI_ESCAPE_RE = re.compile(r'\x1B\[[0-?]*[ -/]*[@-~]')


def _strip_ansi(text: str) -> str:
    if not text:
        return text
    return _ANSI_ESCAPE_RE.sub("", text)

# Session logging — optional: if session_logger.py is unavailable the server still works
try:
    from session_logger import SessionLogger, make_run_id as _make_run_id

    # If the web UI is driving this session, use its exact run ID so all
    # logs end up in the same folder. Otherwise generate a fresh ID per invocation.
    if "MCP_CURRENT_RUN_ID" in os.environ:
        _run_id = os.environ["MCP_CURRENT_RUN_ID"]
    else:
        _label = os.environ.get("MCP_RUN_ID", "native")
        _run_id = _make_run_id(_label)
    _logger = SessionLogger(
        run_id=_run_id,
        metadata={
            "server_type": "native",
            "model": os.environ.get("MCP_MODEL", "unknown"),
            "ollama_url": os.environ.get("MCP_OLLAMA_URL", "unknown"),
        }
    )
except Exception:
    # Fallback no-op logger so the server runs even without session_logger
    class _NoopLogger:
        def log_tool_call(self, *a, **kw): pass
        def finalize(self, *a, **kw): pass
    _logger = _NoopLogger()


@server.list_tools()
async def list_tools() -> list[Tool]:
    try:
        with open("kali_tools.json") as f:
            config = json.load(f)
    except Exception:
        config = {"tools": []}
    
    tools = []
    for t in config.get("tools", []):
        tools.append(Tool(
            name=t["name"],
            description=t.get("description", f"Run {t['name']}"),
            inputSchema={
                "type": "object",
                "properties": {
                    "args": {"type": "string", "description": "Arguments to pass to the tool"}
                }
            }
        ))
    return tools

@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    try:
        with open("kali_tools.json") as f:
            config = json.load(f)
    except Exception:
        return [TextContent(type="text", text="Error: Could not read kali_tools.json")]
        
    tool_config = next((t for t in config.get("tools", []) if t["name"] == name), None)
    if not tool_config:
        return [TextContent(type="text", text=f"Error: Tool {name} not found in config")]

    if name == "shell":
        user_args = (arguments.get("args", "") or "").strip()
        if not user_args:
            return [TextContent(type="text", text="Error: shell requires a command, e.g. 'ls -la', 'ip addr', or 'docker ps'")]

        try:
            shell_parts = shlex.split(user_args)
        except ValueError as exc:
            return [TextContent(type="text", text=f"Error: Invalid shell arguments: {exc}")]

        if not shell_parts:
            return [TextContent(type="text", text="Error: shell requires a command")]

        shell_command = shell_parts[0]
        if shell_command not in _ALLOWED_SHELL_COMMANDS:
            allowed = ", ".join(sorted(_ALLOWED_SHELL_COMMANDS))
            return [TextContent(type="text", text=f"Error: '{shell_command}' is not allowed. Allowed commands: {allowed}")]

        if any(token in _DISALLOWED_SHELL_TOKENS for token in shell_parts[1:]):
            return [TextContent(type="text", text="Error: shell does not allow command chaining, pipes, or redirection")]

        cmd = shell_parts
    else:
        cmd = [tool_config["command"]]
        base_args = tool_config.get("base_args", [])
        user_args = arguments.get("args", "")
        
        if base_args:
            # If we have base_args, check for {args} placeholder or just extend
            has_placeholder = any("{args}" in a for a in base_args)
            if has_placeholder:
                cmd.extend([a.replace("{args}", user_args) for a in base_args])
            else:
                cmd.extend(base_args)
                if tool_config.get("allow_args", False) and user_args:
                    cmd.extend(shlex.split(user_args))
        elif tool_config.get("allow_args", False) and user_args:
            cmd.extend(shlex.split(user_args))
        
    try:
        t0 = time.time()
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        duration_ms = int((time.time() - t0) * 1000)

        output = _strip_ansi(result.stdout or "")
        stderr = _strip_ansi(result.stderr or "")
        if stderr:
            output += f"\nSTDERR:\n{stderr}"

        # Log the tool call
        _logger.log_tool_call(
            name=name,
            args=arguments,
            result=output or "Command executed successfully (no output)",
            duration_ms=duration_ms,
            exit_code=result.returncode,
            stderr=stderr,
        )

        return [TextContent(type="text", text=output or "Command executed successfully (no output)")]
    except Exception as e:
        err_msg = f"Execution error: {str(e)}"
        _logger.log_tool_call(name=name, args=arguments, result=err_msg, exit_code=-1)
        return [TextContent(type="text", text=err_msg)]

async def main():
    try:
        from mcp.server.stdio import stdio_server
        async with stdio_server() as (read_stream, write_stream):
            await server.run(read_stream, write_stream, server.create_initialization_options())
    finally:
        _logger.finalize()

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
