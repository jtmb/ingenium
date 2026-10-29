"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { request, type Skill } from "../../../lib/api";
import { useProject } from "../../../lib/ProjectContext";
import { scopedHref } from "./catalog.mjs";
import { createSkillLifecycle } from "./skill-lifecycle.mjs";

const lifecycle = createSkillLifecycle(request);

export default function SkillArchive() {
  const project = useProject();
  return <ProjectSkillArchive key={project} project={project} />;
}

function ProjectSkillArchive({ project }: { project: string }) {
  const [rows, setRows] = useState<{ active: Skill[]; archived: Skill[] } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ name: string; action: "archive" | "restore" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const writing = useRef(false);
  const generation = useRef(0);

  async function reload() {
    const current = ++generation.current;
    setError("");
    setRows(null);
    try {
      const data = await lifecycle.list(project);
      if (current !== generation.current) return false;
      setRows(data);
      setUncertain(false);
      return true;
    } catch {
      if (current === generation.current) setError("Skill lists could not be loaded. Check project access and connection.");
      return false;
    }
  }

  useEffect(() => {
    let active = true;
    const current = ++generation.current;
    void lifecycle.list(project).then((data) => { if (active && current === generation.current) setRows(data); }).catch(() => {
      if (active && current === generation.current) setError("Skill lists could not be loaded. Check project access and connection.");
      return false;
    });
    return () => { active = false; };
  }, [project]);

  async function confirm() {
    if (!pending || writing.current || uncertain) return;
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await lifecycle.change(project, pending.name, pending.action);
      setPending(null);
      if (result.outcome === "succeeded") {
        setMessage("Change saved by the service. Reloading authoritative lists…");
        const refreshed = await reload();
        setMessage(refreshed ? "Change saved and lists refreshed." : "Change saved, but lists could not be refreshed. Refresh before another change.");
      } else {
        setError(result.message ?? "Change could not be confirmed.");
        setUncertain(result.outcome === "unknown");
      }
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  return <section className="mx-auto max-w-4xl space-y-5 p-4">
    <Link href={scopedHref("/customize/skills", project)} className="text-sm text-blue-400">← Skills</Link>
    <h1 className="text-xl font-semibold">Archive &amp; restore skills</h1>
    <p className="text-sm text-[var(--color-text-muted)]">Changes use the existing API-owned skill storage and maintenance locks. Archiving preserves the skill's history.</p>
    {message && <p role="status" className="text-sm">{message}</p>}
    {error && <p role="alert" className="text-sm text-[var(--color-error-text)]">{error}</p>}
    <button type="button" disabled={busy} onClick={() => void reload()} className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-blue-400">Refresh authoritative lists</button>
    {!rows && !error && <p role="status">Loading skills…</p>}
    {(["active", "archived"] as const).map((group) => rows && <section key={group} className="space-y-2">
      <h2 className="text-sm font-semibold">{group === "active" ? "Active skills" : "Archived skills"}</h2>
      {rows[group].length === 0 && <p className="text-sm text-[var(--color-text-muted)]">No {group} skills.</p>}
      <ul>{rows[group].map((skill) => <li key={skill.id} className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] py-3">
        <span className="min-w-0 truncate text-sm">{skill.name}</span>
        <button type="button" disabled={busy || uncertain} onClick={() => setPending({ name: skill.name, action: group === "active" ? "archive" : "restore" })}
          className="rounded-lg px-3 py-2 text-sm hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-50">{group === "active" ? "Archive" : "Restore"}</button>
      </li>)}</ul>
    </section>)}
    {pending && <form onSubmit={(event) => { event.preventDefault(); void confirm(); }} className="space-y-3 rounded-xl border border-[var(--color-border)] p-4">
      <p>{pending.action === "archive" ? "Archive" : "Restore"} {pending.name} in {project}?</p>
      <div className="flex gap-2">
        <button type="submit" disabled={busy || uncertain} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50">{busy ? "Saving…" : "Confirm change"}</button>
        <button type="button" disabled={busy} onClick={() => setPending(null)} className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">Cancel</button>
      </div>
    </form>}
  </section>;
}
