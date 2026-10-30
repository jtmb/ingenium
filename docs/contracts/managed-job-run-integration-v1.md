# Original managed JobRun source integration

Core remains the sole database and credential writer. Migration126 adds execution metadata for an existing JobRun and a dedicated job-run credential sidecar; it does not replace legacy credential kinds or mint another run, workspace, user or scheduler. The API adapters, manager container owner and fixed child now consume the same original run/attempt and durable effect decisions.

The manager records intent before create/start and keeps an ambiguous original unresolved. Positive original daemon/container wait-and-inspect evidence is required before terminalizing managed work or releasing its quota. A verified model response is separately required for success. Cancellation, restart recovery and the local runner cannot silently finish or execute a managed run. Cleanup follows consumed original outcome and retirement evidence.

The job-run credential uses the original token generation, hashing and encryption owners. Generic browser/runtime/MCP authentication continues to reject this audience. The dedicated handlers validate exact original run, current scope, epochs, grant and explicit tool policy. The child admits only the Core-qualified assignment, passes its exact qualified model to the existing fixed OpenCode CLI, and excludes unrelated host environment variables. Raw prompts, output and credentials are not retained in execution receipts.

## Current verification

- 57 source/real-memory-SQLite fixture cases passed before actual integration, including material/create/start/fast-result CAS, retirement, consumption, credential audience, authorization, epochs and legacy quota guards. Fixture encryption and Docker remain explicit limits.
- Actual API and Core source type checking passes with closed declaration interfaces. The managed launch body now rejects missing, extra or invalid run/runtime fields before invoking the original owner.
- Three actual child-module regressions pass, including exact model argv, invalid/missing model refusal and zero exit without verified response.
- Actual Core startup applied126 in an isolated full-schema fixture. A signed snapshot/capsule recovery test preserved a newer learned forget over an older snapshot, erased its content and passed integrity and foreign-key checks. This verifies the original Core restore hook, not a privileged or deployed restore.
- The consumed restore fixture was removed after an ANSI consumer-log mismatch was resolved from the original output and the same exact cleanup tool/path repeated every preservation and inactivity check. Durable source, raw failure/success logs and signed fixture manifest hashes remain. 11,026,365 logical bytes and11,079,680 Linux allocated bytes were removed; no Windows recovery is claimed.

## Required integration and release checks

This is source integration. The exact private Express ingress, configured immutable job-role image and original protected broker transport still require coordinator composition and runtime qualification. Image labels or a caller boolean do not prove the built job-run transport or selected model. Actual manager enrollment and current image/resource observations must come from the original owners.

The conservative prepared/no-create acknowledgement edge remains unresolved in this revision. A separate reviewed monotonic no-effect proof is being integrated; absent-container observations never establish it. Full configured encryption, real selected-container execution, cancellation, restart/descendant retirement, persisted operation history, exact-source packaging/deployment and attended acceptance remain release gates. The overall delivery goal stays open.
The restore maintenance owner now refuses unfinished managed children before claiming a restore and repeats that check after stopping the original database users. It verifies exact retirement proof and terminal Core run metadata independently of parent runtime state. Seven in-memory SQLite cases pass, including malformed, foreign, missing and incomplete proofs; the original SQL failure remains in the task evidence. The privileged/deployed restore workflow remains a required acceptance check.
