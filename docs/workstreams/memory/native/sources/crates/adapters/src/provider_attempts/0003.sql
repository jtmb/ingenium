CREATE TABLE memory_attempts (
    request_id TEXT NOT NULL PRIMARY KEY,
    scope_hash TEXT NOT NULL CHECK(length(scope_hash)=64 AND scope_hash NOT GLOB '*[^0-9a-f]*'),
    input_hash TEXT NOT NULL CHECK(length(input_hash)=64 AND input_hash NOT GLOB '*[^0-9a-f]*'),
    record TEXT NOT NULL CHECK(length(CAST(record AS BLOB)) BETWEEN 1 AND 8192),
    disposition TEXT NOT NULL CHECK(disposition IN ('pending','yielded'))
) STRICT;
CREATE UNIQUE INDEX memory_attempts_one_input ON memory_attempts(scope_hash,input_hash);
CREATE TRIGGER attempts_no_memory_request BEFORE INSERT ON attempts
WHEN EXISTS(SELECT 1 FROM memory_attempts WHERE request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'original memory request UUID already spent'); END;
CREATE TRIGGER memory_no_task_request BEFORE INSERT ON memory_attempts
WHEN EXISTS(SELECT 1 FROM attempts WHERE request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'original task request UUID already spent'); END;
PRAGMA user_version=3;
