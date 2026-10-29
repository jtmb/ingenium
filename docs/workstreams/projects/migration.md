# Lossless global-project replacement

Status: additive source proposal and tested schema/seeded-data fixtures; production cutover remains coordinator-owned and gated.

## Preservation design

Keep every existing `projects.id`, source resource ID, organization/member/permission row, encrypted field, revision, FK and provenance record. The global row is retained as an internal compatibility owner; it disappears from workspace presentation only after consumers use explicit installation/workspace resolution.

The new installation table references the currently active legacy global row. Settings and library resources stay with their original storage owner during transition. No plaintext credential, transcript or resource body is copied into catalog tables. `chat_defaults`, legacy Docs `chat_selection`, synthesis/provider selection and the newly human-installed orchestration skill are preserved independently.

The additive draft creates five small metadata/receipt tables:

| Table | Purpose |
| --- | --- |
| veyra_workspace_projects | API-owned organization/owner-scoped workspace metadata, stable ID and CAS revision |
| veyra_workspace_roots | Attested host/environment/canonical identities; one primary root; no inferred cross-OS path translation |
| veyra_installation_legacy_refs | Explicit installation-to-legacy configuration owner |
| veyra_project_aliases | Source-system/source-ID classification and evidence reference |
| veyra_project_operations | Scoped exact-request pending/succeeded/failed/unknown receipts; input bodies are not stored |

Native project records stay native-owned through the adapter; these tables are not a mirror of them. No second transcript, scheduler, account database or Rust writer is introduced.

## Rehearsal sequence

1. Coordinator obtains an authorized, transactionally consistent database COPY using the existing backup owner. Verify copy hashes, DB integrity/FKs and protected resource/Secret identities; do not point this module at a live database during discovery.
2. Use metadata plus source consumer review. `inventoryLegacyReferences` inventories declared FKs to projects and logical `project_id`/`source_project_id`/`legacy_project_id` columns. `legacy-consumers.json` records static source matches. Stored JSON, aliases, external consumers and dynamic references require separate review; static search is not proof of completeness.
3. Classify every legacy project explicitly with an evidence reference. The active global owner maps to installation. A verified workspace must carry the original owner/org scope and `permissionsVerified: true`. Ambiguous or historical archived-global records become Imported unassigned metadata with legacy authorization preserved. Labels/paths alone never establish ownership.
4. Coordinator allocates the additive migration number and applies the draft on the COPY only. Capture the exact reviewed `migrationInventoryHash` after schema creation. It hashes schema, reference metadata and legacy row hashes inside the process; no secret/content values are exported. New/unreviewed schema or data changes make that reviewed hash stale.
5. Call `importLegacyCatalog` inside the existing API transaction owner with that exact hash and decisions. The same reviewed source hash remains valid across alias-import retries because only the five owned metadata tables are excluded from source-content hashing. A changed classification/evidence/scope conflicts; partial writes roll back.
6. Compare per-table count/content hashes from before/after; run foreign-key/integrity checks, permission/capability denials and restore/rollback. Prove legacy caller compatibility before enabling the new reads.
7. Resolve roots using the real host adapter. A migrated project has no execution roots until canonical proof exists. `bindImportedRoots` permits only a nonarchived legacy-backed, empty-root catalog row at the expected revision, with existing root-attach authorization. After binding, roots are immutable through ordinary metadata edits.
8. Wire installation settings/library consumers and private Imported unassigned views to the original row IDs under their original ACLs. Global installation content must not be listed as ordinary projects or broadened into private projectless recall.
9. Enable project organization separately from execution binding, then qualify native/WSL/cluster workflows. Restore the old presentation/reader configuration on failure while keeping original rows unchanged. Do not operate two writers or roll back a database file over a running writer.
10. Retire old global schema/code only in a separately reviewed migration after every consumer, data mapping, restore and rollback gate closes. There is no deletion/purge script in this slice.

## Fixture evidence

The dependency-free SQLite suite exercises:

- Complete fresh canonical schema: 121 base migration files; four historical conditional upgrade variants are excluded because `packages/ingenium-core/lib/db.ts` chooses them only for older schema shapes.
- 220 existing tables unchanged after the additive draft/import, 118 legacy project-reference columns inventoried and zero foreign-key violations.
- Seeded migration fixture: stable project/session IDs, encrypted BLOB bytes, owner fields, logical references, duplicate labels, ambiguous scope and archive state remain unchanged.
- All-or-nothing failure, changed-inventory refusal, idempotent alias import, conflicting evidence and one-time root binding.
- Historical archived global identity is preserved as unassigned metadata rather than becoming a second installation owner.
- Installation preference facade keeps Chat defaults distinct from Docs selection and rejects secret keys.

First fixture failures were retained as narrow evidence: a naive all-files loop selected the historical `094_authentication_auth101_upgrade.sql` after the already-current base schema; then migration 101 required the existing SHA-256 SQL function. The test was repaired by following the existing conditional-upgrade selection and registering the deterministic SHA-256 equivalent. No production migration or existing source file was changed.

These are schema/seeded-data fixtures, not a backup of the user's live database. Real production-copy data/provenance, logical references, resource catalogs and rollback acceptance remain required. Never infer them from the passing fixture counts.
