# Current dashboard generated standalone proposal — r1

Owner: packaging worker chat8 (01a18935-1a8b-7eb3-a709-d874f70095e8).
Root alone owns admission, artifact assembly, runtime, cleanup and canonical writes.
This packet is source only, not executed, tested or release acceptance.

## Declared storage and scope

Reuse /home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845
on the existing authorized C-backed WSL volume. Worker writes only these three
small documents/helper files and its existing coordination/packaging/status.json.
No build, dependency tree, cache, scratch root or download is created. Regeneration:
retain this commit; re-materialize only these source files from git. All source,
lockfiles, models, runtime data, golden132, original failures and prior refused
cleanup targets remain protected. This packet does not authorize their deletion.

## Observed current topology

APP = existing real-gmail-ui/prd-ui-fixes under that root.
BUILD = APP/services/ingenium-dashboard/tests/artifacts/current-dashboard-build-view-r1/services/ingenium-dashboard.
TREE = BUILD/.next/standalone.
REL = services/ingenium-dashboard/tests/artifacts/current-dashboard-build-view-r1/services/ingenium-dashboard.
Actual generated entry = TREE/REL/server.js, 8,420 bytes, SHA256
4f26e523194013488284f5f0b6d3d0a69016650876bf78733938098a91b3e761.
The generated entry uses ESM imports for Node builtins, creates a native require,
changes cwd to its own directory, and requires next and next/dist/server/lib/start-server.
Preserve its neighboring package.json with type=module and the WHOLE ancestor
node_modules topology. Do not flatten or rewrite the server, change config, rebuild,
symlink dependencies or fall back to APP/node_modules.

BUILD/.next/required-server-files.json records version=1, output=standalone,
appDir=BUILD, relativeAppDir=REL, outputFileTracingRoot=APP, 18 required files.
Top-level next-server.js.nft.json has 1,183 members; next-minimal-server trace has
141. Route/middleware traces under .next/server also matter; these counts alone
are not closure evidence. BUILD/public and BUILD/.next/static exist. Neither is
currently present at TREE/REL/public or TREE/REL/.next/static.

Canonical services/ingenium-dashboard/next.config.js SHA256:
1ac950fb1a230de220445da855cddfb5f821d07f873d39c71401a24530449056.
It selects output=standalone without an explicit tracing-root override.
Dockerfile SHA256 f2066463924b032301cc6fc90159b2df376f4fd416780681187210d196f8ec99:
lines 165–167 copy the whole standalone tree, then assets to the SHALLOW normal
/app/services/ingenium-dashboard location. That asset assumption is suitable only
when the generated relativeAppDir is services/ingenium-dashboard; it does not fit
this build-view artifact. This proposal does not modify the Dockerfile or certify
its final image. Other git grep matches were not treated as authoritative packagers.

## Root assembly and qualification, in order

1. Revalidate current source/config/server hashes and the existing build-r2 and
   production-http-runtime-r1 receipts. Prior next start HTTP10 passing is evidence
   for the production build, not this standalone launch. No new build is proposed.
2. Root checks live handles/processes, consumers, mounts, Git ownership and physical
   space for the exact artifact and assets. Measure Windows C and destination;
   preserve >=15 GiB free and the existing WSL 20 GiB total ceiling, allowing the
   complete peak including runtime files. If this fails, reconcile OTHER eligible
   outputs; never retry a protected deletion or migrate to another root/drive.
3. Prefer an atomic SAME-filesystem MOVE of the one TREE into a Root-selected
   deployment location inside PHASE, outside APP and any ancestor with host app
   node_modules. Do not duplicate TREE or copy/link dependencies. Retain original
   metadata/trace inputs for audit until reconciled. Source paths in generated
   metadata do not authorize fallback resolution. A different mount/device or
   existing destination is a blocker requiring Root review; do not emulate rename
   with copy-then-delete. Moving TREE does not move the rest of BUILD.
4. Preserve REL exactly. Assemble BUILD/public at DEPLOY/REL/public and
   BUILD/.next/static at DEPLOY/REL/.next/static. These required asset bytes are
   deployable runtime consumers, not dependency snapshots. Budget any temporary
   asset duplicate explicitly. Keep source assets through byte comparison and
   close their build-view consumers before cleanup; a future move-only asset
   approach needs a retained pre-move inventory and a reviewed helper adaptation.
5. Root may import inspectStandalone from the adjacent proposal and call it with
   buildDir=BUILD, standaloneDir=DEPLOY. It performs read-only, fail-closed trace,
   required-file and asset byte checks, link containment, and native createRequire
   resolution of the actual server's next/start-server imports. No module
   evaluation, subprocess, listener, test or writing occurs in this helper.
   It is NOT yet executed or syntax/test qualified. Any absent NFT member,
   deliberate framework transform, external/dangling link or metadata mismatch
   is a review blocker, not permission to weaken the check or copy host modules.
6. Root runs the genuine generated entry with ordinary Node, a fresh environment
   without NODE_PATH/NODE_OPTIONS/preloads/loaders, cwd=DEPLOY, loopback HOSTNAME,
   an admitted unused port, and the same approved runtime inputs. Absolute entry:
   DEPLOY/REL/server.js. No next start, build view launch, custom alias or substituted
   server. Observe actual loaded module paths where possible; all nonbuiltin
   runtime dependencies must reside in DEPLOY. The helper's three resolver checks
   alone do not prove every dynamic import, filesystem read or native binary.
7. Repeat the ten current production HTTP controls against this listener, checking
   actual successful page/content response, a concrete emitted /_next/static asset
   and a public asset selected from actual manifests. Exercise image optimization
   if required by the product and reject missing native optional dependencies.
   Preserve status/body/asset hashes, source stability and exact entry/runtime
   identity in Root's bounded receipt. Stop only Root's own listener afterward.
   Browser, workflow, desktop, Docker/image and cluster acceptance remain separate
   existing gates; no static audit or HTTP fixture closes them.

## Last consumers and cleanup

The sole moved deployable tree and assembled assets remain only for Root's actual
standalone runtime/packaging consumer. End condition: that consumer has an accepted
receipt and any REQUIRED release derivative is reproducible from original source,
locks, exact Next 16.4.2 environment/build receipt and the REL-aware assembly recipe.
Root may then retire inactive reproducible qualification artifacts after exact
ownership, no active handles/process/container/mount references, surviving source,
locks/unique failure evidence and known regeneration checks. Retain minimal hashes,
trace metadata/recipe and unique failures, not full build copies as vague evidence.
Do not remove BUILD or its dependencies until their other Root consumers are closed.
No worker deletion performed; generated worker outputs are only this durable packet.
Report exact removed paths/measured bytes and every retained exception, separately
from Windows free-space changes; no implied VHDX recovery or shutdown permission.