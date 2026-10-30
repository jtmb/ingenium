# Existing fixture writer identity fields

Owner: Work UI worker; same approved C-backed task root. Source-only correction
following492f's private ProjectStore writer identity, valid with currentb178 chain.
No Native/shared writes, compiler/test/application runtime or dependencies.

Six existing test/helper files contain12 direct ProjectStore struct literals.
Each now initializes its own fresh private writer Arc, including independent and
reopened-store fixtures. This preserves the original allocation-identity boundary;
reusing a global/cached identity would weaken it. Existing SQL fixtures, assertions
and behaviors remain byte-exact after removing only the new initializer fields.
No new mirror test is added. This repairs missing fields needed to compile those
existing tests; it does not assert that they compiled or passed here.

compose.py pins exact immutable Native Git blobs and constructor counts1,1,4,1,4,1.
It changes ONLY the constructor field and verifies removing the inserted field
reproduces each entire preimage. Regenerate with python3 -B compose.py and process
TEMP/TMP/TMPDIR in existing coordination/work-ui. Native Runtime/OwnedEngine/lease
literal inventory was also checked; no additional direct test literal was found
for those fields. Root owns actual compiler and test qualification.

Generated paths: this README,compose.py,fixture-writer-identity.patch,manifest.json,
all minimal Root review/regeneration inputs. No bulk/cache/dependency/temp/build
output exists. Removed paths:none; measured bytes0; no disk recovery claim.
Preserve protected research, original source/lockfiles and frozen checkpoints.
