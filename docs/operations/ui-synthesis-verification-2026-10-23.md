# Independent UI and synthesis verification

This follow-up checks a genuinely new free Zen chat and independent UI workflows. Model mappings, variants and saved defaults remain unchanged. All development stays in the current Codex window.

## Verified before the follow-up build

- A newly created, empty chat sent one prompt to OpenCode Zen / Beam Free and received its exact unique marker. The persisted session contains one user message and one newly generated assistant message, with no tool calls. Desktop and mobile screenshots were reviewed.
- An isolated QA project was created through the UI. Tasks passed create, edit, persistence after reload, Board/List/Timeline navigation, and positive/negative search.
- An actual synthesis attempt in that isolated project remained pending with `TRAIT_LLM_UNAVAILABLE`; that project has no authorized automation runtime. This is not a synthesis pass.
- In the existing Ingenium workspace, the enable-learning UI action failed because the local runtime's idle lease had expired, despite the compatibility page showing ready.

## Corrections

The explicit, recently confirmed workspace-owner action can renew an expired idle lease, bounded by the existing absolute expiry. It does not replace credentials, revive revoked grants, bypass workspace/member/epoch checks, or extend the absolute lifetime. Core callers retain strict lease validation unless the server supplies the renewal policy.

The cockpit now reports that synthesis has started and points to Pipeline. Accepting a background request no longer claims completion.

## Validation and remaining acceptance

The 49 focused runtime route/automation tests and two synthesis action tests passed. Core, API and dashboard type checks passed. Denied callers, revoked bindings/grants, expired absolute lifetimes, inactive principals and unrelated workspaces remain covered.

Deployment verification, a completed real synthesis batch with a persisted skill proposal, proposal review, and the remaining independent UI workflows are still required at this source checkpoint. Integration-dependent features must be reported separately when credentials, accounts or authorized recipients are absent. Page loads and unit tests alone do not establish functional acceptance.
