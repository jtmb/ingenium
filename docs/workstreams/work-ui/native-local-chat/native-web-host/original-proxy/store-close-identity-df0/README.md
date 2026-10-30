# Same writer original on SQLite close refusal

Owner: Work UI worker, same approved C-backed task root. Source-only follow-on to
df0b6eb23a487330d71159cf396cb34d8ba43bdf and the original publication source chain.
No Native/shared write, compiler/test/application runtime, dependency or migration8.

ProjectStore::close exhaustively destructures the store and reconstructs it on
SQLite close refusal. It must carry native_web_writer through both places. It
must NOT allocate a replacement writer Arc: a refused close returned the same
connection and existing pre-send outcomes still belong to that exact original.

The existing real busy-SQLite regression now captures its actual writer Arc and
asserts pointer identity along with the original connection/statement after both
refusals. No replacement test or fake positive close is introduced. Its current
schema setup, and the busy test-support setup, previously created1–4 then explicitly
validated current version5; both now apply existing0005 before that validation,
matching production. Historical-schema tests are untouched. This is a test setup
correction, not a production migration or quota change. Rust regression UNRUN.

compose.py verifies frozen fixture source against df0, reads the exact pinned
close.rs blob2364046fb3500453f3bb8c8508dc8ee9e5b9f053, and generates a three-path
delta with exact before/after hashes. Regenerate with python3 -B compose.py and
process TEMP/TMP/TMPDIR in existing coordination/work-ui. Root owns semantic,
compiler and actual SQLite qualification.

Generated paths: this README,compose.py,review.py/review.json,store-close-identity.patch,manifest.json,
minimal Root integration/review recipes and source evidence. No bulk/build/cache/
dependency/temp output. Removed paths:none; measured bytes0; no disk recovery
claim. Preserve protected research, user data, source/lockfiles and frozen commits.
