import json
import sys
import subprocess
import time
import os
from mcp.server import Server
from mcp.types import Tool, TextContent
from session_logger import SessionLogger, make_run_id

server = Server("mcp-kali")

# Initialize session logger on startup
_run_id = os.environ.get("MCP_RUN_ID") or make_run_id("native")
_logger = SessionLogger(
    run_id=_run_id,
    metadata={
        "server_type": "native",
        "model": os.environ.get("MCP_MODEL", "unknown"),
        "ollama_url": os.environ.get("MCP_OLLAMA_URL", "unknown"),
    }
)

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
            description=f"Run {t['name']}",
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
        
    cmd = [tool_config["command"]]
    if tool_config.get("allow_args", False) and "args" in arguments:
        import shlex
        cmd.extend(shlex.split(arguments["args"]))
        
    try:
        t0 = time.time()
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        duration_ms = int((time.time() - t0) * 1000)

        output = result.stdout
        stderr = result.stderr or ""
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
