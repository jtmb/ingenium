# Linux Docker MVP quickstart

The exercised candidate is docker.io/jtmb92/ingenium@sha256:1925d5695fba242f4990748473f72d847276c10ae721be13173e974dc404ec50, built from source 5bb3755c37f741d855d082618ab58b375d063e0e. It runs on the existing cluster through chart 0.1.22 / promotion 1c6f142493685676f9d8fee339400e0fe8d22ee5. Visual and complete feature acceptance remain open.

## Existing cluster

Use the established authenticated SSH/Service forward for the complete dashboard and fixed-origin OpenCode/CLI/VS Code surfaces. LAN HTTPS is dashboard-only. Never expose private upstream ports or add private routes to the information-only tunnel. The exact access, native Secrets, retained claim, validator/publisher and rollback rules are in the [Kubernetes runbook](kubernetes.md).

Read-only observations with the existing operator kubeconfig:

```sh
kubectl -n ingenium get deployment,pods,pvc
kubectl -n flux-system get helmrelease ingenium
```

Check the actual running imageID, Ready/restart state, Flux chart revision and retained storage identities; a tag or health badge alone is insufficient. The qualification recorded a Ready Pod with zero restarts and the same 11 GiB claim/volume with two healthy Longhorn replicas. No second publisher, direct Helm install or manual validated-ref advancement is part of this quickstart.

## Workspace tour

Home starts Chat; Chat keeps quiet collapsed navigation and its own history/cancel controls. Work opens unchanged upstream OpenCode Web/CLI. Expanded navigation exposes the existing Mail, Tasks, Docs, intelligence, operations and configuration pages. Settings contains 20 categories; many link to the feature workspace. VS Code currently retains Restricted Mode.

Live Luna Home-to-Chat recovery, cancellation, history/reload and existing Docs/Mail persistence passed. Read [the evidence report](veyra-mvp.md) and [47-view review](veyra-mvp-review.md) for unfinished behavior. Linux excludes the custom Windows inference engine/model manager and weights.

## Restart recovery

Reuse the saved authorized development .env for normal CSRF/login/session verification. An image replacement seals the existing Vault; use its existing separate recovery credential through normal step-up/unseal. Do not try the dashboard password as a substitute, initialize a new Vault, rotate keys or request another user sign-in for the established account. The operator-private reusable helper verifies scope and can resume only the already enabled information-only connector with its stored token. It preserves disabled private routes and configuration and logs out only its own verification session.

After recovery, verify public information/privacy/terms are reachable, private routes remain denied, Mail's engine sync-status has completed folders, and Chat/synthesis settings and account/project identities persist. A cached message body is not proof of fresh provider sync. Usage requires an explicit authorized project mapping; do not guess attribution.

## Reproduction and rollback

Build only from the reviewed source/lockfiles using the declared task-owned output root and headroom/peak checks. Do not invoke an unscoped default Docker/npm/Cargo cache or copy generated dependencies into a source snapshot. The image contains the pinned complete brain package and portable consumer; protected deployment and runtime skill loading were verified.

The registry digest and minimal lossless regeneration recipe replace consumed local image archives after exact regeneration proof. Roll back through the reviewed chart/operator flow to the preserved prior image/configuration while retaining the existing state claim, native Secrets, signing/encryption keys, user skills and Goal state. Never rebuild an empty installation over existing data. See [brain rollback](veyra-brain.md).
