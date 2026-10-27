"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import StepUpDialog from "../../auth/StepUpDialog";
import Select from "../../Select";
import { api, type MigrationPlan, type MigrationStatus } from "../../../../lib/api";

export const CHECKS = [
  ["storage", "Full storage copied and verified", "Copy every named volume and bind mount from the actual deployment to encrypted off-host storage. Quiesce writers for the final consistent copy; the database backup alone is incomplete."],
  ["secrets", "Original keys available on PRD", "Transfer protected deployment files separately. Preserve email/auth encryption keys, backup signing key and vault passphrase. Never place these in the downloaded plan or Git."],
  ["models", "Same models and defaults verified", "Compare provider/model settings, quantizations, context sizes and config hashes. Local models and endpoints must work from PRD without substituting models."],
  ["access", "Private PRD access and OAuth prepared", "Configure HTTPS, exact allowed origins, Google redirect URI and authenticated runtime access. Keep the public-info tunnel limited to its static pages; never expose the compatibility VS Code/CLI profile."],
  ["restore", "Restore rehearsal passed on PRD", "Restore a separate copy on PRD using the same reviewed image and migration lineage. Verify both databases, attachments, skills and decryption before considering cutover."],
  ["features", "Independent PRD feature checks passed", "Test a fresh chat, Goal mode outside /chat, synthesis approval/activation, real mail send/receive, vault, jobs, docs and backups. Confirm counts and model settings match."],
  ["rollback", "Rollback and single-writer cutover prepared", "Keep the original computer and verified backups intact. Stop original mail/jobs/tunnel writers only during approved cutover. If PRD fails, fence PRD before restoring original routing and writers."],
] as const;

export function migrationRunbook(status: MigrationStatus): string {
  return ["# Ingenium PRD migration preparation", `Generated: ${new Date().toISOString()}`, `Source profile: ${status.inventory.sourceMode}`, `Target platform: ${status.plan.target.platform}`, `Target origin: ${status.plan.target.origin || "Not selected"}`, `Saved revision: ${status.plan.revision}`, "", "This file contains preparation metadata, not backup bytes or credentials. No transfer or cutover has occurred.", "", "## Required transfers", ...status.inventory.requiredTransfers.map((item) => `- ${item.label}: ${item.contents}`), "", "## Database checkpoint", status.inventory.backup ? `Backup ${status.inventory.backup.id}, created ${status.inventory.backup.createdAt}. Integrity verified at report time: ${status.inventory.backup.verified}. Fresh at report time: ${status.inventory.backup.fresh}. This signed pair is only part of the installation.` : "No completed signed database backup is available.", "", "## Operator-confirmed preparation", ...CHECKS.map(([id, label, detail]) => `- [${status.plan.confirmed.includes(id) ? "x" : " "}] ${label}: ${detail}`), "", "## Deployment sequence", "1. Inventory the actual running image digest, Compose overrides, every mount and external dependency. Pin the reviewed image; do not build from an unreviewed checkout on PRD.", "2. Prepare PRD storage, service identities, owner-only credential files and private authenticated ingress. For Kubernetes, adapt the existing production control-plane/runtime-manager isolation contract; do not publish the local compatibility services directly.", "3. Create a signed dual-database snapshot. Preserve its manifest and both components plus the original signing key. Database download in Backups is only the core component, not a complete bundle.", "4. Securely transfer full volumes and bind mounts. Take the final file-level copy with all writers quiesced; never copy a live SQLite main file without its WAL state. Do not run source and destination mail/jobs simultaneously.", "5. Start an isolated PRD rehearsal with matching persistent paths, image and models. Follow docs/operations/backup-restore.md for verified restore. The local restore executor is not an off-host migration executor.", "6. Complete each preparation check on the destination. Obtain a separate cutover approval, fence the source writers, switch authenticated routes, and verify real traffic. Preserve source data for rollback.", "7. On failure, fence destination writers first, preserve failure evidence, then restore original routing/writers. Never run docker compose down -v or delete source volumes as part of migration.", "", "Automatic off-host transfer and cutover are not implemented by these controls. Checklist confirmations are operator attestations, not automated PRD verification.", ""].join("\n");
}

export default function MigrationPanel() {
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [stepUp, setStepUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const apply = (data: MigrationStatus) => { setStatus(data); setPlan(data.plan); };
  useEffect(() => {
    let cancelled = false;
    api.migration.get().then(({ data }) => { if (!cancelled) apply(data); }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Migration preparation could not load"); });
    return () => { cancelled = true; };
  }, []);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(""); setMessage("");
    try { await operation(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Migration preparation failed"); } finally { setBusy(false); }
  };
  const dirty = Boolean(status && plan && JSON.stringify(plan) !== JSON.stringify(status.plan));
  const changeTarget = (target: MigrationPlan["target"]) => { if (plan) setPlan({ ...plan, target, confirmed: [] }); };
  const download = () => {
    if (!status || dirty) return;
    const blob = new Blob([migrationRunbook(status)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "ingenium-prd-migration.md"; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("Preparation runbook downloaded. It contains no backup bytes or credentials.");
  };
  const button = "rounded border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-surface-hover)] disabled:opacity-50";
  return <div className="space-y-6">
    <StepUpDialog open={stepUp} onClose={() => setStepUp(false)} onComplete={() => { setStepUp(false); setError(""); setMessage("Administrator session verified. You can save the migration plan."); }} />
    <div><h2 className="text-lg font-semibold">Move Ingenium to PRD</h2><p className="mt-2 text-sm text-[var(--color-text-muted)]">Prepare the full installation for another machine. These controls save a plan and create database checkpoints. Secure file transfer, destination verification and cutover remain separate operator steps.</p></div>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {!status || !plan ? <button className={button} disabled={busy} onClick={() => void run(async () => apply((await api.migration.get()).data))}>Retry loading migration preparation</button> : <>
      <div className="space-y-3">
        <label className="block text-sm">PRD platform<Select aria-label="PRD platform" value={plan.target.platform} onChange={(event) => changeTarget({ ...plan.target, platform: event.target.value as "compose" | "kubernetes" })} className="ml-3 rounded border bg-[var(--color-surface)] p-2"><option value="compose">Docker Compose on another host</option><option value="kubernetes">Kubernetes</option></Select></label>
        <label className="block text-sm">PRD HTTPS origin<input aria-label="PRD HTTPS origin" type="url" placeholder="https://ingenium.your-domain.com" value={plan.target.origin} onChange={(event) => changeTarget({ ...plan.target, origin: event.target.value })} className="mt-1 block w-full rounded border bg-[var(--color-surface)] p-2" /></label>
        <p className="text-xs text-[var(--color-text-muted)]">Changing the target clears preparation confirmations. No connection is made to this address.</p>
      </div>
      <section aria-label="Migration database checkpoint"><h3 className="font-medium">Database checkpoint</h3><p className="my-2 text-sm">{status.inventory.backup ? `${status.inventory.backup.verified ? (status.inventory.backup.fresh ? "Verified recent" : "Verified, older than 24 hours") : "Integrity check failed for"} signed database pair: ${status.inventory.backup.createdAt}` : "No completed signed database pair found."} Attachments, keys and workspaces require the full transfer below.</p>
        <button className={button} disabled={busy || dirty} onClick={() => void run(async () => { await api.backups.create(); apply((await api.migration.get()).data); setMessage("A signed snapshot of both databases was created. Other files still need secure transfer."); })}>Create database checkpoint</button> <Link href="/backups" className="text-sm underline">Open backups</Link>
      </section>
      <section aria-label="Required migration transfers"><h3 className="font-medium">What must move</h3><ul className="mt-2 space-y-2 text-sm">{status.inventory.requiredTransfers.map((item) => <li key={item.id}><strong>{item.label}</strong>: {item.contents}</li>)}</ul></section>
      <fieldset disabled={busy || !plan.target.origin} className="space-y-3"><legend className="mb-2 font-medium">Operator-confirmed preparation</legend><p className="text-xs text-[var(--color-text-muted)]">Confirm only after checking the destination. These are your confirmations, not automated PRD tests.</p>{CHECKS.map(([id, label, detail]) => <label key={id} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={plan.confirmed.includes(id)} onChange={(event) => setPlan({ ...plan, confirmed: event.target.checked ? [...plan.confirmed, id] : plan.confirmed.filter((value) => value !== id) })} /><span><strong>{label}</strong><span className="mt-1 block text-[var(--color-text-muted)]">{detail}</span></span></label>)}</fieldset>
      <p className="text-sm" role="status">{plan.confirmed.length} of {CHECKS.length} operator confirmations. {dirty ? "Unsaved changes." : `Saved revision ${plan.revision}.`} Automatic transfer and cutover are unavailable.</p>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy} onClick={() => setStepUp(true)}>Verify administrator session</button>
        <button className={button} disabled={busy || !dirty} onClick={() => void run(async () => { apply((await api.migration.save(plan)).data); setMessage("Migration plan saved. Models and the running installation are unchanged."); })}>Save migration plan</button>
        <button className={button} disabled={busy || dirty} onClick={() => void run(async () => { apply((await api.migration.get()).data); setMessage("Source backup inventory refreshed."); })}>Refresh readiness</button>
        <button className={button} disabled={busy || dirty} onClick={download}>Download preparation runbook</button>
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">Saving requires a recently verified administrator session. Database checkpoints use the existing backup permissions. Use “Verify administrator session” if prompted. Preserve the original computer until the destination passes verification and cutover is approved.</p>
    </>}
  </div>;
}
