# External computer-use brain

Veyra consumes the separate [computer-use repository](https://github.com/jtmb/computer-use/tree/b47765e4a9f5c124c4716deb52962e17d7fb4a2a) at a reviewed immutable revision. Development stays in Veyra. The dependency supplies 23 complete skill bundles, including their reference trees, and supporting launchers. Its global configuration, credentials, workstation paths and model defaults are excluded.

## Prepare and verify

From the application source, using Python 3.10 or later:

```sh
python3 -B scripts/prepare-computer-use.py \
  --lock config/computer-use.lock.json --output /chosen/new/dependency-directory
```

For a previously fetched source checkout, add `--source /chosen/computer-use-checkout`. Every installed file is checked against the pinned Git blob and size. An altered reference, incomplete skill catalog or existing output directory fails before installation. The source checkout is never patched. The image packages the result at `/usr/local/share/veyra/computer-use`.

Veyra's managed OpenCode configuration includes the external `.opencode/skills` path alongside its own skills. The pinned `@opencode/schema` 2.0.11 defines `skills` as an array of strings; validate configuration against that installed schema, rather than another OpenCode version's `skills.paths` format. Windows and WSL consumers must use their actual dependency paths. Do not apply the dependency's global deployment/onboarding scripts to a Veyra installation.

## Runtime acceptance

Restart the parent OpenCode process after configuration changes. Verify discovery of all expected external skills, then load a safe representative skill in a fresh session and record its actual tool result. Repeat on native Windows, selected WSL and the cluster image. A package manifest, health endpoint or source test does not prove loading.

Keep the existing Goal integration once, outside ordinary Chat. Retain the protected broker and existing model/profile credentials. Skill discovery does not install browser/GitHub tools, grant credentials or qualify their capabilities. Some pinned setup/reference instructions describe older bootstrap/browser paths; check the actual pinned launchers and Veyra's platform adapters before following them.

Current status: package closure and rejection checks pass; fresh runtime discovery/loading remains pending in both editions.

## Rollback

Use the previously verified application image/package and its managed configuration. Preserve installation data, credentials, user skills and Goal state. A dependency pin update is a reviewed Veyra change; never update a moving branch in place. Remove an obsolete materialized dependency only after no process/package still consumes it and its exact source, lock and regeneration command survive.
