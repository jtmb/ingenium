"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { useProject } from "../../../lib/ProjectContext";
import Overlay from "../Overlay";
import { customizeViewIdentity, groupCatalogEntries, installationLabel, projectCatalog, readCatalogScope, resolveInstallationScope, scopedHref, visibleEntries, type CustomizeEntry, type CustomizeScopeBinding } from "./catalog.mjs";

import { resolveHostedCatalogBindings } from "./catalog-reader.mjs";
import { createServiceCatalogSource } from "./service-catalog-source";

type Kind = "plugin" | "skill";

export interface CustomizeCatalogSource {
  id: "project" | "public" | "personal" | "system";
  scopeIdentity: string;
  label: string;
  apiProject?: string;
  activeSkillsOnly?: boolean;
  read(kind: Kind): Promise<CustomizeEntry[]>;
}

const noCatalogSources: CustomizeCatalogSource[] = [];
type CatalogState = { status: "loading" | "ready" | "error"; entries: CustomizeEntry[]; error: string };
const pending: CatalogState = { status: "loading", entries: [], error: "" };
const control = "rounded-lg px-3 py-2 text-sm hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-50";

export default function CustomizeSurface({ kind, catalogSources = noCatalogSources }: { kind: Kind; catalogSources?: CustomizeCatalogSource[] }) {
  const project = useProject();
  return <HostedCustomize key={project} project={project} kind={kind} catalogSources={catalogSources} />;
}

function HostedCustomize({ project, kind, catalogSources }: {project: string; kind: Kind; catalogSources: CustomizeCatalogSource[]}) {
  const [sources, setSources] = useState<CustomizeCatalogSource[] | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setSources(null);
    setError(false);
    void api.projects.list().then(({ data }) => {
      const defaults = resolveHostedCatalogBindings(data, project).map(createServiceCatalogSource);
      const bound = [...defaults.filter(source => !catalogSources.some(override => override.id === source.id)), ...catalogSources];
      if (active) setSources(bound);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [project, catalogSources, refresh]);
  if (error) return <div role="alert" className="p-6 text-sm">
    <p>Catalog scope could not be resolved. Check project access, then retry.</p>
    <button type="button" className={control} onClick={() => setRefresh(value => value + 1)}>Retry scope resolution</button>
  </div>;
  if (!sources) return <p role="status" className="p-6 text-sm">Resolving catalog scope…</p>;
  return <CustomizeCatalogView project={project} kind={kind} catalogSources={sources} discoverSystem={false} />;
}

/** Work may provide explicit projectless/actor-owned sources without a fake project. */
export function CustomizeCatalogView({ project, kind, catalogSources = noCatalogSources, onNavigate, discoverSystem = true }: {
  project: string | null; kind: Kind; catalogSources?: CustomizeCatalogSource[]; onNavigate?: (kind: Kind) => void; discoverSystem?: boolean;
}) {
  const identity = customizeViewIdentity(project, kind, catalogSources) + ":" + discoverSystem;
  return <ProjectCustomize key={identity} project={project} kind={kind} catalogSources={catalogSources} onNavigate={onNavigate} discoverSystem={discoverSystem} />;
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
      <span className="shrink-0 text-xs text-[var(--color-text-muted)]" title={installationLabel(entry)} aria-hidden="true">{!entry.installed ? "+" : entry.archived ? "Archived" : entry.enabled ? "✓" : "Disabled"}</span>
    </button>
  );
}

function ProjectCustomize({ project, kind, catalogSources, onNavigate, discoverSystem }: { project: string | null; kind: Kind; catalogSources: CustomizeCatalogSource[]; onNavigate?: (kind: Kind) => void; discoverSystem: boolean }) {
  const [plugins, setPlugins] = useState<CatalogState>(project ? pending : { status: "ready", entries: [], error: "" });
  const [skills, setSkills] = useState<CatalogState>(project ? pending : { status: "ready", entries: [], error: "" });
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState(project ? "project" : catalogSources.some((source) => source.id === "personal") ? "personal" : "system");
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<CustomizeEntry | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [installation, setInstallation] = useState<CustomizeScopeBinding | null>(null);
  const [scopeError, setScopeError] = useState("");
  const [scopeResolution, setScopeResolution] = useState<"loading" | "ready" | "error">(discoverSystem ? "loading" : "ready");
  const sources = useMemo<CustomizeCatalogSource[]>(() => {
    if (catalogSources.some((source) => !source.scopeIdentity || !source.label || typeof source.read !== "function" || !["project", "public", "personal", "system"].includes(source.id)) ||
        new Set(catalogSources.map((source) => source.id)).size !== catalogSources.length) {
      throw new Error("Catalog sources require unique, explicit authorized scope identities.");
    }
    const configuredProject = catalogSources.find((source) => source.id === "project");
    if (configuredProject && (project === null || configuredProject.apiProject !== project)) {
      throw new Error("A project catalog must retain its explicit logical project namespace.");
    }
    return installation && !catalogSources.some((source) => source.id === "system")
      ? [...catalogSources, { id: "system" as const, scopeIdentity: installation.id, label: "System", apiProject: installation.apiProject, activeSkillsOnly: true,
          read: (resourceKind: Kind) => readCatalogScope(api, installation, resourceKind) }]
      : catalogSources;
  }, [catalogSources, installation, project]);
  const projectSource = sources.find((source) => source.id === "project");
  const selectedSource = sources.find((source) => source.id === scope);
  const selectedProject = selected?.apiProject ?? null;
  const showSystemTab = (sources.some((source) => source.id === "system") || discoverSystem && (kind === "skill" || project === null))
    && !(project !== null && sources.find((source) => source.id === "system")?.apiProject === project);
  const scopeProject = scope === "project" ? project : selectedSource?.apiProject ?? null;
  const presentedScope = scope === "system" && project !== null && selectedSource?.apiProject === project ? "project" : scope;
  const title = kind === "plugin" ? "Plugins" : "Skills";
  const state = kind === "plugin" ? plugins : skills;
  const entries = visibleEntries(state.entries, kind, query);
  const installed = entries.filter((entry) => entry.installed && !entry.archived);
  const manage = scopeProject ? scopedHref(`/customize/${kind === "plugin" ? "plugins" : "skills"}/manage`, scopeProject) : null;

  function refreshCatalog() {
    setPlugins(project ? pending : { status: "ready", entries: [], error: "" });
    setSkills(project ? pending : { status: "ready", entries: [], error: "" });
    setSelected(null);
    setScopeError("");
    setScopeResolution(discoverSystem ? "loading" : "ready");
    setInstallation(null);
    setRefresh((value) => value + 1);
  }

  useEffect(() => {
    if (project === null) return;
    const namespace = project;
    let active = true;
    const read = async (resourceKind: Kind): Promise<CustomizeEntry[]> => {
      if (projectSource) return projectSource.read(resourceKind);
      if (resourceKind === "plugin") {
        const { data } = await api.plugins.list(namespace);
        return projectCatalog(namespace, data, []);
      }
      const { data } = await api.skills.list(namespace);
      return projectCatalog(namespace, [], data);
    };
    void Promise.resolve().then(() => active ? read("plugin") : []).then((entries) => {
      if (active) setPlugins({ status: "ready", entries, error: "" });
    }).catch(() => {
      if (active) setPlugins({ status: "error", entries: [], error: "Plugins could not be loaded. Check your connection and project access, then refresh." });
    });
    void Promise.resolve().then(() => active ? read("skill") : []).then((entries) => {
      if (active) setSkills({ status: "ready", entries, error: "" });
    }).catch(() => {
      if (active) setSkills({ status: "error", entries: [], error: "Skills could not be loaded. Check your connection and project access, then refresh." });
    });
    return () => { active = false; };
  }, [project, projectSource, refresh]);
  useEffect(() => {
    if (!discoverSystem || catalogSources.some((source) => source.id === "system")) return;
    let active = true;
    void api.projects.list().then(({ data }) => {
      const binding = resolveInstallationScope(data);
      if (active) { setInstallation(binding); setScopeResolution("ready"); }
    }).catch(() => {
      if (active) { setInstallation(null); setScopeResolution("error"); setScopeError("System scope could not be resolved. Refresh to recheck installation access."); }
    });
    return () => { active = false; };
  }, [catalogSources, discoverSystem, refresh]);
  return (
    <section className="flex min-h-[calc(100dvh-4rem)] min-w-0 flex-col overflow-hidden rounded-xl bg-[var(--color-surface)] text-[var(--color-text-primary)] md:flex-row" data-testid="customize-surface">
      <aside className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 md:w-[min(28vw,29rem)] md:border-r md:border-b-0" aria-label="Customize navigation">
        <div className="mb-4 flex items-center gap-2 px-2 py-1">
          <Image src="/veyra-blue.png" alt="Veyra" width={22} height={22} />
          <span className="text-sm font-semibold">Customize</span>
        </div>
        <nav className="space-y-1">
          {(["plugin", "skill"] as const).map((item) => {
            const label = item === "plugin" ? "⊞  Plugins" : "◇  Skills";
            const className = "block w-full rounded-lg px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-blue-400 " +
              (item === kind ? "bg-[var(--color-surface-hover)]" : "hover:bg-[var(--color-surface-hover)]");
            if (onNavigate) return <button key={item} type="button" className={className}
              aria-current={item === kind ? "page" : undefined} onClick={() => onNavigate(item)}>{label}</button>;
            if (project) return <Link key={item} href={scopedHref("/customize/" + (item === "plugin" ? "plugins" : "skills"), project)}
              aria-current={item === kind ? "page" : undefined} className={className}>{label}</Link>;
            return <span key={item} aria-current={item === kind ? "page" : undefined} className={className}>{label}</span>;
          })}
        </nav>
        <h2 className="mt-6 px-3 text-xs font-medium text-[var(--color-text-muted)]">Installed</h2>
        {plugins.status === "loading" && <p className="px-3 py-2 text-xs" role="status">Loading plugins…</p>}
        {plugins.status === "error" && <p className="px-3 py-2 text-xs" role="status">Installed plugins unavailable</p>}
        {plugins.status === "ready" && plugins.entries.length === 0 && <p className="px-3 py-2 text-xs text-[var(--color-text-muted)]">{project ? "No plugins installed" : "Choose a scope to inspect installed plugins."}</p>}
        <ul className="mt-2 max-h-72 overflow-y-auto">
          {plugins.entries.map((entry) => <li key={entry.id}><button type="button" onClick={() => setSelected(entry)}
            className="w-full truncate rounded-lg px-3 py-2 text-left text-xs hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-blue-400">{entry.name}{!entry.enabled && " · disabled"}</button></li>)}
        </ul>
        {scopeProject ? <nav aria-label="Customize controls" className="mt-6 flex flex-wrap gap-1 md:flex-col">
          <Link className={control} href={scopedHref("/customize/agents", scopeProject)}>Agents</Link>
          <Link className={control} href={scopedHref("/customize/mcp", scopeProject)}>MCP servers &amp; tools</Link>
          <Link className={control} href={scopedHref("/customize/configuration", scopeProject)}>Configuration &amp; hooks</Link>
          <Link className={control} href={scopedHref("/pipeline", scopeProject)}>Synthesis pipeline</Link>
        </nav> : <p className="mt-6 px-3 text-xs text-[var(--color-text-muted)]">Choose a scope with management access to edit resources.</p>}
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
              {scopeProject && <Link href={scopedHref("/customize/configuration", scopeProject)} className={control} aria-label="Customize settings">⚙</Link>}
              {manage && <Link href={manage} className="rounded-full bg-[var(--color-text-primary)] px-4 py-2 text-xs font-medium text-[var(--color-surface)]">Add</Link>}
            </div>
          </header>

          {state.status === "loading" && <p className="mt-8 text-sm text-[var(--color-text-muted)]" role="status">Loading {title.toLowerCase()}…</p>}
          {state.status === "error" && <div role="alert" className="mt-8 rounded-xl border border-[var(--color-error-border)] p-4 text-sm"><p>{state.error}</p><button className={control} onClick={refreshCatalog}>Retry</button></div>}

          {project && kind === "skill" && state.status === "ready" && (
            <section aria-label="Installed skills" className="mt-6">
              <h2 className="border-b border-[var(--color-border)] px-2 pb-3 text-sm font-semibold">{projectSource ? "Installed" : "Active skills"}</h2>
              <div className="mt-2 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                {(expanded ? installed : installed.slice(0, 6)).map((entry) => <CatalogRow key={entry.id} entry={entry} onSelect={setSelected} />)}
              </div>
              {installed.length === 0 && <p className="px-2 py-4 text-sm text-[var(--color-text-muted)]">{query ? "No installed skills match your search." : projectSource ? "No skills installed in this project. Add a skill to get started." : "No active skills returned by this service."}</p>}
              {installed.length > 6 && <button type="button" onClick={() => setExpanded(!expanded)} className={control}>{expanded ? "Show fewer" : `See ${installed.length - 6} more`}</button>}
            </section>
          )}

          <div className="mt-6 flex flex-wrap gap-1" role="group" aria-label={`${title} catalog scope`}>
            {[...(project ? [{ id: "project", label: installation?.apiProject === project ? "System" : project }] : []), ...(kind === "plugin" || sources.some((source) => source.id === "public") ? [{ id: "public", label: "Public" }] : []), { id: "personal", label: "Personal" }, ...(showSystemTab ? [{ id: "system", label: "System" }] : [])].map((item) => (
              <button type="button" key={item.id} aria-pressed={presentedScope === item.id} onClick={() => setScope(item.id)}
                className={`${control} max-w-full truncate rounded-full text-xs ${presentedScope === item.id ? "bg-[var(--color-surface-hover)] font-semibold" : "text-[var(--color-text-muted)]"}`}>{sources.find((source) => source.id === item.id)?.label ?? item.label}</button>
            ))}
          </div>
          {scope !== "project" && selectedSource ? <ScopedCatalogPanel key={selectedSource.scopeIdentity + ":" + kind + ":" + refresh} source={selectedSource} kind={kind} query={query} onSelect={setSelected} /> : scope === "system" && scopeResolution === "loading" ? <p role="status" className="mt-6 text-sm">Resolving System scope…</p> : scope !== "project" ? <p role="status" className="mt-6 text-sm text-[var(--color-text-muted)]">{scope === "public" ? "Public catalog is unavailable through the current service. Add a local plugin or manage MCP connections." : `${scope === "personal" ? "Personal" : "System"} scope is not exposed by the current service.`}</p> : state.status === "ready" && (
            <section className="mt-6" aria-label={`Project ${title.toLowerCase()} catalog`}>
              {kind === "plugin" && <h2 className="mb-3 text-sm font-semibold">Local plugins</h2>}
              <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">{entries.map((entry) => <CatalogRow key={entry.id} entry={entry} onSelect={setSelected} />)}</div>
              {entries.length === 0 && <p className="py-4 text-sm text-[var(--color-text-muted)]">{query ? "No matching resources." : kind === "skill" && !projectSource ? "No active skills returned in this project." : `No ${title.toLowerCase()} in this project. Use Add to upload one.`}</p>}
            </section>
          )}
          {scope === "system" && scopeError && <p role="status" className="mt-4 text-sm text-[var(--color-text-muted)]">{scopeError}</p>}
          <div className="mt-8 flex flex-wrap gap-2 text-[var(--color-text-muted)]">
            {manage && <Link href={manage} className={control}>{kind === "plugin" ? "Manage local plugins" : "Edit, archive, restore & review proposals"}</Link>}
            {scopeProject && (kind === "plugin" ? <Link href={scopedHref("/customize/mcp", scopeProject)} className={control}>Discover &amp; connect MCP tools</Link> : <Link href={scopedHref("/customize/skills/archive", scopeProject)} className={control}>Archive &amp; restore skills</Link>)}
          </div>
        </div>
      </div>

      <Overlay isOpen={selected !== null} onClose={() => setSelected(null)} title={selected?.name ?? ""} subtitle={selected?.scope}>
        {selected && <div className="space-y-4">
          <p className="whitespace-pre-wrap break-words text-sm">{selected.description || "No description provided."}</p>
          <p className="text-sm">{installationLabel(selected)} · Scope: {selected.scope}</p>
          <p className="text-sm text-[var(--color-text-muted)]">Installed state comes from the scoped service records. Enabled does not establish that a connector is authenticated or healthy.</p>
          {selected.installed && selectedProject && <Link className={control} href={scopedHref(`/customize/${selected.kind === "plugin" ? "plugins" : "skills"}/manage`, selectedProject)}>Open editor &amp; lifecycle controls</Link>}
        </div>}
      </Overlay>
    </section>
  );
}

function ScopedCatalogPanel({ source, kind, query, onSelect }: {
  source: CustomizeCatalogSource; kind: Kind; query: string; onSelect: (entry: CustomizeEntry) => void;
}) {
  const [loaded, setLoaded] = useState<{ source: CustomizeCatalogSource; state: CatalogState } | null>(null);
  const state = loaded?.source === source ? loaded.state : pending;
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => active ? source.read(kind) : []).then((entries) => {
      if (active) setLoaded({ source, state: { status: "ready", entries, error: "" } });
    }).catch(() => {
      if (active) setLoaded({ source, state: { status: "error", entries: [], error: "This scoped catalog could not be loaded. Check access and refresh; no other scope was substituted." } });
    });
    return () => { active = false; };
  }, [source, kind]);
  const entries = visibleEntries(state.entries, kind, query);
  if (state.status === "loading") return <p role="status" className="mt-6 text-sm">Loading {source.label} catalog…</p>;
  if (state.status === "error") return <p role="alert" className="mt-6 text-sm text-[var(--color-error-text)]">{state.error}</p>;
  return <section aria-label={source.label + " catalog"} className="mt-6">
    <h2 className="mb-3 text-sm font-semibold">{source.label}</h2>
    {kind === "skill" && source.activeSkillsOnly && <p className="mb-3 text-xs text-[var(--color-text-muted)]">Showing active skills for this connection.</p>}
    {groupCatalogEntries(entries).map((group) => <section key={group.category} className="mb-7" aria-label={group.category}>
      <h3 className="mb-3 text-sm font-semibold">{group.category}</h3>
      <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {group.entries.map((entry) => <CatalogRow key={entry.id} entry={entry} onSelect={onSelect} />)}
      </div>
    </section>)}
    {entries.length === 0 && <p className="py-4 text-sm text-[var(--color-text-muted)]">{query ? "No matching resources." : kind === "skill" && source.activeSkillsOnly ? "No active skills returned in this scope." : "No resources in this scope."}</p>}
  </section>;
}
