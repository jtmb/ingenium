# Private release-trust and native owner contract

Field/interface contract only. Root owns the installation writer, shared schema,
approved artifact values and actual constructors. No positive factory, wire
implementation, signing assertion or usable child grant is supplied here.

Owner/output: Work UI worker; this one small document stays under the existing
/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845 root on the
C-backed Ubuntu VHDX. Consumer: Root installation/startup/broker integration.
Retain as minimal source contract through review. No build/dependency/DDL/runtime/
CU/shared edits, scratch/cache or bulk. Removed paths none; removed bytes0.
Earlier checkpoints remain frozen; no disk recovery or full-release claim.

## Independent trust input

`LocalReleaseTrustRecord` is data read from the release owner's private fixed
installation slot. It becomes input to verification, never authority by parsing.
The locator comes from the original installation/library provider, not a request,
renderer path, candidate picker, working directory or silent fallback search.
The actual trust file is retained before reading; bound the record before decode.

The expected values below come from Root's independently reviewed exact built
artifact/release receipt. Reading the candidate manifest and copying its own hash
into a trust record does not establish approval. Renderer `compare_manifest`,
expected-hash DTOs and inspection reports cannot mint the record or its owner.

```rust
// Proposed field types only; Root finalizes on-disk names, epoch and bounds.
type Sha256 = [u8; 32];
type PublisherThumbprintSha1 = [u8; 20]; // existing expected-publisher API

enum PublisherPolicy {
    RequireVerifiedExpectedPublisher {
        expected: PublisherThumbprintSha1,
    },
    LocallyReviewedExactBuild {
        reviewed_release_receipt_sha256: Sha256,
    },
}

struct LocalReleaseTrustRecord {
    schema_epoch: u32,
    installation_id: InstallationId,
    expected_manifest_sha256: Sha256,
    source_identity: BoundedSourceIdentity,
    build_identity: BoundedBuildIdentity,
    target: ApprovedWindowsTarget,
    desktop_executable_sha256: Sha256,
    service_executable_sha256: Sha256,
    lineage: SelectedRollbackLineage,
    publisher_policy: PublisherPolicy,
}

struct SelectedRollbackLineage {
    selected_manifest_sha256: Sha256,
    selected_release_receipt_sha256: Sha256,
    selection_generation: u64,
    rollback_manifest_sha256: Option<Sha256>,
    rollback_release_receipt_sha256: Option<Sha256>,
}
```

The paired optional rollback fields must be both present or both absent. The
selected manifest must equal `expected_manifest_sha256`. Source/build/target
must match both exact role artifacts and the reviewed release receipt. Root
must set finite canonical source/build encodings; no unbounded JSON Value, opaque
free-form report or display label is accepted as identity. Role locations are
derived from the selected protected manifest and fixed package roles, never a
caller-supplied executable. No root path, credential or executable bytes are
added to public status/renderer output.

Publisher policy is an expectation, not a signature result. The publisher branch
requires the real verifier's result on each retained role executable against the
independent expected certificate. Local exact-build review approves only those
exact bytes/source/lineage; it does not say signed, trusted publisher, or verified
signature. Candidate manifest signing claims are not evidence for either branch.

## Privately minted package owner

```rust
// All fields private. No Deserialize/Default/Clone of owning handles and no
// constructor from this record, JSON, a hash/boolean, path or inspection DTO.
struct ApprovedPackagePair {
    installation: OriginalInstallation,
    trust_file: RetainedTrustFileOriginal,
    trust_record_digest: Sha256,
    manifest_file: RetainedManifestOriginal,
    desktop_file: RetainedRoleExecutableOriginal,
    service_file: RetainedRoleExecutableOriginal,
    expected: LocalReleaseTrustRecord, // validated data; not authority by itself
    checked_publisher: PublisherDispositionOriginal,
}
```

Each file original is the actual retained handle, volume/file ID, length and
exact bytes hash under the protected package read/ancestor policy. Only the
original startup/release owner may mint the pair after comparison to independent
trust values and publisher disposition; no timestamp/path/inspection shortcut.
Keep the same trust/manifest/both role objects through live enrollment. Updates
use original selection/retirement. Broker/renderer requests never write approval.

## Approved Windows process and window originals

```rust
struct ApprovedPeerProcessOriginal {
    accepted_control_io: OriginalControlConnectionIdentity,
    actual_process: RetainedQuerySynchronizeProcessHandle,
    observed_creation_filetime: u64,
    observed_image: RetainedProcessImageObservation,
    approved_pair: Shared<ApprovedPackagePair>,
    role: DesktopOrService,
    service_instance: OriginalServiceInstance,
}

struct ApprovedWindowOriginal {
    approved_desktop: Shared<ApprovedPeerProcessOriginal>,
    actual_native_window: RetainedRustConstructedWindow,
    actual_bundled_webview: RetainedRustConstructedWebview,
    native_window_uid: WindowCreationUid,
    actual_selection: OriginalWorkSelection,
    service_scope: OriginalWindowScopeBinding,
    control_io: Shared<OriginalControlConnectionIdentity>,
    revocation: OriginalRevocationState,
}
```

Use kernel pipe peer PID only to capture the actual process HANDLE/birth/image
against the same pair and service instance. Later checks use that same retained
object, never a reopened reported PID. Path or inspection-hash equality alone is
insufficient. Service approves Desktop role; Desktop approves service role.
Query/synchronize handles grant no stop/CPU-control rights; copied frames mint none.

The trusted Rust/Tauri constructor supplies window/webview/UID. Renderer selection
is intent; the approved control connection obtains actual binding/session/runtime
from the original writer. Destruction, selection change, exit or disconnect fences
the same source. Label/HWND/Origin/DTO/cached true never mints it. New effects
require fresh real selected scope; uncertain/lost view observations remain fenced.

## Broker control I/O ownership

```rust
struct ControlIoOriginal {
    endpoint: ActualCreatedOrAcceptedPrivatePipe,
    kernel_peer: OriginalKernelPeerCapture,
    approved_process: Shared<ApprovedPeerProcessOriginal>,
    instance: OriginalServiceInstance,
    connection_identity: OriginalControlConnectionIdentity,
    incoming: RetainedFrameReadOriginal,
    outgoing: RetainedFrameWriteOriginal,
    reader_join: RetainedActualWorkerJoin,
    writer_join: RetainedActualWorkerJoin,
    close: CheckedNativePipeCloseOriginal,
    failures: OriginalFailureInventory,
}
```

Registry custody precedes create/accept/connect/read/write/publication. Frames
retain pre-reserved bounded bytes, exact partial prefix, OVERLAPPED/event/buffer
state and actual operation result. Root fixes cap/codec; no unbounded Vec/Value or
token logs. Child credentials travel only on this approved peer channel, never
an ordinary bearer factory/fallback.

Pending I/O keeps actual buffers/events/pipe until observed completion. Deadline,
EOF, signal, absent handle, Drop, receipt or phase enum is no join/close witness.
Retain actual joins and latch consumed failure before taking originals. Checked
close waits for I/O ownership to end; no retry through Drop/another wrapper and
no manual close of a borrowed Tokio handle.

Disconnect/reselection revokes effects, not child/listener/request/engine/agent/
goal retirement. Auth detach, child removal, HTTP/control joins and checked closes
remain separate ordered witnesses. Preserve profiles/drafts/history/unknowns.

## Availability and acceptance boundary

Missing/old trust or old discovered service without this broker returns
`WebProtocolUpgradeRequired`; normal features continue. An invalid/mismatched
trust record is a distinct static Web trust refusal, never inferred approval,
auto-write, service replacement, migration or disabled trust checking. Discovery
uses the same retained registration/process/library instance. The final package
must qualify the new Windows service and Desktop together under the real trust
writer, peer channel, child/window/auth and unchanged upstream Web route closure.

Windows Desktop is the actual native acceptance target. Linux native broker
remains unavailable without a genuine platform owner. Nothing in this contract
adds a native Linux Desktop/broker requirement to Linux Docker acceptance, changes
headless/ordinary APIs or authorizes a network/bearer substitute for OS peer proof.
Earlier exploratory Linux leaf source stays frozen and is not an activated
platform owner or acceptance expansion.

Threat model: isolate browsers and arbitrary untrusted/native-bearer clients from
the approved Desktop constructor. No claim against malicious fully privileged
same-OS-user/root, code injection or a compromised OS. Full release, ordinary20MiB,
64MiB resident payload, framework overhead and actual Windows runtime/visual
acceptance remain open; this typed document closes none of those gates.

## Exact outstanding Root inputs

1. The fixed trust-slot provider/location under the original installation owner,
   read guard and installation/library binding.
2. Final schema epoch, canonical bounded source/build/target/lineage encodings and
   the independent reviewed release receipt plus expected artifact hashes.
3. Chosen publisher policy and its independent expected publisher or exact local
   review receipt; actual file/signature verification and sealed pair constructor.
4. Actual retained process-image/window-selection constructors and Windows private
   pipe I/O/OVERLAPPED/join/checked-close owners needed by the above declarations.

Root owns those values and implementations. No approval or identity is fabricated
to fill them, and no shared schema/wire/source/dependency changes occur here.
