"""Regenerate the minimal source manifest in place; no dependency/cache output."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent
paths = sorted(path for path in root.rglob("*") if path.is_file() and path.name != "manifest.json")
manifest = {
    "native_base_tree": "c295428576246dfa2b97f3a30f2045fc5ff1950f",
    "projects_source_commit": "8b18318e248c7e1cba953c1e68b47529aac1a276",
    "files": [{"path": str(path.relative_to(root)).replace("\\", "/"), "bytes": path.stat().st_size,
               "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path in paths],
    "removed_paths": [], "removed_bytes": 0,
    "bulk_outputs": [], "acceptance": "fixture source only; central React/types/native/runtime/visual gates open"
}
(root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"files": len(paths), "source_bytes": sum(item["bytes"] for item in manifest["files"])}))
