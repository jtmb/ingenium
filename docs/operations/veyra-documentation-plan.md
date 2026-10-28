# Veyra documentation deliverables

Documentation is part of every phase's completion gate, not a final cleanup task. Use the [computer-use README](https://github.com/jtmb/computer-use/blob/b47765e4a9f5c124c4716deb52962e17d7fb4a2a/README.md) as the example for concise purpose, setup, focused links, verification and rollback. Use Veyra's actual commands and platform semantics; do not copy workstation paths, model defaults, credentials or unverified claims.

## README target

Blue computer-use mascot and Veyra identity; concise product description; separate Windows/Linux status; verified download/image links and compatibility. Quickstart Windows, Docker and cluster operator link; brief feature tour tied to approved screenshots; brain integration/repository boundary; provider connection and model selection; configuration/state paths and safety; setup verification; restart/upgrade/rollback; troubleshooting; architecture/repository map; development/contributing; licences/attribution. Link deeper guides instead of an enormous command dump. Keep platform-specific prerequisites visible.

Fix current documentation drift: current README's dashboard-view/tool counters are historical and cannot be updated by guessing. Generate or verify counts from current registries. Separate released preview capabilities from development-only source work and unaccepted gates.

## Per-phase checklist

| Phase | Required documentation |
|---|---|
| 1: both MVP builds | README entry/status, Windows/Docker quickstarts, platform/backend selection, WSL attach/reconnect, visual tour/contract, external brain pin/install/discovery/rollback, MVP limitations and exact tested artefacts |
| 2: feature workflows | Every feature/settings/auth help page, real provider/mail/vault setup, skill synthesis lifecycle, permissions and specific recovery guidance; route/control evidence matrix |
| 3: Rust foundation | Architecture decision, API/DTO/data/crypto contracts, single migration authority, compatible startup and operator rollback |
| 4: workspace/intelligence | Domain API/schema changes, import/export/checkpoints, memory and skill storage, migrated/not-migrated status |
| 5: operations/integrations | Mail/OAuth, scheduler/timezone, Vault, MCP, backups/isolated restore, status/log/usage provenance and dependency capabilities |
| 6: packages/platform parity | Windows installer/portable/signing/update, Linux image lifecycle, upstream attribution and scoped capability matrix; explain intentional platform differences |
| 7: release | Current installation/upgrade/recovery guides, release notes, tested versions/digests, visual and functional evidence index, known limitations and final feature inventory |

Every phase verifies affected links, code examples and names against that phase's actual build. Record whether commands were run or are instructions only. Keep user-facing documentation free of private host paths, credentials, raw email or sensitive logs. Preserve existing docs history and write concise current entries; do not duplicate cumulative predecessor ledgers.
