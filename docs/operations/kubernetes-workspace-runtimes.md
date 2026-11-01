# Kubernetes workspace runtimes

Veyra's Work execution path currently expects an original Docker manager. The
existing cluster runs containerd; its Pod IDs are not Docker IDs. The Kubernetes
adapter is being implemented as a separate physical backend, retaining the
workspace, account, organization, credential, image and lifecycle requirements.

## Implemented source

- `services/ingenium-api/lib/kubernetes/api-client.ts` provides verified TLS,
  bounded JSON requests, rotating in-cluster credentials, namespace identity,
  Pod/PVC/node reads, one-attempt creation, and UID/resourceVersion-conditioned
  deletion. It follows no redirects and writes no credentials.
  Retirement finalization uses JSON-patch tests for the original UID, resource
  version, deletion timestamp and finalizer list, removing only Veyra's key.
- `workspace-pod.ts` constructs a workspace Pod from an explicit PVC binding,
  immutable image and qualified node PID policy. It uses a private container,
  UID/GID1000, dropped capabilities, a read-only root, no service-account token
  and bounded CPU/memory. It creates no readiness or execution authority.
- `workspace-wire.ts` retains a new Kubernetes v5 WebSocket, matches the
  bootstrap nonce and original Pod/container birth, and invalidates active
  custody when that connection fails or closes. Reconnecting cannot replace it.
- Docker and Kubernetes reuse `workspaceRuntimeEnvironmentV2`; capabilities
  travel through stdin rather than Pod metadata or environment variables.
- `workspace-lifecycle.ts` owns actual creation, running-container observation,
  retained bootstrap attachment, fresh profile reads and graceful retirement.
  It accepts only the requested profile and closed Kubernetes default forms,
  comparing resource quantities without changing the recorded raw profile.
  STARTING metadata is distinct from image approval and READY.
- Core migration141 adds an explicit backend identity to the existing original
  provision table. Docker payloads and the137/138 recipe bytes remain unchanged.
  The new evolution verifies the predecessor receipts and its exact reversible
  DDL change. Kubernetes metadata binds namespace/CA, Pod UID, original CRI ID,
  node UID/boot ID, start, immutable image, PVC and finite PID policy.
- `workspace-manager.ts` and `scripts/kubernetes-runtime-manager.ts` compose a
  separate Kubernetes manager without initializing the Docker/JobRun owners.
  The existing private manager token and actual Core admission endpoints remain
  authoritative. Original admission is rechecked around creation and bootstrap;
  fresh placement verifies every approved runtime artifact over actual exec.
  Namespace-wide claim-user checks include unlabelled Pods and require retained
  Core retirement receipts for predecessor executions.
- A read-only physical preflight runs before credential issuance or the Core
  ABSENT-to-PROVISIONING transition. Missing PID policy, conflicting claim use
  or an unavailable manager preserves the existing not-dispatched outcome.
  Confirmed POST201 children get bounded cleanup after a failed provision. Lost
  create outcomes are retained rather than adopted through names/labels.
- Both the API's OpenCode target and the browser gateway use the fresh original
  Pod address. The private proof binds it to namespace UID, Pod UID and original
  container ID. Workspace terminals use the same original derived Basic
  credential as OpenCode, and a separate bounded writable terminal home.
  The gateway injects that credential for both audiences. Legacy Project
  terminal/header behavior is unchanged.

The original Core compiler passes101 inputs and copies only the three new141
resources alongside150 unchanged resources. The API compiler passes340 source
inputs/169 compiler roots, with298 runtime copier files and no dependency copies.
The WebSocket runtime and types are
the already installed, locked versions8.21.3 and8.18.1. Only their two direct
API dependency references were added to the lockfile. Unrelated npm peer,
platform/libc and legacy-name changes were rejected and preserved in a minimal
resolver delta.

## Actual cluster observation —2026-11-01

The compiled client reached the existing verified API at192.168.0.4:6443 and
read namespace UIDeb610dd1-562b-4085-911b-04083fa4974f. One inert, model-free
Pod on workernode1 used the already cached immutable preview image with
`imagePullPolicy: Never`. Input and matching output crossed an actual
`v5.channel.k8s.io` connection. The same container exited0 and the same Pod was
deleted with UID/resourceVersion preconditions. No Core/agent credential,
workspace/PVC, model, GPU or production writer was involved.

A second actual inert Pod remained running after the stdin/stdout exchange.
Graceful deletion retained its API object under Veyra's finalizer while the
original CRI container exited0. Its exact terminal container ID/start time and
the original healthy node were observed, and its original attached connection
closed. Only then did the compiled client remove its own finalizer using
conditional JSON patch. The Pod was confirmed absent; no smoke Pod remains.
Kubernetes documents [terminal Pod transitions](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
and [finalizer retention](https://kubernetes.io/docs/concepts/overview/working-with-objects/finalizers/).

Migration141 also installed and reopened against an in-memory SQLite snapshot
of the existing canonical synthetic fixture. All75 evolution objects verified,
foreign keys/integrity passed, and the private insert guard worked inside the
original transaction. This fixture contains zero original provision rows;
populated historical-original and real Core/bootstrap acceptance remain open.
The4,071,424-byte temporary snapshot was removed after Windows exclusive-handle
and Linux ownership/source/process/container/mount checks. Source and minimal
failure/success evidence remain; no Windows recovery is inferred.

These checks qualify transport and the graceful retirement transport, not the
agent bootstrap, a Work turn, image approval, tenant execution or complete Core
retirement. A further actual model-free Pod measured all11 canonical runtime
artifacts through the compiled fixed-command exec path. Hashes, sizes and file
metadata matched an independent operator read of the same immutable image.
The original container/Pod were bracketed around measurement; graceful shutdown,
closed attachment and complete removal were observed. This validates the actual
artifact transport, not approval of that older image for the new Work role.

Both worker nodes currently report kubelet `podPidsLimit: -1`. Veyra's ordinary
Docker defaults are256 PIDs and128 processes. The Pod planner rejects a missing
or unlimited qualified PID policy. It preserves those defaults instead of
pretending a Kubernetes Pod field enforces them. Kubernetes configures Pod PID
limits through the kubelet, not the individual Pod API.
See [Kubernetes PID limits](https://kubernetes.io/docs/concepts/policy/pid-limiting/).

All three nodes currently run kernel5.15.0-202 and containerd2.4.2. Pod user
namespaces require filesystem idmap support and at least kernel6.3 for tmpfs;
they are not an available shortcut on these hosts.
See [Kubernetes user namespaces](https://kubernetes.io/docs/concepts/workloads/pods/user-namespaces/).
No host configuration, kernel, kubelet or runtime class was changed.

## Remaining integration

1. Package and deploy the compiled manager composition with its actual
   ServiceAccount, namespace-scoped Pod/PVC permissions, selected node identity
   reads and protected flat configuration. Keep the existing chart publisher.
   Do not mount a Docker socket, state claim or agent capability into it.
2. Qualify141 in actual Core startup/reopen and populated historical-original
   migration. Keep137/138 recipes and their predecessor DDL receipts unchanged.
3. Complete actual workspace image/bootstrap qualification and independent
   approval before installing a writable runtime policy.
4. Prepare a reviewed, explicit finite PID configuration for the selected
   worker(s) and matching Kubernetes runtime limits. Changes affect other Pods,
   so inspect existing workloads and obtain the required host-change approval
   before applying them. Preserve current Docker defaults.
5. Wire the manager, scoped workspace registration, gateway, Work/Web, Git,
   terminals and projectless chats. Exercise real agent work and persistence.
6. Qualify cancellation, unknown outcomes, manager restart and physical
   retirement before allowing successor execution.

The new backend is source work in progress. Work is still unavailable in the
compatibility preview; no production deployment or full release completion is
claimed.

## Operator configuration being prepared

The existing protected `/run/ingenium-core126/approval.json` registry and its
content-addressed manifest files also support an explicit
`kubernetes-workspace-runtime-v1` role. The original Docker Project/JobRun
validator is unchanged and cannot consume this role. Actual immutable image,
bootstrap/MCP, denial/isolation and runtime qualification remain prerequisites
to coordinator installation of an approval. No writable policy was installed.

`INGENIUM_WORKSPACE_RUNTIME_IMAGE` selects the Work role image; absence preserves
the existing `INGENIUM_USER_RUNTIME_IMAGE` setting. Likewise,
`INGENIUM_WORKSPACE_RUNTIME_MANAGER_URL` selects its private service; absence
preserves the existing manager URL. Neither setting changes JobRun's manager
or image. Empty/invalid explicit values refuse instead of falling back.

The manager reads only `/run/ingenium-kubernetes-runtime/config.json`. It must be
a bounded root-owned flat regular file under a non-writable root-owned directory,
with exactly `schemaVersion`, `namespace`, `workspaceMappings` and
`nodePidPolicies`. The workspace/PVC/user/organization identities, actual node
UID/boot/version, finite PID enforcement and expiry are validated before use.
Changing the live file invalidates the manager rather than silently adopting a
new configuration. Mount only the manager's projected Kubernetes credentials;
workspace Pods retain `automountServiceAccountToken: false`.

Scoped workspace registration now uses the shared RuntimeWorkspacePicker. Its
discovery API exposes only the current account/organization's explicitly
assigned PVC mappings; preparation creates the authorized workspace/runtime
records without starting a Pod. The optional chart foundation is prepared and
disabled by default. No PVC assignment or runtime approval is fabricated.

## Retirement after a manager restart

The manager can stop a persisted original after losing its in-memory attachment.
This is a negative recovery operation: the authenticated private Core owner must
return the already recorded original while the runtime is STOPPING. Namespace,
CA, original node UID/boot, Pod UID, complete Pod profile, CRI container, image
and start time are checked against fresh API observations. A terminal phase or
404 alone cannot produce a stopped receipt. The manager never reconnects the
old bootstrap or returns a new placement grant from stored metadata.

The Pod remains under Veyra's retirement finalizer while Core commits the
physical stopped receipt. Only then does the API call the manager's private
`finish-retirement` operation. That operation reads the immutable Core receipt,
checks the same terminal container/finish time, conditionally removes only
Veyra's finalizer and observes absence. A lost response or manager restart can
retry cleanup from the stored receipt. It cannot erase the only physical
witness before Core records it. Other controllers' finalizers are preserved.

Core's `recordedAt` metadata is omitted from the closed physical-original wire
DTO. The original identity/hash fields are validated and preserved; otherwise
the persistence timestamp would invalidate placement and predecessor checks.
The original API compiler/copier passes all340 source inputs/169 compiler roots
and298 runtime files for this change. No Core migration, dependency copy or new
test was added. Actual composed-manager restart/retirement acceptance remains
open; the previous transport smoke is not represented as proof of this change.

Still open: actual composed manager startup, unknown create/start outcomes
without a committed original, Core failure/successor reconciliation, assigned
PVC/configuration installation, finite PID qualification, exact image/bootstrap
approval and the full Work/Web/terminal/Git workflow. Source compilation does
not close those gates.

## Dedicated Work runtime class

The planner also supports an explicitly qualified node PID policy2 with
`runtimeClassName`, its actual `runtimeClassUid`, `runtimeHandler` and the
node-local `baseRuntimeSpecSha256`. All original node/boot/version, finite
limit, configuration digest and expiry fields remain required. It reads the
named RuntimeClass through verified Kubernetes transport and refuses changed
UID/handler, deletion, overhead or scheduling mutation. Policy1 retains the
existing qualified kubelet path. Neither policy accepts an unlimited limit.

Policy2 adds the class to the Pod profile and requires the bootstrap to read
the actual finite `/sys/fs/cgroup/pids.max` before consuming its capability
frame. A missing, unlimited, changed or inaccessible leaf limit aborts before
bootstrap authority is used. This selects a dedicated containerd handler for
Work instead of changing the default handler or every Pod's kubelet setting.
See [Kubernetes RuntimeClass](https://kubernetes.io/docs/concepts/containers/runtime-class/)
and the versioned [containerd2.4.2 configuration](https://github.com/containerd/containerd/blob/v2.4.2/docs/cri/config.md).

The explicit RuntimeClass manifest is in
`ops/kubernetes/veyra-workspace-runtime-class.yaml`; the proposed handler
fragment is `config/kubernetes/containerd-workspace-runtime.toml`. These are
reviewable deployment inputs, not an installed or qualified handler. The
existing worker2 runtime is `/opt/containerd-k8s/bin/containerd`, unit
`containerd-k8s.service`, configuration `/etc/containerd-k8s/config.toml`.
Generate the base OCI spec with that runtime's `ctr oci spec` and set its Linux
resource PID limit to128, preserving all other generated defaults. Confirm
the effective configuration retains every original handler/default, record
both file digests, review the daemon restart and qualify actual kernel
enforcement, original bootstrap and retirement before approval/activation.
Do not touch the retired Docker/Swarm runtime or substitute another daemon.

No host configuration, runtime class, daemon, kubelet or live approval has
been changed. The current operator SSH identity cannot perform noninteractive
sudo on worker2; applying the reviewed host configuration still requires
that actual host authorization. A failed authorization must not be bypassed
with a privileged Pod, a different identity or a weaker process limit.
