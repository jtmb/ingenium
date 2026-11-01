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
- `workspace-pod.ts` constructs a workspace Pod from an explicit PVC binding,
  immutable image and qualified node PID policy. It uses a private container,
  UID/GID1000, dropped capabilities, a read-only root, no service-account token
  and bounded CPU/memory. It creates no readiness or execution authority.
- `workspace-wire.ts` retains a new Kubernetes v5 WebSocket, matches the
  bootstrap nonce and original Pod/container birth, and invalidates active
  custody when that connection fails or closes. Reconnecting cannot replace it.
- Docker and Kubernetes reuse `workspaceRuntimeEnvironmentV2`; capabilities
  travel through stdin rather than Pod metadata or environment variables.

The original API compiler passes336 source inputs/165 compiler roots without
copying dependencies or rebuilding Core441. The WebSocket runtime and types are
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

This qualifies transport creation, stdin/stdout and cleanup. It does **not**
qualify the agent bootstrap, a Work turn, image approval, tenant execution or
full runtime retirement.

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

1. Add the Kubernetes original-provision, placement and retirement branch to
   the same authenticated Core/API lifecycle. Bind actual namespace, node, Pod,
   CRI container, start time, immutable image and PVC identities.
2. Coordinator reserves migration141 for this backend evolution. The existing
   original-provision table has an explicit Docker host-prefix constraint and
   migrations137/138 retain exact source/DDL receipts. Preserve those recipes
   unchanged. A new verified evolution must validate their predecessor hashes,
   preserve existing rows/storage classes and provide its own invertible schema
   receipt. Never put a Kubernetes identity into a Docker proof to avoid this.
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
