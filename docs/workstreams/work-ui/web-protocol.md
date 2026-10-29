# Unchanged upstream Web session route evidence

Checked 2026-10-29. Application Dockerfile pins OpenCode2.0.11 with SHA256 `59e917d7c0704e84f050619973e28374269b1c814548f8c9ae7942f69d69ee13`. No upstream source was modified or downloaded into task storage.

Version-tagged primary sources establish this protocol:

- [`shell/routes/routes.tsx`](https://github.com/anomalyco/opencode/blob/v2.0.11/packages/app/src/shell/routes/routes.tsx): registers the server/session route and resolves the decoded server key against its known registry.
- [`shell/routes/session.ts`](https://github.com/anomalyco/opencode/blob/v2.0.11/packages/app/src/shell/routes/session.ts): constructs `/server/<base64url(server-key)>/session/<session-id>`; route decoding checks canonical encoding.
- [`runtime/server/registry.tsx`](https://github.com/anomalyco/opencode/blob/v2.0.11/packages/app/src/runtime/server/registry.tsx): an HTTP connection's key is its HTTP URL. Sidecar/WSL/SSH identities differ; Work must not substitute those desktop keys for the browser gateway connection.
- [`runtime/platform/web.ts`](https://github.com/anomalyco/opencode/blob/v2.0.11/packages/app/src/runtime/platform/web.ts): production Web obtains its current server URL from the origin. Development mode uses separate configuration and is not the deployed-build protocol qualified here.
- [`entry.tsx`](https://github.com/anomalyco/opencode/blob/v2.0.11/packages/app/src/entry.tsx): supplies that current HTTP connection to the application registry.
- [`util/encode.ts`](https://github.com/anomalyco/opencode/blob/v2.0.11/packages/util/src/encode.ts): UTF-8 base64url encoding without padding.

The adapter derives the key only from the public root returned by the existing authorized audience launch hook. It rejects credential-bearing roots, ticket/exchange paths, queries/fragments, unsupported protocols and unsafe session segments. It does not add auth tokens, accept a private service address, inspect iframe DOM/localStorage or use native IPC. Gateway admission still owns all actual authorization; the encoded URL is presentation, not a capability.

On first Web selection, the adapter opens the selected engine session directly. Repeated Work/Web presentation changes retain that iframe and Work draft. On return, Work temporarily clears only its controller's loaded-session handle, then reopens the same selected session through existing history/busy-state recovery. It retains the scoped draft, model choice and unknown-admission notices and never replays a prompt. A history error blocks sending.

Required final evidence: served Web assets match the pinned2.0.11 behavior; the gateway routes its public origin to the same admitted runtime; the selected engine session appears without replacement creation; messages/tools/permissions/questions and in-progress native activity survive both directions; Web-side updates rehydrate into Work; unknown admissions remain unreplayed; invalid/revoked/expired bindings fail closed. Iframe `load`, source inspection and unit tests alone do not close these gates. Upgrading upstream requires requalification rather than reusing this versioned protocol silently.
