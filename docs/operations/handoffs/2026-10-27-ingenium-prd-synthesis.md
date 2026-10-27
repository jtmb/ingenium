# Ingenium PRD synthesis checkpoint

The full goal remains open: finish the production Kubernetes migration and independent UI acceptance, preserve all data/credentials/model settings and the single-writer cutover, and reconcile owned outputs. Continue development in the current Codex window; do not develop through OpenCode or create a successor chat.

## Accepted release

Application PR #19 merged as `b306f38a5bd3a57046f8d9f9dc64a2b212917f34`; chart PR #19 merged as `be98fffec8963b95479e05cefeff9ea4efedb900`, version 0.1.12. Exact-source local CI attempt `ba11aa51142840cd96d4a224225f52e5` promoted that chart revision to validated and Flux deployed `docker.io/jtmb92/ingenium@sha256:2138eb9790df6218af3bbaa753b6b21ee1754e250106a3f4dde17f896cc6b5bc`. Image size is 1209306877 bytes, about 1.21 GB. Data, replicas and caches are separate.

Home supports an explicit one-run synthesis model selection, restricted to the signed-in owner of the exact authorized runtime. Current catalog validation, private-data checks and tool denial remain enforced. Saved models/defaults, credentials, scheduled selection and the Chat catalog are unchanged. Source validation passed 80 focused API checks and 18 UI checks, then all 37 affected route/broker checks after the runtime identity fence; API/dashboard typechecks, three packaged boundary checks, exact-digest worker probe, 33 chart tests, full chart validation and server dry run passed.

The real retained batch completed with the explicitly approved Luna response-test fallback after free Zen reported quota exhaustion. Its three observations produced one update to the owned verification skill. UI review/approval applied it; the active main file and new reference survived reload and were read back from API-owned storage. A separate empty chat used the active skill as explicit prompt reference and correctly handled a held-out mixed-case payload without tools. This proves that consumption path, not automatic skill discovery. The original nine unrelated proposals remain untouched.

Production has one Ready writer with zero restarts, the original local installation remains stopped, and the same retained claim/native Secret identities and mounted model hash are preserved. Both Longhorn replicas remain RW and healthy. Vault was unsealed normally after replacement, and the information-only tunnel was reconnected. The earlier 942,039,040-byte backup download passed signed-hash and authenticated encrypted readback through the normal dashboard gateway.

## Remaining acceptance

- Configure a supported Jobs provider connection and the job service-principal grant, then verify an actual isolated Job execution and persistence. Do not bypass provider authorization or substitute the text-only broker for the real runner. The packaged CLI supports the existing run flags; native OAuth support is not yet established.
- Finish independent UI controls and the final passive sweep. A real proposal-review DTO mismatch is confirmed: the API sends observation `type`/`contentPreview`, while the overlay/evidence widgets read `observation_type`/`content_preview`; trigger labels also omit the actual `trigger` field. Fix with production-shaped regression coverage.
- Inspect the old owned Chat conversation that renders an internal Code Mode catalog notice; establish its message type before changing filtering.
- Verify the newly activated skill after the next qualified Pod replacement, then complete the full requirement matrix and production acceptance flags.
- Reconcile remaining older fixture/runtime artifacts with ownership, reference and inactivity evidence. Preserve policy-rejected paths and all original recovery material.

## Continuation

Use the existing operator deployment skills, exact-source image publisher and charts/local-CI/validated/Flux pipeline. Keep the models and all existing credentials unchanged. Preserve the dirty canonical checkout, stopped original installation, full encrypted cold/NAS recovery and required private access supervisor. The private operator companion retains exact paths, handles, receipts and cleanup inventory; it contains no permission to broaden scope.
