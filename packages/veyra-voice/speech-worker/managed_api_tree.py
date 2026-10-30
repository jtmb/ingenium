"""Linux API supervisor entry; same CPU worker, no Core/SQLite/file journal writer.

Production embeds the fixed OriginalTree + fixed managed bootstrap before this
entry under -I -S -B. The API's existing Core writer owns every durable record.
The one-time retirement capability is inherited only by this original helper;
it is removed from the CPU child's environment and never enters a DB/renderer.
"""
from __future__ import annotations
import base64
import ctypes
import hashlib
import hmac
import json
import os
import select
import signal
import socket
import stat
import struct
import sys
import uuid

# Standalone import is model/process free, for algorithm fixtures. Production
# uses the exact embedded base so no mutable application import precedes custody.
if "OriginalTree" not in globals():
    from managed_linux_tree import OriginalTree, WALL, TREE_DOMAIN, exact_read, request_cancel


def private_directory(path):
    if not isinstance(path, str) or not path.startswith("/"):
        raise ValueError("private endpoint directory")
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    held = [os.open("/", flags)]
    try:
        for part in path.split("/")[1:]:
            if not part or part in (".", ".."):
                raise ValueError("private endpoint ancestor")
            held.append(os.open(part, flags, dir_fd=held[-1]))
            facts = os.fstat(held[-1])
            if facts.st_uid not in (0, os.geteuid()) or facts.st_mode & 0o022:
                raise ValueError("private endpoint custody")
        facts = os.fstat(held[-1])
        if facts.st_uid != os.geteuid() or facts.st_mode & 0o077:
            raise ValueError("private endpoint owner")
    finally:
        for descriptor in reversed(held):
            os.close(descriptor)


class ApiOriginalTree(OriginalTree):
    """Original physical CPU tree; only Core receives retirement metadata."""
    def __init__(self, bootstrap, key, owner, control, parent_fd, listener, secret, endpoint_identity):
        super().__init__(bootstrap, key, owner["ownerId"], owner["ownerGeneration"], {}, parent_fd)
        self.fds.discard(None)
        self.api_owner, self.control = owner, control
        self.listener, self.retirement_secret = listener, secret
        self.endpoint_identity = endpoint_identity
        self.fork_closed = False

    def parent_exited(self):
        if self.parent_fd is None:
            return False
        return super().parent_exited()

    def capture(self):
        if self.fork_closed:
            raise ValueError("original CPU publication sealed")
        return super().capture()

    def proof(self):
        if not (self.empty and not self.originals and self.output is None and (self.leader_status is not None or self.no_start_sealed)):
            raise ValueError("actual original tree remains owned")
        self.fork_closed = True
        return {"version": 1, "controlOperationId": self.control, "owner": self.api_owner,
                "recoveryEndpointIdentity": self.endpoint_identity, "treeEmpty": True, "pipeEof": True,
                "leaderWaited": self.leader_status is not None, "noStartSealed": self.no_start_sealed,
                "parentExited": self.parent_exited(), "reaped": self.reaped,
                "retirementSecret": base64.b64encode(self.retirement_secret).decode("ascii")}

    def retirement_server(self):
        """Metadata-only rendezvous; never starts a child or writes Core state.

        The successor's fixed witness captures this actual socket peer pidfd
        BEFORE acknowledging exit. Core accepts only after that positive exit
        and the witness's own original Child/pumps join; no socket/PID absence.
        """
        proof = self.proof()
        self.listener.settimeout(0.25)
        while not self.retirement_retained:
            try:
                connection, _ = self.listener.accept()
            except TimeoutError:
                continue
            try:
                self._retirement_connection(connection, proof)
            except (TimeoutError, ConnectionError, OSError):
                # A disconnected metadata reader cannot consume the original
                # helper or its one-time capability. Keep the same rendezvous.
                continue
        self.listener.close()

    def _retirement_connection(self, connection, proof):
        with connection:
            connection.settimeout(5)
            raw = connection.recv(4097)
            if len(raw) > 4096 or not raw.endswith(b"\n"):
                return
            try:
                request = json.loads(raw)
            except (ValueError, UnicodeError):
                return
            if request != {"action": "retire-original", "controlOperationId": self.control, "owner": self.api_owner,
                           "recoveryEndpointIdentity": self.endpoint_identity}:
                return
            connection.sendall(json.dumps(proof, separators=(",", ":")).encode() + b"\n")
            # The recovery witness must already hold the actual peer pidfd.
            # Losing this ACK keeps the original helper and its capability.
            if connection.recv(32) != b"original-pidfd-captured\n":
                return
            self.retirement_retained = True

    def event(self, event):
        # The original actual Child stderr is separate from CPU child output.
        facts = os.fstat(self.listener.fileno())
        value = {"event": event, "ownerId": self.owner, "ownerGeneration": self.generation,
                 "treeEmpty": self.empty, "pipeEof": self.output is None, "leaderWaited": self.leader_status is not None,
                 "reaped": self.reaped, "controlOperationId": self.control, "leaseId": self.api_owner["leaseId"],
                 "parentBootId": self.api_owner["bootId"], "recoveryEndpointIdentity": self.endpoint_identity,
                 "socketDevice": facts.st_dev, "socketInode": facts.st_ino}
        payload = json.dumps(value, separators=(",", ":")).encode()
        self.sequence += 1
        ordinal = struct.pack("!Q", self.sequence)
        tag = hmac.digest(self.key, TREE_DOMAIN + ordinal + payload, "sha256")
        frame = struct.pack("!I", len(payload)) + ordinal + tag + payload
        offset = 0
        while offset < len(frame):
            offset += os.write(2, frame[offset:])
        if event in ("tree-retired", "tree-no-start"):
            self.retirement_server()

    def retain_after_parent_exit(self):
        # Override Native's file writer. This API helper NEVER opens a DB or
        # journal. All state returns through the existing Core-owned port.
        return self.retirement_server()


def capture_actual_parent(expected):
    """Capture the actual kernel parent relation before any fork/model dispatch."""
    parent = os.getppid()
    if parent != expected:
        return None
    descriptor = os.pidfd_open(parent)
    if os.getppid() != parent:
        os.close(descriptor)
        return None
    return descriptor


def run_api():
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, request_cancel)
    # All are fixed server-owned spawn inputs, never renderer/HTTP fields.
    owner = json.loads(os.environ.pop("VEYRA_CPU_ORIGINAL_OWNER"))
    control = os.environ.pop("VEYRA_CPU_CONTROL_ID")
    endpoint = os.environ.pop("VEYRA_CPU_ORIGINAL_ENDPOINT")
    endpoint_identity = os.environ.pop("VEYRA_CPU_ENDPOINT_IDENTITY")
    secret = base64.b64decode(os.environ.pop("VEYRA_CPU_RETIREMENT_SECRET"), validate=True)
    key = base64.b64decode(os.environ.pop("VEYRA_CPU_PIPE_KEY"), validate=True)
    expected_parent = int(os.environ.pop("VEYRA_CPU_PARENT_PID"))
    memory = int(os.environ.pop("VEYRA_CPU_MEMORY_BYTES"))
    if not 268435456 <= memory <= 9223372036854775807:
        raise ValueError("original CPU memory budget")
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
    if set(owner) != {"instanceId", "bootId", "ownerId", "ownerGeneration", "leaseId"} or len(secret) != 32 or len(key) != 32:
        raise ValueError("original owner inputs")
    for value in (owner["bootId"], owner["ownerId"], owner["leaseId"], control):
        if str(uuid.UUID(value)) != value or uuid.UUID(value).int == 0:
            raise ValueError("original owner UUID")
    if type(owner["ownerGeneration"]) is not int or not 1 <= owner["ownerGeneration"] <= 9007199254740991:
        raise ValueError("original owner generation")
    if os.getpid() == 1:
        raise ValueError("existing init/manager required")
    # Protect the helper-only retirement capability from the CPU child's /proc
    # reads. This is a self-process setting, not a host or machine policy change.
    if ctypes.CDLL(None, use_errno=True).prctl(4, 0, 0, 0, 0):
        raise ValueError("original helper private custody")
    parent = capture_actual_parent(expected_parent)
    expected_endpoint = "veyra-cpu-" + hashlib.sha256((owner["ownerId"] + "\0" + owner["leaseId"]).encode()).hexdigest()
    if endpoint != expected_endpoint or endpoint_identity != endpoint or len(endpoint.encode()) > 100:
        raise ValueError("fixed original endpoint")
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    # Explicit abstract Unix transport creates no filesystem output/fallback.
    # Name alone is never authority: the original Core hash/preimage, actual
    # peer pidfd and positive CPU-tree retirement are independently required.
    listener.bind("\0" + endpoint)
    listener.listen(1)
    tree = ApiOriginalTree(b"", key, owner, control, parent, listener, secret, endpoint_identity)
    try:
        length = struct.unpack("!I", exact_read(0, 4))[0]
        if not 0 < length <= 65536:
            raise ValueError("original bootstrap limit")
        body = exact_read(0, length)
        value = json.loads(body)
        if value["ownerId"] != owner["ownerId"] or value["ownerGeneration"] != owner["ownerGeneration"] or value["instanceId"] != owner["instanceId"] or base64.b64decode(value["capability"], validate=True) != key:
            raise ValueError("original bootstrap conflict")
        if parent is None:
            # Sealed BEFORE any fork or application import. ECHILD is observed,
            # not inferred from the changed/missing parent relation.
            try:
                os.waitpid(-1, os.WNOHANG | WALL)
            except ChildProcessError:
                tree.empty = tree.no_start_sealed = True
                tree.event("tree-no-start")
                return
            raise ValueError("unrelated helper child")
        tree.bootstrap = struct.pack("!I", length) + body
        tree.capture()
        tree.run()
    finally:
        if tree.started and not (tree.empty and not tree.originals and tree.output is None):
            tree.cancel()
            while True:
                try:
                    tree.reap()
                    if not tree.empty:
                        tree.kill_originals()
                    if tree.output is not None:
                        os.set_blocking(tree.output, False)
                        try:
                            if not os.read(tree.output, 16384):
                                tree._close(tree.output)
                                tree.output = None
                        except BlockingIOError:
                            pass
                    if tree.empty and not tree.originals and tree.output is None:
                        break
                except BaseException:
                    pass
                import time
                time.sleep(0.005)
        if not tree.started:
            try:
                os.waitpid(-1, os.WNOHANG | WALL)
            except ChildProcessError:
                tree.empty = tree.no_start_sealed = True
        if tree.parent_exited() and not tree.retirement_retained:
            tree.retirement_server()
        tree.close()


if __name__ == "__main__":
    try:
        run_api()
    except BaseException:
        os._exit(75)
