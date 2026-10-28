# Veyra visual acceptance contract

The user explicitly made the screenshots the acceptance contract. The selected set is the 47 entries in [veyra-screen-contract.json](veyra-screen-contract.json): all 38 current page routes, all 20 settings sections (some reuse feature screens), plus conversation, expanded navigation, memory and account/configuration states. Earlier rejected/superseded drafts are not acceptance images. The private companion locates the unique original images; preserve their hashes.

## Shared rules and precedence

1. Chat uses the supplied standard: slim collapsed icon rail, calm dark canvas, centered Chat/Work toggle, compact composer; conversation view keeps focused content and tool/progress disclosure.
2. Expanded navigation contains Home; Chat, OpenCode, VS Code, Mail, Tasks, Docs; Skills, Agents, Observations, Personality, Context, Pipeline; Jobs, Backups, Logs, Usage, Status; Projects, Organizations, Plugins, MCP Servers, Config, Secrets; Settings and Account. Use one route registry across desktop/browser and shared settings links.
3. Veyra's blue computer-use mascot replaces every temporary V/flower/text-only logo in the drawings. This is a direct user override; no full image regeneration was requested. Preserve upstream OpenCode's own branding.
4. Use shared dark tokens, blue accent, typography, spacing, focus/disabled/error conventions and control components. Auth/bootstrap/MFA/reset/verification flows expose no private navigation or workspace data. The Windows titlebar/tray are platform chrome, not a reason to redesign page content.
5. Serve upstream OpenCode Web unchanged. Its reference is a real existing-session UI screenshot, not a new frontend to implement and not proof of fresh inference.
6. The per-screen composition and visible controls define feature requirements. Sample names, dates, counts, badges, endpoint strings, model labels and JSON are deterministic fixture content, not production settings or a new schema. Preserve validated configuration semantics. Agents' GPT-4/Claude examples and the sample config's veyra.dev schema do not authorize model changes or an invented configuration format.
7. Cross-screen consistency and explicit user overrides take precedence over incidental generated inconsistencies. Record every normalization/deviation; don't silently replace a whole screen with another layout or hide a feature. A material layout/control change requires review before acceptance.

## Scope alignment and known differences to reconcile

- The mockups have different native resolutions/aspect ratios. Store each intrinsic size; compare actual captures at a recorded viewport/DPI with explicit page-content crop. Define shared responsive rules in Phase 1, never stretch a baseline and call it pixel parity.
- Header/search shortcuts, sidebar widths, recent-item presence, icons, blue hues and title hierarchy vary between generated drafts. Normalize through one shared shell/token set, with collapsed versus expanded layouts intentional. Present a small implementation comparison for these variations; do not claim the raw set is already pixel-identical.
- Mail list/detail currently illustrate different sample messages; use distinct deterministic state IDs. List, detail, callback and Mail settings must describe one actual mail feature and account scope.
- Context must retain source refresh, automatic external-session upload, saved-memory edit/forget and operation status, conversation/message search/load-earlier, immutable checkpoint hashes and restore AS A NEW conversation.
- MCP needs both Servers and full Tools, child-server lifecycle/scope, Vault environment references and the browser preset. The sample list does not install or authorize every depicted external integration.
- Jobs has Jobs/Event queue/Trusted events plus nested run history and Logs/Output/Approval/Vault audit, not separate competing schedulers.
- Backups' existing actions are Create/Refresh/Download/Delete and separate hourly/daily schedules. Do not add a fake Restore/Verify UI based on superseded images. Actual isolated restore qualification remains an operator acceptance gate.
- General archive retention means days before archived PROJECTS are purged. Mail header/body retention is separate. The pictured typography/motion controls are added visual requirements, not proof they already exist.
- Skills needs upload, preview/edit/save, archive/restore, proposals, consolidated sources and history. Preserve the API-owned persistent storage model. Synthesis must complete and activate a proposal before its green status is accepted.
- Added depicted controls (for example secret consumers/rotation/audit, global search, appearance settings, validation, mail smart replies and mic interaction) must each be mapped to a real existing API or an explicit implementation gate. Never silently drop them or make fake success interactions.
- Full Status keeps 12 runtime services and four application services. Technical identifiers can remain ingenium-* where changing them would break migrations or operation.
- Ordinary Chat excludes the Goal plugin and custom multi-chat orchestration. Platform-only functionality remains clearly scoped.
- The blue logo changes visible branding; it does not authorize renaming database namespaces, OAuth client IDs, credential paths or persistent service identities.

## Verification contract

For every selected view, record baseline hash, route/state, platform, viewport/DPI/theme/font, deterministic fixture or redacted live state, actual capture, comparison and reviewer disposition. Keep normal, loading, empty, failure, auth-expired/step-up recovery, keyboard/focus and 100–200% scaling checks. Selected screen controls need independent behavior/persistence checks as well as image matching.

The Phase 1 Windows and Linux builds must both render the agreed shell/screens. A static fixture screenshot can qualify only the presentation slice, never live mail, tool execution, provider auth or synthesis. The full release needs those workflows. No stage is complete by changing an acceptance screenshot to resemble unfinished code.
