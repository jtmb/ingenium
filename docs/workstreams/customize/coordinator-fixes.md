# Coordinator-owned plugin editing fixes

These are concrete inherited workflow defects found while binding the Customize System editor. The affected production files are outside this worker's writer prefixes; they remain unchanged here. The new regression test is within the assigned API test prefix.

## C1: Source endpoint reads from the process directory

In services/ingenium-api/lib/routes/plugins.ts, GET /:name/source currently resolves plugin.file_path against process.cwd(). The core plugin owner writes that same relative path under getPluginsBase(projectId). A registered same.ts can therefore cause this endpoint to return a process-directory same.ts instead of the registered owner's source, when that unrelated file exists. This conclusion follows from source inspection; no live file or private data was probed.

Requested minimal behavior:

1. Preserve requireProject/auth checks before any source access.
2. If source_content is a string, return those API-owned bytes, including a confirmed empty string.
3. For a legacy record without stored source, read only its actual getPluginsBase(projectId) projection with lexical and realpath/symlink containment checks. Never resolve against process.cwd().
4. If neither authoritative source is available, return a safe non-2xx source-unavailable error. Do not return successful empty content.

services/ingenium-api/tests/veyra-customize-plugin-source.test.ts covers stored source versus an unrelated same-named process file, confirmed empty content, and missing source. It invokes the existing handler without a server or filesystem output. The current inherited implementation is expected to fail the first and third assertions; this regression is intentionally a gate for the coordinator-owned correction, not a reported passing check.

## C2: Legacy editor swallows source-load failure

In services/ingenium-dashboard/src/app/plugins/page.tsx, the Edit handler catches getSource failure and proceeds with the empty buffer. Once the API source is explicitly unavailable, this must stop editor entry and show the permission/network/source error. Preserve the user's existing text when save/readback fails. A successful empty string is distinct from a failed request.

Requested minimal behavior: inside the source-fetch catch, surface the error and return before setEditingId/setEditContent. Reuse the canonical authenticated request/reauthentication path. services/ingenium-dashboard/tests/veyra-customize-plugin-editor.test.tsx supplies the focused regression and a confirmed-empty-source control. The inherited implementation is expected to fail its source-failure assertion until the coordinator applies this fix.

No shared router, core owner, manifest, auth policy, legacy editor or runtime was changed by this worker. These two changes are required before claiming complete plugin editing acceptance through Customize.
## C3: Full skill membership needs an API-owned metadata reader

The existing core listSkills query deliberately filters enabled=1 and archived_at IS NULL. Keep that activation-facing behavior. It cannot enumerate disabled-but-retained installed records for the Customize catalog.

Requested coordinator-owned addition: a read-only core catalog query that returns unarchived records regardless of enabled state, retaining id/revision/ownership. Inject it as the second argument to createProjectCatalogAuthority(canRead, readSkillRecords). No schema migration or second database writer is required. Wire a project catalog source and a System source built from the exact mapped installation namespace through the authenticated Customize read boundary.

The frontend supports source selector project for the full current-project catalog. A service reader can use visibility=project with selectorId=system for an explicitly bound installation namespace; the display label confers no authority. If full-catalog access fails, the UI does not retry through the legacy active-only list. The compatibility view is labelled Active skills instead of claiming complete installed membership.

The fourth real persistence case uses the actual core disableSkill and getSkill owners to enumerate its one known seeded fixture record, proving adapter/readback/retained-reference behavior. It does not prove full production enumeration. C3's production core query and authenticated wiring remain a coordinator gate.

## C4: Legacy Skills upload/save outcomes hide service failures

Verified read-only in the coordinator's integration-root Skills page as well as this baseline: handleSave catches without presenting an error. handleUpload uses the same transient Invalid file message for parser rejection, denied/network create failures, and confirmed create followed by loadSkills failure.

Requested coordinator behavior: keep validation rejection separate from API refusal/unknown outcome, keep entered edit text and a persistent error after save failure, and report confirmed write/readback failure accurately. A failed refresh after a successful create must not be presented as invalid Markdown or encourage an unqualified replay. Extend the existing shared Skills-page tests for denied upload, transport failure, confirmed create/failed refresh and denied save. This is already a retained Phase-2 workflow requirement; the Customize management route makes it a direct integration gate here.

C4 was reported immediately to the coordinator after current-root source verification. No shared Skills source or tests were changed by this worker.
