# Bounded original message-order conformance

Checked2026-10-30 against the already-running original Kubernetes owner through the coordinator's established authenticated procedure. No owner, engine, model or session was started or modified.

## Source identity and bounds

- /api/info returned version2.0.11.
- /openapi.json SHA256: `2fa254eff9933cf357e61fe918a2b4f8ccfda5e750fcb4299134f9685beab28a`, matching the coordinator's original249841-byte schema. OpenAPI document info.version0.0.1 is not the served application version.
- That exact schema declares session.message.list order asc|desc, string/null limit and cursor, a single type selector, and SessionMessagesResponse data plus previous/next cursors. Assistant time.created is required, time.completed optional; finish includes stop/length/tool-calls/content-filter/error/unknown and error is optional. User does not declare parentID.
- Exactly one session-list GET requested at most3 existing sessions. Exactly one ascending and one descending message GET requested at most32 raw entries per sampled session. No cursor followed; no history traversal or additional session search.
- Parsing/export was restricted to metadata. The credential remained inside the existing pod. No titles, text, tool payloads, raw IDs or credential values were exported.

The private sanitized receipt coordination/work-ui/original-message-order.json is4277bytes, SHA256 `fc3c2365dab2ffa164c27177d46319f002ee0ac382111ada3d7c50aa84bc3411`. Its IDs are digested. The bounded script and exact SSH/pod invocation remain beside it as read-original-message-order.mjs/.sh. The earlier WSL49374/401 evidence describes a different, unqualified owner and remains preserved; it is not evidence against this original service.

## Observed results

| Sample | asc count | desc count | Created-time order | ID overlap |
| --- | --- | --- | --- | --- |
| 1 | 0 | 0 | No comparable pairs | Empty; no ordering evidence |
| 2 | 5 | 5 | asc nondecreasing; desc nonincreasing, four comparable pairs each | Five of five; exact reverse sequence |
| 3 | 0 | 0 | No comparable pairs | Empty; no ordering evidence |

The nonempty sample had one each of agent-switched, model-switched, user, assistant and idle. The assistant had numeric completed time, finish stop and no error. No non-null user parentID was observed; this projection does not distinguish a missing field from a null field. Both directions contained unique IDs and valid numeric created timestamps.

Message IDs were **not lexicographically monotonic in either direction**. ID sorting is not a replacement for the original server's chronological ordering.

Both previous and next cursors were nonempty on both five-row pages. Consequently, cursor presence alone does not prove that more messages exist or that a capture is truncated. No continuation page was requested, so their actual navigation direction/exhaustion remains untested.

## Nonbreaking client implications

The schema qualifies descending support and the nonempty short-page sample conforms to chronological direction. Preserve all existing ascending/default/cursor callers. A separate bounded recent-page method can request limit32/orderdesc initially and preserve the returned opaque cursor metadata. If a consumer needs chronological presentation of that bounded descending page, reverse that returned sequence; do not sort IDs.

The raw page includes operational events such as idle as well as user/assistant records. A32-raw-entry bound does not promise32 completed conversational messages. A completed-time/finish/error observation is metadata, not proof of a whole successfully completed turn. Do not invent a user parentID or accept a multi-value type query when the actual schema declares one enum value.

Report cursor availability separately from proven more-data/truncation. A page hitting the32-entry limit establishes a bounded capture, not necessarily an additional row. None of these samples hit32, so this run does **not** empirically prove the newest-window boundary on a long conversation. Concurrent changes were not locked out. No further sampling/traversal was authorized or performed.

## Scope and reconciliation

Only metadata evidence and this source-limited recommendation were written. Shared client, upstream/Web, native frozen sources, secrets and all actual session/agent/model/service state were unchanged. No Computer Use, build, install, browser, new checkout/output root, model/GPU or service action. The small receipts and safe recipes remain under the same task root for coordinator integration/qualification. Removed paths:none; removed bytes:0. Long-chat boundary, opaque-cursor continuation and full Work/release acceptance remain open.
