# Same-browser-actor pairing follow-on

This is SOURCE for Root integration into the existing APP/Native owners. It does not establish actual sign-in, TLS enrollment, Native compilation, visual/workflow acceptance, synthesis execution or cluster deployment. The complete existing Veyra and Customize acceptance scope remains open.

## Apply and compose

Use native-pairing-followon.patch after the existing Native transport/portable patches and Root's r6 Read/newline corrections. It passed git apply --check against actual Native. The recipe does not repeat those Root corrections.

Use node-pairing-consolidated.patch against Root's current APP checkout (it passed git apply --check). This includes the three prior b283 proof files in their final form; do not first apply the old Node proof patch when using the consolidated patch. node-pairing-followon.patch is the alternative incremental delta after b283. Inspect pinned shared preimages in assembly-preimages.json, core-export-preimage.json, vault-guard-preimage.json and mcp-guard-preimage.json. Do not overwrite later shared edits.

The APP source assembly:
- exports actual frozen Core payloadHash under hostedGovernancePayloadHash and its exact SqlDb type alias;
- creates the request-bound custody owner from the current actual browser user, existing installation identity, existing project permissions and existing user-owned connection/vault rows;
- mounts pairings before governance, outside proof preflight (pairing creates the proof custody);
- runs governance preflight on each matched route, with actual params, and rechecks custody synchronously inside the Core callback;
- registers only the exact pairing GET/POST paths under browser-session admission. Concrete custody still checks actual vault/skills permissions and same owner.

No new credential database, schema/table, global service token, Native identity fallback or renderer credential is introduced. Core's frozen POST /enrollments remains exactly enrollmentRequestId, hostedProjectId, visibility. The new private POST /pairings accepts exactly enrollmentRequestId, hostedProjectId, preparationItemId. The requested hosted project must equal the actual owned vault row BEFORE the irreversible pair effect.

## Actual custody path

Native validates its actual full saved Project/library/service owner, current Node account session and pinned Node identity. It generates the existing one-use Pairing -> Grant custodian with an explicit policy. It uploads the closed preparation (actual public listener origin/cert/pin/authority plus private one-use code) into the existing user-owned encrypted vault item through the fixed existing vault creation route. It then invokes the fixed pairing route; neither route returns the secret.

Node claims an existing provider_connections row before pair POST. Its config is secret-free. Node obtains the actual secure HttpOnly veyra_remote cookie from Native's existing pair response and retains that real redemption in the SAME encrypted vault item before its context GET. It constructs full Native original ownership only from the authenticated paired proof. It stores the paired credential in that item and activates its existing connection row.

The source reader checks pinned certificate AND hostname, uses fixed paths, bounded responses/timeouts, no redirect/retry, and keeps tokens private. The synchronous Core-time guard rechecks actual browser actor, installation, active connection revision, actual secret version, project permission and unsealed vault.

Native's tracked remote_control worker holds serial across the entire ceremony. It holds commands for preparation and finalization, releases commands before Node redeems Native's pair endpoint, then reacquires it and checks full owner/listener revision before final enrollment. No outer serial/commands lock is reacquired by proof callbacks.

Install the guards atomically with custody: generic vault routes cannot reveal/edit/rotate/delete the reserved native-pairing-credential type, cannot change another item into that type, and accept only closed preparation-stage creation under an actual user session. Generic child-MCP resolution treats it as unavailable BEFORE decryption. Lists expose metadata with no reveal capabilities.

## Failures and remaining gates

The Node connection phase claim precedes the pair request; duplicate pairing calls return retained metadata and never resend code. Received redemption survives context-read failure when the existing vault is available; inspect/recover performs verification GETs only. If the vault is sealed or its secret version changes between irreversible pair and receipt retention, custody cannot store under the wrong owner/key or invent a receipt. The claim stays unknown; no replay/fallback. This limitation is explicitly tested, not claimed solved by encryption.

Native preserves remote_admin original before preparation. Exact same original returns its retained row; altered reuse is refused. Failures after preparation/enrollment can leave an unconfirmed original; no automatic login, pair or enrollment retries. Root must verify operator inspect/revoke/reconciliation and full lifecycle guards for account/pairing originals as well as hosted effect originals. The generic vault guards intentionally preserve the private item: explicit lifecycle retirement must use the true connection/grant owner, with all unknown receipts and protected evidence reconciled.

Root owns full actual APP types/auth-policy/security integration, SQLite migration/runtime persistence, actual user sign-in/MFA, TLS listener/connectivity, actual Native compilation and lock/deadlock/lifecycle testing, UI/IPC enrollment controls, screenshot/workflow review, synthesis executor, deployment, publication and final cleanup. No inference/GPU/service/network activity was run here.

## Tests and provenance

custody.node.mjs executes the actual 096 provider_connections DDL/triggers and actual vault-crypto AES-GCM functions in memory with synthetic keys/principals/transport. Its default production constructor is concrete; fixtures do not establish authentication/runtime acceptance. It covers pair-once, same existing encrypted item, no model/settings changes, actual ownership/scope, sealed/version races, retained redemption recovery, synchronous authority guard, generic vault and child-MCP exclusions.

preflight.node.mjs executes actual proposed preflight, real frozen Core refusal/hash and paired proof decoder; it verifies the public enrollmentRequestId name, closed keys, actual hosted project, same actor, Core-time custody guard and identity read bypass. Existing transport/compatibility controls preserve frozen34351 vectors and original semantics.

check-api-source.mjs checks six private/router modules against the frozen engine and exact source interfaces without emission, plus syntactic diagnostics for all canonical TypeScript. Shared application modules require Root's full type/build/security checks. Native Rust source remains UNRUN here.

The acknowledged test-only direct write to actual Native affected exactly HostedGovernance.test.tsx and __tests__/fixture.ts. Root explicitly retained the correction and owns its later validation. Exact reversible delta and raw before/after byte hashes are native-test-fixture-followon.patch/.json. No other actual Native edits were made by this worker. All further work stayed in the owned proposal directory.

## Storage and reconciliation

Owner: Customize worker chat 01a18935-0723-7cc0-9ea1-5e70f5627cc5. Exact inherited physical output root: C-backed Ubuntu VHDX /home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845 (Windows UNC wsl.localhost/Ubuntu). Existing 20 GiB task ceiling; this source bundle is below its 750,000-byte declared peak. No additional output root, build, dependency copy, download, runtime data or cache was created.

Regenerate patches with Node prepare-pairing-followon.mjs while the pinned preimages remain available; run source tests/checks with the existing Node/TypeScript runtime. All current files are small source, exact integration patches, recipes, manifests or durable minimal review evidence with Root as remaining consumer. Their end condition is the reviewed integrated checkpoint; full builds/caches are not retained.

routes-placeholder.tmp was moved, within the owned root, to its intended source name files/services/ingenium-api/lib/routes/native-customize-pairings.ts. No scratch remains at its former path. Removed disposable paths: none, 0 bytes. No dependencies/builds/caches/temp outputs were generated. Protected sources, lockfiles, original ownership receipt, prior frozen manifests/vectors and Root-owned shared outputs remain intact. No Windows disk-recovery claim is made.