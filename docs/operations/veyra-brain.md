# External computer-use brain

Veyra consumes the separate [computer-use repository](https://github.com/jtmb/computer-use/tree/b47765e4a9f5c124c4716deb52962e17d7fb4a2a) at a reviewed immutable revision. Development stays in Veyra. The dependency supplies 23 complete skill bundles, including their reference trees, and supporting launchers. Its global configuration, credentials, workstation paths and model defaults are excluded.

## Prepare and verify

From the application source, using Python 3.10 or later:

```sh
python3 -B scripts/prepare-computer-use.py \
  --lock config/computer-use.lock.json --output /chosen/new/dependency-directory
```

For a previously fetched source checkout, add `--source /chosen/computer-use-checkout`. Every installed file is checked against the pinned Git blob and size. An altered reference, incomplete skill catalog or existing output directory fails before installation. The source checkout is never patched. The image packages the result at `/usr/local/share/veyra/computer-use`.

Veyra's managed OpenCode configuration retains its own skills and loads the portable `veyra.computer-use` consumer plugin. The consumer registers all 23 external skills with `computer-use:` IDs and names, preserving the original files, bodies and reference trees. This prevents collisions with Veyra's own `development-conventions` and `skill-maintenance`. It verifies the entire pinned file closure before registering any skill and refuses a conflicting namespaced owner. The pinned `@opencode/schema` 2.0.11 defines `skills` as an array of strings; validate configuration against that installed schema, rather than another OpenCode version's `skills.paths` format. Windows and WSL consumers must use their actual dependency paths. Do not apply the dependency's global deployment/onboarding scripts to a Veyra installation.

## Runtime acceptance

Restart the parent OpenCode process after configuration changes. Verify discovery of all expected external skills, then load a safe representative skill in a fresh session and record its actual tool result. Repeat on native Windows, selected WSL and the cluster image. A package manifest, health endpoint or source test does not prove loading.

Keep the existing Goal integration once, outside ordinary Chat. Retain the protected broker and existing model/profile credentials. Skill discovery does not install browser/GitHub tools, grant credentials or qualify their capabilities. Some pinned setup/reference instructions describe older bootstrap/browser paths; check the actual pinned launchers and Veyra's platform adapters before following them.

Current status: package closure, collision preservation and modified-reference/symlink rejection checks pass. A fresh WSL OpenCode 2.0.11 process discovered all 23 namespaced skills alongside all eight Veyra skills and activated the exact pinned development-conventions body with resume disabled and no inference. A fresh native Windows 2.0.11 process also passed discovery/coexistence and exact-body activation using an isolated persistent NTFS SQLite profile. On Windows, directory paths for the built-in skill scanner use forward slashes; the verified Y: alias resolves to the same source file identities. The actual Windows portable launcher also passed discovery/coexistence and exact-body activation, then passed again after restarting against the same isolated persistent profile. Both runs disabled resume, made no provider/inference request and stopped their owned CLI and launcher processes. The controlled profile was removed after its last consumer; source, hashes, runtime exports and exact cleanup receipts remain. The deployed immutable Linux MVP image also passed fresh discovery/coexistence and exact-body activation after replacement, with one active Goal integration and the protected broker. See [current MVP evidence](veyra-mvp.md) for its source and digest.

## Rollback

Use the previously verified application image/package and its managed configuration. Preserve installation data, credentials, user skills and Goal state. A dependency pin update is a reviewed Veyra change; never update a moving branch in place. Remove an obsolete materialized dependency only after no process/package still consumes it and its exact source, lock and regeneration command survive.

## Protected deployment configuration

The immutable managed OpenCode config includes the existing Veyra skills directory and the pinned computer-use consumer plugin. Its exact SHA-256 is `d769cbee281433d0a127bb47ebca4e1843e4423015218274bb025bb8891e137d`; `LLM_BROKER_CONFIG_SHA256` in `packages/ingenium-core/lib/tools/agents.ts` pins those approved bytes. Intentional managed-config changes must update this reviewed pin. Never calculate a replacement expected hash from the runtime file itself or weaken descriptor, owner, no-follow, read-only or identity checks.

The first full Phase 1 image build correctly refused a stale config pin. The broker definition, wildcard-deny permissions, enforcer and MCP scope were unchanged by the brain integration. After aligning the pin, all 45 existing core agent/broker checks passed, including malformed/missing artifacts, writable or runtime-owned trust roots, canonical broker mutation denials and raw SQLite bypass attempts. The immutable rebuilt image passed its actual protected-deployment check, root entrypoint, complete LAN guard and representative runtime skill load. These checks preserve broker ownership and do not qualify every external capability.
