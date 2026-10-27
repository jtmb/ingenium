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
