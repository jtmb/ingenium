import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, BookOpen, Check, Package, Plus, RefreshCw, Search, Settings2 } from "lucide-react";
import type { Project } from "@veyra/contracts";
import type { Gateway } from "../../platform/types";
import { decodeNativeCatalog, filterNativeEntries, hostedGovernanceMatches, nativeCatalogPath, nativeOwnerKey, type HostedGovernanceBinding, type NativeCatalog, type NativeEntry, type NativeKind } from "./nativeCatalog";
import "./native-customize.css";

const Packages = lazy(() => import("../extensions/PluginPackages").then(m => ({default: m.PluginPackages})));
const Skills = lazy(() => import("../extensions/SkillWorkspace").then(m => ({default: m.SkillWorkspace})));
const Extensions = lazy(() => import("../extensions/ExtensionsPanel").then(m => ({default: m.ExtensionsPanel})));
const Instructions = lazy(() => import("../extensions/InstructionEditor").then(m => ({default: m.InstructionEditor})));
const EngineSettings = lazy(() => import("../extensions/ScopedEngineSettings").then(m => ({default: m.ScopedEngineSettings})));
type Panel = "packages" | "skills" | "extensions" | "instructions" | "engine" | "legacy" | "hosted";
type ReadState = {status: "loading" | "ready" | "error"; catalog?: NativeCatalog; error?: string};
type Props = Readonly<{
  gateway: Gateway; project: Project | null; connected: boolean; serviceInstanceId: string;
  /** Reuse the coordinator's existing Productivity element with its callbacks. */
  renderLegacyWorkflows: (gateway: Gateway) => ReactNode;
  /** Render only the coordinator's authenticated, owner-bound governance adapter. */
  hostedGovernance?: HostedGovernanceBinding & Readonly<{content: ReactNode}>;
}>;
const waiting: ReadState = {status: "loading"};
const names: Record<Panel, string> = {packages: "Plugin packages", skills: "Skill source editor", extensions: "MCP, tools & connections",
  instructions: "Instructions & references", engine: "Engine settings", legacy: "Other Customize workflows", hosted: "Hosted skill governance"};

export function NativeCustomize(props: Props) {
  const [kind, setKind] = useState<NativeKind>("plugin");
  const project = props.project;
  const owner = project ? nativeOwnerKey({serviceInstanceId: props.serviceInstanceId, projectId: project.id, projectRevision: project.revision},
    [project.primary_root, project.environment]) : JSON.stringify([props.serviceInstanceId, null]);
  return <CustomizeOwner key={owner} {...props} kind={kind} setKind={setKind}/>;
}

function CustomizeOwner({gateway, project, connected, serviceInstanceId, renderLegacyWorkflows, hostedGovernance, kind, setKind}: Props & {kind: NativeKind; setKind: (kind: NativeKind) => void}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("project"), [expanded, setExpanded] = useState(false), [limit, setLimit] = useState(50);
  const [pluginRead, setPluginRead] = useState<ReadState>(waiting), [skillRead, setSkillRead] = useState<ReadState>(waiting);
  const [refresh, setRefresh] = useState(0), [selected, setSelected] = useState<NativeEntry | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null), [visited, setVisited] = useState<Panel[]>([]);
  const detailHeading = useRef<HTMLHeadingElement>(null), detailOrigin = useRef<HTMLElement | null>(null);
  const back = useRef<HTMLButtonElement>(null), origin = useRef<HTMLElement | null>(null), pageHeading = useRef<HTMLHeadingElement>(null);
  const admitted = !!(project && !project.archived && connected && serviceInstanceId && gateway.workbench);
  const fencedGateway = useMemo(() => admitted ? gateway : {...gateway, workbench: undefined}, [admitted, gateway]);
  const hostedMatches = hostedGovernanceMatches(hostedGovernance, serviceInstanceId, project, connected);
  const readOwner = useMemo(() => project ? {serviceInstanceId, projectId: project.id, projectRevision: project.revision} : null, [serviceInstanceId, project?.id, project?.revision]);
  useEffect(() => {
    let active = true;
    setPluginRead(waiting); setSkillRead(waiting); setSelected(null);
    if (!admitted || !readOwner || !gateway.workbench) return () => { active = false; };
    const owner = readOwner;
    const transport = gateway.workbench;
    const read = async (resource: NativeKind, set: (state: ReadState) => void) => {
      try {
        const response = await transport("GET", nativeCatalogPath(resource, owner), undefined, () => active);
        if (active) set({status: "ready", catalog: decodeNativeCatalog(resource, response, owner)});
      } catch (cause) {
        if (active) set({status: "error", error: cause instanceof Error ? cause.message : "The catalog could not be read."});
      }
    };
    void read("plugin", setPluginRead); void read("skill", setSkillRead);
    return () => { active = false; };
  }, [admitted, gateway.workbench, readOwner, refresh]);
  useEffect(() => { setLimit(50); }, [kind, query]);
  useEffect(() => { if (panel) back.current?.focus(); }, [panel]);
  useEffect(() => { if (selected) detailHeading.current?.focus(); }, [selected]);
  const openPanel = (next: Panel) => {
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setVisited(value => value.includes(next) ? value : [...value, next]); setPanel(next); setSelected(null);
  };
  const returnToCatalog = () => {
    setPanel(null); setRefresh(value => value + 1);
    requestAnimationFrame(() => {
      if (origin.current?.isConnected) origin.current.focus(); else pageHeading.current?.focus();
    });
  };
  const current = kind === "plugin" ? pluginRead : skillRead;
  const catalog = admitted ? current.catalog : undefined;
  const filtered = filterNativeEntries(catalog?.entries ?? [], query);
  const present = filtered.filter(row => row.present);
  const sidePlugins = admitted ? pluginRead.catalog?.entries.filter(row => row.present) ?? [] : [];
  const title = kind === "plugin" ? "Plugins" : "Skills";
  const manager: Panel = kind === "plugin" ? "packages" : "skills";
  const readMessage = !project ? "Choose a project to inspect its resource catalog. No global project is selected for you."
    : project.archived ? "This project is archived. Restore it through Projects before managing resources."
    : !admitted ? "Connect to the current service to read the catalog." : null;

  function card(row: NativeEntry) {
    return <button type="button" key={row.key} className="native-customize-card" onClick={() => { detailOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSelected(row); }}
      aria-label={row.name + ", " + row.state}>
      <span aria-hidden="true" className="native-customize-icon">{row.kind === "plugin" ? <Package size={19}/> : <BookOpen size={19}/>}</span>
      <span><strong>{row.name}</strong><small>{row.description || row.id}</small><small>{row.state}</small></span>
      {row.present && <Check size={14} aria-hidden="true"/>}
    </button>;
  }
  return <section className="native-customize" aria-label="Customize">
    <aside className="native-customize-sidebar">
      <div className="native-customize-brand"><span aria-hidden="true">V</span> Customize</div>
      <nav aria-label="Customize pages">
        {(["plugin", "skill"] as const).map(value => <button type="button" key={value} aria-current={kind === value ? "page" : undefined}
          onClick={() => { setKind(value); setScope("project"); setSelected(null); setPanel(null); setRefresh(value => value + 1); }}>
          {value === "plugin" ? <Package size={16}/> : <BookOpen size={16}/>} {value === "plugin" ? "Plugins" : "Skills"}
        </button>)}
      </nav>
      <h2>Registered plugins</h2>
      {readMessage ? <p>{readMessage}</p> : pluginRead.status === "loading" ? <p role="status">Loading registrations…</p>
        : pluginRead.status === "error" ? <p>Plugin registrations unavailable</p> : sidePlugins.length === 0 ? <p>No plugin packages registered</p> : null}
      <ul>{sidePlugins.slice(0, 50).map(row => <li key={row.key}><button type="button" onClick={() => {setKind("plugin"); setSelected(row); setPanel(null);}}>
        {row.name}{row.enabled === false ? " · disabled" : ""}
      </button></li>)}</ul>
      {sidePlugins.length > 50 && <p>Search the Plugins catalog to inspect all {sidePlugins.length} registrations.</p>}
      <nav aria-label="Customize controls">
        {(["extensions", "instructions", "engine", "legacy", "hosted"] as const).map(value => <button type="button" key={value}
          onClick={() => openPanel(value)}>{names[value]}</button>)}
      </nav>
      {project && <p className="native-customize-owner">Project: {project.name}</p>}
    </aside>
    <div className="native-customize-main">
      <div hidden={panel !== null} inert={panel !== null}>
        <header><div><h1 ref={pageHeading} tabIndex={-1}>{title}</h1><p>{kind === "plugin" ? "Connect packages and tools to Veyra" : "Extend Veyra with project skills"}</p></div>
          <div className="native-customize-actions">
            <label><Search size={14} aria-hidden="true"/><span className="native-customize-sr">Search {title.toLowerCase()}</span>
              <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={"Search " + title.toLowerCase()}/></label>
            <button type="button" aria-label={"Refresh " + title.toLowerCase()} onClick={() => setRefresh(value => value + 1)} disabled={!admitted || current.status === "loading"}><RefreshCw size={16}/></button>
            <button type="button" aria-label="Customize settings" onClick={() => openPanel("extensions")}><Settings2 size={16}/></button>
            <button type="button" className="native-customize-add" onClick={() => openPanel(manager)} disabled={!admitted}><Plus size={14}/> Add</button>
          </div>
        </header>
        {readMessage && <p role="status" className="native-customize-message">{readMessage}</p>}
        {admitted && current.status === "loading" && <p role="status" className="native-customize-message">Loading {title.toLowerCase()}…</p>}
        {admitted && current.status === "error" && <div role="alert" className="native-customize-message"><p>{current.error}</p><button type="button" onClick={() => setRefresh(value => value + 1)}>Retry catalog</button></div>}
        {admitted && catalog && <>
          {kind === "skill" && <section aria-label="Present project skill sources" className="native-customize-installed">
            <h2>Project skill sources</h2><p>Presence on disk does not establish engine activation. Select deliberate skill attachments in the session composer after engine discovery.</p>
            <div className="native-customize-grid">{(expanded ? present.slice(0, 256) : present.slice(0, 6)).map(card)}</div>
            {present.length > 6 && <button type="button" onClick={() => setExpanded(value => !value)}>{expanded ? "Show fewer" : "See more project sources"}</button>}
          </section>}
          {!catalog.supported && <p role="status" className="native-customize-message">{catalog.reason || "This environment does not support guarded skill editing."}</p>}
        </>}
        <div className="native-customize-scopes" role="group" aria-label="Catalog scope">
          {["project", "public", "personal", "system"].map(value => <button type="button" key={value} aria-pressed={scope === value}
            onClick={() => {setScope(value); setSelected(null);}}>{value === "project" ? project?.name || "Project" : value[0].toUpperCase() + value.slice(1)}</button>)}
        </div>
        {scope !== "project" ? <p role="status" className="native-customize-message">
          {scope[0].toUpperCase() + scope.slice(1)} catalog is unavailable through the current native resource owner. No project resource is relabelled into this scope.
        </p> : admitted && current.status === "ready" && catalog && <section aria-label={"Project " + title.toLowerCase() + " catalog"}>
          <h2>{kind === "plugin" ? "Project registrations" : "Project sources"}</h2>
          <div className="native-customize-grid">{filtered.slice(0, limit).map(card)}</div>
          {filtered.length === 0 && <p className="native-customize-message">{query ? "No matching resources." : "No resources were returned by this project owner."}</p>}
          {filtered.length > limit && <button type="button" onClick={() => setLimit(value => value + 50)}>Show more catalog entries ({filtered.length - limit} remaining)</button>}
          <button type="button" onClick={() => openPanel(manager)} disabled={!admitted}>{kind === "plugin" ? "Discover local packages & manage registrations" : "Open source editor"}</button>
        </section>}
        {selected && <section className="native-customize-detail" aria-label={"Details for " + selected.name}>
          <button type="button" onClick={() => {setSelected(null); requestAnimationFrame(() => detailOrigin.current?.focus());}} aria-label="Close resource details">Close</button>
          <h2 ref={detailHeading} tabIndex={-1}>{selected.name}</h2><p>{selected.description}</p><p>{selected.state}</p><p>{selected.activation}</p>
          {selected.path && <p className="native-customize-path">{selected.path}</p>}{selected.reason && <p>{selected.reason}</p>}
          <button type="button" disabled={!admitted} onClick={() => openPanel(selected.kind === "plugin" ? "packages" : "skills")}>Open existing management controls</button>
        </section>}
      </div>
      {panel && <header className="native-customize-manager-heading"><button ref={back} type="button" onClick={returnToCatalog}><ArrowLeft size={16}/> Back to catalog</button><h1>{names[panel]}</h1></header>}
      {/* Keep visited mutation owners alive while changing presentation; their original ledgers remain authoritative. */}
      {visited.map(value => <div key={value} hidden={panel !== value} inert={panel !== value} className="native-customize-manager">
        <Suspense fallback={<p role="status">Opening {names[value]}…</p>}>
          {value === "legacy" ? renderLegacyWorkflows(fencedGateway)
            : value === "hosted" ? hostedMatches ? <div key={JSON.stringify([hostedGovernance?.actorId, hostedGovernance?.installationId, hostedGovernance?.hostedProjectId])}>{hostedGovernance?.content}</div> : <div role="status">
              <h2>Hosted skill governance is unavailable</h2><p>Archive, restore, proposal review, synthesis and hosted activation require an authenticated bridge to their existing API owner. Native file removal is not archive. No request was submitted.</p>
            </div>
            : !project ? <p role="status">Choose a project to use {names[value]}.</p>
            : value === "packages" ? <Packages gateway={fencedGateway} project={project} connected={admitted}/>
            : value === "skills" ? <Skills gateway={fencedGateway} project={project} connected={admitted}/>
            : value === "extensions" ? <Extensions gateway={fencedGateway} project={project} connected={admitted}/>
            : value === "instructions" ? <Instructions gateway={fencedGateway} project={project} connected={admitted}/>
            : <EngineSettings gateway={fencedGateway} project={project} connected={admitted}/>}
        </Suspense>
      </div>)}
    </div>
  </section>;
}
