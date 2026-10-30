"""Fixed Linux CPU subreaper: gated fork, retained pidfds, ECHILD and pipe EOF.

Derived from the project's owned local_wsl_git/LocalGitTree source; it does not
use process groups, UID sweeps, serialized PIDs, host cgroups or root privileges.
This file is embedded with managed_bootstrap.py by the source proposal generator.
No application import/model load occurs in this single-threaded helper.
"""
from __future__ import annotations

import base64
import ctypes
import errno
import hashlib
import hmac
import json
import os
import selectors
import signal
import struct
import sys
import time
import stat
import uuid

WALL = 0x40000000
MAX_BOOTSTRAP = 65536
MAX_QUEUE = 131072
TREE_DOMAIN = b"VEYRA-CPU-ORIGINAL-TREE-V1\0"
# Generator substitutes the exact canonical owned bootstrap, never profile code.
BOOTSTRAP_SOURCE = "__VEYRA_EMBEDDED_BOOTSTRAP__"
_cancel_requested = False


def request_cancel(_signal, _frame):
    """Keep the original subreaper alive until its actual children retire."""
    global _cancel_requested
    _cancel_requested = True


def exact_read(fd: int, count: int) -> bytes:
    result = bytearray()
    while len(result) < count:
        chunk = os.read(fd, count - len(result))
        if not chunk:
            raise ValueError("original bootstrap closed")
        result.extend(chunk)
    return bytes(result)


class OriginalTree:
    """Retain before fork. No timeout or helper exit substitutes for this owner."""
    def __init__(self, bootstrap: bytes, key: bytes, owner: str, generation: int, journal: dict, parent_fd: int):
        self.bootstrap, self.key = bootstrap, key
        self.owner, self.generation = owner, generation
        self.journal, self.parent_fd = journal, parent_fd
        self.originals: dict[int, int] = {}
        self.fds: set[int] = {parent_fd}
        self.child = None
        self.gate = None
        self.input = self.output = None
        self.empty = False
        self.started = self.dispatched = self.stopping = False
        self.leader_status = None
        self.reaped = 0
        self.sequence = 0
        self.failure = False
        self.retirement_retained = False
        self.no_start_sealed = False

    def parent_exited(self):
        """Poll the actual inherited original Native process pidfd, never a PID."""
        import select
        watch = select.poll()
        watch.register(self.parent_fd, select.POLLIN)
        events = watch.poll(0)
        if any(flags & (select.POLLERR | select.POLLNVAL) for _, flags in events):
            raise ValueError("original parent capability unavailable")
        return any(flags & select.POLLIN for _, flags in events)

    def retain_after_parent_exit(self):
        """Transfer the SAME owner receipt writer only after positive parent exit.

        The helper writes no operation transcripts/results. Native process exit
        proves all its threads gone; actual ECHILD+EOF proves the CPU tree gone.
        A shared zero-state flock serializes replacement Native startup. It is
        never itself an exit proof. Normal live Native remains the sole writer.
        """
        if not (self.parent_exited() and self.empty and not self.originals and self.output is None and (self.leader_status is not None or self.no_start_sealed)):
            raise ValueError("original retirement incomplete")
        import fcntl
        directory = self.journal["directory"]
        if not isinstance(directory, str) or not directory.startswith("/"):
            raise ValueError("original journal")
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
        held = [os.open("/", flags)]
        lock = temporary = None
        pending_name = None
        try:
            for part in directory.split("/")[1:]:
                if not part or part in (".", ".."):
                    raise ValueError("original journal ancestor")
                held.append(os.open(part, flags, dir_fd=held[-1]))
                facts = os.fstat(held[-1])
                if facts.st_uid not in (0, os.geteuid()) or facts.st_mode & 0o022:
                    raise ValueError("original journal custody")
            root = held[-1]
            facts = os.fstat(root)
            if facts.st_uid != os.geteuid() or facts.st_mode & 0o077:
                raise ValueError("original private journal")
            lock = os.open("managed-cpu-owner.lock", os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=root)
            facts = os.fstat(lock)
            if not stat.S_ISREG(facts.st_mode) or facts.st_uid != os.geteuid() or facts.st_nlink != 1 or facts.st_mode & 0o077:
                raise ValueError("original writer custody")
            # Nonblocking refusal preserves the original; no other owner stopped.
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            descriptor = os.open(self.owner + ".json", os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=root)
            try:
                facts = os.fstat(descriptor)
                if not stat.S_ISREG(facts.st_mode) or facts.st_uid != os.geteuid() or facts.st_nlink != 1 or facts.st_mode & 0o077 or not 0 < facts.st_size <= 524288:
                    raise ValueError("original receipt custody")
                raw = bytearray()
                while len(raw) <= 524288:
                    chunk = os.read(descriptor, min(16384, 524289 - len(raw)))
                    if not chunk:
                        break
                    raw.extend(chunk)
                value = json.loads(raw)
            finally:
                os.close(descriptor)
            operation = value["operation"]
            provenance = operation["provenance"]
            if set(value) != {"version", "digest", "operation"} or value["version"] != 1 or value["digest"] != self.journal["digest"] or operation["id"] != self.owner or operation["kind"] != "managed_cpu_owner" or provenance["ownerGeneration"] != self.generation or provenance["scope"]["platform"] != "linux-subreaper-pidfd" or provenance["scope"]["ownerId"] != self.owner:
                raise ValueError("original receipt binding")
            operation["state"] = "cancelled"
            provenance.update(stage="retired", ownedProcessRetired=True, originalParentExited=True,
                              originalTreeECHILD=True, originalTreePipeEOF=True, originalTreeNoStart=self.no_start_sealed, retirementId=str(uuid.uuid4()))
            encoded = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()
            if len(encoded) > 524288:
                raise ValueError("original receipt limit")
            pending_name = str(uuid.uuid4()) + ".tmp"
            temporary = os.open(pending_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=root)
            offset = 0
            while offset < len(encoded):
                offset += os.write(temporary, encoded[offset:])
            os.fsync(temporary)
            os.close(temporary)
            temporary = None
            os.rename(pending_name, self.owner + ".json", src_dir_fd=root, dst_dir_fd=root)
            pending_name = None
            os.fsync(root)
            self.retirement_retained = True
        finally:
            if temporary is not None:
                os.close(temporary)
            # A failed write is unique failure evidence, never blindly removed.
            if lock is not None:
                os.close(lock)
            for descriptor in reversed(held):
                os.close(descriptor)

    def retain_retirement_until_committed(self):
        """A contended writer lock retains this actual retired original helper."""
        while not self.retirement_retained:
            try:
                self.retain_after_parent_exit()
            except BlockingIOError:
                time.sleep(0.025)

    def _pipe(self):
        pair = os.pipe2(os.O_CLOEXEC)
        self.fds.update(pair)
        return pair

    def _close(self, fd):
        if fd in self.fds:
            os.close(fd)
            self.fds.remove(fd)

    def event(self, event: str):
        """Only this original helper holds stderr; the worker gets /dev/null."""
        value = {"event": event, "ownerId": self.owner, "ownerGeneration": self.generation,
                 "treeEmpty": self.empty, "pipeEof": self.output is None,
                 "leaderWaited": self.leader_status is not None, "reaped": self.reaped}
        payload = json.dumps(value, separators=(",", ":")).encode()
        self.sequence += 1
        ordinal = struct.pack("!Q", self.sequence)
        tag = hmac.digest(self.key, TREE_DOMAIN + ordinal + payload, "sha256")
        frame = struct.pack("!I", len(payload)) + ordinal + tag + payload
        offset = 0
        while offset < len(frame):
            offset += os.write(2, frame[offset:])

    def capture(self):
        if self.started or len(os.listdir("/proc/self/task")) != 1:
            raise ValueError("dedicated original owner required")
        signal.signal(signal.SIGCHLD, signal.SIG_DFL)
        try:
            os.waitid(os.P_ALL, 0, os.WEXITED | os.WNOHANG | os.WNOWAIT | WALL)
        except ChildProcessError:
            pass
        else:
            raise ValueError("unrelated child owner")
        libc = ctypes.CDLL(None, use_errno=True)
        observed = ctypes.c_int()
        if libc.prctl(36, 1, 0, 0, 0) or libc.prctl(37, ctypes.byref(observed), 0, 0, 0) or observed.value != 1:
            raise ValueError("subreaper unavailable")
        if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
            raise ValueError("pidfd unavailable")
        probe = os.pidfd_open(os.getpid())
        try:
            signal.pidfd_send_signal(probe, 0)
        finally:
            os.close(probe)
        if libc.prctl(38, 1, 0, 0, 0):
            raise ValueError("no-new-privileges unavailable")
        gate_read, gate_write = self._pipe()
        in_read, in_write = self._pipe()
        out_read, out_write = self._pipe()
        self.started = True
        child = os.fork()
        if child == 0:
            try:
                os.dup2(in_read, 0)
                os.dup2(out_write, 1)
                null = os.open(os.devnull, os.O_WRONLY | os.O_CLOEXEC)
                os.dup2(null, 2)
                for item in os.listdir("/proc/self/fd"):
                    fd = int(item)
                    if fd not in {0, 1, 2, gate_read}:
                        try:
                            os.close(fd)
                        except OSError as error:
                            if error.errno != errno.EBADF:
                                raise
                if os.read(gate_read, 1) != b"1":
                    os._exit(125)
                os.close(gate_read)
                for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP, signal.SIGPIPE):
                    signal.signal(sig, signal.SIG_DFL)
                os.execve(sys.executable, [sys.executable, "-I", "-S", "-B", "-c", BOOTSTRAP_SOURCE], os.environ)
            except BaseException:
                os._exit(126)
        self.child, self.gate = child, gate_write
        self.input, self.output = in_write, out_read
        for fd in (gate_read, in_read, out_write):
            self._close(fd)
        try:
            pidfd = os.pidfd_open(child)
            self.fds.add(pidfd)
            self.originals[child] = pidfd
        except BaseException:
            # Still our unreaped gated fork child; no worker has been dispatched.
            os.kill(child, signal.SIGKILL)
            self.failure = self.stopping = True
            raise

    def cancel(self):
        self.stopping = True
        if self.gate is not None:
            self._close(self.gate)
            self.gate = None
        if self.input is not None:
            self._close(self.input)
            self.input = None

    def reap(self):
        while True:
            try:
                child, status = os.waitpid(-1, os.WNOHANG | WALL)
            except ChildProcessError:
                self.empty = True
                return
            if not child:
                return
            if child == self.child:
                self.leader_status = status
            self.reaped = min(self.reaped + 1, 2147483647)
            pidfd = self.originals.pop(child, None)
            if pidfd is not None:
                self._close(pidfd)

    def kill_originals(self):
        """Capture only our own unreaped direct/adopted children, then signal pidfds."""
        with open("/proc/self/task/" + str(os.getpid()) + "/children", "rb", buffering=0) as file:
            raw = file.read(65537)
        if len(raw) > 65536:
            raise ValueError("child census capacity")
        for item in raw.split():
            child = int(item)
            if child not in self.originals:
                if len(self.originals) >= 256:
                    raise ValueError("retained child capacity")
                pidfd = os.pidfd_open(child)
                self.fds.add(pidfd)
                self.originals[child] = pidfd
                os.waitid(os.P_PIDFD, pidfd, os.WEXITED | os.WNOHANG | os.WNOWAIT | WALL)
        for pidfd in self.originals.values():
            try:
                signal.pidfd_send_signal(pidfd, signal.SIGKILL)
            except ProcessLookupError:
                pass

    def run(self):
        self.event("tree-prepared")
        if _cancel_requested:
            self.cancel()
        else:
            os.write(self.gate, b"1")
            self._close(self.gate)
            self.gate = None
            self.dispatched = True
        for fd in (0, 1, self.output):
            os.set_blocking(fd, False)
        if self.input is not None:
            os.set_blocking(self.input, False)
        inbound = bytearray(self.bootstrap)
        outbound = bytearray()
        while True:
            try:
                if _cancel_requested:
                    self.cancel()
                if self.parent_exited():
                    self.cancel()
                self.reap()
                if self.leader_status is not None:
                    self.cancel()
                if self.stopping and not self.empty:
                    self.kill_originals()
                if not self.stopping and len(inbound) < MAX_QUEUE:
                    try:
                        data = os.read(0, min(16384, MAX_QUEUE - len(inbound)))
                    except BlockingIOError:
                        data = None
                    if data == b"":
                        self.cancel()
                    elif data:
                        inbound.extend(data)
                if self.input is not None and inbound:
                    try:
                        sent = os.write(self.input, inbound)
                        del inbound[:sent]
                    except BlockingIOError:
                        pass
                if self.output is not None and len(outbound) < MAX_QUEUE:
                    try:
                        data = os.read(self.output, min(16384, MAX_QUEUE - len(outbound)))
                    except BlockingIOError:
                        data = None
                    if data == b"":
                        self._close(self.output)
                        self.output = None
                        self.cancel()
                    elif data:
                        outbound.extend(data)
                if outbound:
                    try:
                        sent = os.write(1, outbound)
                        del outbound[:sent]
                    except BlockingIOError:
                        pass
                if self.empty and not self.originals and self.output is None and not outbound:
                    break
            except BrokenPipeError:
                # Original parent has gone. No final response can be delivered,
                # but this original subreaper must still drain its actual tree.
                outbound.clear()
                self.failure = True
                self.cancel()
            except BaseException:
                self.failure = True
                self.cancel()
            time.sleep(0.005)
        if self.parent_exited():
            self.retain_after_parent_exit()
        else:
            self.event("tree-retired")

    def close(self):
        if self.started and not (self.empty and not self.originals and self.output is None):
            raise ValueError("original tree remains owned")
        for fd in list(self.fds):
            self._close(fd)


def run():
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, request_cancel)
    # Non-secret original journal join comes from Native's fixed argv, before
    # any input/fork. The actual inherited parent pidfd is independent authority.
    if len(sys.argv) != 5:
        raise ValueError("original metadata argv")
    original_owner, original_generation, original_directory, original_digest = sys.argv[1:]
    if str(uuid.UUID(original_owner)) != original_owner or uuid.UUID(original_owner).int == 0 or not original_generation.isdecimal() or not 1 <= int(original_generation) <= 9007199254740991 or len(original_digest) != 64 or original_digest != hashlib.sha256(original_owner.encode()).hexdigest():
        raise ValueError("original metadata binding")
    parent_fd = 3
    if os.readlink("/proc/self/fd/3") != "anon_inode:[pidfd]":
        raise ValueError("original parent pidfd")
    recovery = OriginalTree(b"", bytes(32), original_owner, int(original_generation),
        {"directory": original_directory, "digest": original_digest}, parent_fd)
    try:
        length = struct.unpack("!I", exact_read(0, 4))[0]
        if not 0 < length <= MAX_BOOTSTRAP:
            raise ValueError("bootstrap limit")
        body = exact_read(0, length)
    except BaseException:
        # No application/fork was ever published. Only positive original-parent
        # exit permits the retained helper to seal this same no-start receipt.
        if recovery.parent_exited():
            try:
                os.waitpid(-1, os.WNOHANG | WALL)
            except ChildProcessError:
                recovery.empty = recovery.no_start_sealed = True
                recovery.retain_retirement_until_committed()
                recovery.close()
                return
        raise
    value = json.loads(body)
    journal = value.pop("originalJournal")
    if not isinstance(journal, dict) or set(journal) != {"directory", "digest", "memoryBytes"}:
        raise ValueError("original journal binding")
    if value["ownerId"] != original_owner or value["ownerGeneration"] != int(original_generation) or journal["directory"] != original_directory or journal["digest"] != original_digest:
        raise ValueError("original argv/pipe conflict")
    memory = journal["memoryBytes"]
    if type(memory) is not int or not 268435456 <= memory <= 9223372036854775807:
        raise ValueError("original memory budget")
    import resource
    # Fixed per-process virtual-address bound inherited by the CPU child. The
    # existing container owns the aggregate memory/process bound for Linux.
    resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
    # FD 3 is dup'd from Native's actual self pidfd before this helper exec;
    # never accept a profile-provided descriptor/PID or open a parent by number.
    body = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()
    key = base64.b64decode(value["capability"], validate=True)
    if len(key) != 32:
        raise ValueError("capability")
    owner = OriginalTree(struct.pack("!I", len(body)) + body, key, value["ownerId"], value["ownerGeneration"], journal, parent_fd)
    try:
        if _cancel_requested:
            # No fork has occurred; this sealed code path returns immediately
            # after the authenticated no-start event, so no later dispatch exists.
            owner.empty = True
            owner.no_start_sealed = True
            owner.event("tree-no-start")
            return
        owner.capture()
        owner.run()
    finally:
        # No ordinary finally may abandon a successfully forked original.
        if owner.started and not (owner.empty and not owner.originals and owner.output is None):
            owner.cancel()
            while True:
                try:
                    owner.reap()
                    if not owner.empty:
                        owner.kill_originals()
                    if owner.output is not None:
                        os.set_blocking(owner.output, False)
                        try:
                            if not os.read(owner.output, 16384):
                                owner._close(owner.output)
                                owner.output = None
                        except BlockingIOError:
                            pass
                    if owner.empty and not owner.originals and owner.output is None:
                        break
                except BaseException:
                    pass
                time.sleep(0.005)
        if (owner.started or owner.no_start_sealed) and owner.parent_exited() and not owner.retirement_retained:
            # A replacement may briefly hold the writer lock while it observes
            # the still-unretired original. Keep our actual capabilities until
            # that metadata-only attempt releases it; never infer retirement.
            owner.retain_retirement_until_committed()
        owner.close()


if __name__ == "__main__":
    try:
        run()
    except BaseException:
        os._exit(75)
