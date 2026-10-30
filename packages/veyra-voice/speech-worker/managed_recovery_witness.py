"""Fixed model-free Linux witness for ONE retained original helper.

No fork/subprocess/model/DB write. The API retains this actual Child and its pipe
completion, then commits through its existing Core writer. Missing endpoints,
PIDs, health, ACKs and elapsed deadlines never produce retirement proof.
"""
from __future__ import annotations
import base64
import hashlib
import hmac
import json
import os
import select
import socket
import struct
import sys
import time
import uuid


def original_request(value):
    fields = {"version", "controlOperationId", "owner", "recoveryEndpointIdentity", "retirementSecretSha256", "requireParentExit", "deadlineMs"}
    if not isinstance(value, dict) or set(value) != fields or type(value["version"]) is not int or value["version"] != 1 or type(value["requireParentExit"]) is not bool or type(value["deadlineMs"]) is not int or not 1 <= value["deadlineMs"] <= 60000:
        raise ValueError("original witness request")
    owner = value["owner"]
    if not isinstance(owner, dict) or set(owner) != {"instanceId", "bootId", "ownerId", "ownerGeneration", "leaseId"}:
        raise ValueError("original witness owner")
    for item in (value["controlOperationId"], owner["bootId"], owner["ownerId"], owner["leaseId"]):
        if not isinstance(item, str) or str(uuid.UUID(item)) != item or uuid.UUID(item).int == 0:
            raise ValueError("original witness UUID")
    if type(owner["ownerGeneration"]) is not int or not 1 <= owner["ownerGeneration"] <= 9007199254740991:
        raise ValueError("original witness generation")
    endpoint = "veyra-cpu-" + hashlib.sha256((owner["ownerId"] + "\0" + owner["leaseId"]).encode()).hexdigest()
    if value["recoveryEndpointIdentity"] != endpoint or not isinstance(value["retirementSecretSha256"], str) or len(value["retirementSecretSha256"]) != 64 or any(character not in "0123456789abcdef" for character in value["retirementSecretSha256"]):
        raise ValueError("original witness binding")
    return value


def authenticate_retirement(expected, value):
    fields = {"version", "controlOperationId", "owner", "recoveryEndpointIdentity", "treeEmpty", "pipeEof", "leaderWaited", "noStartSealed", "parentExited", "reaped", "retirementSecret"}
    if not isinstance(value, dict) or set(value) != fields or type(value["version"]) is not int or value["version"] != 1 or value["controlOperationId"] != expected["controlOperationId"] or value["owner"] != expected["owner"] or value["recoveryEndpointIdentity"] != expected["recoveryEndpointIdentity"]:
        raise ValueError("original witness conflict")
    if value["treeEmpty"] is not True or value["pipeEof"] is not True or type(value["noStartSealed"]) is not bool or type(value["leaderWaited"]) is not bool or type(value["parentExited"]) is not bool or type(value["reaped"]) is not int or value["reaped"] < 0:
        raise ValueError("actual original tree proof missing")
    if not (value["leaderWaited"] and value["reaped"] > 0 or value["noStartSealed"]):
        raise ValueError("actual original wait/no-start missing")
    if expected["requireParentExit"] and not value["parentExited"] and not value["noStartSealed"]:
        raise ValueError("live original owner cannot be adopted")
    secret = base64.b64decode(value["retirementSecret"], validate=True)
    if len(secret) != 32 or not hmac.compare_digest(hashlib.sha256(secret).hexdigest(), expected["retirementSecretSha256"]):
        raise ValueError("original retirement capability mismatch")
    return {key: item for key, item in value.items() if key != "retirementSecret"}


def read_line(connection, maximum):
    result = bytearray()
    while not result.endswith(b"\n"):
        chunk = connection.recv(min(1024, maximum + 1 - len(result)))
        if not chunk:
            raise ValueError("original witness response closed")
        result.extend(chunk)
        if len(result) > maximum or b"\n" in result[:-1]:
            raise ValueError("original witness response limit")
    return bytes(result)


def run_witness():
    raw = sys.stdin.buffer.readline(8193)
    if not raw.endswith(b"\n") or len(raw) > 8192:
        raise ValueError("original witness input limit")
    expected = original_request(json.loads(raw))
    deadline = time.monotonic() + expected["deadlineMs"] / 1000
    descriptor = None
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(min(5, expected["deadlineMs"] / 1000))
        connection.connect("\0" + expected["recoveryEndpointIdentity"])
        # Actual connected kernel peer, not a PID supplied by Core/HTTP. The
        # helper is held at its ACK gate until this peer pidfd is captured.
        peer = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
        process_id, user_id, _ = struct.unpack("3i", peer)
        if user_id != os.geteuid():
            raise ValueError("original peer identity")
        descriptor = os.pidfd_open(process_id)
        try:
            request = {"action": "retire-original", "controlOperationId": expected["controlOperationId"], "owner": expected["owner"],
                       "recoveryEndpointIdentity": expected["recoveryEndpointIdentity"]}
            connection.sendall(json.dumps(request, separators=(",", ":")).encode() + b"\n")
            proof = authenticate_retirement(expected, json.loads(read_line(connection, 8192)))
            if connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, len(peer)) != peer:
                raise ValueError("original peer changed")
            connection.sendall(b"original-pidfd-captured\n")
            if connection.recv(1) != b"":
                raise ValueError("original helper protocol incomplete")
            watch = select.poll()
            watch.register(descriptor, select.POLLIN)
            exited = False
            while time.monotonic() < deadline:
                events = watch.poll(25)
                if any(flags & (select.POLLERR | select.POLLNVAL) for _, flags in events):
                    raise ValueError("original kernel capability unavailable")
                if any(flags & select.POLLIN for _, flags in events):
                    exited = True
                    break
            if not exited:
                raise ValueError("original kernel exit unconfirmed")
            proof.update(helperKernelExited=True, helperPipeEOF=True, retirementSecretSha256=expected["retirementSecretSha256"])
            data = json.dumps(proof, separators=(",", ":")).encode() + b"\n"
            if len(data) > 8192:
                raise ValueError("original witness output limit")
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()
        finally:
            if descriptor is not None:
                os.close(descriptor)


if __name__ == "__main__":
    try:
        run_witness()
    except BaseException:
        os._exit(75)
