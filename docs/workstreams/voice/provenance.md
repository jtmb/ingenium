# Stratus reuse provenance

Read-only source qualification on 2026-10-29 used Stratus HEAD `3199ed969546bf021f77ffe57f287e0427b2eed6` plus its existing dirty working files. Stratus had active unrelated work and the GPU/live-test hold. It was not edited, staged, built, started, stopped or used for inference by this worker.

The Veyra adapters independently implement the reusable lifecycle/protocol patterns: generation fencing, explicit consent/start, bounded normalized PCM, FIR filtering before downsampling, minimum speech/silence endpoints, WAV validation, authenticated worker requests, scoped tool feedback and native interruption acknowledgement. Discord membership, channel IDs, transport, credentials, defaults, models and runtime paths are not imported. No Stratus source file, dependency tree or neural component is bundled in this change.

Source authorship remains with the Stratus project contributors. No repository-root LICENSE/COPYING file was found in the inspected source tree; this is not permission to redistribute Stratus source or model weights. Direct source/model packaging remains a coordinator provenance/licence gate. Veyra's new code does not assert a licence over Stratus or use personal workstation paths as runtime dependencies.

| Read-only input | Working-file SHA256 |
| --- | --- |
| `discord-bot/src/voice/session.ts` | `5e022995c7f1f4b74e5d5abef1f5688c8f1bf1c0f543bdb6886f7239f8803ae9` |
| `discord-bot/src/voice/receiver.ts` | `8d01aab4de4506447c57e4434ad90b1ab4906a2833c7d7f3ce6adb8c4e652208` |
| `discord-bot/src/voice/audio.ts` | `cb9932f1c1f03983a69591ba8fce9ac3df1ff0d10aeeea9b073280d9c7992284` |
| `discord-bot/src/voice/speech-client.ts` | `2675ceb0523537b8f496540006434973e176d5a17891dbeeccbc1e43f21f8d40` |
| `discord-bot/src/voice/tool-feedback.ts` | `efd190455259bcdc3783d1420a111bd9e619fc18e3d871400fdc5393664bae38` |
| `docs/reference/discord-voice/README.md` | `cd6de6849d1fcddb44c99748b74d01b103597bec122ea6c437a0819752919f9e` |
| `docs/reference/discord-voice/architecture.md` | `aaf6655b08d8debfc24a0a4d3cab4b7cef9e5f8daaf2af62d9ae468534feabf2` |
| `docs/reference/discord-voice/phase-4.md` | `634255dccff3f3b473cfda5d26de19736e99d495ba0c30d4691280a2eb8c9e60` |

The architecture document includes historical/proposed behavior; the current phase-4 checkpoint explicitly leaves real latency, segmented speech, multi-human/reconnect and final GPU acceptance open. These are not inherited as Veyra acceptance.

The two protected human-supplied start/active voice images were inspected with `view_image` only. Their source bytes were not copied or edited. Reference hashes: start `0a50e554525c0dbf189e1f7b7cf8fc6780314b8af440433e146767729b60eef5`, active `d3287e0f6af9bdbec1bded4255a214a1ea8f446e2aa5bf324b33c1d5c5a810bd`. New controls use Veyra branding; no account/project/model text is copied from the images.
