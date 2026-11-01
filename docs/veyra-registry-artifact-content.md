# Registry artifact content qualification

The Linux browser lock now contains content hashes measured from the existing
immutable Linux/amd64 image. This is build-input evidence. Browser launch,
integrated packaging, OS input provenance, source qualification, and independent
rebuild comparison remain required.

The read-only tools in ops/registry_image_reader.py and
ops/registry_layer_inventory.py verify manifest/config bytes, each complete
compressed layer digest, and each complete uncompressed diff ID. They stream
files through bounded hashes and never extract archive paths or retain layers.
Redirects remove registry authorization before contacting a permitted CDN.

ops/registry_artifact_projection.py requires the full image layer closure.
It applies later-layer whiteouts and opaque directory effects before hashing
the final artifact tree, including its parent-directory ownership and modes.
Missing directories, mutable ownership/modes, unsupported metadata, hard links,
escaping links, dangling links and cycles are refused. Its output is data;
it grants no runtime authority or permission to reuse an image.

sha256-tree-manifest-v1 hashes compact sorted-key ASCII-escaped JSON with the
shape {version:1,entries:[...]}. Entries are sorted by absolute image path.
Each entry contains path, type, mode, uid, gid and bytes, plus sha256 for a
regular file, or link and resolvedImagePath for a symlink. Filesystem timestamps
are absent. Extended archive metadata is refused rather than silently ignored.
A matching revision or executable filename alone does not qualify a tree.

The qualified artifacts are Chromium 1232, Chromium headless shell 1232 and
FFmpeg 1011 for Playwright 1.62.0-alpha-1783623505000. Their immutable acquisition
and complete tree hashes are recorded in tools/veyra-release/linux-build.lock.json.
Four package metadata files were matched to the actual Playwright dependency
resolved by @playwright/mcp, rather than a different root Playwright install.

Run the bounded in-memory controls without generating bytecode:
python3 -I -B -m unittest discover -s tests -p 'test_registry_*.py' -v

The source image's bookworm-updates and security repository index hashes differ
from the newer approved snapshot lock. Keep that OS provenance gate open.
Do not replace the snapshot receipts with claims inferred from browser hashes.
The editor also occurs in both the main code-server layer and the vendor
security overlay, so dropping only the main editor layer is insufficient.
No new image assembly, smaller build reserve, publication, or deployment is
accepted by this content qualification.
