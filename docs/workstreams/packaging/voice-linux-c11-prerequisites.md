# Voice qualification C11 prerequisite discovery

Read-only discovery on2026-10-30, requested by Root while it owns Native/Core/Voice integration. No compiler, container, service or qualification owner was started. No image/package was pulled or installed; no runtime/dependency/image archive was copied/exported. Existing stopped/unrelated containers and images were untouched. This receipt is documentation only, not compiler/runtime qualification or permission to launch anything.

## Native WSL result

Ubuntu26.04 LTS, x86_64, kernel6.6.87.2-microsoft-standard-WSL2; resident glibc2.43. GNU binutils2.46-3ubuntu2 is installed, including /usr/bin/as -> x86_64-linux-gnu-as, /usr/bin/ld -> x86_64-linux-gnu-ld.bfd and /usr/bin/readelf -> x86_64-linux-gnu-readelf.

No GCC/cc/Clang/Zig/TCC frontend was found in standard /usr/bin, /usr/local/bin or known /home/brajam/.local/bin locations; known GCC/LLVM toolchain directories and ~/.cargo/~/.rustup toolchains were absent. Installed package lookup confirms libc6-dev uninstalled. Missing actual files: /usr/include/stdio.h, sys/types.h (including the x86_64-linux-gnu variant), linux/capability.h, linux/magic.h, /usr/lib/x86_64-linux-gnu/crt1.o, crti.o and libc.so linker script. Existing libc.so.6 and /lib64/ld-linux-x86-64.so.2 are runtime components, not a compiler/sysroot. The minimal host alternative would require a real C11 frontend plus its matching libc/kernel development headers, startup objects/libgcc and linker; binutils alone is insufficient. No host-install action is authorized by this finding. This is bounded known-location/package discovery, not an assertion that every private/cache path was exhaustively scanned.

Both /sys/fs/cgroup/init.scope/memory.peak and pids.peak exist. Their presence does not establish controller/namespace/process/runtime qualification.

## Existing local image alternative selected by Root

Exact existing image ID and reported RepoDigest:
`sha256:c4d5523090a817b7aa86d2111241fdd4f66d1e27782b44160e6aa63b357ecb2d` / `node@sha256:c4d5523090a817b7aa86d2111241fdd4f66d1e27782b44160e6aa63b357ecb2d`.

Docker metadata reports linux/amd64 and410542869 bytes. Its recorded build history identifies Debian bookworm/buildpack-deps, explicitly installs gcc,g++,libc6-dev and make, and records Node22.23.3. This supports an already-local native Linux toolchain/sysroot candidate with no download. It does **not** establish the exact GCC executable/version, header contents or successful linking. No existing container was identified as an already qualified Veyra compiler environment. Root selected this exact local image with --pull=never as preferred if actual preflight succeeds.

Original local transport is `/usr/bin/docker -H unix:///var/run/docker.sock` (socket realpath /run/docker.sock). CLI is a native ELF64 x86-64 executable,45357024 bytes, SHA256018f1a3d2dacf73614077ded6d05d2b9954630627a3722f1f19e46f5c973cec6. Actual daemon ID31ae6ed1-962c-4705-940f-3784a94a6797, linux/x86_64, Docker29.6.2, existing /var/lib/docker; manager source uses this same socket with API/v1.45. No remote context, new Docker owner or alternate token/client is needed. Discovery used only local ps/image inspect/history/info metadata, not container create/start/exec/cp/export/save.

## Root-owned preflight and narrow recipe

Exact original C source is `docs/workstreams/voice/cpu-qualification/kernel-owner.c`,17752 bytes, SHA256a62dd094615c506846cbfcf93ed11125c91ad0754c32faa5a801c2ca22927eda. Root must recheck this source before compiling. It uses C11 + its own _GNU_SOURCE, libc/GNU headers and linux/magic.h/capability.h; it calls SYS_pidfd_open, SYS_pidfd_send_signal, SYS_close_range and SYS_capset. No libcap library or libcap-dev header is required: capset is a direct syscall. Required executable/sysroot/linker checks, not yet run: /usr/bin/gcc --version/-dumpmachine/-print-sysroot/-print-prog-name=cc1; actual crt1.o/crti.o/crtbegin.o/libgcc paths; /usr/bin/ld identity; real required header and syscall macro availability. Root must record results, not infer GCC version solely from the base name/history.

Root alone measures complete current pairedC20GiB/15GiB reserves, registers existing PHASE/coordination/voice/cpu-qualification (QUAL), and serializes the proposed512MiB/CPU1/pids64/network-none/read-only-image build with bounded scratch and one same-root binary output. No new output root, host package or dependency/runtime copy is needed. Bind exactly the approved C source read-only; set TEMP/TMP/TMPDIR under QUAL's declared scratch (including any explicitly approved bounded tmpfs there), and choose an output UID that can write its registered mount. UID0 with cap-dropALL cannot bypass a UID1000 mode0700 directory; the privilege needed to run the final owner is distinct from compiling it.

After successful Root preflight, the exact compiler argv corresponding to Voice7's recipe is:

```js
// Reviewable argv only; NOT executed by packaging.
const args = [
  '-std=c11', '-O2', '-Wall', '-Wextra', '-pipe',
  '-DVEYRA_QUALIFICATION_ROOT=' + JSON.stringify(QUAL + '/'),
  '/qualification-src/kernel-owner.c', '-o', QUAL + '/bin/kernel-owner'
];
```

Invoke actual qualified /usr/bin/gcc in the pinned local image under Root's retained bounded owner. QUAL is the exact registered absolute Linux prefix, and the C string MUST end with `/` as Voice7's README specifies. Pass arguments directly; do not shell-interpolate source/user text. Use --pull=never and the exact image ID, no image build, package operation or mutable-tag fallback. Keep both compiler scratch and binary inside the same declared scope. The recipe is a dynamic libc link unless Root separately chooses and verifies static archives; never silently switch link strategy after failure.

Before privileged owner execution, Root must inspect the actual output's ELF64/EM_X86_64 identity, interpreter, NEEDED libraries and required GLIBC symbol versions against the resident host (or inspect an explicitly selected/qualified static build), then exact path/source/binary hash and ownership/mode. Matching architecture, newer resident glibc and kernel syscall metadata are prerequisites, not execution evidence. Root retains launch/actual wait/first-failure/cleanup custody of only its own builder, compile scratch and exact binary. Existing protected Native/caches/model/rollback/unrelated container state is unaffected.

## Reconciliation

Only this small durable receipt and the existing single packaging status were written. No scratch, build directory, binary, cache, dependency tree, downloaded/exported image or container was created. Removed paths none; removed bytes0; no Windows/Linux recovery claimed. Retained consumer: Root's imminent registered compiler preflight/build and exact owner qualification. Regeneration is the same read-only fixed-path/package and original local Docker metadata queries, not a build. All original Voice/runtime/native/platform/18case/image-approval/full-release gates remain Root-owned and open.
