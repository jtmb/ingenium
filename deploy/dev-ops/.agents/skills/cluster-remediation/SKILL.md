---
name: cluster-remediation
description: "Safe remediation patterns for common K8s cluster issues. Defines auto-approve, needs-approval, and never-allowed safety tiers for automated cluster operations."
---

# Cluster Remediation Skill

Remediation patterns organized by safety tier. Use these tiers to decide whether to auto-execute a fix or request approval.

## Tier 1: Auto-Approve (Safe)

These actions are non-destructive — they restart or recreate resources that will be automatically restored by their controllers.

### Restart a deployment (rolling restart)
```bash
kubectl rollout restart deployment/<name> -n <namespace>
```
**When**: Pods in CrashLoopBackOff that may recover with a fresh start.

### Delete a stuck pod (force recreate)
```bash
kubectl delete pod <name> -n <namespace> --grace-period=30
```
**When**: Pod stuck in terminating state, or known to be safely replaceable.

### Force delete a stuck pod
```bash
kubectl delete pod <name> -n <namespace> --grace-period=0 --force
```
**When**: Pod stuck in Terminating for > 5 minutes.

### Reconcile Flux sources
```bash
flux reconcile source git <name> -n <namespace>
```
**When**: GitRepository out of sync or showing errors.

### Reconcile Flux kustomizations
```bash
flux reconcile kustomization <name> -n <namespace>
```
**When**: Kustomization with Ready=False or drift detected.

### Annotate resources
```bash
kubectl annotate <resource> <name> -n <namespace> key=value
```
**When**: Adding metadata to trigger reconciliation or document state.

---

## Tier 2: Needs Approval (Potentially Destructive)

These actions have side effects that could cause data loss, service disruption, or require context about the cluster's intended state. Always ask for human confirmation before executing.

### Delete a PVC
```bash
kubectl delete pvc <name> -n <namespace>
```
**Risk**: Data loss if the PV reclaim policy is Delete.

### Delete a namespace
```bash
kubectl delete namespace <name>
```
**Risk**: Deletes ALL resources in the namespace.

### Cordon a node
```bash
kubectl cordon <node>
```
**Risk**: No new pods will schedule on this node.

### Drain a node
```bash
kubectl drain <node> --ignore-daemonsets --delete-emptydir-data
```
**Risk**: All pods evicted. emptydir data lost.

### Delete a deployment
```bash
kubectl delete deployment <name> -n <namespace>
```
**Risk**: Removes all pods managed by the deployment.

### Suspend Flux kustomization
```bash
flux suspend kustomization <name> -n <namespace>
```
**Risk**: Stops Flux from reconciling — drift will accumulate.

### Uninstall a Helm release
```bash
helm uninstall <release> -n <namespace>
```
**Risk**: Removes all resources managed by the release.

---

## Tier 3: NEVER Allowed

These commands are permanently blocked. No amount of approval justifies running them from an automated agent.

| Command | Why Blocked |
|---------|-------------|
| `kubectl delete node <name>` | Removes node from cluster — requires rejoin |
| `kubectl delete clusterrolebinding` | Can lock out all users including the agent |
| `kubectl delete secret` (cluster secrets) | Can break authentication, TLS, Flux auth |
| `kubectl delete crd <name>` | Drops all custom resources of that type |
| Any command touching `/etc/kubernetes/` | Direct manipulation of control plane config |
| `rm`, `mv`, `dd`, `mkfs` | Filesystem-destructive |
| `iptables`, `nft` | Network manipulation outside K8s scope |

---

## Decision Flow

```
Issue detected
  │
  ├── Is it a pod crash/restart?
  │     └─→ Check logs first → rollout restart or delete pod (Tier 1)
  │
  ├── Is it a node pressure condition?
  │     └─→ Check node describe → cordon/drain (Tier 2)
  │
  ├── Is it a PVC stuck Pending?
  │     └─→ Check storage class → delete PVC (Tier 2)
  │
  ├── Is it a Flux reconciliation failure?
  │     └─→ flux trace → flux reconcile (Tier 1) or suspend (Tier 2)
  │
  └── Is it a certificate not Ready?
        └─→ describe certificate → check cert-manager logs (diagnostic only)
```
