# Veyra shared shell implementation review

Phase 1 implementation is in progress. The approved baseline hashes remain unchanged. These choices require comparison with actual captures before visual acceptance.

| Area | Implementation decision | Acceptance |
|---|---|---|
| Identity | Use the exact selected blue mascot for the application, sign-in card and favicon. Keep technical namespaces and upstream OpenCode branding. | Source integrated; capture review pending |
| Home | Welcome composer reuses Chat's real owners and creates a fresh conversation for an explicit send. Recent Work uses real permission-scoped Chat/Docs/Task identities with server sorting, pagination and exact reopening. Project-scoped Tasks/Mail/Pipeline quick links and the operational dashboard remain available. Five controlled browser scenarios, including the fresh 47-view capture, passed. | Needs-attention proposal/job controls, live workflow and visual/scaling approval remain open |
| Navigation | Preserve all existing route groups and settings. Chat starts with a compact rail when no preference exists; an explicit saved density wins. The quiet rail contains Chat, Projects, OpenCode, Settings, All features and Home; All features expands the complete directory without losing saved group state. | Final compact-rail keyboard/drawer checks and screenshot comparison pending |
| Chat / Work | Chat opens `/chat`; Work opens the existing `/opencode` page. The switch creates no task or session. | Browser workflow pending |
| Chat history | History is explicitly opened from Chat. New conversation remains separate. The editor waits for the exact initial session/history before mounting, preventing cold-start drafts from disappearing during initial selection. | Controlled send/stream/history/reopen and cold-start source checks passed; live recovery remains open |
| Conversation controls | Provider, agent, rename, fork, share, compaction and task capture remain in a disclosure. The selected model is also available at the composer. | Intentional normalization of inconsistent mockup headers; review pending |
| Context and memory | Existing scoped context/read/save controls remain inside a composer disclosure. No consent or server permission is inferred from its presentation. | Existing 21 context checks passed before the final presentation edits; final browser check pending |
| Suggestions | Suggested text fills the composer and requires the user to send it. | Behavior verification pending |
| Microphone | Depicted mic remains visibly unavailable with an explanation until an actual dictation adapter is qualified. It never shows fake recording/success. | Functional gate open |
| Appearance | Shared charcoal tokens and system font stack, with dark as the new-user default. Existing light/system preferences remain supported. | Font/viewport/scaling comparison pending |
| Windows companion | Reuse existing authenticated service, project creation, selected WSL environment, terminal/cache and model action owner. The chosen shared service opens in its own origin-restricted window without native IPC. | Native build/runtime/visual checks pending |

[Home control reconciliation](veyra-home-controls.md) maps the composer, work-item identities, proposal and job actions to their existing owners and explicit missing requirements. These gaps remain open.

The native service selector, Windows/WSL project dialog, terminal reconnect and tray states need targeted Windows captures and review in addition to the 47 shared views. Existing Windows concept images remain protected references. No Windows state is accepted merely because a Linux-route screen exists.

Global search, typography/motion settings, validation, secret consumer/rotation/audit and mail smart-reply controls remain explicit functional gates from the visual contract. Existing feature pages retain their real APIs; rendering a control never completes its workflow gate. See the full phased plan and 74-row feature map.
