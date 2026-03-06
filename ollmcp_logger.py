#!/usr/bin/env python3
"""
ollmcp_logger.py — Safe transcript logger for ollmcp that avoids PTY wrapping.

Uses script(1) if available to record the terminal session as a raw log,
then runs ollmcp directly so tool execution is never blocked.

NOTE: User-entered text is NOT captured this way (ollmcp's stdin isn't piped).
      Tool calls and results are logged by mcp_kali.py / apt_logger_wrapper.py.
      This script only sets up the run ID and passes through to ollmcp.
"""

import os
import sys

try:
    from session_logger import make_run_id
    label = os.environ.get("MCP_RUN_ID", "session")
    run_id = make_run_id(label)
    os.environ["MCP_CURRENT_RUN_ID"] = run_id
    print(f"[logger] Session run ID: {run_id}", flush=True)
except Exception:
    pass

# Exec ollmcp directly — no PTY wrapping, no pipes, no interference
os.execvp("ollmcp", ["ollmcp"] + sys.argv[1:])
