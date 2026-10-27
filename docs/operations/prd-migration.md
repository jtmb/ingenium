---
title: Move Ingenium to PRD
description: Full-installation migration preparation and rollback controls.
---

# Move Ingenium to PRD

Open **Settings → Move to PRD** (`/?settings=migration`). A browser installation
administrator can save an HTTPS destination and Compose/Kubernetes target,
create a signed snapshot of both databases, refresh source snapshot integrity,
and download a preparation runbook. Saving requires recent step-up verification.
The versioned plan is stored owner-only beside the core database and survives a
container replacement. Conflicting saves are rejected. Changing the destination
clears prior destination attestations on the server.

These controls prepare a move. They do not provide automatic off-host file
transfer, Kubernetes deployment, remote health probing, service fencing or DNS
cutover. Checklist entries are explicitly operator confirmations. A fresh,
verified database snapshot is source evidence; it is not proof that PRD works.
No destination URL is fetched by the server. The downloaded runbook contains
metadata and instructions, never credentials or backup bytes.

A complete move must include the Ingenium, OpenCode configuration and OpenCode
data volumes; every actual workspace/model/custom bind mount; optional VS Code
data; all protected deployment inputs; the original email/auth encryption and
backup signing keys; and the vault passphrase through a separate secure channel.
Preserve exact model definitions, quantizations, context sizes and defaults.
The existing Backups download returns the core database component only; retain
the signed manifest and OpenCode component too. Follow
[Backup and Restore](backup-restore.md) for paired snapshot verification.

Inventory the actual running image digest, Compose project identity, override
files, mounts, external endpoints and resource needs. Transfer to encrypted
storage and rehearse with the same reviewed image before an approved final
cutover. Quiesce all writers for the final full file-level copy; copying a live
SQLite main file without WAL state can lose committed data. Never run mail
watchers, schedules and tunnel replicas from both hosts unintentionally.

PRD needs authenticated private ingress and exact browser origins. Register its
Gmail callback before reconnecting there. The public information tunnel must
remain limited to static pages. The local compatibility profile's auth-none
CLI/VS Code services must not be exposed remotely. For Kubernetes, preserve the
production control-plane, isolated runtime-manager and authenticated gateway
boundaries described in [Deployment](deployment.md); the local restore executor
does not implement off-host migration.

Rehearse restoration, compare counts, prove decryption, then independently test
fresh chat, native Goal mode, synthesis approval and activation, real Gmail
send/receive, vault, jobs, documents and backups. Preserve the original machine
and snapshots until PRD passes. On rollback fence destination writers before
restoring original routing and writers, and retain failure evidence. Do not
delete source volumes or run `docker compose down -v` as part of migration.
