# Exact canonical JSON source proposal

Owner: Work UI worker. One authorized root remains
/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845 on the existing
C-backed Ubuntu VHDX. This directory owns only bounded source/recipes/pinned
evidence and hash receipts. No build/runtime/CU/install/download/disk DB/new
writer/dependency or DDL changes. Native/shared source, lockfiles, frozen7,
research and immutable checkpoints stay protected. Root alone applies changes.
Regenerate with Python -B using existing coordination/work-ui as TMPDIR.
Consumer: Root exact canonical provenance/feature/compiler/fixture review.
End condition: retain minimal source and pinned evidence through integration.
Removed paths none, bytes0; no bulk or disk recovery claim.

Root requires existing full-Value canonical hash semantics. No raw-hash substitute
or new provenance protocol is allowed. The proposed serializer traverses validated
charged source spans, allocates only charged per-object span indexes and delegates
string escaping, numeric parsing/formatting and delimiters to the same actual
pinned serde_json crate. It probes that crate's actual Map ordering with a fixed
two-key map, so preserve_order vs BTreeMap affects output exactly as the legacy
Value path. Duplicate decoded keys remain refused before serialization.

Numeric resource prerequisite: actual serde_json target features are not yet
verified. Version1.0.151 has default fixed-size Number representation, while
arbitrary_precision stores an owned String and float_roundtrip can grow parser
scratch on long numbers. Calling the actual Number parser preserves canonical
semantics, but does NOT prove those internal allocations charged or bounded.
Root was asked for the actual build feature fingerprint. No scalar length cap,
std-f64 substitution or changed numeric representation is authorized as a fix.
Do not activate/claim complete memory enforcement until that gate is resolved.

Root supplied coordination/integration/serde-json-existing-fingerprints-r1.json:
five prior actual compiler cache observations all omit preserve_order,
arbitrary_precision and float_roundtrip. Three include raw_value; one includes
unbounded_depth. This is prior cache evidence, not the uncompiled final target.
inspect_serde.py pins the actual crate archive to Cargo.lock, compares seven
primary source files byte-for-byte and references that original receipt by hash.
It neither extracts files nor executes any dependency/runtime code.

Pinned Value deserialization has feature-selected private first-key semantics:
RawValue reparses a string as JSON, Number parses its string as a number. The
serializer probes those actual compiled behaviors with tiny constant objects and
handles the corresponding semantic form using charged decoded bytes/indexes.
Extra siblings are rejected as the pinned end_map does. Ordinary duplicate keys
in the actual original input remain refused. Embedded JSON inside a RawValue
string retains the legacy parser's last-value duplicate semantics and127-container
limit, because those are string data in the original and must hash identically.
No unknown metadata Value/Map/String AST is allocated. Seven supplied tests cover
exact library bytes/hashes, feature-selected keys, failures and depth boundaries;
they remain UNRUN, as do compiler/fuzz/performance/platform/memory qualification.

The materializer uses actual parsed URI/file spans and charged decode/encode/output
destinations. It removes the full before/expected body Values and old uncharged
key scanner; existing source provenance projection Values and captured URI String
fields still require bounded replacement. Nothing here closes that remaining
resource gate or claims the ordinary20MiB/full64MiB acceptance predicate.

The fixed two-key ordering probe uses tiny known bookkeeping allocations; no
unknown metadata is materialized into a Map/Value/String. Allocator/wrapper/stack/
HTTP/SQLite bookkeeping still needs its explicit whole-system qualification.
Full20MiB and64MiB resident-payload acceptance remain open.
