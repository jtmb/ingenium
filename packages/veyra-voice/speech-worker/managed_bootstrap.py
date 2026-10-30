"""Embedded trusted -I/-S bootstrap: no application/site/model import before enrollment.

Native starts this fixed code in its actually owned process scope and sends the
private profile/capability only after kernel enrollment. It is not a CLI config,
HTTP boot request or a renderer-controlled path/URL/token interface.
"""
import base64
import io
import json
import os
from pathlib import Path
import struct
import sys


def run() -> None:
    """Preserve only non-inheritable original control descriptors, then load fixed assets."""
    reader = io.FileIO(os.dup(0), "rb", closefd=True)
    writer = io.FileIO(os.dup(1), "wb", closefd=True)
    os.set_inheritable(reader.fileno(), False)
    os.set_inheritable(writer.fileno(), False)
    null = os.open(os.devnull, os.O_RDWR)
    try:
        os.dup2(null, 0)
        os.dup2(2, 1)
    finally:
        os.close(null)
    sys.stdout = sys.stderr

    def exact(length: int) -> bytes:
        result = bytearray()
        while len(result) < length:
            chunk = reader.read(length-len(result))
            if not chunk:
                raise ValueError("bootstrap closed")
            result.extend(chunk)
        return bytes(result)

    length = struct.unpack("!I", exact(4))[0]
    if not 0 < length <= 65536:
        raise ValueError("bootstrap limit")
    value = json.loads(exact(length))
    required = {"version", "capability", "instanceId", "ownerId", "ownerGeneration", "workerRoot", "pythonPaths", "settings", "enableInference"}
    if not isinstance(value, dict) or set(value) != required or value["version"] != 1 or value["enableInference"] is not True:
        raise ValueError("bootstrap shape")
    key = base64.b64decode(value["capability"], validate=True)
    if len(key) != 32 or not isinstance(value["pythonPaths"], list) or not 1 <= len(value["pythonPaths"]) <= 32:
        raise ValueError("bootstrap capability")
    root = Path(value["workerRoot"])
    if not root.is_absolute() or not root.is_dir():
        raise ValueError("bootstrap bundle")
    paths = [str(root)]
    for path in value["pythonPaths"]:
        candidate = Path(path)
        if not candidate.is_absolute() or not candidate.is_dir() or str(candidate) in paths:
            raise ValueError("bootstrap import root")
        paths.append(str(candidate))
    os.environ.update({"CUDA_VISIBLE_DEVICES": "", "HIP_VISIBLE_DEVICES": "", "ROCR_VISIBLE_DEVICES": "",
        "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1"})
    # Standard-library roots came from the pinned isolated interpreter. Only the
    # Native-owned fixed bundle/venv roots are added after private scope binding.
    sys.path[:0] = paths
    from managed_entry import serve_managed
    serve_managed(reader, writer, key, value)


if __name__ == "__main__":
    try:
        run()
    except BaseException:
        # No private profile, token, model path or raw payload reaches diagnostics.
        raise SystemExit(75) from None
