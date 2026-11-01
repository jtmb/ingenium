# Saved workspace conversation read boundary

This is a browser-only read of canonical saved Context data, separate from live
execution admission and model memory retrieval. The existing Core database
connection remains the sole data owner; no transcript is copied or rewritten.

The request owner revalidates the actual user session, active account and current
organization read permission before and after a coherent read transaction. Scope
is the canonical installation identity, explicit organization and actual user.
Compatibility, service/runtime credentials, caller-supplied owners and installation
administration cannot read another user's private history. Foreign or unavailable
scope is concealed. No execution availability or authority is synthesized.

Rows must be actual private, null-Project workspace Context conversations owned
by this user/organization, with exactly one matching original-engine source and
retained immutable original provision identity. Engine/source keys, generations,
source-entry coverage/snapshot and message hashes/provenance are verified using
the existing writer's serialization contract. Pagination is bounded and revision
fenced. No storage paths, credentials or caller transcript fields are accepted.

Stopped, failed, revoked or replaced execution does not erase the user's saved
conversation. Current user/organization data permission still controls this read.
Archive remains an explicit history filter; memory-forget still suppresses model
retrieval through its existing owner. This human-readable endpoint grants no
model recall, extraction, prompt, terminal, runtime launch or source re-adoption.

The UI is read-only and identifies saved data. Returning to Work uses its normal
explicit execution selection and fresh confirmation. No saved metadata can be
passed as an available runtime or used to resume an old engine generation.

Required qualification includes real canonical-data/auth isolation, stopped and
revoked runtime reads, generation/provenance and corruption refusal, bounded
pagination, original archive semantics, no content/execution/memory writes and
first-render/late-response UI scope fences. Synthetic stored data never qualifies
physical runtime, engine, native, voice, image or deployment acceptance.
