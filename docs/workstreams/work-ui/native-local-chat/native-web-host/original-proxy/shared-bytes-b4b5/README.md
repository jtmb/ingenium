# Shared request bytes and completed-view release

Owner: Work UI worker, same approved C-backed task root. Source-only follow-on
against immutableb4b5c353c702a4439fbdaef15a093819594eb22d. No Native/shared write,
compiler, application runtime, model/GPU/browser, download, DDL or activation.

Raw captured bytes now have an immutable Arc<[u8]> owner. Windows identity
effective bytes share that actual allocation. Request Body::sized owns an Arc
cursor over exact effective bytes, replacing a full to_vec copy. Completed submit
and dispatch readonly JSON views explicitly drop before downstream reserve/HTTP.
The actual prompt bytes, hash framing, method/target/headers, source authority,
same-writer publication, engine/read/transport witnesses and existing caps stay
unchanged. Native JSON body projection serializes the exact slice; no serde rc
feature/Cargo change is needed. WSL's explicit transformation remains explicit.

Exact locked reqwest0.12.28 blocking/body.rs (SHA256578d58f3c661a4c43b771e982bac1dd08a6fedaf98f8baacd096fbe0cad63f7a,
already verified against the cached archive inb4) has Body::sized at80–82 and its
producer path274–351 with requested buffer size min(length,8192), channel sends
and no whole-body buffering in that path. This is not a proof of all HTTP/library
buffers or whole-process RSS. The actual final Client/Response closer remains
the same scoped owner and checked real join fromb4.

One new actual TCP fixture verifies the prepared Reader retains the same byte
owner and peer receives exact whitespace/future JSON fields/Content-Length. The
partial-response fixture now drains request bytes before deliberately truncating
the response, avoiding an unrelated unread-request TCP reset. Fixtures are UNRUN
here; Root owns compiler/real TCP/native qualification.

This removes the audited inline request's unnecessary copies/views. It DOES NOT
close the full64MiB/20MiB gate: provenance JSON/hash copies, WSL recomputation,
SQLite transient full BLOB binds, ACK JSON/base64 copies, actual expansion bounds
and bounded historical replay still need the coherent reviewed design. Allocation7
is unchanged and allocation8 is not implemented here. No history/content/key is
removed and no quota is independently raised.

Regenerate with python3 -B compose.py; review with python3 -B review.py and process
TEMP/TMP/TMPDIR in existing coordination/work-ui. Generated paths: this README,
compose.py,review.py/review.json,shared-request-bytes.patch and manifest.json, all
minimal Root review/regeneration inputs. Consumer ends on exact reviewed import;
durable source recipe/evidence remains. No bulk/build/cache/temp/dependency copy
exists. Removed paths:none, measured bytes0; no disk recovery claim. Preserve all
frozen checkpoints, protected research, user data and source/lockfiles.
