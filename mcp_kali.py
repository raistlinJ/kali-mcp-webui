import json
import sys
import subprocess
import time
import os
import shlex
import re
import ipaddress
from urllib.parse import urlparse
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
_ALLOWED_EXTENDED_SHELL_COMMANDS = {
    "curl",
    "dig",
    "host",
    "nslookup",
    "openssl",
    "tracepath",
    "traceroute",
    "ping",
}
_DISALLOWED_SHELL_TOKENS = {"|", "||", "&", "&&", ";", ">", ">>", "<", "<<"}
_DISALLOWED_CURL_FLAGS = {
    "-d",
    "--data",
    "--data-ascii",
    "--data-binary",
    "--data-raw",
    "--data-urlencode",
    "-F",
    "--form",
    "--form-string",
    "-o",
    "--output",
    "-O",
    "--remote-name",
    "--remote-name-all",
    "-T",
    "--upload-file",
    "-K",
    "--config",
    "-X",
    "--request",
}
_DISALLOWED_CURL_SCHEMES = ("file://", "ftp://", "ftps://", "scp://", "sftp://", "ldap://", "dict://", "gopher://")
_DISALLOWED_OPENSSL_FLAGS = {
    "-key",
    "-cert",
    "-CAfile",
    "-CApath",
    "-CRL",
    "-CRLform",
    "-CRL_download",
    "-pass",
    "-passin",
    "-proxy",
    "-sess_out",
    "-keylogfile",
}
_ANSI_ESCAPE_RE = re.compile(r'\x1B\[[0-?]*[ -/]*[@-~]')
_URL_RE = re.compile(r'https?://[^\s]+', re.IGNORECASE)
_CIDR_OR_IP_RE = re.compile(r'\b(?:\d{1,3}\.){3}\d{1,3}(?:/\d{1,2})?\b')
_HOSTNAME_RE = re.compile(r'^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\.?$', re.IGNORECASE)
_MSF_RUN_DEFAULT_TIMEOUT = 90
_MSF_RUN_DEFAULT_WFS_DELAY = 10
_MAX_SHELL_SEQUENCE_COMMANDS = 3
_TIMEOUT_CONTROL_DIRNAME = "control"
_TIMEOUT_REQUEST_FILENAME = "tool_timeout_request.json"
_TIMEOUT_RESPONSE_FILENAME = "tool_timeout_response.json"
_TIMEOUT_DECISION_POLL_SECONDS = 0.25
_CANCEL_REQUEST_FILENAME = "tool_cancel_request.json"
_PROCESS_CANCEL_POLL_SECONDS = 0.25

try:
    _NETWORK_POLICY = json.loads(os.environ.get("MCP_NETWORK_POLICY", ""))
except Exception:
    _NETWORK_POLICY = {"allow": ["*"], "disallow": []}


def _strip_ansi(text: str) -> str:
    if not text:
        return text
    return _ANSI_ESCAPE_RE.sub("", text)


def _normalize_network_policy(policy) -> dict:
    policy = policy or {}
    allow = [str(item).strip() for item in policy.get("allow", ["*"]) if str(item).strip()]
    disallow = [str(item).strip() for item in policy.get("disallow", []) if str(item).strip()]
    if not allow:
        allow = ["*"]
    return {"allow": allow, "disallow": disallow}


def _prepare_msf_run_args(user_args: str) -> str:
    commands = [part.strip() for part in (user_args or "").split(";") if part.strip()]
    if not commands:
        return (user_args or "").strip()

    module_type = None
    for command in commands:
        lower = command.lower()
        if lower.startswith("use "):
            module_path = command[4:].strip().lower()
            if module_path.startswith("exploit/"):
                module_type = "exploit"
            elif module_path.startswith("auxiliary/"):
                module_type = "auxiliary"
            break

    is_exploit_workflow = module_type == "exploit"
    has_wfsdelay = any(
        cmd.lower().startswith("set wfsdelay ") or cmd.lower().startswith("setg wfsdelay ")
        for cmd in commands
    )

    normalized = []
    inserted_wfsdelay = False
    for command in commands:
        lower = command.lower()
        is_run_command = lower == "exploit" or lower.startswith("exploit ") or lower == "run" or lower.startswith("run ")

        if is_exploit_workflow and is_run_command and not has_wfsdelay and not inserted_wfsdelay:
            normalized.append(f"set WfsDelay {_MSF_RUN_DEFAULT_WFS_DELAY}")
            inserted_wfsdelay = True

        if is_exploit_workflow and is_run_command:
            tokens = command.split()
            if "-z" not in tokens:
                command = f"{command} -z"

        normalized.append(command)

    return "; ".join(normalized)


def _next_shell_token(tokens: list[str], index: int) -> str | None:
    if index + 1 >= len(tokens):
        return None
    return tokens[index + 1]


def _normalize_extended_shell_command(shell_parts: list[str]) -> tuple[list[str] | None, str | None]:
    shell_command = shell_parts[0]

    if shell_command == "curl":
        for token in shell_parts[1:]:
            if token in _DISALLOWED_CURL_FLAGS:
                blocked = ", ".join(sorted(_DISALLOWED_CURL_FLAGS))
                return None, f"Error: curl in shell_extended is limited to read-only requests. Disallowed flags: {blocked}"
            lowered = token.lower()
            if lowered.startswith(_DISALLOWED_CURL_SCHEMES):
                blocked_schemes = ", ".join(_DISALLOWED_CURL_SCHEMES)
                return None, f"Error: curl in shell_extended only allows HTTP(S) targets. Disallowed schemes: {blocked_schemes}"
        return shell_parts, None

    if shell_command == "openssl":
        if len(shell_parts) < 2 or shell_parts[1] != "s_client":
            return None, "Error: openssl in shell_extended only allows the 's_client' subcommand"
        for token in shell_parts[2:]:
            if token in _DISALLOWED_OPENSSL_FLAGS:
                blocked = ", ".join(sorted(_DISALLOWED_OPENSSL_FLAGS))
                return None, f"Error: openssl s_client in shell_extended disallows local file, proxy, and session output flags: {blocked}"
        return shell_parts, None

    if shell_command in {"tracepath", "traceroute"}:
        has_max_hops = any(token in {"-m", "--max-hops"} for token in shell_parts[1:])
        normalized = list(shell_parts)
        if not has_max_hops:
            normalized.extend(["-m", "16"])
        return normalized, None

    if shell_command == "ping":
        if any(token == "-f" for token in shell_parts[1:]):
            return None, "Error: ping in shell_extended does not allow flood mode (-f)"

        normalized = list(shell_parts)
        count_index = None
        for index, token in enumerate(normalized[1:], start=1):
            if token == "-c":
                count_index = index
                break

        if count_index is None:
            normalized.extend(["-c", "4"])
            return normalized, None

        count_value = _next_shell_token(normalized, count_index)
        if count_value is None:
            return None, "Error: ping count flag (-c) requires a numeric value"

        try:
            count = int(count_value)
        except ValueError:
            return None, "Error: ping count flag (-c) requires a numeric value"

        if count < 1 or count > 5:
            return None, "Error: ping in shell_extended only allows counts between 1 and 5"
        return normalized, None

    return shell_parts, None


def _parse_shell_sequence(raw_args: str) -> tuple[list[str] | None, str | None]:
    raw_text = (raw_args or "").strip()
    if not raw_text:
        return None, "Error: shell_sequence requires commands, either as a JSON array or one command per line"

    commands: list[str]
    if raw_text.startswith("["):
        try:
            parsed = json.loads(raw_text)
        except json.JSONDecodeError as exc:
            return None, f"Error: Invalid shell_sequence JSON array: {exc}"
        if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
            return None, "Error: shell_sequence JSON input must be an array of command strings"
        commands = [item.strip() for item in parsed if item.strip()]
    else:
        commands = [line.strip() for line in raw_text.splitlines() if line.strip()]

    if not commands:
        return None, "Error: shell_sequence requires at least one non-empty command"
    if len(commands) > _MAX_SHELL_SEQUENCE_COMMANDS:
        return None, f"Error: shell_sequence allows at most {_MAX_SHELL_SEQUENCE_COMMANDS} commands per call"

    return commands, None


def _run_dir_for_current_session() -> str | None:
    run_id = os.environ.get("MCP_CURRENT_RUN_ID")
    if not run_id:
        return None
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "runs", run_id)


def _timeout_control_dir() -> str | None:
    run_dir = _run_dir_for_current_session()
    if not run_dir:
        return None
    return os.path.join(run_dir, _TIMEOUT_CONTROL_DIRNAME)


def _timeout_request_path() -> str | None:
    control_dir = _timeout_control_dir()
    if not control_dir:
        return None
    return os.path.join(control_dir, _TIMEOUT_REQUEST_FILENAME)


def _timeout_response_path() -> str | None:
    control_dir = _timeout_control_dir()
    if not control_dir:
        return None
    return os.path.join(control_dir, _TIMEOUT_RESPONSE_FILENAME)


def _cancel_request_path() -> str | None:
    control_dir = _timeout_control_dir()
    if not control_dir:
        return None
    return os.path.join(control_dir, _CANCEL_REQUEST_FILENAME)


def _cancel_requested() -> bool:
    path = _cancel_request_path()
    return bool(path and os.path.exists(path))


def _clear_timeout_control_files():
    for path in (_timeout_request_path(), _timeout_response_path(), _cancel_request_path()):
        if path and os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass


def _write_timeout_request(tool_name: str, arguments: dict, cmd: list[str], timeout_seconds: int, checkpoint_index: int) -> str | None:
    request_path = _timeout_request_path()
    response_path = _timeout_response_path()
    if not request_path or not response_path:
        return None

    os.makedirs(os.path.dirname(request_path), exist_ok=True)
    if os.path.exists(response_path):
        try:
            os.remove(response_path)
        except OSError:
            pass

    request_id = f"{int(time.time() * 1000)}-{checkpoint_index}"
    payload = {
        "request_id": request_id,
        "tool": tool_name,
        "args": arguments,
        "command": shlex.join(cmd),
        "timeout_seconds": int(timeout_seconds),
        "checkpoint_index": int(checkpoint_index),
        "timestamp": time.time(),
    }
    with open(request_path, "w") as f:
        json.dump(payload, f, indent=2)
    return request_id


def _await_timeout_decision(proc: subprocess.Popen, tool_name: str, arguments: dict, cmd: list[str], timeout_seconds: int, checkpoint_index: int) -> str:
    request_id = _write_timeout_request(tool_name, arguments, cmd, timeout_seconds, checkpoint_index)
    if not request_id:
        return "kill"

    response_path = _timeout_response_path()
    request_path = _timeout_request_path()

    try:
        while True:
            if proc.poll() is not None:
                return "finished"

            if _cancel_requested():
                return "kill"

            if response_path and os.path.exists(response_path):
                try:
                    with open(response_path) as f:
                        response = json.load(f)
                except Exception:
                    response = None

                if isinstance(response, dict) and response.get("request_id") == request_id:
                    action = str(response.get("action") or "").strip().lower()
                    if action in {"wait", "kill"}:
                        return action

            time.sleep(_TIMEOUT_DECISION_POLL_SECONDS)
    finally:
        for path in (request_path, response_path):
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                except OSError:
                    pass


def _run_subprocess_with_timeout_prompt(cmd: list[str], timeout_seconds: int, tool_name: str, arguments: dict) -> dict:
    run_dir = _run_dir_for_current_session()
    t0 = time.time()

    if not run_dir:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_seconds)
        return {
            "stdout": result.stdout or "",
            "stderr": result.stderr or "",
            "returncode": result.returncode,
            "duration_ms": int((time.time() - t0) * 1000),
            "timed_out_kill": False,
            "checkpoint_index": 0,
        }

    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    checkpoint_index = 0
    _clear_timeout_control_files()
    next_checkpoint_at = t0 + timeout_seconds

    while True:
        try:
            remaining_to_checkpoint = max(0.0, next_checkpoint_at - time.time())
            wait_slice = min(_PROCESS_CANCEL_POLL_SECONDS, remaining_to_checkpoint)
            stdout, stderr = proc.communicate(timeout=wait_slice)
            return {
                "stdout": stdout or "",
                "stderr": stderr or "",
                "returncode": proc.returncode,
                "duration_ms": int((time.time() - t0) * 1000),
                "timed_out_kill": False,
                "cancelled": False,
                "checkpoint_index": checkpoint_index,
            }
        except subprocess.TimeoutExpired:
            if _cancel_requested():
                if proc.poll() is None:
                    proc.kill()
                stdout, stderr = proc.communicate()
                return {
                    "stdout": stdout or "",
                    "stderr": stderr or "",
                    "returncode": -1,
                    "duration_ms": int((time.time() - t0) * 1000),
                    "timed_out_kill": False,
                    "cancelled": True,
                    "checkpoint_index": checkpoint_index,
                }

            if time.time() < next_checkpoint_at:
                continue

            checkpoint_index += 1
            action = _await_timeout_decision(proc, tool_name, arguments, cmd, timeout_seconds, checkpoint_index)
            if action == "wait":
                next_checkpoint_at = time.time() + timeout_seconds
                continue

            if action != "finished" and proc.poll() is None:
                proc.kill()
            stdout, stderr = proc.communicate()
            return {
                "stdout": stdout or "",
                "stderr": stderr or "",
                "returncode": -1,
                "duration_ms": int((time.time() - t0) * 1000),
                "timed_out_kill": action == "kill",
                "cancelled": False,
                "checkpoint_index": checkpoint_index,
            }


def _build_shell_command(name: str, arguments: dict) -> tuple[list[str] | None, str | None]:
    user_args = (arguments.get("args", "") or "").strip()
    if not user_args:
        examples = {
            "shell": "'ls -la', 'ip addr', or 'docker ps'",
            "shell_extended": "'curl -I https://example.com', 'dig example.com', or 'host example.com'",
            "shell_sequence": "'[\"curl -I https://example.com\", \"host example.com\"]' or one command per line",
        }
        return None, f"Error: {name} requires a command, e.g. {examples.get(name, 'a command')}"

    try:
        shell_parts = shlex.split(user_args)
    except ValueError as exc:
        return None, f"Error: Invalid {name} arguments: {exc}"

    if not shell_parts:
        return None, f"Error: {name} requires a command"

    shell_command = shell_parts[0]
    allowed_commands = _ALLOWED_SHELL_COMMANDS if name == "shell" else _ALLOWED_EXTENDED_SHELL_COMMANDS
    if shell_command not in allowed_commands:
        allowed = ", ".join(sorted(allowed_commands))
        return None, f"Error: '{shell_command}' is not allowed. Allowed commands: {allowed}"

    if any(token in _DISALLOWED_SHELL_TOKENS for token in shell_parts[1:]):
        return None, f"Error: {name} does not allow command chaining, pipes, or redirection"

    if name == "shell_extended":
        return _normalize_extended_shell_command(shell_parts)

    return shell_parts, None


def _requested_shell_command(arguments: dict) -> str | None:
    raw_args = (arguments.get("args", "") or "").strip()
    if not raw_args:
        return None
    try:
        shell_parts = shlex.split(raw_args)
    except Exception:
        shell_parts = raw_args.split()
    if not shell_parts:
        return None
    return shell_parts[0]


def _requested_shell_parts(arguments: dict) -> list[str]:
    raw_args = (arguments.get("args", "") or "").strip()
    if not raw_args:
        return []
    try:
        return shlex.split(raw_args)
    except Exception:
        return raw_args.split()


def _resolve_shell_delegation(config: dict, current_tool_name: str, arguments: dict) -> tuple[str, dict, dict] | None:
    shell_parts = _requested_shell_parts(arguments)
    if not shell_parts:
        return None

    requested_command = shell_parts[0]
    if requested_command == current_tool_name:
        return None

    delegated_tool = next(
        (
            tool for tool in config.get("tools", [])
            if isinstance(tool, dict) and str(tool.get("name", "")).strip() == requested_command
        ),
        None,
    )
    if not delegated_tool:
        return None

    delegated_args = shlex.join(shell_parts[1:]) if len(shell_parts) > 1 else ""
    return requested_command, delegated_tool, {"args": delegated_args}


def _run_shell_sequence(arguments: dict, timeout_seconds: int) -> tuple[str, int, int]:
    raw_args = arguments.get("args", "")
    commands, parse_error = _parse_shell_sequence(raw_args)
    if parse_error:
        return parse_error, -1, 0

    output_chunks = []
    t0 = time.time()
    overall_exit_code = 0

    for index, command in enumerate(commands, start=1):
        cmd, error_text = _build_shell_command("shell_extended", {"args": command})
        if error_text:
            output_chunks.append(f"Step {index}: {command}\n{error_text}")
            overall_exit_code = -1
            break

        try:
            execution = _run_subprocess_with_timeout_prompt(cmd, timeout_seconds, "shell_sequence", {"args": command})
        except subprocess.TimeoutExpired:
            output_chunks.append(
                f"Step {index}: {command}\nExecution error: Command timed out after {int(timeout_seconds)} seconds"
            )
            overall_exit_code = -1
            break

        if execution.get("timed_out_kill"):
            elapsed_seconds = max(int(execution.get("duration_ms", 0) / 1000), int(timeout_seconds))
            step_output = (
                f"Execution stopped after {elapsed_seconds} seconds because the user chose kill "
                f"at timeout checkpoint {execution.get('checkpoint_index', 1)}."
            )
            partial_stdout = _strip_ansi(execution.get("stdout") or "")
            partial_stderr = _strip_ansi(execution.get("stderr") or "")
            if partial_stdout:
                step_output += f"\n\nPartial STDOUT:\n{partial_stdout}"
            if partial_stderr:
                step_output += f"\n\nPartial STDERR:\n{partial_stderr}"
            output_chunks.append(f"Step {index}: {command}\n{step_output}")
            overall_exit_code = -1
            break

        step_output = _strip_ansi(execution.get("stdout") or "")
        step_stderr = _strip_ansi(execution.get("stderr") or "")
        if step_stderr:
            step_output += f"\nSTDERR:\n{step_stderr}"
        step_output = step_output or "Command executed successfully (no output)"
        output_chunks.append(f"Step {index}: {command}\n{step_output}")

        if execution.get("returncode") != 0:
            overall_exit_code = int(execution.get("returncode") or 0)
            break

    duration_ms = int((time.time() - t0) * 1000)
    return "\n\n".join(output_chunks), overall_exit_code, duration_ms


def _build_dangerous_shell_command(arguments: dict) -> tuple[list[str] | None, str | None]:
    user_args = (arguments.get("args", "") or "").strip()
    if not user_args:
        return None, "Error: shell_dangerous requires a command"
    if "\x00" in user_args:
        return None, "Error: shell_dangerous command contains a null byte"
    return ["/bin/sh", "-lc", user_args], None


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
            host = (urlparse(url).hostname or "").lower()
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
            target_net = ipaddress.ip_network(target_value, strict=False)
            return target_net.num_addresses == 1 and target_net.network_address == entry_ip
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

    policy_allowed, policy_message = _evaluate_network_policy(_NETWORK_POLICY, arguments)
    if not policy_allowed:
        return [TextContent(type="text", text=f"Policy blocked tool call to {name}: {policy_message}")]

    delegated_from_shell = False
    if name in {"shell", "shell_extended"}:
        delegation = _resolve_shell_delegation(config, name, arguments)
        if delegation:
            name, tool_config, arguments = delegation
            delegated_from_shell = True
        else:
            cmd, error_text = _build_shell_command(name, arguments)
            if error_text:
                return [TextContent(type="text", text=error_text)]
    elif name == "shell_sequence":
        timeout_seconds = int(tool_config.get("timeout_seconds", 120) or 120)
        output, exit_code, duration_ms = _run_shell_sequence(arguments, timeout_seconds)
        _logger.log_tool_call(
            name=name,
            args=arguments,
            result=output or "Command executed successfully (no output)",
            duration_ms=duration_ms,
            exit_code=exit_code,
        )
        return [TextContent(type="text", text=output or "Command executed successfully (no output)")]
    elif name == "shell_dangerous":
        cmd, error_text = _build_dangerous_shell_command(arguments)
        if error_text:
            return [TextContent(type="text", text=error_text)]
    if name not in {"shell", "shell_extended", "shell_sequence", "shell_dangerous"} or delegated_from_shell:
        cmd = [tool_config["command"]]
        base_args = tool_config.get("base_args", [])
        user_args = arguments.get("args", "")
        if name == "msf_run":
            user_args = _prepare_msf_run_args(user_args)
        
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
        timeout_seconds = int(tool_config.get("timeout_seconds", 300) or 300)
        execution = _run_subprocess_with_timeout_prompt(cmd, timeout_seconds, name, arguments)
        duration_ms = int(execution.get("duration_ms") or int((time.time() - t0) * 1000))

        output = _strip_ansi(execution.get("stdout") or "")
        stderr = _strip_ansi(execution.get("stderr") or "")
        if execution.get("cancelled"):
            elapsed_seconds = max(1, int(duration_ms / 1000))
            output = f"Execution cancelled after {elapsed_seconds} seconds by the user."
            if execution.get("stdout"):
                output += f"\n\nPartial STDOUT:\n{_strip_ansi(execution.get('stdout') or '')}"
            if stderr:
                output += f"\n\nPartial STDERR:\n{stderr}"
        elif execution.get("timed_out_kill"):
            elapsed_seconds = max(int(duration_ms / 1000), int(timeout_seconds))
            output = (
                f"Execution stopped after {elapsed_seconds} seconds because the user chose kill "
                f"at timeout checkpoint {execution.get('checkpoint_index', 1)} instead of waiting longer."
            )
            if execution.get("stdout"):
                output += f"\n\nPartial STDOUT:\n{_strip_ansi(execution.get('stdout') or '')}"
            if stderr:
                output += f"\n\nPartial STDERR:\n{stderr}"
        elif stderr:
            output += f"\nSTDERR:\n{stderr}"

        # Log the tool call
        _logger.log_tool_call(
            name=name,
            args=arguments,
            result=output or "Command executed successfully (no output)",
            duration_ms=duration_ms,
            exit_code=int(execution.get("returncode") or 0),
            stderr=stderr,
        )

        return [TextContent(type="text", text=output or "Command executed successfully (no output)")]
    except subprocess.TimeoutExpired as e:
        if name == "msf_run":
            err_msg = (
                f"Execution error: msf_run timed out after {int(e.timeout)} seconds. "
                "This usually means the Metasploit exploit workflow kept waiting for a session or module completion. "
                "The wrapper already forces batch mode defaults (`set WfsDelay 10` and `exploit/run -z`) for exploit modules unless you override them. "
                "If you need different behavior, set `WfsDelay` explicitly, use `check` when supported, or use an auxiliary/scanner module instead of a full exploit."
            )
        else:
            err_msg = f"Execution error: Command timed out after {int(e.timeout)} seconds"
        _logger.log_tool_call(name=name, args=arguments, result=err_msg, exit_code=-1)
        return [TextContent(type="text", text=err_msg)]
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
