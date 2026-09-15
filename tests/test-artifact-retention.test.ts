import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ARTIFACT_RETENTION_PLAN_TTL_MS,
  executeArtifactRetention,
  previewArtifactRetention,
  reportArtifactRetention,
  verifyArtifactRetention,
} from "./test-artifact-retention";
import {
  acquireTestRunArtifactWriterLock,
  getTestRunRetentionControlRoot,
  getTestRunRetentionLockPath,
  inspectTestRunArtifactLock,
  releaseTestRunArtifactLock,
  TEST_RUN_RETENTION_PLAN_DIRECTORY,
  TEST_RUN_RETENTION_QUARANTINE_DIRECTORY,
  TEST_RUN_RETENTION_RECEIPT_DIRECTORY,
  TEST_RUN_RETENTION_REPORT_DIRECTORY,
  type TestRunArtifactLockToken,
} from "./test-run-retention-lock";
import * as retentionLockModule from "./test-run-retention-lock";
import { inspectProcessIdentity } from "./test-run-process-discovery";
import type { TestRunProcess, TestRunTelemetry } from "./test-run-context";
import { auditSuiteContainment, strictFailures } from "./suite-containment-audit";

const roots: string[] = [];
const children: ChildProcess[] = [];
const NOW = new Date();
const OLD = new Date(NOW.getTime() - 45 * 24 * 60 * 60 * 1_000);

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRepository(): { repoRoot: string; artifactRoot: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), "ingenium-retention-test-"));
  roots.push(repoRoot);
  writeFileSync(join(repoRoot, "package.json"), "{}\n");
  execFileSync("git", ["init", "--quiet", repoRoot]);
  const artifactRoot = join(repoRoot, "tests", "artifacts", "test-runs");
  mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  return { repoRoot, artifactRoot };
}

function telemetryFor(repoRoot: string, runId: string, overrides: Partial<TestRunTelemetry> = {}): TestRunTelemetry {
  return {
    version: 1,
    runId,
    runNonce: randomUUID(),
    repoRoot,
    manifestPath: join(repoRoot, ".tmp", `ingenium-playwright-run-${runId}`, "run-manifest.json"),
    status: "complete",
    updatedAt: OLD.toISOString(),
    ports: { api: 61001, dashboard: 61002, fixture: 61003 },
    activeProcesses: [],
    processes: [],
    failures: [],
    resolution: { status: "resolved", resolvedAt: OLD.toISOString(), method: "explicit-recovery" },
    ...overrides,
  };
}

function writeCandidate(
  repoRoot: string,
  artifactRoot: string,
  overrides: Partial<TestRunTelemetry> = {},
): { runId: string; runDir: string; telemetryPath: string; telemetry: TestRunTelemetry } {
  const runId = overrides.runId ?? randomUUID();
  const runDir = join(artifactRoot, runId);
  const telemetryPath = join(runDir, "runner-telemetry.json");
  mkdirSync(runDir, { mode: 0o700 });
  const telemetry = telemetryFor(repoRoot, runId, overrides);
  writeFileSync(telemetryPath, `${JSON.stringify(telemetry, null, 2)}\n`, { mode: 0o600 });
  utimesSync(telemetryPath, OLD, OLD);
  utimesSync(runDir, OLD, OLD);
  return { runId, runDir, telemetryPath, telemetry };
}

const closedPorts = async () => false;

describe("ownership-verified telemetry retention", () => {
  it("previews read-only content-free eligibility and classifies manual evidence", async () => {
    const { repoRoot, artifactRoot } = temporaryRepository();
    const eligible = writeCandidate(repoRoot, artifactRoot);
    const failure = writeCandidate(repoRoot, artifactRoot, { failures: ["SECRET command payload name"] });
    const unresolved = writeCandidate(repoRoot, artifactRoot, { resolution: undefined });
    const recent = writeCandidate(repoRoot, artifactRoot, { updatedAt: NOW.toISOString() });
    utimesSync(recent.telemetryPath, NOW, NOW);
    utimesSync(recent.runDir, NOW, NOW);
    const auxiliary = writeCandidate(repoRoot, artifactRoot);
    writeFileSync(join(auxiliary.runDir, "trace.zip"), "manual evidence");
    mkdirSync(join(artifactRoot, "legacy-manual"));
    const controlRoot = getTestRunRetentionControlRoot(artifactRoot);

    const plan = await previewArtifactRetention({ repoRoot, now: NOW, portProbe: closedPorts });

    expect(plan.eligible.map(({ runId }) => runId), JSON.stringify(plan.excludedRuns.find(({ runId }) => runId === eligible.runId)))
      .toEqual([eligible.runId]);
    expect(plan.excludedRuns.find(({ runId }) => runId === failure.runId)?.codes).toContain("FAILURE_EVIDENCE");
    expect(plan.excludedRuns.find(({ runId }) => runId === unresolved.runId)?.codes).toContain("RESOLUTION_UNRESOLVED");
    expect(plan.excludedRuns.find(({ runId }) => runId === recent.runId)?.codes).toContain("TOO_RECENT");
    expect(plan.excludedRuns.find(({ runId }) => runId === auxiliary.runId)?.codes).toContain("AUXILIARY_EVIDENCE");
    expect(plan.reasonCounts.NON_CANONICAL_ROOT).toBe(1);
    expect(JSON.stringify(plan)).not.toContain("SECRET command payload name");
    expect(plan.eligible[0]?.inventory).toEqual([
      expect.objectContaining({ name: "runner-telemetry.json", links: 1, sha256: plan.eligible[0]?.telemetrySha256 }),
    ]);
    expect(existsSync(controlRoot)).toBe(false);
  });

  it("rejects unsafe path, link, mode, manifest, selected run, live identity, and open port evidence", async () => {
    const { repoRoot, artifactRoot } = temporaryRepository();
    const hardlinked = writeCandidate(repoRoot, artifactRoot);
    linkSync(hardlinked.telemetryPath, join(repoRoot, "telemetry-hardlink.json"));
    const wrongMode = writeCandidate(repoRoot, artifactRoot);
    chmodSync(wrongMode.telemetryPath, 0o644);
    const manifested = writeCandidate(repoRoot, artifactRoot);
    mkdirSync(dirname(manifested.telemetry.manifestPath), { recursive: true });
    writeFileSync(manifested.telemetry.manifestPath, "malformed manifest\n");
    const selected = writeCandidate(repoRoot, artifactRoot);
    const linkedRunId = randomUUID();
    const outside = join(repoRoot, "outside-evidence");
    mkdirSync(outside);
    symlinkSync(outside, join(artifactRoot, linkedRunId));

    const live = writeCandidate(repoRoot, artifactRoot);
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: repoRoot,
      env: { PATH: process.env.PATH ?? "", INGENIUM_TEST_RUN_NONCE: live.telemetry.runNonce },
      detached: true,
      stdio: "ignore",
    });
    children.push(child);
    if (!child.pid) throw new Error("live identity child has no PID");
    let identity = inspectProcessIdentity(child.pid);
    for (let attempt = 0; !identity && attempt < 40; attempt += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
      identity = inspectProcessIdentity(child.pid);
    }
    if (!identity) throw new Error("live identity was not observable");
    const record: TestRunProcess = {
      name: "build", pid: child.pid, port: 0, startedAt: OLD.toISOString(),
      runNonce: live.telemetry.runNonce, ...identity,
    };
    const liveTelemetry = telemetryFor(repoRoot, live.runId, {
      runNonce: live.telemetry.runNonce,
      processes: [{ record, state: "cleared", updatedAt: OLD.toISOString() }],
    });
    writeFileSync(live.telemetryPath, JSON.stringify(liveTelemetry), { mode: 0o600 });
    utimesSync(live.telemetryPath, OLD, OLD);
    utimesSync(live.runDir, OLD, OLD);

    const open = writeCandidate(repoRoot, artifactRoot, {
      ports: { api: 62001, dashboard: 62002, fixture: 62003 },
    });
    const plan = await previewArtifactRetention({
      repoRoot,
      now: NOW,
      selectedRunIds: [selected.runId],
      portProbe: async (port) => port === open.telemetry.ports.api,
    });

    const codes = (runId: string) => plan.excludedRuns.find((entry) => entry.runId === runId)?.codes ?? [];
    expect(codes(hardlinked.runId)).toContain("LINK_UNSAFE");
    expect(codes(wrongMode.runId)).toContain("MODE_UNSAFE");
    expect(codes(manifested.runId)).toContain("MANIFEST_PRESENT");
    expect(codes(selected.runId)).toContain("CURRENT_RUN");
    expect(codes(linkedRunId)).toContain("PATH_UNSAFE");
    expect(codes(live.runId)).toContain("ACTIVE_PROCESS");
    expect(codes(open.runId)).toContain("PORT_OPEN");
  });

  it("persists owner-only matching plan/report digests and enforces confirmation and expiry", async () => {
    const { repoRoot, artifactRoot } = temporaryRepository();
    const candidate = writeCandidate(repoRoot, artifactRoot);
    const reported = await reportArtifactRetention({ repoRoot, now: NOW, portProbe: closedPorts });

    expect(reported.report.planDigest).toBe(reported.plan.digest);
    expect(reported.report.eligibleRunIds).toEqual([candidate.runId]);
    expect(lstatSync(reported.planPath).mode & 0o777).toBe(0o600);
    expect(lstatSync(reported.reportPath).mode & 0o777).toBe(0o600);
    expect(reported.planPath).toBe(join(
      getTestRunRetentionControlRoot(artifactRoot), TEST_RUN_RETENTION_PLAN_DIRECTORY, `${reported.plan.planId}.json`,
    ));
    await expect(executeArtifactRetention({
      repoRoot, planPath: reported.planPath, confirmSha256: "0".repeat(64), now: NOW, portProbe: closedPorts,
    })).rejects.toThrow(/exact confirm-sha256/);
    await expect(executeArtifactRetention({
      repoRoot,
      planPath: reported.planPath,
      confirmSha256: reported.plan.digest,
      now: new Date(NOW.getTime() + ARTIFACT_RETENTION_PLAN_TTL_MS + 1),
      portProbe: closedPorts,
    })).rejects.toThrow(/expired/);
    expect(existsSync(candidate.runDir)).toBe(true);
  });

  it("revalidates mutation, honors writer locks, and steals only a stable dead lock", async () => {
    const { repoRoot, artifactRoot } = temporaryRepository();
    const mutated = writeCandidate(repoRoot, artifactRoot);
    const mutationReport = await reportArtifactRetention({ repoRoot, now: NOW, portProbe: closedPorts });
    writeFileSync(mutated.telemetryPath, `${readFileSync(mutated.telemetryPath, "utf8")} `, { mode: 0o600 });
    utimesSync(mutated.telemetryPath, OLD, OLD);
    utimesSync(mutated.runDir, OLD, OLD);
    const mutationExecution = await executeArtifactRetention({
      repoRoot, planPath: mutationReport.planPath, confirmSha256: mutationReport.plan.digest, now: NOW, portProbe: closedPorts,
    });
    expect(mutationExecution.receipt.skipped[0]?.codes).toContain("CANDIDATE_CHANGED");
    expect(existsSync(mutated.runDir)).toBe(true);

    const locked = writeCandidate(repoRoot, artifactRoot);
    const lockReport = await reportArtifactRetention({ repoRoot, now: NOW, portProbe: closedPorts });
    const writerLock = acquireTestRunArtifactWriterLock({
      artifactRoot, repoRoot, runId: locked.runId, runNonce: locked.telemetry.runNonce,
    });
    try {
      const execution = await executeArtifactRetention({
        repoRoot, planPath: lockReport.planPath, confirmSha256: lockReport.plan.digest, now: NOW, portProbe: closedPorts,
      });
      expect(execution.receipt.skipped.find(({ runId }) => runId === locked.runId)?.codes).toContain("LOCK_ACTIVE");
      expect(existsSync(locked.runDir)).toBe(true);
    } finally {
      releaseTestRunArtifactLock(writerLock);
    }

    const dead = writeCandidate(repoRoot, artifactRoot);
    const deadReport = await reportArtifactRetention({ repoRoot, now: NOW, portProbe: closedPorts });
    const modulePath = join(process.cwd(), "tests", "test-run-retention-lock.ts");
    const script = `import(${JSON.stringify(modulePath)}).then((m) => { const loaded = m.default ?? m; loaded.acquireTestRunArtifactWriterLock(${JSON.stringify({
      artifactRoot, repoRoot, runId: dead.runId, runNonce: dead.telemetry.runNonce,
    })}); });`;
    const child = spawnSync(process.execPath, ["--import", "tsx", "--eval", script], {
      cwd: process.cwd(), env: { PATH: process.env.PATH ?? "" }, encoding: "utf8",
    });
    expect(child.status, `${child.stdout}${child.stderr}`).toBe(0);
    expect(inspectTestRunArtifactLock(artifactRoot, dead.runId).state).toBe("dead");
    const deadExecution = await executeArtifactRetention({
      repoRoot, planPath: deadReport.planPath, confirmSha256: deadReport.plan.digest, now: NOW, portProbe: closedPorts,
    });
    expect(deadExecution.receipt.deleted.some(({ runId }) => runId === dead.runId)).toBe(true);
    expect(existsSync(dead.runDir)).toBe(false);
  });

  it("serializes two cleaners, deletes only the exact candidate, and verifies the receipt", async () => {
    const { repoRoot, artifactRoot } = temporaryRepository();
    const candidate = writeCandidate(repoRoot, artifactRoot);
    const sibling = join(artifactRoot, "manual-evidence");
    mkdirSync(sibling);
    writeFileSync(join(sibling, "keep.txt"), "keep");
    const reported = await reportArtifactRetention({ repoRoot, now: NOW, portProbe: closedPorts });

    const [first, second] = await Promise.all([
      executeArtifactRetention({ repoRoot, planPath: reported.planPath, confirmSha256: reported.plan.digest, now: NOW, portProbe: closedPorts }),
      executeArtifactRetention({ repoRoot, planPath: reported.planPath, confirmSha256: reported.plan.digest, now: NOW, portProbe: closedPorts }),
    ]);

    expect(first.receipt.digest).toBe(second.receipt.digest);
    expect(first.receipt.deleted.map(({ runId }) => runId)).toEqual([candidate.runId]);
    expect(existsSync(candidate.runDir)).toBe(false);
    expect(readFileSync(join(sibling, "keep.txt"), "utf8")).toBe("keep");
    expect(first.receiptPath).toBe(join(
      getTestRunRetentionControlRoot(artifactRoot), TEST_RUN_RETENTION_RECEIPT_DIRECTORY, `${reported.plan.planId}.json`,
    ));
    expect(verifyArtifactRetention({ repoRoot, receiptPath: first.receiptPath })).toEqual({
      verified: true,
      deletedPathsGone: [`tests/artifacts/test-runs/${candidate.runId}`],
      recoverableQuarantines: [],
      quarantineClean: true,
    });
  });

  it("retains inode/token-bound recovery evidence after a quarantine crash", async () => {
    const { repoRoot, artifactRoot } = temporaryRepository();
    const candidate = writeCandidate(repoRoot, artifactRoot);
    const reported = await reportArtifactRetention({ repoRoot, now: NOW, portProbe: closedPorts });
    let retainedLock: TestRunArtifactLockToken | undefined;
    let quarantinePath = "";

    await expect(executeArtifactRetention({
      repoRoot,
      planPath: reported.planPath,
      confirmSha256: reported.plan.digest,
      now: NOW,
      portProbe: closedPorts,
      afterQuarantine: (input) => {
        retainedLock = input.lock;
        quarantinePath = input.quarantinePath;
        throw new Error("simulated crash after quarantine");
      },
    })).rejects.toThrow(/simulated crash/);

    expect(existsSync(candidate.runDir)).toBe(false);
    expect(existsSync(quarantinePath)).toBe(true);
    expect(lstatSync(quarantinePath).ino).toBe(reported.plan.eligible[0]?.directory.inode);
    expect(inspectTestRunArtifactLock(artifactRoot, candidate.runId)).toMatchObject({
      state: "active",
      owner: { planDigest: reported.plan.digest, token: retainedLock?.owner.token },
    });
    expect(existsSync(reported.planPath)).toBe(true);
    expect(existsSync(join(
      getTestRunRetentionControlRoot(artifactRoot), TEST_RUN_RETENTION_REPORT_DIRECTORY, `${reported.plan.planId}.json`,
    ))).toBe(true);

    releaseTestRunArtifactLock(retainedLock!);
    renameSync(quarantinePath, candidate.runDir);
    rmdirSync(join(
      getTestRunRetentionControlRoot(artifactRoot), TEST_RUN_RETENTION_QUARANTINE_DIRECTORY, reported.plan.planId,
    ));
    expect(existsSync(getTestRunRetentionLockPath(artifactRoot, candidate.runId))).toBe(false);
  });

  it("revalidates descriptor content and path identity immediately before unlink", async () => {
    const { repoRoot } = temporaryRepository();
    const artifactRoot = join(repoRoot, "tests", "artifacts", "test-runs");
    const mutated = writeCandidate(repoRoot, artifactRoot);
    const replaced = writeCandidate(repoRoot, artifactRoot);
    const reported = await reportArtifactRetention({ repoRoot, now: NOW, portProbe: closedPorts });

    const executed = await executeArtifactRetention({
      repoRoot,
      planPath: reported.planPath,
      confirmSha256: reported.plan.digest,
      now: NOW,
      portProbe: closedPorts,
      afterFinalDescriptorOpen: ({ runId, telemetryPath }) => {
        const bytes = lstatSync(telemetryPath).size;
        if (runId === mutated.runId) {
          writeFileSync(telemetryPath, Buffer.alloc(bytes, "x"), { mode: 0o600 });
          return;
        }
        if (runId === replaced.runId) {
          const replacement = `${telemetryPath}.replacement`;
          writeFileSync(replacement, Buffer.alloc(bytes, "y"), { mode: 0o600 });
          renameSync(replacement, telemetryPath);
        }
      },
    });

    expect(executed.receipt.deleted).toEqual([]);
    expect(executed.receipt.recoverable.map(({ runId }) => runId).sort())
      .toEqual([mutated.runId, replaced.runId].sort());
    expect(executed.receipt.recoverable.every(({ codes }) => codes.includes("QUARANTINE_CHANGED"))).toBe(true);
    expect(verifyArtifactRetention({ repoRoot, receiptPath: executed.receiptPath })).toMatchObject({
      verified: true,
      quarantineClean: true,
    });
  });

  it("lets containment retry only the exact validated quarantined transition", async () => {
    const { repoRoot, artifactRoot } = temporaryRepository();
    const candidate = writeCandidate(repoRoot, artifactRoot);
    const reported = await reportArtifactRetention({ repoRoot, now: NOW, portProbe: closedPorts });
    const previousRepoRoot = process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT;
    process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT = repoRoot;
    const composeOwnership = { classification: "unverified" as const, hostPorts: [], reason: "isolated retention test" };
    try {
      let auditDuringExecution: Awaited<ReturnType<typeof auditSuiteContainment>> | undefined;
      const executed = await executeArtifactRetention({
        repoRoot,
        planPath: reported.planPath,
        confirmSha256: reported.plan.digest,
        now: NOW,
        portProbe: closedPorts,
        afterQuarantine: async () => {
          auditDuringExecution = await auditSuiteContainment({
            manifestPath: "", telemetryPaths: [], includeRepositoryTelemetry: true,
            composeOwnership, portProbe: closedPorts,
          });
        },
      });
      expect(auditDuringExecution?.retentionTransitions).toContain(`active retention transition: ${candidate.runId}`);
      expect(auditDuringExecution?.retentionErrors).toEqual([]);
      expect(auditDuringExecution?.telemetryErrors).toEqual([]);
      expect(strictFailures(auditDuringExecution!)).toEqual([]);
      expect(executed.receipt.deleted.map(({ runId }) => runId)).toEqual([candidate.runId]);
    } finally {
      if (previousRepoRoot === undefined) delete process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT;
      else process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT = previousRepoRoot;
    }
  });

  it("never trusts forged, recreated, expired, or malformed retention markers", async () => {
    const { repoRoot, artifactRoot } = temporaryRepository();
    const candidate = writeCandidate(repoRoot, artifactRoot);
    const reported = await reportArtifactRetention({ repoRoot, now: NOW, portProbe: closedPorts });
    const previousRepoRoot = process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT;
    process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT = repoRoot;
    const composeOwnership = { classification: "unverified" as const, hostPorts: [], reason: "isolated retention test" };
    let retainedLock: TestRunArtifactLockToken | undefined;
    let quarantinePath = "";
    await expect(executeArtifactRetention({
      repoRoot,
      planPath: reported.planPath,
      confirmSha256: reported.plan.digest,
      now: NOW,
      portProbe: closedPorts,
      afterQuarantine: (input) => {
        retainedLock = input.lock;
        quarantinePath = input.quarantinePath;
        throw new Error("retain validated transition");
      },
    })).rejects.toThrow(/retain validated transition/);

    const ownerPath = join(getTestRunRetentionLockPath(artifactRoot, candidate.runId), "owner.json");
    const validatedOwner = readFileSync(ownerPath, "utf8");
    const audit = () => auditSuiteContainment({
      manifestPath: "", telemetryPaths: [], includeRepositoryTelemetry: true,
      composeOwnership, portProbe: closedPorts,
    });
    const malformedRunId = randomUUID();
    const malformedPath = getTestRunRetentionLockPath(artifactRoot, malformedRunId);
    try {
      expect("acquireTestRunArtifactLock" in retentionLockModule).toBe(false);

      const forged = JSON.parse(validatedOwner) as { planDigest: string };
      forged.planDigest = "a".repeat(64);
      writeFileSync(ownerPath, `${JSON.stringify(forged, null, 2)}\n`, { mode: 0o600 });
      let report = await audit();
      expect(report.retentionErrors.some((error) => error.includes("MARKER_PLAN_MISMATCH_OR_EXPIRED"))).toBe(true);
      expect(strictFailures(report).some((failure) => failure.startsWith("retention:"))).toBe(true);

      writeFileSync(ownerPath, validatedOwner, { mode: 0o600 });
      writeCandidate(repoRoot, artifactRoot, { runId: candidate.runId });
      report = await audit();
      expect(report.retentionErrors.some((error) => error.includes("MARKER_CANDIDATE_RECREATED"))).toBe(true);
      expect(strictFailures(report).some((failure) => failure.startsWith("retention:"))).toBe(true);
      rmSync(candidate.runDir, { recursive: true, force: true });

      const expired = JSON.parse(validatedOwner) as { acquiredAt: string; expiresAt: string };
      expired.acquiredAt = new Date(Date.now() - 120_000).toISOString();
      expired.expiresAt = new Date(Date.now() - 60_000).toISOString();
      writeFileSync(ownerPath, `${JSON.stringify(expired, null, 2)}\n`, { mode: 0o600 });
      report = await audit();
      expect(report.retentionErrors.some((error) => error.includes("MARKER_EXPIRED"))).toBe(true);

      writeFileSync(ownerPath, validatedOwner, { mode: 0o600 });
      mkdirSync(malformedPath, { mode: 0o700 });
      writeFileSync(join(malformedPath, "owner.json"), "{}\n", { mode: 0o600 });
      report = await audit();
      expect(report.retentionErrors.some((error) => error.includes(`retention marker invalid: ${malformedRunId}`))).toBe(true);
      expect(strictFailures(report).some((failure) => failure.startsWith("retention:"))).toBe(true);
    } finally {
      writeFileSync(ownerPath, validatedOwner, { mode: 0o600 });
      releaseTestRunArtifactLock(retainedLock!);
      renameSync(quarantinePath, candidate.runDir);
      rmdirSync(dirname(quarantinePath));
      rmSync(malformedPath, { recursive: true, force: true });
      if (previousRepoRoot === undefined) delete process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT;
      else process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT = previousRepoRoot;
    }
  });
});
