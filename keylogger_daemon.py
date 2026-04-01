"""
System Keylogger Daemon for Kali MCP WebUI
Captures system-wide keystrokes for the current user and integrates with session logging.
"""

import json
import os
import queue
import threading
import time
from datetime import datetime, timezone
from typing import Optional, Callable


def _now_iso() -> str:
    """Return current UTC time in ISO format."""
    return datetime.now(timezone.utc).isoformat()


class SystemKeylogger:
    """
    System-wide keylogger that captures keystrokes and integrates with session logging.
    
    Features:
    - Continuous background capture of system keystrokes
    - Batching for efficient storage
    - Session correlation via run_id
    - Pause/resume capability
    - Platform-specific implementations (macOS, Linux, Windows)
    """

    def __init__(self, base_dir: str = None, event_callback: Callable = None):
        """
        Args:
            base_dir: Base directory for runs/ (defaults to script directory)
            event_callback: Optional callable(dict) invoked for keystroke events
        """
        self._event_callback = event_callback
        self._running = False
        self._paused = False
        self._listener = None
        self._buffer = []
        self._buffer_lock = threading.Lock()
        self._flush_interval = 5  # seconds
        self._flush_thread = None
        self._current_run_id = None
        self._keystrokes_dir = None

        if base_dir is None:
            base_dir = os.path.dirname(os.path.abspath(__file__))
        self._base_dir = base_dir

        # Import platform-specific listener
        self._setup_listener()

    def _setup_listener(self):
        """Setup the appropriate key listener based on platform."""
        try:
            from pynput import keyboard
            self._keyboard_listener = keyboard
        except ImportError:
            raise ImportError(
                "pynput is required for system keylogging. "
                "Install it with: pip install pynput"
            )

    def _on_press(self, key):
        """Handle key press event."""
        if self._paused or not self._running:
            return

        try:
            key_data = {
                "timestamp": _now_iso(),
                "type": "press",
                "key": self._normalize_key(key),
                "key_code": self._get_key_code(key),
                "modifiers": self._get_modifiers(key),
            }
            self._add_to_buffer(key_data)
        except Exception as e:
            print(f"[Keylogger] Error processing key press: {e}")

    def _on_release(self, key):
        """Handle key release event."""
        if self._paused or not self._running:
            return

        try:
            key_data = {
                "timestamp": _now_iso(),
                "type": "release",
                "key": self._normalize_key(key),
                "key_code": self._get_key_code(key),
                "modifiers": self._get_modifiers(key),
            }
            self._add_to_buffer(key_data)
        except Exception as e:
            print(f"[Keylogger] Error processing key release: {e}")

    def _normalize_key(self, key) -> str:
        """Normalize key to a readable string."""
        try:
            if hasattr(key, 'char') and key.char is not None:
                return key.char
            # Handle special keys
            key_map = {
                self._keyboard.Key.shift: "Shift",
                self._keyboard.Key.shift_l: "Shift",
                self._keyboard.Key.shift_r: "Shift",
                self._keyboard.Key.ctrl: "Ctrl",
                self._keyboard.Key.ctrl_l: "Ctrl",
                self._keyboard.Key.ctrl_r: "Ctrl",
                self._keyboard.Key.alt: "Alt",
                self._keyboard.Key.alt_l: "Alt",
                self._keyboard.Key.alt_r: "Alt",
                self._keyboard.Key.alt_gr: "AltGr",
                self._keyboard.Key.cmd: "Cmd",
                self._keyboard.Key.win: "Win",
                self._keyboard.Key.space: "Space",
                self._keyboard.Key.enter: "Enter",
                self._keyboard.Key.backspace: "Backspace",
                self._keyboard.Key.delete: "Delete",
                self._keyboard.Key.insert: "Insert",
                self._keyboard.Key.home: "Home",
                self._keyboard.Key.end: "End",
                self._keyboard.Key.page_up: "PageUp",
                self._keyboard.Key.page_down: "PageDown",
                self._keyboard.Key.left: "Left",
                self._keyboard.Key.right: "Right",
                self._keyboard.Key.up: "Up",
                self._keyboard.Key.down: "Down",
                self._keyboard.Key.tab: "Tab",
                self._keyboard.Key.caps_lock: "CapsLock",
                self._keyboard.Key.num_lock: "NumLock",
                self._keyboard.Key.scroll_lock: "ScrollLock",
                self._keyboard.Key.f1: "F1",
                self._keyboard.Key.f2: "F2",
                self._keyboard.Key.f3: "F3",
                self._keyboard.Key.f4: "F4",
                self._keyboard.Key.f5: "F5",
                self._keyboard.Key.f6: "F6",
                self._keyboard.Key.f7: "F7",
                self._keyboard.Key.f8: "F8",
                self._keyboard.Key.f9: "F9",
                self._keyboard.Key.f10: "F10",
                self._keyboard.Key.f11: "F11",
                self._keyboard.Key.f12: "F12",
                self._keyboard.Key.f13: "F13",
                self._keyboard.Key.f14: "F14",
                self._keyboard.Key.f15: "F15",
                self._keyboard.Key.f16: "F16",
                self._keyboard.Key.f17: "F17",
                self._keyboard.Key.f18: "F18",
                self._keyboard.Key.f19: "F19",
                self._keyboard.Key.f20: "F20",
                self._keyboard.Key.print_screen: "PrintScreen",
            }
            return key_map.get(key, str(key))
        except Exception:
            return str(key)

    def _get_key_code(self, key) -> Optional[int]:
        """Get numeric key code if available."""
        try:
            if hasattr(key, 'vk') and key.vk is not None:
                return key.vk
            if hasattr(key, 'value') and hasattr(key.value, 'vk'):
                return key.value.vk
        except Exception:
            pass
        return None

    def _get_modifiers(self, key) -> list:
        """Get list of active modifier keys."""
        modifiers = []
        try:
            # This is a simplified check - pynput doesn't provide direct access
            # to current modifier state in on_press/on_release
            # We'll track this via special key events
        except Exception:
            pass
        return modifiers

    def _add_to_buffer(self, key_data: dict):
        """Add keystroke to buffer for batched writing."""
        with self._buffer_lock:
            self._buffer.append(key_data)
            # Flush if buffer is large
            if len(self._buffer) >= 100:
                self._flush_buffer()

    def _flush_buffer(self):
        """Write buffered keystrokes to disk."""
        with self._buffer_lock:
            if not self._buffer:
                return
            
            if self._current_run_id and self._keystrokes_dir:
                log_path = os.path.join(self._keystrokes_dir, "system_log.jsonl")
                try:
                    with open(log_path, "a") as f:
                        for entry in self._buffer:
                            entry["run_id"] = self._current_run_id
                            f.write(json.dumps(entry) + "\n")
                    self._buffer = []
                except Exception as e:
                    print(f"[Keylogger] Error writing buffer: {e}")

    def _flush_loop(self):
        """Background thread that periodically flushes buffer."""
        while self._running:
            time.sleep(self._flush_interval)
            if self._running:
                self._flush_buffer()

    def start(self, run_id: str = None):
        """
        Start the system keylogger.
        
        Args:
            run_id: Optional session run ID for correlation
        """
        if self._running:
            print("[Keylogger] Already running")
            return

        self._running = True
        self._paused = False
        self._buffer = []
        self._current_run_id = run_id

        # Setup keystrokes directory if run_id provided
        if run_id:
            runs_dir = os.path.join(self._base_dir, "runs", run_id)
            self._keystrokes_dir = os.path.join(runs_dir, "keystrokes")
            os.makedirs(self._keystrokes_dir, exist_ok=True)

        # Start flush thread
        self._flush_thread = threading.Thread(target=self._flush_loop, daemon=True)
        self._flush_thread.start()

        # Start listener
        self._listener = self._keyboard_listener.Listener(
            on_press=self._on_press,
            on_release=self._on_release
        )
        self._listener.start()
        print(f"[Keylogger] Started (run_id: {run_id or 'unassigned'})")

        if self._event_callback:
            self._event_callback({"type": "keylogger_started", "run_id": run_id})

    def stop(self):
        """Stop the system keylogger."""
        if not self._running:
            return

        self._running = False
        self._paused = False

        # Flush remaining buffer
        self._flush_buffer()

        # Stop listener
        if self._listener:
            self._listener.stop()
            self._listener = None

        # Reset state
        self._current_run_id = None
        self._keystrokes_dir = None

        print("[Keylogger] Stopped")

        if self._event_callback:
            self._event_callback({"type": "keylogger_stopped"})

    def pause(self):
        """Pause keylogging."""
        if self._running and not self._paused:
            self._paused = True
            print("[Keylogger] Paused")
            if self._event_callback:
                self._event_callback({"type": "keylogger_paused"})

    def resume(self):
        """Resume keylogging."""
        if self._running and self._paused:
            self._paused = False
            print("[Keylogger] Resumed")
            if self._event_callback:
                self._event_callback({"type": "keylogger_resumed"})

    def toggle_pause(self):
        """Toggle pause/resume state."""
        if self._paused:
            self.resume()
        else:
            self.pause()

    def update_run_id(self, run_id: str):
        """Update the current run ID for keystroke correlation."""
        self._current_run_id = run_id
        if run_id:
            runs_dir = os.path.join(self._base_dir, "runs", run_id)
            self._keystrokes_dir = os.path.join(runs_dir, "keystrokes")
            os.makedirs(self._keystrokes_dir, exist_ok=True)

    @property
    def is_running(self) -> bool:
        """Check if keylogger is running."""
        return self._running

    @property
    def is_paused(self) -> bool:
        """Check if keylogger is paused."""
        return self._paused

    @property
    def buffer_size(self) -> int:
        """Get current buffer size."""
        with self._buffer_lock:
            return len(self._buffer)


# Global instance for singleton access
_keylogger_instance: Optional[SystemKeylogger] = None


def get_keylogger(base_dir: str = None, event_callback: Callable = None) -> SystemKeylogger:
    """Get or create the global keylogger instance."""
    global _keylogger_instance
    if _keylogger_instance is None:
        _keylogger_instance = SystemKeylogger(base_dir=base_dir, event_callback=event_callback)
    return _keylogger_instance


def start_keylogger(run_id: str = None, base_dir: str = None, event_callback: Callable = None):
    """Start the global keylogger instance."""
    global _keylogger_instance
    if _keylogger_instance is None:
        _keylogger_instance = SystemKeylogger(base_dir=base_dir, event_callback=event_callback)
    _keylogger_instance.start(run_id=run_id)
    return _keylogger_instance


def stop_keylogger():
    """Stop the global keylogger instance."""
    global _keylogger_instance
    if _keylogger_instance:
        _keylogger_instance.stop()


def pause_keylogger():
    """Pause the global keylogger instance."""
    if _keylogger_instance:
        _keylogger_instance.pause()


def resume_keylogger():
    """Resume the global keylogger instance."""
    if _keylogger_instance:
        _keylogger_instance.resume()


def get_keylogger_status() -> dict:
    """Get the current keylogger status."""
    if _keylogger_instance is None:
        return {
            "running": False,
            "paused": False,
            "run_id": None,
            "buffer_size": 0
        }
    return {
        "running": _keylogger_instance.is_running,
        "paused": _keylogger_instance.is_paused,
        "run_id": _keylogger_instance._current_run_id,
        "buffer_size": _keylogger_instance.buffer_size
    }