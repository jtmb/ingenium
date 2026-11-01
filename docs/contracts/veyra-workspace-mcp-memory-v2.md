# Workspace MCP memory read owner

Projectless runtime tools use the existing dedicated workspace-runtime-v2
audience. They never impersonate a browser user or feed a null/global Project
into a legacy handler. Original credential, capability, user epoch, membership,
lease, retained provision and fresh manager placement checks remain authoritative.

A new runtime may receive the explicit memory:read capability through the existing
Core issuance owner. Existing scope-only credentials retain only their recorded
scopes; inspection must not synthesize or silently add a grant. Catalog descriptions remain stable during startup so an engine can cache them.
Only the scope operation executes before Ready. Memory calls require READY/IDLE
and actual original image/manager placement; metadata never grants that authority.

The tool catalog presents memory read and per-chat policy inspection only when
the actual catalog definition, credential capability and current private owner
allow them. It does not expose human saved-history endpoints, browser mutation
facades, policy writes, forget/reset, extraction, model execution or installation
operations. Engine chat IDs are validated through the original current-generation
canonical mapping. A caller cannot supply an owner, organization, scope hash,
Context ID, runtime placement, source transcript or positive availability proof.

Use the original MemoryLifecycle and Core connection. A separate fixed runtime
request factory supplies an actual authenticated service identity and its
credential attestation; the shared adapter must require a distinct explicit
projectless service ownership port, absent from existing browser factories. The
original browser-only projectless path stays browser-only. Every memory
authorization revalidates the real capability and original execution; services
never gain write-policy, forget, generate, backup or restore through this path.

Recall honors installation/scope/chat use-memory policy, source exclusion,
suppression receipts, source generations, exact canonical completed-turn
provenance and live original-engine availability. Source proof is bounded and
rechecked before return. Returned memory is untrusted data with no instruction
authority. No weaker database-only source reader or synthetic native engine
identity is accepted. No extraction/generation or second writer is introduced.

Qualification requires unchanged browser/legacy denial controls, scope-only
credential compatibility, real canonical Core/service isolation, revocation and
policy suppression, source/generation refusal, original SDK protocol behavior,
source-identical packaging and finally real qualified runtime/engine checks.
Test ports and synthetic runtime rows cannot close physical image acceptance.
