"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api";
import { useProject } from "../../lib/ProjectContext";
import { compareRecentWork, recentWorkHref, type RecentWorkDirection, type RecentWorkItem, type RecentWorkPage } from "../../lib/recent-work";
import { Dropdown, DropdownItem, DropdownPanel, DropdownTrigger } from "./Dropdown";

const kindLabels = { conversation: "Conversation", document: "Document", task: "Task" };
const sourceLabels = { conversation: "Conversations", document: "Documents", task: "Tasks" };

function WorkIcon({ name, size = 16 }: { name: RecentWorkItem["kind"] | "folder" | "more" | "refresh" | "right" | "up" | "down"; size?: number }) {
  const paths = {
    conversation: "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z",
    document: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8M8 17h6",
    task: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
    folder: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2Z",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    refresh: "M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2l1 4M4 12l1 4a8 8 0 0 0 13 2",
    right: "M5 12h14m-6-6 6 6-6 6", up: "M12 19V5m-6 6 6-6 6 6", down: "M12 5v14m-6-6 6 6 6-6",
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === "more" ? 3 : 1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function updatedLabel(value: string) {
  const date = new Date(value), today = new Date(), yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const sameDay = (other: Date) => date.getFullYear() === other.getFullYear() && date.getMonth() === other.getMonth() && date.getDate() === other.getDate();
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  return sameDay(today) ? `Today ${time}` : sameDay(yesterday) ? `Yesterday ${time}`
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function WorkActions({ item, onNotice }: { item: RecentWorkItem; onNotice: (message: string) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ position: "fixed" });
  const href = recentWorkHref(item);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("resize", close); document.removeEventListener("scroll", close, true); };
  }, [open]);
  return <Dropdown open={open} onOpenChange={setOpen}>
    <DropdownTrigger aria-label={`Actions for ${item.title}`} onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      setPosition({ position: "fixed", left: Math.max(8, Math.min(rect.right - 176, window.innerWidth - 184)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 88)) });
    }}><WorkIcon name="more" size={18} /></DropdownTrigger>
    <DropdownPanel className="w-44" style={position}>
      <DropdownItem onClick={() => router.push(href)}>Open {kindLabels[item.kind].toLowerCase()}</DropdownItem>
      <DropdownItem disabled={typeof navigator.clipboard?.writeText !== "function"} onClick={async () => {
        try { await navigator.clipboard.writeText(new URL(href, window.location.origin).href); onNotice("Link copied."); }
        catch { onNotice("Could not copy the link. Try again."); }
      }}>Copy link</DropdownItem>
    </DropdownPanel>
  </Dropdown>;
}

export default function RecentWork() {
  const project = useProject();
  const [expanded, setExpanded] = useState(false);
  const [direction, setDirection] = useState<RecentWorkDirection>("desc");
  return <ProjectRecentWork key={JSON.stringify([project, expanded, direction])} project={project} expanded={expanded}
    direction={direction} onExpand={() => setExpanded(value => !value)} onSort={() => setDirection(value => value === "desc" ? "asc" : "desc")} />;
}

function ProjectRecentWork({ project, expanded, direction, onExpand, onSort }: {
  project: string; expanded: boolean; direction: RecentWorkDirection; onExpand: () => void; onSort: () => void;
}) {
  const headingId = useId(), contentId = useId();
  const [page, setPage] = useState<RecentWorkPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const owner = useRef({ active: false, generation: 0, busy: false, controller: null as AbortController | null });
  const limit = expanded ? 20 : 3;

  const load = useCallback(async (cursor?: string) => {
    const scope = owner.current;
    if (!scope.active || scope.busy) return;
    scope.busy = true;
    const generation = ++scope.generation;
    const controller = new AbortController();
    scope.controller = controller;
    const current = () => scope.active && scope.generation === generation;
    setLoading(true); setError(null);
    if (!cursor) setPage(null);
    try {
      const response = await api.home.recentWork(project, { limit, direction, cursor, signal: controller.signal });
      if (!current()) return;
      setPage(previous => {
        const rows = new Map((cursor ? previous?.items ?? [] : []).map(item => [item.key, item]));
        for (const item of response.data.items) rows.set(item.key, item);
        return { ...response.data, items: [...rows.values()].sort((a, b) => compareRecentWork(a, b, direction)) };
      });
    } catch (failure) {
      if (!current()) return;
      setPage(null);
      setError(failure instanceof Error ? failure.message : "Recent work is unavailable");
    } finally {
      if (current()) { scope.busy = false; setLoading(false); }
    }
  }, [project, direction, limit]);

  useEffect(() => {
    const scope = owner.current;
    scope.active = true; scope.busy = false;
    void load();
    return () => { scope.active = false; scope.generation++; scope.busy = false; scope.controller?.abort(); };
  }, [load]);

  const allDenied = page && Object.values(page.sources).every(state => state === "denied");
  return <section className="veyra-recent-work" aria-labelledby={headingId}>
    <div className="veyra-work-heading">
      <h2 id={headingId}>Recent work</h2>
      <div>
        <button type="button" className="veyra-work-refresh" aria-label="Refresh recent work" disabled={loading} onClick={() => void load()}><WorkIcon name="refresh" size={15} /></button>
        <button type="button" className="veyra-work-view-all" aria-expanded={expanded} aria-controls={contentId} onClick={onExpand}>{expanded ? "Show fewer" : "View all"}<WorkIcon name="right" size={15} /></button>
      </div>
    </div>
    <div id={contentId} aria-busy={loading}>
      {error ? <div role="alert" className="veyra-work-message"><p>Could not load recent work: {error}</p><button type="button" onClick={() => void load()}>Retry</button></div>
        : !page ? <p role="status" className="veyra-work-message">Loading recent work…</p>
        : <>
          {page.unavailable.length > 0 && <p role="status" className="veyra-work-message">Some recent work is unavailable: {page.unavailable.map(kind => sourceLabels[kind]).join(", ")}.</p>}
          {page.items.length === 0 ? <p className="veyra-work-message">{allDenied ? "Recent work is unavailable for your current permissions."
            : page.unavailable.length ? "Recent work could not be fully loaded."
            : "Your recent conversations, documents and tasks will appear here."}</p>
            : <div className="veyra-work-table-wrap"><table aria-labelledby={headingId}>
              <thead><tr><th scope="col">Item</th><th scope="col">Project</th>
                <th scope="col" aria-sort={direction === "desc" ? "descending" : "ascending"}><button type="button" onClick={onSort}>Updated<WorkIcon name={direction === "desc" ? "down" : "up"} size={13} /></button></th>
                <th scope="col">Type</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{page.items.map(item => {
                return <tr key={item.key}>
                  <td><Link href={recentWorkHref(item)} className="veyra-work-item"><WorkIcon name={item.kind} size={20} /><span><span>{item.title}</span>{item.description && <small>{item.description}</small>}</span></Link></td>
                  <td><span className="veyra-work-project"><WorkIcon name="folder" />{item.projectName}</span></td>
                  <td><time dateTime={item.updatedAt} title={item.updatedAt}>{updatedLabel(item.updatedAt)}</time></td>
                  <td><span className="veyra-work-kind">{kindLabels[item.kind]}</span></td>
                  <td><WorkActions item={item} onNotice={setNotice}/></td>
                </tr>;
              })}</tbody>
            </table></div>}
          {expanded && page.nextCursor && <button type="button" className="veyra-work-load-more" disabled={loading} onClick={() => void load(page.nextCursor!)}>{loading ? "Loading…" : "Load more work"}</button>}
        </>}
      {notice && <p role="status" className="veyra-work-message">{notice}</p>}
    </div>
  </section>;
}
