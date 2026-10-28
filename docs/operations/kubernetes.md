# Ingenium on production Kubernetes

Ingenium deployment is an external operator task. There are no deployment or migration controls inside Ingenium.

The chart is `charts/ingenium` in the private `jtmb/branconet-charts` repository; delivery is `flux-system/ingenium`, targeting namespace `ingenium`. Use the existing Windows-Git/local exact-source validator/validated/Flux publisher. Keep Actions disabled and do not run a second publisher, direct Helm install, or manually advance validated refs.

## Current preparation and cutover gate

The initial release renders a zero-replica Deployment, ClusterIP Service, ServiceAccount, trusted public-info inventory and ingress NetworkPolicy. It creates no claim or public route. This is preparation, not a running application or completed migration. Current Longhorn inspection found only worker1 schedulable; master and worker2 are below the existing floor. Keep local Ingenium running until two-replica placement, capacity/headroom, PVC health and copied state are verified. Do not lower replica counts or thresholds, prune node images, delete migration artifacts or change unrelated BORTUS holds.

`persistence.create` requires measured source sizing and redundant-storage readiness. Nonzero replicas require all of measured sizing, imported native Secrets, coordinated consistent data, quiesced source and healthy redundant storage. The chart accepts at most one writer and uses Recreate and a retained ReadWriteOnce claim. The 128Gi preparation size is not a completed sizing result; the source workspace inventory and physical capacity must be reconciled before claim creation.

## Persistent state and credentials

Use one retained claim with subdirectories `ingenium-data`, `opencode-config`, `opencode-data`, `vscode-data`, `workspaces` and `host-opencode`. Preserve numeric owners, modes, ACLs, hardlinks, symlinks, hidden files and original path aliases. It mounts the workspace at both `/workspace` and `/home/brajam/repos`, preserving absolute Git/worktree registrations. Account for all required workspace content and external links; do not silently drop unrelated project source or unique artifacts to make a claim fit.

Transfer the coordinated core/OpenCode databases together with attachments, skills, vault ciphertext, authentication/backup signing keys, native OpenCode provider sign-ins/Goal state and workspace sources. An online paired database checkpoint alone is not the full installation. Prepare a full encrypted cold archive after source writers stop, verify its manifest and an independent restore, and preserve the original installation and rollback archive.

Provision native Secrets through the operator's existing Kubernetes access and stdin; no Secret resources or values belong in chart source, Helm values, command arguments or logs. `ingenium-bootstrap` has keys `api-token`, `learning-credential`, `opencode-server-password`, `email-encryption-key` and the existing `mail-release-ca`. `ingenium-model-config` contains the exact original `opencode.json`. Copy values without generating replacements. Authentication and backup signing keys remain on the state claim. Keep the vault passphrase in operator recovery storage, not the image or chart.

Secret file mounts use subPath so the bootstrap's no-symlink regular-file checks remain effective. Runtime secrets and shared memory use memory-backed emptyDir volumes. The container needs root bootstrap and the image's bounded CHOWN/FOWNER restore file capabilities, so allowPrivilegeEscalation remains true with a restricted capability bounding set; this is not a privileged Pod, host mount, Docker socket or Kubernetes API grant. The ServiceAccount token is not mounted.

## Access and loopback dependencies

The default full administrative surface is the existing local-origin profile over an operator-authenticated SSH forward to the cluster Service. Forward local 3000 to the Service's 3000 and local 1455 to its callback-only 1456, through a master loopback kubectl port-forward. This preserves localhost iframe origins and approved OAuth callbacks while moving the server/state off the computer. The SSH key and host verification are the outer remote-access boundary. Never publish OpenCode 4098, ttyd 4099, code-server 4100 or the API bearer boundary directly.

An optional dashboard-only LAN HTTPS ingress is `ingenium.branconet.lan`, class `traefik`, with a namespace-local Certificate issued by `branconet-local-ca`. It appears only after routing review. Certificate trust and DNS are separate verification gates; never bypass a browser warning. The fixed native OpenCode/CLI/VS Code compatibility aliases remain available only through the authenticated operator forward. Public app-information pages retain the dedicated info-only Cloudflare tunnel; preserve its encrypted token and fixed loopback target. No private audience is added to that tunnel.

## Delivery and acceptance

Publish the qualified Ingenium image from its actual `jtmb/ingenium` source using the existing Docker Hub `jtmb92/ingenium` grant, then pin the registry digest. The operator publisher lives in Ingenium's `ops/publish-image.py`; its credential helper stdout is consumed only by the Docker protocol, never displayed. A publication receipt is not an image scan or deployment receipt.

After storage/data/credential preparation, stop and verify all original writers, restore and read back the target, then publish the reviewed one-writer release through the existing pipeline. Observe the exact Flux revision and Pod image ID, readiness, logs, Secret/PVC identities and original data counts/hashes. Verify fresh chat, full synthesis approval/activation/persistence, real Gmail send/receive, vault decryption, docs/jobs/backups and completed Goal state outside `/chat`; then verify a Pod replacement. Keep the source stopped only after target acceptance. A rollback must fence target writers first and retain any target changes before resuming a data-compatible source; image rollback alone is insufficient.

### Publish an already qualified local build

Run `python3 ops/publish-image.py --image <local-image> --revision <full-commit-sha> --output-root <existing-owner-private-attempt-directory>`. Use `--probe` in a separate empty phase directory to check registry access without pushing. Both directories must remain under the task's one declared output root. The helper removes its ephemeral Docker client configuration in finally, retains a redacted publication receipt and never deploys. Do not display the Windows credential helper's stdout.

### Vendor image qualification

The initial published image scan is retained separately from the zero-advisory application lockfile audit. The production candidate updates code-server to upstream 4.143.1 and cloudflared to upstream 2026.10.4 using their official SHA-256 asset digests, upgrades runtime OpenSSL packages and pins standalone image npm to 12.2.1. OpenCode 2.0.11, application dependency versions, models/defaults and original data are unchanged. Packaged startup, VSIX engine/integrity, image scan, actual VS Code UI and tunnel lifecycle checks must pass against this new digest before image qualification is claimed.

The 2026-10-27 scan of candidate source `e138651a3de7087733a980ceecacc75fa5525c48` reports 5 Critical, 135 High, 270 Medium, 285 Low and 14 Unknown package findings. This is an improvement over 6 Critical / 175 High in the initial image, not a security acceptance. One Critical shell-quote finding has an available vendor dependency fix; four Critical Debian findings have no fixed version listed. Nine High findings have listed fixes, including some major dependency upgrades that require compatibility qualification. Keep the rollout held for these findings as well as the storage gate. The application lockfile audit remains a separate result.

Compatible vendor dependency overlays are defined in `config/vendor-security.json`. A build-only stage checks exact npm-registry SHA-512 archives without running package scripts; installation rejects vendor version/path drift and major API changes, then verifies dependency ranges. Shell quoting, compressed requests, excessive response encodings, cross-origin sensitive headers and Zod 4 compatibility have isolated regression coverage in `tests/test-vendor-security.mjs`. The sandbox Zod 3 and basic-ftp major-version findings remain held for separate compatibility work; do not claim zero image advisories.

### Compatible vendor patch qualification (2026-10-27)

Source `48c5222b4ac4998b1c26201c7f2cb7ed54251b66` built image `sha256:202ed057da6897c07b60f4c6d8bc4d66045fb57f2235da48f526ee15732037a1`. All workspace builds, three packaged boundary checks, nine exact-image security/compatibility regressions and five extraction tests passed. Negative controls reproduce the original shell quoting, redirect-header and HTTP stream failures; the gzip control reports an uncaught Z_DATA_ERROR in the old image. Archive guards also pass with Python optimization enabled.

The same-day full scan is now 4 Critical / 128 High / 267 Medium / 285 Low / 14 Unknown, with **no Critical row that has a listed fixed version**. The remaining two fixable High rows are basic-ftp 5 to 6 and sandbox Zod 3 to 4; their major API transitions remain unqualified, not suppressed. Four Medium and one Low rows also have listed fixes. The raw scans and distinct earlier results remain retained.

The four raw Critical OS rows require vendor context: Debian calls [GLib CVE-2026-58016](https://security-tracker.debian.org/tracker/CVE-2026-58016), [SQLite CVE-2025-7458](https://security-tracker.debian.org/tracker/CVE-2025-7458) and [libxml2 CVE-2026-6653](https://security-tracker.debian.org/tracker/CVE-2026-6653) minor issues for Bookworm, with fixes postponed or no DSA. Debian [CVE-2023-45853](https://security-tracker.debian.org/tracker/CVE-2023-45853) records the zlib source issue as ignored because contrib/minizip is not built. Keep these scanner findings and their vendor assessment visible; do not claim a vulnerability-free image. This compatible patch resolves the earlier fixable Critical and seven High rows. Production still requires actual redundant capacity, full consistent restoration and single-writer acceptance.

The complete workspace inventory is 79,895,206,614 apparent bytes across 114 entries, including node_modules; no entry failed measurement. Recheck at cutover because source remains live. Two namespace-owned native Secrets now contain the original bootstrap/model bytes, verified on read-back without rotation; target state and writers remain absent until storage is ready.

### Expired browser sessions

The page proxy no longer treats a cookie's presence as proof of a live session when visiting login or bootstrap. A revoked/expired cookie previously redirected login back to a protected page; the API then sent the browser back to login, eventually producing gateway 429 responses. Public authentication pages now remain reachable, while API session validation, CSRF, login throttles and return-target validation remain authoritative. The focused dashboard proxy/authentication suite passes 52 tests, including stale-cookie recovery; verify real HTTP 200 on login and 401 on protected API requests with an invalid cookie after adoption.

## Production LAN feature audit

A connected native ChatGPT account must appear in the Chat catalog and the synthesis
provider selector. Native selections use the existing OpenCode credential, not a
custom endpoint or copied API key. The requested saved model is openai/gpt-6-luna;
the operator must verify a new response and a complete proposal/approval/activation
cycle before recording acceptance.

The browser shell handles STEP_UP_REQUIRED through one confirmation dialog shared
by concurrent requests. It retries once only after confirmation with the rotated
CSRF grant; cancellation, aborted streams and unrelated authorization failures do
not replay protected actions.

The compatibility deployment can opt into separate HTTPS editor origins with
NEXT_PUBLIC_RUNTIME_ROOT_DOMAIN at build time and
INGENIUM_COMPATIBILITY_RUNTIME_ROOT_DOMAIN at runtime. The dashboard issues a
60-second, single-use proof bound to an administrator session and one exact
audience. The child origin exchanges that proof for a host-only HttpOnly cookie;
its 30-minute grant never authenticates dashboard APIs. Every HTTP request and
WebSocket upgrade validates the parent session, security epoch, administrator role
and audience. Revocation and process restart invalidate grants. Nginx strips all
cookies before forwarding to the editors, validates browser origins and preserves
the upstream VS Code workbench CSP. These are opt-in operator routes, independent
of the public information tunnel; never expose the raw editor or API ports.

Production acceptance requires the full sidebar feature matrix, ordinary login,
fresh Chat inference, saved model persistence, full synthesis lifecycle, real Gmail
send/receive, editor file and terminal checks, and independent backup verification.
An HTTP200, a page load or an All healthy banner alone does not establish these
requirements. Record partial and failed checks honestly.

The retired Windows/WSL source container is removed without --force or --volumes.
Its named volumes, bind-mounted data and exact rollback image remain preserved;
unique writable settings were authenticated-encrypted and independently read back
before removal. No original workstation files or installation keys are deleted.
