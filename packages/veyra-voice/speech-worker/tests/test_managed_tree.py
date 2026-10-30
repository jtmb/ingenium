"""Model-free original-tree algorithm checks; every kernel/file operation faked.

These do not qualify Linux fork/pidfd/parent-loss/runtime behavior. Root owns that
actual inert helper qualification; importing this file starts no helper/process.
"""
import io
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import managed_linux_tree as production


def tree():
    return production.OriginalTree(b"", bytes(32), "00000000-0000-4000-8000-000000000001", 1,
        {"directory": "/private/speech", "digest": "a" * 64, "memoryBytes": 1073741824}, 123)


class OriginalTreeTests(unittest.TestCase):
    def test_capture_only_actual_unreaped_direct_children_and_signal_retained_pidfds(self):
        original = tree()
        original.originals = {5: 55}
        opened, waited, signals = [], [], []
        fake = SimpleNamespace(getpid=lambda: 17, P_PIDFD=3, WEXITED=4, WNOHANG=1, WNOWAIT=0x1000000,
            pidfd_open=lambda child: opened.append(child) or child + 100,
            waitid=lambda *args: waited.append(args))
        with patch.object(production, "os", fake), patch.object(production, "signal", SimpleNamespace(SIGKILL=9,
                pidfd_send_signal=lambda descriptor, sig: signals.append((descriptor, sig)))), patch("builtins.open", return_value=io.BytesIO(b"5 9")) as file:
            original.kill_originals()
        file.assert_called_once_with("/proc/self/task/17/children", "rb", buffering=0)
        self.assertEqual(opened, [9])
        self.assertEqual(waited, [(3, 109, 4 | 1 | 0x1000000 | production.WALL)])
        self.assertEqual(signals, [(55, 9), (109, 9)])

    def test_original_leader_wait_never_substitutes_for_echild_or_descendant_eof(self):
        original = tree()
        original.child, original.output = 5, 8
        original.originals = {5: 55, 9: 99}
        closed = []
        original._close = closed.append
        with patch.object(production, "os", SimpleNamespace(WNOHANG=1, waitpid=lambda *_: next(events))):
            events = iter([(5, 0), (0, 0)])
            original.reap()
        self.assertEqual(original.leader_status, 0)
        self.assertFalse(original.empty)
        self.assertEqual(original.originals, {9: 99})
        events = iter([(9, 0), ChildProcessError()])
        def wait(*_):
            value = next(events)
            if isinstance(value, BaseException):
                raise value
            return value
        with patch.object(production, "os", SimpleNamespace(WNOHANG=1, waitpid=wait)):
            original.reap()
        self.assertTrue(original.empty)
        self.assertEqual(closed, [55, 99])
        original.parent_exited = lambda: True
        with patch("builtins.open", side_effect=AssertionError("no file mutation before pipe EOF")):
            with self.assertRaisesRegex(ValueError, "retirement incomplete"):
                original.retain_after_parent_exit()

    def test_live_original_parent_cannot_transfer_same_journal_writer_even_after_tree_exit(self):
        original = tree()
        original.empty, original.leader_status, original.output = True, 0, None
        original.parent_exited = lambda: False
        with patch("builtins.open", side_effect=AssertionError("no writer takeover")):
            with self.assertRaisesRegex(ValueError, "retirement incomplete"):
                original.retain_after_parent_exit()


if __name__ == "__main__":
    unittest.main()
