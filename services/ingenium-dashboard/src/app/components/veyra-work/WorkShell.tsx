"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ConversationSidebar, ConversationToolbar, conversationRowClass } from "../ConversationNavigation";

export interface WorkConversation { id: string; title: string; pinned?: boolean; busy?: boolean }
export interface WorkProject { id: string; label: string; conversations: WorkConversation[] }

const sidebarSizes = [{ width: 256, className: "w-64" }, { width: 360, className: "w-[360px]" }, { width: 468, className: "w-[468px]" }] as const;

export default function WorkShell({ projectLabel, projects, conversations, activeId, onSelect, onNew,
  children, composer, web, status, tools, dot, projectCatalog, newPending = false, onPresentationChange,
}: {
  projectLabel: string; projects: WorkProject[]; conversations: WorkConversation[]; activeId: string | null;
  onSelect: (id: string) => void; onNew: () => void; children: ReactNode; composer: ReactNode;
  web: ReactNode; status?: ReactNode; tools?: ReactNode; dot?: ReactNode; projectCatalog?: ReactNode | ((search:string)=>ReactNode); newPending?: boolean;
  onPresentationChange?: (view: "work" | "web") => void;
  installationAdmin?: boolean;
}) {
  const [view, setView] = useState<"work" | "web">("work");
  const [webVisited, setWebVisited] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [sidebarSize, setSidebarSize] = useState(1);
  const dragOrigin = useRef<{ x: number; width: number } | null>(null);
  const selectedSize = sidebarSizes[sidebarSize]!;
  const [search, setSearch] = useState("");
  const renderConversation = (conversation: WorkConversation) => <li key={conversation.id}>
    <button type="button" onClick={() => onSelect(conversation.id)} aria-current={activeId === conversation.id ? "page" : undefined}
      className={conversationRowClass(activeId === conversation.id)}>
      <span className="truncate">{conversation.title}</span>{conversation.busy && <span className="ml-auto" aria-label="Running">◌</span>}
    </button>
  </li>;
  const matches = (conversation: WorkConversation) => conversation.title.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  return <div data-testid="veyra-work-shell" className="flex h-full min-h-0 min-w-0 overflow-hidden bg-[var(--color-surface-muted)] text-[var(--color-text-primary)]">
    {sidebar && <ConversationSidebar id="veyra-work-sidebar" label="Projects and conversations"
      widthClassName={selectedSize.className} className="max-w-[40vw] max-sm:max-w-[45vw]"
      onClose={() => setSidebar(false)} closeLabel="Close projects and conversations" onNew={onNew} newDisabled={newPending}>
      <Link href="/work/history" className="mx-2 rounded-lg px-3 py-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-blue-400">Saved chats</Link>
      {dot}
      <label className="px-2 py-2"><span className="sr-only">Search conversations</span><input type="search" value={search}
        onChange={(event) => setSearch(event.target.value)} placeholder="Search chats" className="w-full rounded-lg border border-[var(--color-border)] bg-transparent p-2 text-xs focus-visible:outline-blue-400" /></label>
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        <h2 className="px-3 pb-2 pt-4 text-xs text-[var(--color-text-muted)]">Pinned</h2>
        <ul>{conversations.filter((item) => item.pinned && matches(item)).map(renderConversation)}</ul>
        <h2 className="px-3 pb-2 pt-4 text-xs text-[var(--color-text-muted)]">Projects</h2>
        {typeof projectCatalog === "function" ? projectCatalog(search) : projectCatalog}
        {projects.map((project) => <details key={project.id} open className="mb-1">
          <summary className="cursor-pointer truncate rounded-lg px-3 py-2 text-xs hover:bg-[var(--color-surface-hover)]">▱ {project.label}</summary>
          <ul className="pl-3">{project.conversations.filter(matches).map(renderConversation)}</ul>
        </details>)}
        <h2 className="px-3 pb-2 pt-4 text-xs text-[var(--color-text-muted)]">Recents</h2>
        <ul>{conversations.filter(matches).map(renderConversation)}</ul>
        {search && !conversations.some(matches) && <p role="status" className="p-3 text-xs text-[var(--color-text-muted)]">No matching chats.</p>}
      </div>
    </ConversationSidebar>}
    {sidebar && <div role="separator" tabIndex={0} aria-label="Conversation sidebar width" aria-orientation="vertical"
      aria-valuemin={256} aria-valuemax={468} aria-valuenow={selectedSize.width} aria-valuetext={`${selectedSize.width} pixels preferred width`}
      className="w-1 shrink-0 cursor-col-resize touch-none bg-white/5 hover:bg-blue-500/50 focus-visible:bg-blue-500 focus-visible:outline-blue-400"
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") {
          event.preventDefault();
          setSidebarSize((current) => event.key === "Home" ? 0 : event.key === "End" ? sidebarSizes.length - 1
            : Math.max(0, Math.min(sidebarSizes.length - 1, current + (event.key === "ArrowRight" ? 1 : -1))));
        }
      }} onPointerDown={(event) => { dragOrigin.current = { x: event.clientX, width: selectedSize.width }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => {
        if (!dragOrigin.current) return;
        const width = dragOrigin.current.width + event.clientX - dragOrigin.current.x;
        let nearest = 0;
        sidebarSizes.forEach((size, index) => { if (Math.abs(size.width - width) < Math.abs(sidebarSizes[nearest]!.width - width)) nearest = index; });
        setSidebarSize(nearest);
      }} onPointerUp={(event) => { dragOrigin.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { dragOrigin.current = null; }}
      onLostPointerCapture={() => { dragOrigin.current = null; }} />}
    <section aria-label="Work workspace" className="relative flex min-w-0 flex-1 flex-col">
      <ConversationToolbar expanded={sidebar} controls="veyra-work-sidebar" onToggle={() => setSidebar(!sidebar)} onNew={onNew} newDisabled={newPending}>
        <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-muted)]">{projectLabel}</span>
        <div role="group" aria-label="Workspace presentation" className="flex rounded-lg border border-[var(--color-border)] p-1 text-xs">
          <button type="button" aria-pressed={view === "work"} onClick={() => { if (view !== "work") onPresentationChange?.("work"); setView("work"); }} className={`rounded px-3 py-1 ${view === "work" ? "bg-[var(--color-surface-selected)]" : ""}`}>Work</button>
          <button type="button" aria-pressed={view === "web"} onClick={() => { if (view !== "web") onPresentationChange?.("web"); setWebVisited(true); setView("web"); }} className={`rounded px-3 py-1 ${view === "web" ? "bg-[var(--color-surface-selected)]" : ""}`}>Web</button>
        </div>{tools}
      </ConversationToolbar>
      {status}
      {/* Keep both viewport boxes full size: hidden iframe geometry can reset
          upstream virtual lists even when the frame itself remains mounted. */}
      <div className="relative min-h-0 flex-1">
        <div role="region" aria-label="Work presentation" aria-hidden={view !== "work"} inert={view !== "work"}
          className={`absolute inset-0 flex min-h-0 min-w-0 flex-col ${view === "work" ? "visible opacity-100 pointer-events-auto" : "invisible opacity-0 pointer-events-none"}`}>
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>{composer}
        </div>
        <div role="region" aria-label="Web presentation" aria-hidden={view !== "web"} inert={view !== "web"}
          className={`absolute inset-0 flex min-h-0 min-w-0 flex-col ${view === "web" ? "visible opacity-100 pointer-events-auto" : "invisible opacity-0 pointer-events-none"}`}>{webVisited ? web : null}</div>
      </div>
    </section>
  </div>;
}
