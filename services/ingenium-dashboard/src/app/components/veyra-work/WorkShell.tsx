"use client";

import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { workFeatures } from "./work-state";

export interface WorkConversation { id: string; title: string; pinned?: boolean; busy?: boolean }
export interface WorkProject { id: string; label: string; conversations: WorkConversation[] }

const sidebarSizes = [{ width: 256, className: "w-64" }, { width: 360, className: "w-[360px]" }, { width: 468, className: "w-[468px]" }] as const;
function subscribeNarrowScreen(callback: () => void) {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const media = window.matchMedia("(max-width: 767px)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
function narrowScreen() { return typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches; }
function serverScreen() { return false; }

export default function WorkShell({ projectLabel, projects, conversations, activeId, onSelect, onNew,
  children, composer, web, status, tools, dot, newPending = false, onPresentationChange,
}: {
  projectLabel: string; projects: WorkProject[]; conversations: WorkConversation[]; activeId: string | null;
  onSelect: (id: string) => void; onNew: () => void; children: ReactNode; composer: ReactNode;
  web: ReactNode; status?: ReactNode; tools?: ReactNode; dot?: ReactNode; newPending?: boolean;
  onPresentationChange?: (view: "work" | "web") => void;
}) {
  const [view, setView] = useState<"work" | "web">("work");
  const [webVisited, setWebVisited] = useState(false);
  const narrow = useSyncExternalStore(subscribeNarrowScreen, narrowScreen, serverScreen);
  const [sidebarOverride, setSidebar] = useState<boolean | null>(null);
  const sidebar = sidebarOverride ?? !narrow;
  const [sidebarSize, setSidebarSize] = useState(2);
  const dragOrigin = useRef<{ x: number; width: number } | null>(null);
  const selectedSize = sidebarSizes[sidebarSize]!;
  const [features, setFeatures] = useState(false);
  const [search, setSearch] = useState("");
  const renderConversation = (conversation: WorkConversation) => <li key={conversation.id}>
    <button type="button" onClick={() => onSelect(conversation.id)} aria-current={activeId === conversation.id ? "page" : undefined}
      className={`flex w-full items-center gap-2 truncate rounded-lg px-3 py-2 text-left text-xs hover:bg-white/5 focus-visible:outline-blue-400 ${activeId === conversation.id ? "bg-white/10 text-white" : "text-neutral-300"}`}>
      <span className="truncate">{conversation.title}</span>{conversation.busy && <span className="ml-auto" aria-label="Running">◌</span>}
    </button>
  </li>;
  const matches = (conversation: WorkConversation) => conversation.title.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  return <div data-testid="veyra-work-shell" className="flex h-full min-h-[32rem] min-w-0 overflow-hidden bg-[#181616] text-neutral-200">
    <nav aria-label="Work applications" className="flex w-[52px] shrink-0 flex-col items-center gap-3 border-r border-white/5 bg-[#202020] py-3">
      <button type="button" aria-label="Toggle conversation sidebar" aria-expanded={sidebar} aria-controls="veyra-work-sidebar"
        onClick={() => setSidebar(!sidebar)} className="rounded-lg p-2 hover:bg-white/10 focus-visible:outline-blue-400">
        <Image src="/veyra-blue.png" alt="Veyra" width={24} height={24} />
      </button>
      <Link href="/tasks" aria-label="Tasks" className="rounded p-2 hover:bg-white/10">▤</Link>
      <Link href="/jobs" aria-label="Jobs" className="rounded p-2 hover:bg-white/10">◷</Link>
      <Link href="/plugins" aria-label="Customize" className="rounded p-2 hover:bg-white/10">⊞</Link>
      <button type="button" aria-label="Browse features" aria-expanded={features} onClick={() => setFeatures(!features)} className="rounded p-2 hover:bg-white/10">•••</button>
      <Link href="/settings" aria-label="Settings" className="mt-auto rounded p-2 hover:bg-white/10">⚙</Link>
    </nav>
    {sidebar && <aside id="veyra-work-sidebar" aria-label="Projects and conversations" className={`flex ${selectedSize.className} max-w-[40vw] shrink-0 flex-col border-r border-white/5 bg-[#1c1a1a] p-2 max-sm:max-w-[45vw]`}>
      <div className="px-2 py-2 text-sm font-semibold">Veyra</div>
      <button type="button" onClick={onNew} disabled={newPending} className="rounded-lg px-3 py-2 text-left text-xs hover:bg-white/5 disabled:opacity-40">＋ New chat</button>
      {dot}
      <label className="px-2 py-2"><span className="sr-only">Search conversations</span><input type="search" value={search}
        onChange={(event) => setSearch(event.target.value)} placeholder="Search chats" className="w-full rounded-lg border border-white/10 bg-transparent p-2 text-xs focus-visible:outline-blue-400" /></label>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <h2 className="px-3 pb-2 pt-4 text-xs text-neutral-400">Pinned</h2>
        <ul>{conversations.filter((item) => item.pinned && matches(item)).map(renderConversation)}</ul>
        <h2 className="px-3 pb-2 pt-4 text-xs text-neutral-400">Projects</h2>
        {projects.map((project) => <details key={project.id} open className="mb-1">
          <summary className="cursor-pointer truncate rounded-lg px-3 py-2 text-xs hover:bg-white/5">▱ {project.label}</summary>
          <ul className="pl-3">{project.conversations.filter(matches).map(renderConversation)}</ul>
        </details>)}
        <h2 className="px-3 pb-2 pt-4 text-xs text-neutral-400">Recents</h2>
        <ul>{conversations.filter(matches).map(renderConversation)}</ul>
        {search && !conversations.some(matches) && <p role="status" className="p-3 text-xs text-neutral-400">No matching chats.</p>}
      </div>
    </aside>}
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
      <header className="flex min-h-12 flex-wrap items-center gap-2 px-4 py-2">
        <span className="min-w-0 flex-1 truncate text-xs text-neutral-400">{projectLabel}</span>
        <div role="group" aria-label="Workspace presentation" className="flex rounded-lg border border-white/10 p-1 text-xs">
          <button type="button" aria-pressed={view === "work"} onClick={() => { if (view !== "work") onPresentationChange?.("work"); setView("work"); }} className={`rounded px-3 py-1 ${view === "work" ? "bg-white/10" : ""}`}>Work</button>
          <button type="button" aria-pressed={view === "web"} onClick={() => { if (view !== "web") onPresentationChange?.("web"); setWebVisited(true); setView("web"); }} className={`rounded px-3 py-1 ${view === "web" ? "bg-white/10" : ""}`}>Web</button>
        </div>{tools}
      </header>
      {status}
      {features && <section aria-label="Feature directory" className="max-h-64 overflow-auto border-y border-white/10 bg-[#242222] p-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{workFeatures.map((feature) => <Link key={feature.href} href={feature.href} className="rounded-lg p-2 hover:bg-white/5 focus-visible:outline-blue-400">
          <strong className="text-sm">{feature.label}</strong><p className="text-xs text-neutral-400">{feature.description}</p>
        </Link>)}</div>
      </section>}
      {/* Presentation changes retain both controllers, drafts, scroll and upstream frame. */}
      <div hidden={view !== "work"} className={`${view === "work" ? "flex" : "hidden"} min-h-0 flex-1 flex-col`}>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>{composer}
      </div>
      <div hidden={view !== "web"} className={`relative ${view === "web" ? "flex" : "hidden"} min-h-0 flex-1 flex-col`}>{webVisited ? web : null}</div>
    </section>
  </div>;
}
