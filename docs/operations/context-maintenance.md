---
title: Context Checkpoint Maintenance
description: Safe preview, authorization, archive, audit, and restore-as-new procedure for immutable context conversations.
---

# Context Checkpoint Maintenance

Use this procedure only for a project-scoped immutable context conversation.
It preserves conversations, messages, checkpoints, checkpoint source links, and
RAG citation snapshots. Do not use direct SQLite writes or attempt checkpoint
deletion.

## Safe workflow

1. **Preview candidates** with `ingenium_context_checkpoint_maintenance_preview`.
   The result is bounded to 100 content-free summaries. Supply `staleBefore`
   only when an operator has chosen a cutoff; Ingenium has no automatic
   retention policy. Review divergence, integrity, and multiple-branch flags
   before choosing any action.
2. **Authorize one target** with
   `ingenium_context_checkpoint_maintenance_authorize`, including the observed
   `expectedRevision` and, for restore-as-new, the checkpoint ID. This returns a
   one-time confirmation token valid for 15 minutes.
3. **Perform exactly one action**:
   - `ingenium_context_conversation_archive` appends an archive event. The
     conversation disappears from ordinary lists and accepts no new messages or
     checkpoints, but no immutable row is changed or deleted.
   - `ingenium_context_conversation_unarchive` appends a compensating event and
     restores ordinary visibility.
   - `ingenium_context_checkpoint_restore` creates a new conversation from the
     checkpoint. The source conversation and checkpoint remain unchanged.
4. **Read the audit evidence** using `ingenium_context_checkpoint_audit_list`.
   It reports event IDs, source/target IDs, expected revisions, state hashes,
   archive sequence, and timestamps. It deliberately omits message content,
   metadata, and confirmation tokens.

## Safeguards and failure handling

- A stale `expectedRevision` returns `REVISION_CONFLICT`; refresh preview and
  authorize again. Never retry using a previous authorization for new state.
- An expired, used, wrong-project, or mismatched token returns the single
  `MAINTENANCE_AUTHORIZATION_INVALID` result. Do not log the token while
  diagnosing this condition.
- Checkpoint integrity failures stop restore-as-new before any target
  conversation is created. Preserve the audit/preview evidence and investigate
  the source through supported project-scoped APIs.
- Archive is reversible only through a new unarchive authorization. It is not a
  deletion, purge, or content-compaction mechanism.
- There is no direct checkpoint deletion API or MCP tool. Database triggers
  reject direct checkpoint and audit-event mutation/deletion.

## Project isolation

Every preview, authorization, action, and audit query is constrained by the
requested project. A foreign conversation or checkpoint is reported as absent;
the API does not reveal whether it exists in another project.
