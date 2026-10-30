# Original-route live acceptance source slice

Owner: existing Customize worker `01a18935-0723-7cc0-9ea1-5e70f5627cc5`. Root exclusively applies or executes this slice. No subagents, service starts, synthetic account creation, runtime store changes, builds, downloads or desktop control occurred in the worker.

The worker's inherited output root remains `/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845` on the existing authorized C-backed Ubuntu VHDX, within Root's shared 20 GiB ceiling. Source lives only in this existing docs boundary. No output-root migration or Windows disk recovery is claimed. The source bundle stays below its 750,000-byte estimate. Runtime generation is UNRUN and must use Root's same declared physical storage and process-scoped TEMP/TMP/TMPDIR; the driver never chooses another drive.

## Entry points and honest scope

`live-acceptance.mjs` is a Node 22 builtin-only driver for **real original mounted services**. It imports no Core test factories, mocked auth, SQL adapters or fixture-session helpers. It creates the synthetic owner through `POST /api/v1/bootstrap/claim`, then uses actual HTTPS `/auth/csrf`, `/auth/login`, cookie, CSRF and `/auth/session` APIs. The compatibility bearer is used only for the original bootstrap status/claim, never as a user session. Core must be fresh/pending, and Native must have a supported empty DPAPI account/binding/grant/connection/preparation inventory. The runner refuses existing claimed Core installations. Run only against Root-owned disposable isolated services.

Native setup uses `/v1/remote-control/owned/status` and original configure/start commands, `/v1/accounts/import`, journaled `/v1/remote-control/node-hosted/account-commands`, then `/pairing-commands`. Imported credentials are for the real synthetic Core account. The original account vault encrypts them with the actual Windows service-user DPAPI. Trust files use actual Core certificate PEM, DER SHA256 and dashboard Origin. Native publishes its actual running listener/certificate, Node redeems the actual one-use pairing code, and the actual Native custodian callback must complete before governance can proceed. No success/proof/authentication flags are injected. Real HTTPS trust, hostname and exact leaf DER pin verification remain enabled; redirects, nonloopback HTTP, credentials in URLs and TLS bypass environment are refused. Local Native HTTP is allowed only on explicit `127.0.0.1` or `[::1]`, with the actual local service bearer and no Origin.

The paired path reserves actual originals, sends them once, and inspects them through the original Native owner. A deliberate client close **at real response headers before reading the body** exercises caller signal loss. This establishes caller uncertainty and receipt recovery, **not** a durable `executing`/unknown state. Each original, exact canonical payload hash and first terminal receipt is checked twice; quiescence must preserve the initial receipt. A genuine unknown result stays unresolved and fails the bounded poll; no missing receipt becomes success or a refusal, and the driver never resends an effect. Keep Root's actual-source executing/unknown/retirement-purpose tests as separate controls.

The driver exercises paired Skills create, exact CRLF readback, edit, disable/enable, archive/restore; original Plugins create/source/description edit/enable/disable/delete plus paired catalog; original proposal creation followed by paired server-reviewed submit/approve; synthesis status and pipeline reads; live project archive refusal; Node quiescence and denial of live binding/domain reads; real two-owner retirement; immutable retirement original readback; actual persisted Native grant revocation; retired project archive/restore without binding resurrection; actual browser logout/revocation.

## Root execution prerequisites and commands

Root owns startup, certificates (valid SAN for each actual hostname), bootstrap capability, DPAPI service-user ownership, ports, storage guards, original services and teardown. Source-only verification is not permission to touch an existing user installation. Do not use an alternate Linux vault, no-op custodian, test-only route or SQL fixture to make this pass. Runtime secrets are files, never CLI arguments. Windows `icacls` must successfully restrict the run directory and each transient credential/trust file to the service/driver user; no permissive fallback is available. All referenced paths must survive Native's original no-reparse-file checks. A C-backed UNC mount that cannot enforce ACLs is an unmet prerequisite, not authorization for another root/drive.

Create a private JSON config under Root's existing task root, replacing these placeholders with actual isolated service and source paths:

```json
{
  "isolatedFreshServices": true,
  "runtimeRoot": "<existing Root-owned Windows-accessible output root on the declared physical volume>",
  "appSource": "<actual integrated APP source checkout>",
  "nativeSource": "<actual integrated Native source checkout>",
  "core": {
    "origin": "https://<Core hostname>:<port>",
    "dashboardOrigin": "https://<configured dashboard Origin>",
    "certificateFile": "<actual Core TLS certificate PEM>",
    "certificateSha256": "<64 lowercase hex SHA256 of leaf DER>",
    "bootstrapTokenFile": "<actual isolated Core bootstrap capability file>"
  },
  "native": {
    "origin": "http://127.0.0.1:<original local Native service port>",
    "tokenFile": "<actual isolated Native service token file>"
  },
  "nativeRemote": {
    "bind": "127.0.0.1:<separate TLS port reachable by actual Node service>",
    "publicOrigin": "https://<Native hostname reachable by actual Node service>:<TLS port>",
    "certificateFile": "<actual Native listener certificate PEM>",
    "privateKeyFile": "<actual Native listener private key file>"
  }
}
```

For HTTPS local Native supervision, additionally provide `native.certificateFile` and `native.certificateSha256`. Node Core's private Native callback must reach `nativeRemote.publicOrigin`; a TLS handshake from the driver alone is insufficient.

```powershell
# Use Root's actual Windows Node 22 executable and one already-declared task root.
# Set process-scoped TEMP/TMP/TMPDIR there before execution; do not alter user settings.
& <Windows-Node-22> <owned-source-path>\live-acceptance.mjs <private-config-path>
```

Exit `1` means a source/configuration/runtime assertion failed. Exit `2` means this executable subset finished but the explicit full-acceptance gates remain open. It never returns full-phase acceptance/exit zero. `receipt.json` contains step outcomes, source-contract hash, original IDs/payload/receipt hashes, actor/project/connection IDs, exact removed paths/bytes and retained exceptions. It does not contain passwords, cookies, CSRF grants, pairing codes, Native tokens or unsealed custody.

`live-source-contract.json` pins 31 reviewed actual APP/Native source files using LF-normalized SHA256 (source convention only; runtime payload strings are never normalized). Source drift fails before mutation. Root must review a changed preimage and deliberately update this manifest; do not auto-refresh it or treat matching source as proof that a service binary loaded it. Root must separately record executable hashes, deployed source SHA, endpoints and fresh store ownership.

Pure helper verification (no server, account, secret file or runtime store created):

```text
node --check live-acceptance.mjs
node --test live-acceptance.test.mjs
```

Optionally set `CUSTOMIZE_ACCEPTANCE_APP_SOURCE` and `CUSTOMIZE_ACCEPTANCE_NATIVE_SOURCE` to verify every actual source preimage read-only in the helper suite. Worker receipt `live-source-verification.json` distinguishes these CPU source controls from live acceptance.

## Explicit missing constructors / remaining consumers

- **Two-store full restore:** Core has `/api/v1/backups/restore/preview`, authorize, confirm, execution/authorize and execute with its real maintenance supervisor. No mounted Native authority/journal replacement API was found in the actual Native route tree. This driver does not copy live SQLite/authority/DPAPI files or assert a restore result. Root needs the real stopped-store orchestration and revocation-suppression acceptance across both stores. Ordinary project archive/restore in this driver does not close that gate.
- **Native revoked-token purpose negatives:** live retirement invokes the real bounded revocation proof using the private original token. That token must remain in the original Node custodian. Domain/recovery denial for the revoked token belongs to the existing actual-source Native tests or an equally private real-owner harness; do not export the token to this client just to test it.
- **Synthesis execution:** the newly created synthetic project has no real ready runtime/broker/model owner. This runner reads status/pipeline only. Root's unchanged-model executor qualification and actual proposals/persistence/activation remain required; a mocked executor or a queued response cannot close them. Frozen 34351 paired effects deliberately do not provide synthesis execution.
- **Unsupported Plugins surfaces:** actual Plugins routes have enable/disable/delete but no archive/restore; project catalog is read-only and has no nonproject discovery/connect mutation owner. The driver reports those gaps; delete is not called archive and creation is not claimed as an external connector/discovery implementation.

Before starting any additional runtime stage Root must budget its full peak, measure C: and destination free space and retain the established minimum/ceiling. The worker creates no compiler/dependency/cache trees. The driver places transient credentials/trust and one small receipt in one restricted child directory under the declared root. It deletes the imported credential file after the actual import returns, and deletes trust after terminal retirement, reporting exact bytes. An unresolved original retains its exact trust file for Root's original recovery/retirement consumer. A failed ownership/hash/link safety check protects that exact target and is reported; do not retry via a different path or tool. Synthetic accounts, Native originals, real Core/vault stores and Root-owned certificates are not deleted by this client; Root's isolated fixture teardown after final acceptance is their remaining consumer/end condition.

The obsolete, already-consumed `native-owner-proposal.patch` is now a 703-byte immutable Git reference. Its exact 110,240-byte original remains at `9e505aa3d95a675ba7d55d231c5bccc455fdc833:docs/workstreams/customize/native-hosted-transport/native-owner-proposal.patch`, SHA256 `94098e000ee1e59defa99d6918679312693efc66c4177a1e29c5cfb3b426968b`. In-memory equality and no active exact-path process reference were checked before replacing the duplicated text. Reduction: **109,537 bytes**; no source path, tracked file, lockfile or unique evidence was deleted. Regenerate from that Git object only inside the same declared root when a concrete consumer needs it. Historical delivery generators/manifests are historical; do not rerun them over Root's changed sources.