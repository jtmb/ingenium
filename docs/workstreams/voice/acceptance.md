# Voice acceptance and output reconciliation

## CPU evidence

The dependency-free Node suite covers scope rejection, draft-only dictation, exact agent submission, tool/approval fences, steering/queue semantics, stale STT/model result suppression, interrupt acknowledgement/retirement, reconnect and consent, pending device permission disposal, FIR chunk equivalence/alias suppression, noise suppression/PCM bounds, WAV validation, durable admission rejection, capability revocation, concurrent capacity reservation, authenticated speech protocol, HTTP streaming/binary limits and uncertain mutation outcomes. The tests do not perform speech inference or open devices.

## Coordinator acceptance checklist

All rows below remain OPEN until exercised on exact integrated source:

| Gate | Required evidence |
| --- | --- |
| Shared contract/auth wiring | Versioned DTO mapping, router mount, CSRF/origin/rate limits, account/org/project isolation, auth expiry and revocation during each stage |
| Existing working agent | Same conversation/model/variant and Windows/WSL/cluster binding, real tools, Allow once/Deny, steer/queue, errors and usage accounting |
| Dictation | Real microphone partial/final transcript, exact composer insertion once, edit/cancel, no auto-send, silence/noise and permission denial |
| Call lifecycle | Start/end, mute/unmute, microphone/speaker selection, hot unplug, OS privacy indicator and zero live tracks after end/navigation |
| Speech | Authorized qualified worker, first audible reply, endpoint-to-audible latency, selected voice, no unsupported neural fallback, malformed worker responses |
| Interruption | During STT/model/tool/TTS/playback; local stop latency, exact native acknowledgement, no stale speech or cross-scope reuse |
| Natural barge-in | Qualified VAD/echo adapter plus actual loudspeaker/headset/room noise tests; no feedback loops; generation/queue discard; not established by CPU evidence |
| Reconnect | Transport loss and native/API restart, unknown open/submit outcomes, durable request-ID deduplication, revoked capabilities and expired sessions |
| Memory/retention | Current conversation memory read/contribute policy and provider/audio retention disclosure; no separate transcript writer |
| Visual/accessibility | Protected start 674×501 and active 1374×707 references, Veyra blue mascot, keyboard/focus/labels, 375/768/1280/1920 widths, 100–200% scaling, loading/denied/error/tool/approval states |
| Platform/release | Real packaged Windows/native/WSL and Linux Docker/Kubernetes persistence/rollback, exact package/digest/source, original 74/47/20/11 acceptance rows retained |

## Ownership and generated paths

Worker: session 7 (`voice`), assigned branch `codex/veyra-parallel-voice`, initial application commit `99eed8c6c0b47a043ec90d83e96f54f4f5cc2429`. Disposable storage reuses the coordinator-approved task root on the C-backed Ubuntu VHDX and its existing paired native root; combined ceiling 20 GiB, reserves 15 GiB, source allowance 64 MiB. This worker does not change the phase active owner or allocate another drive/root.

Generated source paths are exactly the owned prefixes listed in the ownership receipt. Required remaining consumer: coordinator review, source integration and final audio/platform qualification. Regeneration: the scoped Git commit and the CPU command in README. These are source/tests/docs, not disposable build trees.

Coordination retains exactly `ownership.json` and `status.json` for ownership and integration review. No task build, dependency copy, cache, model, WAV, image, temporary file or audio recording was created. Test output was returned through the tool and summarized in the receipt. Removed disposable paths: none; measured removed bytes: 0. No empty scratch directories were created. No Linux or Windows disk recovery is claimed. Existing sources, lockfiles, models, credentials, unique evidence and all previously cleanup-rejected targets remain protected.
