#!/usr/bin/env python3
"""
ollmcp_logger.py — Logs user prompts and LLM responses from ollmcp sessions.

Wraps ollmcp using a PTY so it gets a real terminal (preserving interactive
features like progress indicators) while intercepting I/O for session logging.

Usage — replace 'ollmcp' with this script:
    python3 ollmcp_logger.py --model <m> --host <h> --servers-json ./server_config.json
"""

import os
import pty
import re
import sys

# ---------------------------------------------------------------------------
# Session logger setup
# ---------------------------------------------------------------------------
try:
    from session_logger import SessionLogger, make_run_id
    _HAVE_LOGGER = True
except ImportError:
    _HAVE_LOGGER = False

# ANSI escape sequence stripper
_ANSI_RE = re.compile(rb'\x1b\[[0-9;]*[mKJHABCDGSTufABCDnsu]|\x1b[()][AB0-9]|\r')
# ollmcp prompt contains ❯ (UTF-8: \xe2\x9d\xaf)
_PROMPT_BYTES = b'\xe2\x9d\xaf'


def _strip(data: bytes) -> str:
    """Strip ANSI codes and return clean unicode string."""
    return _ANSI_RE.sub(b'', data).decode('utf-8', errors='replace')


def main():
    if not _HAVE_LOGGER:
        # Fallback: just exec ollmcp directly if logger isn't available
        os.execvp('ollmcp', ['ollmcp'] + sys.argv[1:])
        return

    # Generate a fresh run ID and expose it so MCP servers share this folder
    label = os.environ.get('MCP_RUN_ID', 'session')
    run_id = make_run_id(label)
    os.environ['MCP_CURRENT_RUN_ID'] = run_id

    logger = SessionLogger(
        run_id=run_id,
        metadata={
            'server_type': os.environ.get('MCP_SERVER_TYPE', 'native'),
            'model': os.environ.get('MCP_MODEL', 'unknown'),
            'ollama_url': os.environ.get('MCP_OLLAMA_URL', 'unknown'),
        }
    )

    # ---------------------------------------------------------------------------
    # Buffers and state
    # ---------------------------------------------------------------------------
    output_buf = bytearray()   # accumulates ollmcp output between prompts
    user_buf = bytearray()     # accumulates current user keystroke line
    state = {'after_prompt': True}  # start ready to capture first user input

    def stdin_read(fd: int) -> bytes:
        """Called when user types. Capture the line for logging."""
        data = os.read(fd, 1024)
        try:
            if state['after_prompt']:
                clean = _ANSI_RE.sub(b'', data)
                user_buf.extend(clean)
                # Flush on enter
                if b'\r' in clean or b'\n' in clean:
                    text = user_buf.decode('utf-8', errors='replace').strip()
                    if text:
                        logger.log_prompt(text)
                    user_buf.clear()
                    state['after_prompt'] = False
        except Exception:
            pass
        return data

    def master_read(fd: int) -> bytes:
        """Called when ollmcp produces output. Detect turn boundaries via ❯."""
        data = os.read(fd, 4096)
        try:
            output_buf.extend(data)
            if _PROMPT_BYTES in data:
                raw = bytes(output_buf)
                parts = raw.split(_PROMPT_BYTES)
                response_chunk = _strip(parts[0]).strip()
                lines = [
                    ln for ln in response_chunk.splitlines()
                    if ln.strip()
                    and not ln.strip().startswith('(New!)')
                    and not ln.strip().startswith('Connecting')
                    and not ln.strip().startswith('Found server')
                ]
                if lines:
                    logger.log_response('\n'.join(lines))
                output_buf.clear()
                state['after_prompt'] = True
        except Exception:
            pass
        return data

    # ---------------------------------------------------------------------------
    # Save terminal state so we can restore it if the PTY exits unexpectedly
    # ---------------------------------------------------------------------------
    import termios
    try:
        _saved_term = termios.tcgetattr(sys.stdin.fileno())
    except Exception:
        _saved_term = None

    # ---------------------------------------------------------------------------
    # Run ollmcp inside a PTY
    # ---------------------------------------------------------------------------
    try:
        pty.spawn(['ollmcp'] + sys.argv[1:], master_read, stdin_read)
    except Exception:
        pass
    finally:
        # Restore terminal to sane state (cooked mode) so the shell works after exit
        if _saved_term is not None:
            try:
                termios.tcsetattr(sys.stdin.fileno(), termios.TCSADRAIN, _saved_term)
            except Exception:
                pass
        # Log any trailing output
        if output_buf:
            try:
                resp = _strip(bytes(output_buf)).strip()
                if resp:
                    logger.log_response(resp)
            except Exception:
                pass
        logger.finalize()


if __name__ == '__main__':
    main()
