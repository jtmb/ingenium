---
name: kubectl-diagnose
description: "kubectl diagnostic commands reference for cluster troubleshooting. Covers pod debugging, node inspection, PVC analysis, Flux status checking, and cert-manager certificate validation."
---

# kubectl Diagnose Skill

Diagnostic kubectl commands organized by resource type. Use these to investigate cluster health issues.

## Pod Diagnostics

### Check pod status and conditions
```bash
kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded
kubectl get pods -A -o wide | grep -v -E "Running|Succeeded|Completed"
```

### Describe a pod (events, container states, conditions)
```bash
kubectl describe pod <name> -n <namespace>
```

### Pod logs
```bash
# Recent logs
kubectl logs <pod> -n <namespace> --tail=100

# Previous container (if restarted)
kubectl logs <pod> -n <namespace> --previous --tail=100

# All containers
kubectl logs <pod> -n <namespace> --all-containers --tail=100
```

### Check for CrashLoopBackOff / OOMKilled
```bash
kubectl get pods -A -o json | jq '.items[] | select(.status.containerStatuses != null) | .status.containerStatuses[] | select(.state.waiting.reason == "CrashLoopBackOff" or .state.terminated.reason == "OOMKilled") | {namespace: .metadata.namespace, pod: .metadata.name, state: .state}'
```

### Check pod resource usage
```bash
kubectl top pod -A
kubectl top pod <name> -n <namespace> --containers
```

### Get events for a namespace
```bash
kubectl get events -n <namespace> --sort-by='.lastTimestamp' | tail -30
```

## Node Diagnostics

### Node status
```bash
kubectl get nodes -o wide
kubectl describe node <name>
```

### Node conditions (pressure, ready)
```bash
kubectl get nodes -o json | jq '.items[] | {name: .metadata.name, conditions: .status.conditions[] | select(.status == "True") | {type, reason, message}}'
```

### Node resource usage
```bash
kubectl top nodes
kubectl describe node <name> | grep -A5 "Allocated resources"
```

## PVC / Storage Diagnostics

### PVC status
```bash
kubectl get pvc -A
kubectl get pvc -A -o json | jq '.items[] | select(.status.phase == "Pending")'
```

### PVC details
```bash
kubectl describe pvc <name> -n <namespace>
```

### Storage classes
```bash
kubectl get storageclass
kubectl get pv
```

### Longhorn-specific
```bash
kubectl get volumes -n longhorn-system
kubectl get engines -n longhorn-system
kubectl get replicas -n longhorn-system
```

## Flux Diagnostics

### GitRepository status
```bash
flux get sources git -A
kubectl get gitrepositories -A
```

### Kustomization status
```bash
flux get kustomizations -A
flux get kustomizations -A --status-selector ready=false
```

### HelmRelease status
```bash
flux get helmreleases -A
kubectl get helmreleases -A
```

### Flux events and errors
```bash
flux events -A --tail=20
kubectl get events -n flux-system --sort-by='.lastTimestamp' | tail -30
```

### Reconciliation trace
```bash
flux trace <kustomization-name> -n <namespace> --kind kustomization
```

### Suspend / Resume
```bash
flux suspend kustomization <name> -n <namespace>
flux resume kustomization <name> -n <namespace>
```

## cert-manager Diagnostics

### Certificate status
```bash
kubectl get certificates -A
kubectl get certificates -A -o json | jq '.items[] | {name: .metadata.name, namespace: .metadata.namespace, ready: (.status.conditions[]? | select(.type == "Ready") | .status), notAfter: .status.notAfter}'
```

### Certificate details
```bash
kubectl describe certificate <name> -n <namespace>
```

### CertificateRequest and Order status
```bash
kubectl get certificaterequests -A
kubectl get orders -A
kubectl get challenges -A
```

### Check for expired or expiring certs
```bash
kubectl get certificates -A -o json | jq -r '.items[] | select(.status.notAfter != null) | [.metadata.namespace, .metadata.name, .status.notAfter, (.status.notAfter | fromdateiso8601 - now | ./86400 | floor)] | @tsv' | sort -t$'\t' -k4 -n
```

## Quick Health Summary

```bash
echo "=== Pods ===" && kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded 2>/dev/null || echo "All pods running"
echo "=== Nodes ===" && kubectl get nodes 2>/dev/null
echo "=== PVCs ===" && kubectl get pvc -A --field-selector=status.phase=Pending 2>/dev/null || echo "No pending PVCs"
echo "=== Flux Kustomizations ===" && flux get kustomizations -A --status-selector ready=false 2>/dev/null || echo "All kustomizations ready"
echo "=== Certs ===" && kubectl get certificates -A 2>/dev/null || echo "No certificates found"
```
