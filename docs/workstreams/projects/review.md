# Source review and coordinator change requests

Reviewed boundary: owned project modules, prefixed dependency-free tests and controlled UI components. Existing source outside this stream is read-only. The native checkout remains at its clean baseline; no native commit is required for these consumer adapters.

## Required coordinator wiring

- Allocate the five-table additive migration after copied-data review; keep legacy global FKs/resources/settings/provenance. Do not drop or repurpose the old row.
- Supply the existing DB transaction/checkpoint and authenticated authorization helpers. Decide final core-library placement for the persistence implementation; dashboard/MCP remain API clients with zero DB access.
- Derive scope from the real principal/project membership. Mount unnumbered proposed workspace routes only after existing CSRF/origin/auth/capability checks.
- Convert source-relative shared `.mjs` imports to the coordinator-reviewed workspace package/build layout, including the modules/schema in API distribution. Run no-emit API/dashboard checks against that exact wiring.
- Choose native catalog through `NativeProjectCatalogAdapter`; attach native instance ID and host-native root proofs. Never persist a duplicate native catalog.
- Bind execution/read ports to the existing native/runtime owner, with immutable workspace identity/mapping hash/security epoch/instance/revision. Operation admission must authorize specific terminal/action/worktree targets and retain exact-original recovery.
- Supply private projectless working-area admission. Existing native contracts require a project for task submission; projectless UI must not create a synthetic global project to bypass that limitation. Coordinator must implement or expose an explicit private working-area owner before enabling unsupported native projectless execution.
- Wire the three UI components into Work's slots. Pass only current authorized state and preserve unavailable selections. Terminal inputs retain draft/unknown outcomes and must not be replayed by reconnect.
- Existing native terminal router lacks resize. Genuine PTY/resize/persistence and real WSL prerequisites remain a native integration request, not a passing worker claim.
- Shared sidebar preferences, read/unread, import/export, cross-location handoff, remote pairing/mobile/cloud and immutable share snapshots keep their existing native owners. Qualify those adapters with the coordinator's actual native/runtime/auth contracts; do not create duplicate stores to make controls look active.

## Concrete requested validation

1. Run the pending five-case React interaction suite with existing coordinator dependencies: `npm exec --workspace=ingenium-dashboard -- vitest run --config vitest.config.ts tests/veyra-projects-components.test.tsx`. It covers explicit projectless/offline selection, unknown terminal input/remount and capability-disabled worktree controls. Then no-emit TypeScript for owned API consumer declarations and the three TSX components using existing lockfile-compatible coordinator dependencies. Do not install/copy dependencies for this worker.
2. Isolated component render/keyboard states: empty/loading/error; projectless; missing/archived/offline project or target; terminal reconnect/unknown input; pending worktree/archive/restore; 100–200% scale and narrow viewport.
3. Integrated authenticated API cases: CRUD/CAS/archive/restore, no unauthorized rows/cursors, same-label distinct roots/hosts, explicit root attestation, settings bridge and secret-key denial.
4. Native exact-source cases: catalog ID/revision/instance preservation; original terminal input/resize/close; no orphan process after reconnect/restart; Git status/diff and reviewed worktree recovery. WSL and cluster must run against the selected actual owner/storage.
5. Authorized production COPY: all original table hashes/IDs/ACLs/resources, new orchestration skill, protected references, migration failure/restore/rollback and unknown-consumer refusal.
6. Package/runtime smoke from exact integrated `dist/`, then Windows and Kubernetes workflow/persistence/rollback/visual gates.

No build/resource lease has been consumed by this stream. No publication, runtime start/stop, desktop/microphone capture or model/GPU workload was performed.

## Supplemental exact-request review

Regression tests exposed mutable caller scope/request data changing during host admission and a native list project identity changing between authorization and response mapping. Inputs and native owner responses now use detached, recursively frozen JSON snapshots before asynchronous work. Non-JSON/cyclic inputs are rejected before admission. Both failing regressions pass after that change; the dependency-free suite is now 29/29. This does not close the pending React/typecheck/runtime gates.
