-- Upgrade AUTH-101 invitation consumption so pending invitations can be revoked.
BEGIN IMMEDIATE;

DROP TRIGGER organization_invitations_consume_once;
CREATE TRIGGER organization_invitations_consume_once
BEFORE UPDATE ON organization_invitations
WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.email_normalized IS NOT OLD.email_normalized
  OR NEW.role IS NOT OLD.role OR NEW.token_hash IS NOT OLD.token_hash OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.created_at IS NOT OLD.created_at OR OLD.accepted_at IS NOT NULL OR OLD.revoked_at IS NOT NULL
  OR (NEW.accepted_at IS NULL) = (NEW.revoked_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'organization invitation may only be consumed once'); END;

COMMIT;
