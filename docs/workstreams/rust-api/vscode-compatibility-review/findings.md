# VSCode removal and historical compatibility review

Bounded read-only API/compatibility review. The rejected Windows process-control task stayed stopped. No shared edits, build, runtime, Windows operations, Computer Use or workers were used. The coordinator's current vscode-* receipts were read as source-change evidence, not runtime acceptance. Exact reviewed source hashes and cleanup inventory are in the single coordination `vscode-compatibility-review-receipt.json`.

## P2 reported and corrected: contradictory deployment gate

Historical `scripts/validate-deployment-config.sh` SHA256 `67293f5e64081c885df34b46f5c01b8717dec00491dc2371546d96e0b0b01c42`, line282 required the removed code-server socket cleanup using /home/ingenium-vscode and VSCODE_UID/GID. Line532 rejected any ingenium-vscode in that same entrypoint. The current removed entrypoint cannot satisfy the requirement; restoring it would violate the absence check. This makes that deployment gate unsatisfiable independently of runtime state.

Root removed only the stale required line, retaining the absence guard. Corrected validator observed SHA256 `5d52263e4daad877a7a8068e910ea1c4772c7112fe6fc767e824b4dbaef7b076`; unchanged removed entrypoint SHA256 `5370a807e56ff50273859867e0059e5ca6f218ea725e061342e173e956928be2`. The small source witness losslessly reconstructs the exact historical hash from that precise correction in memory and checks both the original contradiction and the corrected guard. It does not run the complete deployment validator or establish a valid deployment.

Root also corrected the stale status-only projection in dashboard.ts: the old single-host health process list at678 and display map at697 always reported VS Code stopped after its supervisor program was removed. Observed old SHA256 `dbfa3bf5c48abbc71a3c5d96115cfeff2cf12edd5c95687edcb2a07717a90731`, corrected `fc26c180a14cc525c0d0b8caa87d062f2587656283ba0ae0fbd93dc799455052`. This was a health/UI leftover, not evidence of an active launcher or trust route.

## Remaining review

No additional concrete P1/P2 preserved-data, restore-contract or active editor trust/launch defect was found in the reviewed paths:

- Core active runtime audience validation permits web/cli only. Legacy editor tickets/sessions cannot be exchanged or resolved by changing the requested audience; the original row audience remains part of the DB binding. Retired-input guards execute before the relevant DB session/token effect. Historical revocation paths may still revoke existing rows, preserving their original metadata.
- SQL101 runtime isolation and SQL102 browser sessions remain byte-identical to the existing historical migrations, including their editor audience constraints. No historical table rewrite, bulk deletion, token migration or schema normalization was introduced by the removal. The existing Core schema/restore inspectors continue to use those historical declarations. This review did not independently execute startup or signed restore.
- Cloudflare has five active service IDs. Old editor inventory entries are validated then omitted from active trust; old saved editor settings are projected read-only and raw stored bytes are not rewritten by that read. Incoming new configurations with editor service keys are rejected. Active origin/target inventory matching remains separate; a retired route alone grants no active origin trust. Root reports30 passing Core cases covering real historical rows, raw settings preservation, active Web behavior and denial; that result was not rerun here.
- API/gateway audience parsing and compatibility grants omit editor. Dashboard editor iframe/entrypoints and server upstream/start/supervisor routes are removed. Remaining vscode.localhost nginx aliases include the explicit404 tombstone, with health assertions checking HTTP and Upgrade refusal. Those retained hostname references are not active editor trust.

One nonblocking documentation leftover was relayed to Root: README.md241/243 still advertises code-server4100 and the old vscode.localhost upstream. It is stale operator guidance, not an active service path. The computer-use catalog's vscode-management item concerns desktop Microsoft Visual Studio Code; it is not the retired code-server gateway, and no change to that unrelated component was proposed or executed.

Actual API/gateway/route tests, complete deployment/static gates, signed startup/restore and runtime acceptance remain coordinator gates. No full release completion is asserted.

## Reproduction and output reconciliation

Run from this existing owned checkout with VSCODE_REVIEW_ROOT pointing to the existing read-only real-gmail-ui/prd-ui-fixes, TEMP/TMP/TMPDIR in the SAME existing veyra-phase-1/coordination/rust-api root, and NODE_DISABLE_COMPILE_CACHE=1:

```sh
node --test docs/workstreams/rust-api/vscode-compatibility-review/source-witness.test.mjs
```

Unknown validator/entrypoint source hashes stop the historical witness; the current correction is not represented as defective. Only two tiny source files under this owned docs prefix and a small TAP/receipt/in-place status in the existing C-backed coordination root are retained for Root review. No disk DB, fixture tree, cache, dependency, download or compiler output was created. Removed paths none; removed bytes0. Previous rejected/EBUSY cleanup targets remain untouched. No Linux or Windows disk recovery is claimed.
