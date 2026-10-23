-- 120_lifecycle_plugin_description: repair existing databases after lifecycle replaced session-coordinator.
UPDATE plugins
SET description = 'Uploads session context and records external usage at lifecycle boundaries.'
WHERE name = 'lifecycle'
  AND (description = '' OR description = 'Project-local OpenCode plugin.');
