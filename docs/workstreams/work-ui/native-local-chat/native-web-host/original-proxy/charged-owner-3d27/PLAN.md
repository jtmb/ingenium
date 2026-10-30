# Concrete charged ownership proposal

Owner: Work UI worker. Output root remains
/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845,
C-backed Ubuntu VHDX. This bounded directory owns source modules, an exact patch
recipe and minimal hashes/review receipts only. No build, cache, install, runtime,
disk DB, new connection/writer or schema activation is authorized here.

Protected: all Native/shared source, Cargo manifests/lockfiles, frozen allocation7,
existing source checkpoints and protected research. Root applies shared changes.
Regeneration: Python -B compose.py with existing coordination/work-ui as TMPDIR.
The minimal patch has zero context to avoid whitespace-only context records in
the tracked patch. Root must use git apply --unidiff-zero --check and then the
same --unidiff-zero flag when applying after exact input hash verification.
Consumer: Root exact semantic integration review, then compiler/runtime tests.
End condition: retain minimal source and recipe through reviewed integration.
No reproducible bulk exists. Removed paths none, removed bytes 0; no disk recovery.

The complete Native search includes apps/service. Real callers are
routes/live_agent.rs and routes/local_workspaces/web_original.rs. The latter's
capture, acquire and submit_prompt have no external caller in the current source;
the outer private authenticated host remains an actual integration boundary.
This proposal must adapt those service consumers, not stop at adapter signatures.

The first concrete history implementation revalidates a whole ACK hash in bounded
windows inside one original-connection transaction for EACH returned page. That
costs O(body size times page count), but does not hold an SQLite borrow or the
service projects mutex over network backpressure. Each prepass and returned page
refer to the same actual BLOB/snapshot. Schema8 verified immutable chunks can
later avoid repeated full scans after their exact manifest/immutability review.
No SELECT substr or full-row BLOB loading is proposed. One page is charged before
query/open, and real HTTP Bytes ownership must retain that charge to last drop.

Payload capacity is not whole-process RSS. Existing JSON/parser/path/base64/SQLite/
HTTP and allocator bookkeeping still require explicit bounded integration. The
source proposal must list every remaining escape, without granting qualification
or changing ordinary20MiB acceptance. Root owns schema8 DDL/dependency activation.
