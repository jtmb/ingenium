// Read the existing Context authority only. LIMIT 2 distinguishes one exact
// source registration from ambiguity without picking a latest/active row.
export function findRequestChatSourceIds(readRows,execution,engineSessionId) {
  return readRows(`
    SELECT id FROM context_conversations
    WHERE project_id = ? AND organization_id = ? AND owner_user_id = ?
      AND visibility = 'private'
      AND CASE WHEN json_valid(metadata) THEN
        json_extract(metadata,'$.source') = 'opencode-chat'
        AND json_type(metadata,'$.sourceRuntimeId') = 'text'
        AND json_extract(metadata,'$.sourceRuntimeId') = ?
        AND json_type(metadata,'$.sourceSessionId') = 'text'
        AND json_extract(metadata,'$.sourceSessionId') = ?
      ELSE 0 END
    LIMIT 2`, [
    execution.projectId,execution.organizationId,execution.ownerUserId,
    execution.runtimeId,engineSessionId,
  ]);
}

// Archive events use the canonical Context ID, never the engine session ID.
export function isRequestChatConversationActive(readRow,projectId,contextConversationId) {
  const state=readRow(`SELECT event_type FROM context_checkpoint_audit_events
    WHERE project_id = ? AND conversation_id = ? AND archive_sequence IS NOT NULL
    ORDER BY archive_sequence DESC LIMIT 1`,[projectId,contextConversationId]);
  return !state || state.event_type==="conversation_unarchived";
}
