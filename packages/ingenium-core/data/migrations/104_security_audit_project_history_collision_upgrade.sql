-- db.ts applies this only to the exact post-104 schema missing this trigger and wraps it in a transaction.
CREATE TRIGGER security_audit_events_primary_key_collision
BEFORE INSERT ON security_audit_events
WHEN EXISTS (SELECT 1 FROM security_audit_events WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'security audit event id already exists'); END;
