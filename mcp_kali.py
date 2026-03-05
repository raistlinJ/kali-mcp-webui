import json
import sys
import subprocess
from mcp.server import Server
from mcp.types import Tool, TextContent

server = Server("mcp-kali")

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
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300) # 5 min timeout
        output = result.stdout
        if result.stderr:
            output += f"\nSTDERR:\n{result.stderr}"
        return [TextContent(type="text", text=output or "Command executed successfully (no output)")]
    except Exception as e:
        return [TextContent(type="text", text=f"Execution error: {str(e)}")]

async def main():
    from mcp.server.stdio import stdio_server
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
