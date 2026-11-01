# Kubernetes Work workspaces

The shared workspace picker can discover and add cluster workspaces assigned to
the signed-in account and organization. Organization project administrators use
**Add workspace**, choose an assignment, then add it. The picker reloads the
canonical catalog and selects the prepared workspace. Starting it remains a
separate action. Changing account or organization clears pending selection and
discards late responses from the previous scope.

Work keeps the shared picker in its loading state until organization discovery
finishes. Pending discovery must not show a missing-organization or empty-workspace
message, and registration remains unavailable until the current scope is loaded.

Discovery uses the private manager's configured account mappings and fresh,
authenticated namespace/PVC observations. The browser submits only a workspace ID.
It cannot choose storage paths, claims, nodes, credentials or backend identities.
The API revalidates the actual browser session and organization permission before
and after discovery and inside the original Core transaction. Existing legacy,
revoked, differently owned or differently mapped workspace IDs cannot be reused.
Preparation creates only the original projectless workspace and initial runtime
records. It grants no execution authority and creates no Pod or global project.

The manager's original lifecycle still owns preflight, original Pod creation,
bootstrap, current-container placement and confirmed retirement. Root-owned image
approval, finite PID policy, original actor/lease/credential checks and fresh
container identity remain mandatory. Workspace Pods receive no control-plane
token or Kubernetes API identity. The Kubernetes manager has no database, Docker
socket or state claim. The API remains the sole Core writer.

The chart's optional manager uses explicit native Secret/ConfigMap references and
owner-checked memory-backed mounts. It is disabled by default. Qualified image,
node PID policy and reviewed migration are prerequisites to activation through
the existing chart validator and Flux publisher. Existing legacy control-plane
startup settings and feature contracts remain prerequisites; no fallback manager
or gateway is invented. See the chart repository's `docs/INGENIUM.md` for the
operator deployment boundary.

The original full API compiler passed for 340 current source inputs and 169
compiler roots; its existing domain copier included 298 runtime files. The
original Next16.4.2 production build passed for all 315 current frontend inputs.
The assembled standalone passed the existing trace/asset/resolver checks and
retains its exact source inventory for image assembly. No new test suite or
dependency tree was added. These build results do not establish live Work
bootstrap, process isolation, image approval or retirement acceptance. Both
current cluster workers have an unlimited kubelet Pod PID setting; activation
requires a reviewed finite policy rather than a weakened application limit.

Chat, Home and Work continue to share their composer primitives and combined
model/effort picker. SiteChrome and Navigation own the common authenticated
sidebar; workspace selection and registration use RuntimeWorkspacePicker. Keep
repeated interface changes in those components and preserve route-owned state.
