# Conventions

## Naming

| What | Convention | Example |
|------|-----------|---------|
| Cluster operations directories | kebab-case, `{cluster-name}` | `production/`, `staging-cluster/` |
| Remediation evidence files | `{tool}-{resource}-{timestamp}.{ext}` | `kubectl-describe-pod-webapp-20260705.txt` |
| Operator scripts | snake_case, descriptive | `restart_crashloop_pod.sh` |
| Skill files | kebab-case, one topic per skill | `cluster-operator/`, `cluster-remediation/` |
| Agent definition files | `ingenium-{role}.md` | `ingenium-infrastructure-engineer.md` |
| Agent mentions | `@ingenium-{role}` | `@ingenium-infrastructure-engineer` |
| Documentation files | SCREAMING_CAPS.md | `ARCHITECTURE.md`, `CONVENTIONS.md` |

## File Organization

```
dev-ops/
├── .agents/
│   ├── skills/             # 47 skill directories (43 universal + 4 cluster ops)
│   ├── hooks/              # 3 lifecycle hooks (JSON)
│   └── scripts/            # Bootstrap scripts
├── .opencode/
│   ├── agents/             # 8 agent definitions (markdown)
│   └── plugins/            # 3 TypeScript lifecycle plugins
├── docs/
│   └── remediations/       # Remediation evidence and reports (created per cluster)
│       └── {cluster}/
│           ├── pod-health.md
│           ├── node-health.md
│           ├── storage.md
│           ├── flux.md
│           ├── certificates.md
│           └── report.md
└── evidence/               # Raw command output and collected artifacts
    └── {cluster}/
        ├── pods/
        ├── nodes/
        ├── pvcs/
        ├── flux/
        └── certificates/
```

## Safety Tiers

Every cluster operation must be classified into one of three safety tiers. This classification is defined in `cluster-remediation/SKILL.md` and enforced by agent instructions.

| Tier | Label | Color | Action | Validation |
|------|-------|-------|--------|------------|
| 1 | Auto-Approve | 🔵 Blue | Execute without human approval | Verify cluster state after execution |
| 2 | Needs Approval | 🟡 Yellow | Present risk and expected outcome; wait for explicit approval | Execute only after approval |
| 3 | NEVER Allowed | 🔴 Red | Reject with explanation | Log the attempt and escalation path |

### Tier 1 — Auto-Approve Actions

These actions are safe because they restart or recreate resources managed by controllers:

- `kubectl describe <resource>` — diagnostic only
- `kubectl logs <pod> -n <ns>` — diagnostic only
- `kubectl get events -n <ns> --sort-by='.lastTimestamp'` — diagnostic only
- `kubectl rollout restart deployment/<name> -n <ns>` — rolling restart, safe
- `kubectl delete pod <name> -n <ns> --grace-period=30` — pod will be recreated by controller
- `kubectl delete pod <name> -n <ns> --grace-period=0 --force` — for pods stuck Terminating > 5 min
- `flux reconcile source git <name> -n <ns>` — trigger Git sync
- `flux reconcile kustomization <name> -n <ns>` — trigger reconciliation
- `flux reconcile helmrelease <name> -n <ns>` — trigger Helm release reconciliation
- `kubectl annotate <resource> <name> -n <ns> key=value` — metadata only

### Tier 2 — Needs Approval Actions

These actions have side effects that require human judgment:

- `kubectl delete pvc <name> -n <ns>` — potential data loss
- `kubectl delete namespace <name>` — deletes all resources in namespace
- `kubectl cordon <node>` — prevents new pod scheduling
- `kubectl drain <node> --ignore-daemonsets --delete-emptydir-data` — evicts all pods
- `kubectl delete deployment/<name> -n <ns>` — removes all managed pods
- `kubectl scale deployment/<name> -n <ns> --replicas=0` — scales down to zero
- `kubectl taint nodes <node> key=value:Effect` — modifies scheduling constraints
- `flux suspend kustomization <name> -n <ns>` — drift will accumulate
- `flux resume kustomization <name> -n <ns>` — may cause unexpected changes
- `helm uninstall <release> -n <ns>` — removes all release-managed resources

### Tier 3 — NEVER Allowed Actions

These actions are permanently blocked at the agent instruction level:

| Command | Why Blocked |
|---------|-------------|
| `kubectl delete node <name>` | Removes node from cluster — requires manual rejoin procedure |
| `kubectl delete clusterrolebinding <name>` | Can lock out all users including the agent |
| `kubectl delete secret <name>` (cluster/infra secrets) | Can break authentication, TLS, Flux connectivity |
| `kubectl delete crd <name>` | Drops all custom resources of that type from the cluster |
| Any command touching `/etc/kubernetes/` | Direct manipulation of control plane configuration |
| `rm`, `mv`, `dd`, `mkfs` on cluster hosts | Filesystem-destructive operations |
| `iptables`, `nft` on cluster hosts | Network manipulation outside K8s scope |
| `kubectl delete --all` in any namespace | Mass deletion without resource-by-resource confirmation |
| `kubectl proxy --accept-hosts=.*` | Exposes the API server to potential SSRF attacks |

## Cluster Discovery Patterns

### Always Discover, Never Assume

Before any operation, the orchestrator must discover cluster state at runtime:

```bash
# Required discovery commands before any remediation
kubectl get nodes -o wide           # Topology and node roles
kubectl get namespaces              # Active namespaces
kubectl get storageclasses          # Storage backend
kubectl get ingressclasses          # Ingress controller
flux get sources git -A             # GitOps repositories
kubectl get pods -n kube-system |   # CNI plugin
  grep -E 'calico|flannel|cilium|weave|kube-router'
kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded  # Non-running pods
kubectl get events -A --sort-by='.lastTimestamp' | tail -30  # Recent cluster events
```

### Context Validation

- Verify namespace exists before running commands in it
- Verify resource name exists before describing or modifying it
- Use `--dry-run=client` for destructive commands when possible
- Check PodDisruptionBudgets before draining nodes with stateful workloads
- Check finalizers before deleting resources (may block deletion)
- Verify storage class provisioner is running before diagnosing PVC issues

## Output Capture Rules

Every command's output must be captured and included in the remediation report:

| Command Type | Output Format | Processing |
|-------------|---------------|------------|
| `kubectl get ...` | `-o wide` for human, `-o json` for parsing | Use `jq` to filter relevant fields |
| `kubectl describe ...` | Full text output | Cite relevant sections (events, conditions, status) |
| `kubectl logs ...` | `--tail=50` minimum | Look for error patterns, OOMKilled, crash traces |
| `kubectl events ...` | `--sort-by='.lastTimestamp'` | Focus on recent events (last 30) |
| `flux get ...` | Default format | Filter with `--status-selector ready=false` |
| `flux trace ...` | Full trace output | Follow the dependency chain |
| `helm list ...` | Default format | Check release status and revision |

## Error Handling

| Error Pattern | Response |
|--------------|----------|
| `NotFound` | Resource doesn't exist — verify name and namespace, then report |
| `Forbidden` | RBAC restriction — report to human operator; check ClusterRole/RoleBindings |
| `CrashLoopBackOff` | Check logs (`--previous`), describe events, consider restart or image fix |
| `ImagePullBackOff` | Check image tag, registry credentials, network connectivity, pull secrets |
| `OOMKilled` | Check resource limits, describe pod for memory pressure, consider limit increase |
| `Pending` (pod) | Check node resources, PVC binding, taints/tolerations, node selector |
| `NotReady` (node) | Check node conditions, kubelet logs, system resources (disk/memory/PID) |
| `Ready=False` (Flux Kustomization) | Run `flux trace` to follow the reconciliation chain; check source readiness |
| `Ready=False` (Flux HelmRelease) | Check Helm release status with `helm history` |
| `Pending` (PVC) | Check StorageClass exists, provisioner pod is running, volume binding mode |
| `Expired` or `NotReady` (Certificate) | Check cert-manager pod logs, Issuer/ClusterIssuer status, DNS propagation |

## Stage-Gating — Diagnose → Plan → Remediate → Verify

**Do not skip phases.** Each phase depends on the output of the previous phase:

| Phase | Prerequisites | Gate check |
|-------|---------------|------------|
| 1. Diagnosis | Health report (pod/node/PVC/Flux/cert issue) | — |
| 2. Planning | Completed diagnosis (root cause hypothesis, diagnostic output) | Root cause identified |
| 3. Remediation | Completed plan (safety tier classification, ordered steps) | Plan reviewed for safety |
| 4. Verification | Completed remediation | Cluster state restored to healthy |

To skip a phase (e.g., going straight to remediation from a known CVE), you MUST:
1. Document why the phase is being skipped
2. Have direct evidence that justifies the skip
3. Get user confirmation

## Git Practices

- **Branch naming**: `remediation/{cluster}-{issue}` (e.g., `remediation/production-pod-crashloop`)
- **Commit messages**: Conventional Commits: `{type}({scope}): {remediation summary}`
- **Evidence commits**: Every remediation gets its own commit with clear message
- **No secrets in commits**: Never commit kubeconfig files, cluster tokens, or service account credentials
- **Tag significant remediations**: `git tag remediation-{cluster}-{issue-date}` for important fixes

## Script Style (Operator Scripts)

- **Language**: Bash (preferred for direct kubectl/flux/helm integration) with `set -euo pipefail`
- **Error handling**: Check exit codes, use meaningful error messages, never silent failures
- **Configuration**: Cluster context as argument or environment variable — never hardcoded
- **Output**: Machine-parseable output (JSON) with human-readable summary
- **Safety**: Always include a `--dry-run` or `--check` mode for destructive operations
- **Cleanup**: Restore context, release resources on exit
- **Rate limiting**: Include `--sleep` or throttling for operations that could overload the API server

## Logging

- **Phase-level logging**: Timestamp, phase name, cluster, resource type, command used, exit code
- **Action-level logging**: Timestamp, resource, action, safety tier, approval status, output summary
- **Error logging**: Command errors, unexpected responses, safety boundary violations
- **Format**: Plain-text log files in the cluster evidence directory
- **No sensitive data**: Never log kubeconfig paths, tokens, or service account credentials