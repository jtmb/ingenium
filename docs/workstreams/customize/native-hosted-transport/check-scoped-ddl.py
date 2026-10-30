"""DDL syntax/constraint-shape check only. Empty structural bases; no auth/session rows."""
import sqlite3, pathlib, json
root=pathlib.Path(__file__).resolve().parent
connection=sqlite3.connect(':memory:')
connection.execute('PRAGMA foreign_keys=ON')
connection.executescript('''
CREATE TABLE users(id TEXT PRIMARY KEY);
CREATE TABLE organizations(id TEXT PRIMARY KEY);
CREATE TABLE projects(id TEXT PRIMARY KEY);
CREATE TABLE skill_proposals(id TEXT PRIMARY KEY);
CREATE TABLE plugins(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,enabled INTEGER NOT NULL);
''')
connection.executescript((root/'files/packages/ingenium-core/data/migrations/133_customize_scoped_catalog.sql').read_text())
columns={row[1] for row in connection.execute('PRAGMA table_info(plugins)')}
assert {'revision','archived_at'}<=columns
names={row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
assert {'plugins_archived_inactive','plugins_revision','plugins_lifecycle_event','customize_catalog_immutable','customize_command_no_update','customize_command_no_delete','customize_installation_no_update','customize_preimage_no_update','customize_preimage_no_delete'}<=names
assert connection.execute('SELECT count(*) FROM users').fetchone()[0]==0
assert connection.execute('SELECT count(*) FROM customize_commands').fetchone()[0]==0
print(json.dumps({'ddlSyntax':'passed','triggers':len(names),'authOrSessionRowsCreated':0,'liveMigrationOrOwnerAcceptance':False}))
connection.close()