"""Linux model-free suite + exact owned synthetic-fixture reconciliation.

No fork/helper/process/model/socket/device is launched. Run this script with the
already available Python, -B, and the existing voice coordination directory.
The existing prepare fixture explicitly fakes Python 3.12 and its model loader;
this is unit evidence, never a neural/runtime/platform qualification.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
import shutil
import sys
import unittest

APP = Path(__file__).resolve().parents[4]
coordination = Path(sys.argv[1]).resolve(strict=True)
if coordination.name != "voice" or coordination.parent.name != "coordination" or coordination.parent.parent != APP.parent.parent:
    raise SystemExit("Not the declared existing voice coordination root")
root = coordination / "speech-fixtures"
if root.exists() or root.is_symlink():
    raise SystemExit("Existing fixture target retained; never adopt or delete it")
os.environ.update(TEMP=str(coordination), TMP=str(coordination), TMPDIR=str(coordination),
                  VEYRA_VOICE_TEST_ROOT=str(root), PYTHONDONTWRITEBYTECODE="1")
root.mkdir(mode=0o700)
receipt = {"owner": "01a18935-1617-7d31-8e56-f77df7b6c756", "root": str(root), "python": sys.version,
           "regenerate": "python -B docs/workstreams/voice/managed-cpu/run_model_free.py <same existing coordination/voice>",
           "removed": [], "retained": [], "modelRuntimeQualified": False}
result = None
try:
    suite = unittest.defaultTestLoader.discover(str(APP / "packages/veyra-voice/speech-worker/tests"), pattern="test_*.py")
    result = unittest.TextTestRunner(verbosity=1).run(suite)
finally:
    # Only this create-new synthetic root; never source, models, existing caches
    # or user evidence. Test process/thread ownership is checked before deletion.
    failures = []
    files = []
    for path in root.rglob("*"):
        if path.is_symlink():
            failures.append("Unexpected redirected fixture: " + str(path))
        elif path.is_file():
            files.append({"path": str(path), "bytes": path.stat().st_size})
    if sum(item["bytes"] for item in files) > 1048576:
        failures.append("Unexpected fixture growth exceeds 1 MiB")
    # Test-defined exact synthetic workspaces, never a name-based cache deletion.
    allowed = {"test_cpu_and_gpu_hashes_are_verified_without_loading_either", "test_corrupt_and_unlisted_assets_fail_closed",
               "test_cpu_profile_is_never_interpreted_as_a_gpu_fallback", "test_prepared_cpu_service_uses_only_selected_loader_after_validation"}
    if any(path.name not in allowed for path in root.iterdir()):
        failures.append("Unexpected top-level synthetic fixture")
    try:
        for process in Path("/proc").iterdir():
            if not process.name.isdigit():
                continue
            try:
                for name in ("cwd", "root"):
                    value = os.readlink(process / name).removesuffix(" (deleted)")
                    if value == str(root) or value.startswith(str(root) + "/"):
                        failures.append("Active process directory reference: " + str(process / name))
                for descriptor in (process / "fd").iterdir():
                    try:
                        value = os.readlink(descriptor).removesuffix(" (deleted)")
                    except FileNotFoundError:
                        continue
                    if value == str(root) or value.startswith(str(root) + "/"):
                        failures.append("Active descriptor reference: " + str(descriptor))
                mounts = (process / "mountinfo").read_text()
                if str(root) in mounts:
                    failures.append("Active mount reference: " + str(process))
            except (FileNotFoundError, ProcessLookupError):
                continue
            except PermissionError:
                failures.append("Cannot check process/mount references: " + str(process))
    except BaseException as error:
        failures.append("Reference audit failed: " + type(error).__name__)
    if root.resolve(strict=True) != root or root.parent != coordination or (root / ".git").exists():
        failures.append("Exact ownership/containment check failed")
    if failures:
        receipt["retained"].append({"path": str(root), "bytes": sum(item["bytes"] for item in files), "failedChecks": failures})
    else:
        receipt["removed"] = files
        receipt["removedBytes"] = sum(item["bytes"] for item in files)
        shutil.rmtree(root)
        receipt["emptyRootRemoved"] = str(root)
    if result is not None:
        receipt.update(tests=result.testsRun, failures=len(result.failures), errors=len(result.errors), passed=result.wasSuccessful())
    (coordination / "managed-model-free.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt))
if result is None or not result.wasSuccessful() or receipt["retained"]:
    raise SystemExit(1)
