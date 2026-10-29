"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useProject } from "../../../lib/ProjectContext";
import Overlay from "../Overlay";
import { installationLabel, projectCatalog, scopedHref, visibleEntries, type CustomizeEntry } from "./catalog.mjs";

type Kind = "plugin" | "skill";
type CatalogState = { status: "loading" | "ready" | "error"; entries: CustomizeEntry[]; error: string };
const pending: CatalogState = { status: "loading", entries: [], error: "" };
const control = "rounded-lg px-3 py-2 text-sm hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-50";

export default function CustomizeSurface({ kind }: { kind: Kind }) {
  const project = useProject();
  return <ProjectCustomize key={project + ":" + kind} project={project} kind={kind} />;
}

function CatalogRow({ entry, onSelect }: { entry: CustomizeEntry; onSelect: (entry: CustomizeEntry) => void }) {
  return (
    <button type="button" onClick={() => onSelect(entry)}
      className="flex min-w-0 items-center gap-3 rounded-xl px-2 py-3 text-left hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-blue-400"
      aria-label={`${entry.name}, ${installationLabel(entry)}`} data-testid="customize-catalog-row">
      <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-surface-muted)] text-lg text-blue-400">{entry.kind === "skill" ? "◇" : "⊞"}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{entry.name}</span>
        <span className="mt-1 block truncate text-xs text-[var(--color-text-muted)]">{entry.description || "No description provided."}</span>
      </span>
      <span className="shrink-0 text-xs text-[var(--color-text-muted)]" title={installationLabel(entry)} aria-hidden="true">{entry.archived ? "Archived" : entry.enabled ? "✓" : "Disabled"}</span>
    </button>
  );
}

function ProjectCustomize({ project, kind }: { project: string; kind: Kind }) {
  const [plugins, setPlugins] = useState<CatalogState>(pending);
  const [skills, setSkills] = useState<CatalogState>(pending);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("project");
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<CustomizeEntry | null>(null);
  const [refresh, setRefresh] = useState(0);
  const title = kind === "plugin" ? "Plugins" : "Skills";
  const state = kind === "plugin" ? plugins : skills;
  const entries = visibleEntries(state.entries, kind, query);
  const installed = entries.filter((entry) => entry.installed && !entry.archived);
  const manage = scopedHref(`/customize/${kind === "plugin" ? "plugins" : "skills"}/manage`, project);
  const href = (path: string) => scopedHref(path, project);

  function refreshCatalog() {
    setPlugins(pending);
    setSkills(pending);
    setSelected(null);
    setRefresh((value) => value + 1);
  }

  useEffect(() => {
    let active = true;
    // Project identity is supplied by the existing resolved/authenticated shell.
    // Keep failures independent: a skills failure must not erase installed plugins.
    void api.plugins.list(project).then(({ data }) => {
      if (active) setPlugins({ status: "ready", entries: projectCatalog(project, data, []), error: "" });
    }).catch(() => {
      if (active) setPlugins({ status: "error", entries: [], error: "Plugins could not be loaded. Check your connection and project access, then refresh." });
    });
    void api.skills.list(project).then(({ data }) => {
      if (active) setSkills({ status: "ready", entries: projectCatalog(project, [], data), error: "" });
    }).catch(() => {
      if (active) setSkills({ status: "error", entries: [], error: "Skills could not be loaded. Check your connection and project access, then refresh." });
    });
    return () => { active = false; };
  }, [project, refresh]);

  return (
    <section className="flex min-h-[calc(100dvh-4rem)] min-w-0 flex-col overflow-hidden rounded-xl bg-[var(--color-surface)] text-[var(--color-text-primary)] md:flex-row" data-testid="customize-surface">
      <aside className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 md:w-[min(28vw,29rem)] md:border-r md:border-b-0" aria-label="Customize navigation">
        <div className="mb-4 flex items-center gap-2 px-2 py-1">
          <Image src="/veyra-blue.png" alt="Veyra" width={22} height={22} />
          <span className="text-sm font-semibold">Customize</span>
        </div>
        <nav className="space-y-1">
          {(["plugin", "skill"] as const).map((item) => (
            <Link key={item} href={href(`/customize/${item === "plugin" ? "plugins" : "skills"}`)}
              aria-current={item === kind ? "page" : undefined}
              className={`block rounded-lg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-blue-400 ${item === kind ? "bg-[var(--color-surface-hover)]" : "hover:bg-[var(--color-surface-hover)]"}`}>
              {item === "plugin" ? "⊞  Plugins" : "◇  Skills"}
            </Link>
          ))}
        </nav>
        <h2 className="mt-6 px-3 text-xs font-medium text-[var(--color-text-muted)]">Installed</h2>
        {plugins.status === "loading" && <p className="px-3 py-2 text-xs" role="status">Loading plugins…</p>}
        {plugins.status === "error" && <p className="px-3 py-2 text-xs" role="status">Installed plugins unavailable</p>}
        {plugins.status === "ready" && plugins.entries.length === 0 && <p className="px-3 py-2 text-xs text-[var(--color-text-muted)]">No plugins installed</p>}
        <ul className="mt-2 max-h-72 overflow-y-auto">
          {plugins.entries.map((entry) => <li key={entry.id}><button type="button" onClick={() => setSelected(entry)}
            className="w-full truncate rounded-lg px-3 py-2 text-left text-xs hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-blue-400">{entry.name}{!entry.enabled && " · disabled"}</button></li>)}
        </ul>
        <nav aria-label="Customize controls" className="mt-6 flex flex-wrap gap-1 md:flex-col">
          <Link className={control} href={href("/customize/agents")}>Agents</Link>
          <Link className={control} href={href("/customize/mcp")}>MCP servers &amp; tools</Link>
          <Link className={control} href={href("/customize/configuration")}>Configuration &amp; hooks</Link>
          <Link className={control} href={href("/pipeline")}>Synthesis pipeline</Link>
        </nav>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto px-4 py-7 sm:px-8">
        <div className="mx-auto w-full max-w-[56rem]">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div><h1 className="text-xl font-semibold">{title}</h1><p className="mt-2 text-sm text-[var(--color-text-muted)]">{kind === "plugin" ? "Connect plugins to let Veyra work across your tools" : "Extend Veyra with task-specific skills"}</p></div>
            <div className="flex max-w-full flex-wrap items-center gap-1">
              <label className="sr-only" htmlFor="customize-search">Search {title.toLowerCase()}</label>
              <input id="customize-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${title.toLowerCase()}`} className="w-48 max-w-full rounded-full border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-blue-400" />
              <button type="button" className={control} onClick={refreshCatalog} aria-label={`Refresh ${title.toLowerCase()}`} disabled={state.status === "loading"}>↻</button>
              <Link href={href("/customize/configuration")} className={control} aria-label="Customize settings">⚙</Link>
              <Link href={manage} className="rounded-full bg-[var(--color-text-primary)] px-4 py-2 text-xs font-medium text-[var(--color-surface)]">Add</Link>
            </div>
          </header>

          {state.status === "loading" && <p className="mt-8 text-sm text-[var(--color-text-muted)]" role="status">Loading {title.toLowerCase()}…</p>}
          {state.status === "error" && <div role="alert" className="mt-8 rounded-xl border border-[var(--color-error-border)] p-4 text-sm"><p>{state.error}</p><button className={control} onClick={refreshCatalog}>Retry</button></div>}

          {kind === "skill" && state.status === "ready" && (
            <section aria-label="Installed skills" className="mt-6">
              <h2 className="border-b border-[var(--color-border)] px-2 pb-3 text-sm font-semibold">Installed</h2>
              <div className="mt-2 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                {(expanded ? installed : installed.slice(0, 6)).map((entry) => <CatalogRow key={entry.id} entry={entry} onSelect={setSelected} />)}
              </div>
              {installed.length === 0 && <p className="px-2 py-4 text-sm text-[var(--color-text-muted)]">{query ? "No installed skills match your search." : "No skills installed in this project. Add a skill to get started."}</p>}
              {installed.length > 6 && <button type="button" onClick={() => setExpanded(!expanded)} className={control}>{expanded ? "Show fewer" : `See ${installed.length - 6} more`}</button>}
            </section>
          )}

          <div className="mt-6 flex flex-wrap gap-1" role="group" aria-label={`${title} catalog scope`}>
            {[{ id: "project", label: project }, ...(kind === "plugin" ? [{ id: "public", label: "Public" }] : []), { id: "personal", label: "Personal" }, ...(kind === "skill" ? [{ id: "system", label: "System" }] : [])].map((item) => (
              <button type="button" key={item.id} aria-pressed={scope === item.id} onClick={() => setScope(item.id)}
                className={`${control} max-w-full truncate rounded-full text-xs ${scope === item.id ? "bg-[var(--color-surface-hover)] font-semibold" : "text-[var(--color-text-muted)]"}`}>{item.label}</button>
            ))}
          </div>
          {scope !== "project" ? <p role="status" className="mt-6 text-sm text-[var(--color-text-muted)]">{scope === "public" ? "Public catalog is unavailable through the current service. Add a local plugin or manage MCP connections." : `${scope === "personal" ? "Personal" : "System"} scope is not exposed by the current service. Project resources remain in ${project}.`}</p> : state.status === "ready" && (
            <section className="mt-6" aria-label={`Project ${title.toLowerCase()} catalog`}>
              {kind === "plugin" && <h2 className="mb-3 text-sm font-semibold">Local plugins</h2>}
              <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">{entries.map((entry) => <CatalogRow key={entry.id} entry={entry} onSelect={setSelected} />)}</div>
              {entries.length === 0 && <p className="py-4 text-sm text-[var(--color-text-muted)]">{query ? "No matching resources." : `No ${title.toLowerCase()} in this project. Use Add to upload one.`}</p>}
            </section>
          )}
          <div className="mt-8 flex flex-wrap gap-2 text-[var(--color-text-muted)]">
            <Link href={manage} className={control}>{kind === "plugin" ? "Manage local plugins" : "Edit, archive, restore & review proposals"}</Link>
            {kind === "plugin" ? <Link href={href("/customize/mcp")} className={control}>Discover &amp; connect MCP tools</Link> : <Link href={href("/customize/skills/archive")} className={control}>Archive &amp; restore skills</Link>}
          </div>
        </div>
      </div>

      <Overlay isOpen={selected !== null} onClose={() => setSelected(null)} title={selected?.name ?? ""} subtitle={selected?.scope}>
        {selected && <div className="space-y-4">
          <p className="whitespace-pre-wrap break-words text-sm">{selected.description || "No description provided."}</p>
          <p className="text-sm">{installationLabel(selected)} · Project: {selected.scope}</p>
          <p className="text-sm text-[var(--color-text-muted)]">Installed state comes from the selected project service records. Enabled does not establish that a connector is authenticated or healthy.</p>
          <Link className={control} href={href(`/customize/${selected.kind === "plugin" ? "plugins" : "skills"}/manage`)}>Open editor &amp; lifecycle controls</Link>
        </div>}
      </Overlay>
    </section>
  );
}
