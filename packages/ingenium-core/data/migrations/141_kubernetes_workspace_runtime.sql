-- Original workspace scope remains v2. This adds an explicit physical backend;
-- historical Docker rows retain their payloads and receive only Docker defaults.
CREATE TRIGGER kubernetes141_original_backend_binding BEFORE INSERT ON runtime_original_provisions
WHEN NEW.backend_kind='kubernetes' AND NOT EXISTS (
 SELECT 1 FROM runtime_instances r WHERE r.id=NEW.runtime_id AND r.schema_version=2
 AND r.project_id IS NULL
 AND json_extract(NEW.backend_identity_json,'$.podName')=r.backend_name
 AND json_extract(NEW.backend_identity_json,'$.containerId')=NEW.parent_container_id
)
BEGIN SELECT RAISE(ABORT,'original Kubernetes backend binding unavailable'); END;
