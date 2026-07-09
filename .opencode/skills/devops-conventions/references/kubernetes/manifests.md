---
title: "Kubernetes Manifests — Security, Resources, Probes, Networking, Deployments"
impact: HIGH
impactDescription: "Ensures production-ready K8s manifests with proper security, resource limits, and resilience"
tags: [kubernetes, k8s, security, probes, deployment, networking]
---

## Kubernetes Manifests

### Security Context — Mandatory

Every pod and container must have a security context.

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
  fsGroup: 1000
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop:
      - ALL
```

- **`runAsNonRoot: true`**: Container must not run as root
- **`allowPrivilegeEscalation: false`**: No child process can gain more privileges
- **`readOnlyRootFilesystem: true`**: Only mounted volumes are writable
- **`capabilities.drop: [ALL]`**: Start with zero capabilities
- **Never use `privileged: true`** in production

### Resource Limits — Mandatory

Every container must have resource requests and limits.

```yaml
resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 256Mi
```

- **`requests`**: minimum guaranteed. Used for scheduling.
- **`limits`**: maximum allowed. CPU throttle above limit, OOMKilled above memory limit.
- **Never omit requests**: pods without requests get BestEffort QoS
- CPU: 100m = 0.1 core. Memory: Mi = mebibytes, Gi = gibibytes

### Probes — Mandatory

Every pod serving traffic needs liveness and readiness probes.

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 15
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 2
```

- **`livenessProbe`**: "Should I restart this container?" Failure → container killed and restarted
- **`readinessProbe`**: "Should this pod receive traffic?" Failure → pod removed from Service endpoints
- **Different endpoints**: `/health` lightweight, `/ready` checks dependencies
- **Don't probe dependencies in liveness**: restarting won't fix a down database

### Network Policies

Default-deny, then allow selectively.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

- **Default deny all ingress and egress**: add policies to explicitly allow required traffic
- **Egress rules**: restrict outbound traffic. Pods shouldn't phone home to the internet by default
- **DNS egress**: pods need UDP on port 53 to `kube-dns`

### Labels & Annotations

```yaml
metadata:
  labels:
    app.kubernetes.io/name: my-app
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: my-platform
    app.kubernetes.io/managed-by: helm
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "8080"
```

- Standard labels: `app.kubernetes.io/name`, `component`, `part-of`, `managed-by`
- Labels are for selection, annotations are for metadata

### Deployment Strategy

```yaml
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  minReadySeconds: 10
  revisionHistoryLimit: 10
```

- `RollingUpdate`: default, zero-downtime
- `Recreate`: faster but causes downtime
- Use `PodDisruptionBudget` to prevent voluntary disruptions

### Service Types

- **Use `ClusterIP` by default**: expose via Ingress or Gateway API
- **Headless service** (`clusterIP: None`): for StatefulSets needing pod-level DNS

### Ingress / Gateway API

- **TLS everywhere**: HTTPS-only. Redirect HTTP to HTTPS.
- **`cert-manager`**: auto-provision and renew Let's Encrypt certificates
- **Use `ingressClassName`**: the newer, required field

### ConfigMaps & Secrets

- ConfigMaps for non-sensitive configuration
- Secrets for sensitive data (use external secrets manager in production)
- Mount as volumes or environment variables depending on use case
