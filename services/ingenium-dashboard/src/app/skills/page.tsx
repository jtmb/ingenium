"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect, useRef, useCallback } from "react";
import { useProject } from "../../lib/ProjectContext";
import {
  api,
  Skill,
  type SkillProposalCounts,
  type SkillProposalSummary,
} from "../../lib/api";
import { badgeTones, BADGE_BASE } from "../../lib/badgeTones";
import FileTree from "../components/FileTree";
import MarkdownViewer from "../components/MarkdownViewer";
import Overlay from "../components/Overlay";
import ProposalReviewOverlay, {
  EnrichedObservation as EnrichedObs,
  ProposalDto as ProposalDetail,
} from "../components/proposals/ProposalReviewOverlay";
import Select from "../components/Select";

type SkillsTab = "active" | "proposals" | "consolidated";
type ActiveSkillsState = "loading" | "success" | "error";
type ProposalView = "open" | "history";
type ProposalLoadState = "idle" | "loading" | "success" | "error";

const PROPOSAL_PAGE_LIMIT = 25;

type ProposalCountsState = {
  project: string | null;
  state: ProposalLoadState;
  data: SkillProposalCounts | null;
  error: string | null;
};

type ProposalPageState = {
  project: string | null;
  state: ProposalLoadState;
  rows: SkillProposalSummary[];
  nextCursor: string | null;
  hasMore: boolean;
  error: string | null;
  loadingMore: boolean;
  loadMoreError: string | null;
};

function emptyProposalCounts(project: string | null): ProposalCountsState {
  return { project, state: "idle", data: null, error: null };
}

function emptyProposalPage(project: string | null): ProposalPageState {
  return {
    project,
    state: "idle",
    rows: [],
    nextCursor: null,
    hasMore: false,
    error: null,
    loadingMore: false,
    loadMoreError: null,
  };
}

function proposalErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function appendProposalRows(current: SkillProposalSummary[], incoming: SkillProposalSummary[]): SkillProposalSummary[] {
  const knownIds = new Set(current.map((proposal) => proposal.id));
  return [...current, ...incoming.filter((proposal) => {
    if (knownIds.has(proposal.id)) return false;
    knownIds.add(proposal.id);
    return true;
  })];
}

const CONSOLIDATED_SOURCES: { legacy: string; canonical: string }[] = [
  { legacy: "api-aggregation-patterns", canonical: "development-conventions" },
  { legacy: "ingenium-ops", canonical: "development-conventions" },
  { legacy: "language-conventions", canonical: "development-conventions" },
  { legacy: "mail-app-ui-conventions", canonical: "development-conventions" },
  { legacy: "visual-standards-conventions", canonical: "development-conventions" },
  { legacy: "git-history-hygiene", canonical: "devops-conventions" },
  { legacy: "github-cli", canonical: "devops-conventions" },
  { legacy: "onboard-existing-repo", canonical: "devops-conventions" },
  { legacy: "parallel-session-hygiene", canonical: "devops-conventions" },
  { legacy: "database-migration-management", canonical: "database-conventions" },
  { legacy: "sqlite-migration-patterns", canonical: "database-conventions" },
  { legacy: "sqlite-wal-safety", canonical: "database-conventions" },
  { legacy: "agent-execution-quality", canonical: "engineering-workflow" },
  { legacy: "agent-workflow-patterns", canonical: "engineering-workflow" },
  { legacy: "debugging-patterns", canonical: "engineering-workflow" },
  { legacy: "configuring-opencode", canonical: "engineering-workflow" },
  { legacy: "logging-visibility", canonical: "engineering-workflow" },
  { legacy: "orchestrator-primer", canonical: "engineering-workflow" },
  { legacy: "per-project-scoping", canonical: "engineering-workflow" },
  { legacy: "supervision-logging", canonical: "engineering-workflow" },
  { legacy: "uncensored-direct-response", canonical: "engineering-workflow" },
  { legacy: "browsing-the-web", canonical: "mcp-tooling" },
  { legacy: "dashboard-screenshots", canonical: "mcp-tooling" },
  { legacy: "security-audit-workflow", canonical: "security-audit" },
  { legacy: "docs-workspace", canonical: "documentation" },
  { legacy: "documentation-architecture", canonical: "documentation" },
  { legacy: "documentation-audit-workflow", canonical: "documentation" },
  { legacy: "local-persistence", canonical: "skill-maintenance" },
];

function proposalStatusHue(status: string): string {
  switch (status) {
    case "draft": return "gray";
    case "pending": return "amber";
    case "rejected": return "red";
    case "applied": return "green";
    case "rolled_back":
    case "rolledBack": return "orange";
    case "stale": return "slate";
    default: return "gray";
  }
}

function proposalTypeHue(type: string): string {
  switch (type) {
    case "create": return "emerald";
    case "update": return "blue";
    case "merge": return "purple";
    case "archive": return "orange";
    default: return "gray";
  }
}

export default function SkillsPage() {
  const project = useProject();

  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsState, setSkillsState] = useState<ActiveSkillsState>("loading");
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [skillsProject, setSkillsProject] = useState<string | null>(null);
  const skillsRequestId = useRef(0);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<"alpha" | "newest">("alpha");
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [selectedFile, setSelectedFile] = useState<string>("SKILL.md");
  const [fileContent, setFileContent] = useState<string>("");
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const fileRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<SkillsTab>("active");
  const [proposalCounts, setProposalCounts] = useState<ProposalCountsState>(() => emptyProposalCounts(null));
  const [openProposalPage, setOpenProposalPage] = useState<ProposalPageState>(() => emptyProposalPage(null));
  const [historyProposalPage, setHistoryProposalPage] = useState<ProposalPageState>(() => emptyProposalPage(null));
  const [proposalView, setProposalView] = useState<ProposalView>("open");
  const proposalGeneration = useRef(0);
  const proposalRequestControllers = useRef(new Set<AbortController>());
  const proposalDetailRequestId = useRef(0);
  const currentProjectRef = useRef(project);
  currentProjectRef.current = project;
  const [selectedProposal, setSelectedProposal] = useState<ProposalDetail | null>(null);
  const [proposalDetail, setProposalDetail] = useState<ProposalDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [currentSkillContent, setCurrentSkillContent] = useState<string | null>(null);
  const [enrichedObservations, setEnrichedObservations] = useState<EnrichedObs[]>([]);

  const loadSkills = useCallback(async (): Promise<boolean> => {
    const requestId = ++skillsRequestId.current;
    setSkillsState("loading");
    setSkillsError(null);
    setSkills([]);

    try {
      const r = await api.skills.list(project);
      if (requestId !== skillsRequestId.current) return true;
      setSkills(r.data ?? []);
      setSkillsProject(project);
      setSkillsState("success");
      return true;
    } catch (err: unknown) {
      if (requestId !== skillsRequestId.current) return true;
      setSkills([]);
      setSkillsProject(project);
      setSkillsState("error");
      setSkillsError(err instanceof Error && err.message ? err.message : "Failed to load active skills");
      return false;
    }
  }, [project]);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const abortProposalRequests = useCallback(() => {
    for (const controller of proposalRequestControllers.current) controller.abort();
    proposalRequestControllers.current.clear();
  }, []);

  const resetProposalData = useCallback((requestProject: string): number => {
    abortProposalRequests();
    const generation = ++proposalGeneration.current;
    proposalDetailRequestId.current += 1;
    setProposalCounts(emptyProposalCounts(requestProject));
    setOpenProposalPage(emptyProposalPage(requestProject));
    setHistoryProposalPage(emptyProposalPage(requestProject));
    setProposalView("open");
    setSelectedProposal(null);
    setProposalDetail(null);
    setDetailLoading(false);
    setActionLoading(false);
    setActionError(null);
    setCurrentSkillContent(null);
    setEnrichedObservations([]);
    return generation;
  }, [abortProposalRequests]);

  const isCurrentProposalRequest = useCallback((generation: number, requestProject: string, controller: AbortController): boolean => (
    !controller.signal.aborted
    && generation === proposalGeneration.current
    && requestProject === currentProjectRef.current
  ), []);

  const loadProposalCounts = useCallback(async (requestProject: string, generation = proposalGeneration.current): Promise<void> => {
    const controller = new AbortController();
    proposalRequestControllers.current.add(controller);
    setProposalCounts({ project: requestProject, state: "loading", data: null, error: null });

    try {
      const response = await api.skills.proposals.counts(requestProject, controller.signal);
      if (!isCurrentProposalRequest(generation, requestProject, controller)) return;
      setProposalCounts({ project: requestProject, state: "success", data: response.data, error: null });
    } catch (error: unknown) {
      if (!isCurrentProposalRequest(generation, requestProject, controller)) return;
      setProposalCounts({
        project: requestProject,
        state: "error",
        data: null,
        error: proposalErrorMessage(error, "Failed to load proposal totals"),
      });
    } finally {
      proposalRequestControllers.current.delete(controller);
    }
  }, [isCurrentProposalRequest]);

  const loadProposalPage = useCallback(async (
    view: ProposalView,
    requestProject: string,
    options: { cursor?: string; append?: boolean; generation?: number } = {},
  ): Promise<void> => {
    const { cursor, append = false, generation = proposalGeneration.current } = options;
    const controller = new AbortController();
    const setPage = view === "open" ? setOpenProposalPage : setHistoryProposalPage;
    proposalRequestControllers.current.add(controller);
    setPage((current) => {
      const existing = append && current.project === requestProject ? current : emptyProposalPage(requestProject);
      return {
        ...existing,
        project: requestProject,
        state: append ? existing.state : "loading",
        rows: append ? existing.rows : [],
        nextCursor: append ? existing.nextCursor : null,
        hasMore: append ? existing.hasMore : false,
        error: append ? existing.error : null,
        loadingMore: append,
        loadMoreError: null,
      };
    });

    try {
      const response = await api.skills.proposals.page(view, requestProject, {
        limit: PROPOSAL_PAGE_LIMIT,
        ...(cursor ? { cursor } : {}),
        signal: controller.signal,
      });
      if (!isCurrentProposalRequest(generation, requestProject, controller)) return;
      setPage((current) => {
        const existingRows = append && current.project === requestProject ? current.rows : [];
        return {
          project: requestProject,
          state: "success",
          rows: append ? appendProposalRows(existingRows, response.data) : response.data,
          nextCursor: response.pagination.nextCursor,
          hasMore: response.pagination.hasMore,
          error: null,
          loadingMore: false,
          loadMoreError: null,
        };
      });
    } catch (error: unknown) {
      if (!isCurrentProposalRequest(generation, requestProject, controller)) return;
      const message = proposalErrorMessage(error, `Failed to load ${view} proposals`);
      if (append) {
        setPage((current) => current.project === requestProject
          ? { ...current, loadingMore: false, loadMoreError: message }
          : current);
      } else {
        setPage({
          ...emptyProposalPage(requestProject),
          state: "error",
          error: message,
        });
      }
    } finally {
      proposalRequestControllers.current.delete(controller);
    }
  }, [isCurrentProposalRequest]);

  const refreshProposalData = useCallback((requestProject: string) => {
    const generation = resetProposalData(requestProject);
    void loadProposalCounts(requestProject, generation);
    void loadProposalPage("open", requestProject, { generation });
  }, [loadProposalCounts, loadProposalPage, resetProposalData]);

  useEffect(() => {
    const generation = resetProposalData(project);
    if (tab !== "proposals") return;
    void loadProposalCounts(project, generation);
    void loadProposalPage("open", project, { generation });
  }, [loadProposalCounts, loadProposalPage, project, resetProposalData, tab]);

  useEffect(() => () => {
    abortProposalRequests();
  }, [abortProposalRequests]);

  useEffect(() => {
    if (tab !== "proposals" || proposalView !== "history") return;
    if (historyProposalPage.project !== project || historyProposalPage.state !== "idle") return;
    void loadProposalPage("history", project, { generation: proposalGeneration.current });
  }, [historyProposalPage.project, historyProposalPage.state, loadProposalPage, project, proposalView, tab]);

  const fetchSkill = async (name: string) => {
    try {
      const r = await api.skills.get(name, project);
      setSelectedSkill(r.data);
      setSelectedFile("SKILL.md");
      setFileContent(r.data.content);
      setEditMode(false);
    } catch {}
  };

  const handleSelectFile = (path: string, content: string) => {
    setSelectedFile(path);
    setFileContent(content);
    setEditMode(false);
  };

  const handleEdit = () => {
    setEditText(fileContent);
    setEditMode(true);
  };

  const handleSave = async () => {
    if (!selectedSkill) return;
    setSaving(true);
    try {
      let fileTree = selectedSkill.file_tree;
      if (selectedFile !== "SKILL.md" && fileTree) {
        const tree = JSON.parse(fileTree);
        tree[selectedFile] = editText;
        fileTree = JSON.stringify(tree);
      }
      await api.skills.update(selectedSkill.name, selectedFile === "SKILL.md" ? editText : selectedSkill.content, {
        tags: selectedSkill.tags ?? undefined,
        always_apply: selectedSkill.always_apply,
        files: fileTree ?? undefined,
      }, project);
      setFileContent(editText);
      setEditMode(false);
      await fetchSkill(selectedSkill.name);
    } catch {}
    setSaving(false);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadStatus("uploading");
    try {
      const text = await file.text();
      const match = text.match(/^---\s*\nname:\s*(.+)\ndescription:\s*(.+)\n---\s*\n([\s\S]*)$/m);
      if (!match) {
        setUploadStatus("error");
        setTimeout(() => setUploadStatus("idle"), 3000);
        return;
      }
      await api.skills.create(match[1]!.trim(), match[2]!.trim(), match[3]!.trim(), project);
      if (!await loadSkills()) {
        setUploadStatus("error");
        setTimeout(() => setUploadStatus("idle"), 3000);
        return;
      }
      setUploadStatus("success");
      setTimeout(() => setUploadStatus("idle"), 3000);
    } catch {
      setUploadStatus("error");
      setTimeout(() => setUploadStatus("idle"), 3000);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const openProposal = async (proposal: SkillProposalSummary) => {
    const requestId = ++proposalDetailRequestId.current;
    const requestProject = project;
    setSelectedProposal(proposal as ProposalDetail);
    setDetailLoading(true);
    setActionError(null);
    setCurrentSkillContent(null);
    setEnrichedObservations([]);
    try {
      const r = await api.skills.proposals.get(proposal.id, requestProject);
      if (requestId !== proposalDetailRequestId.current || requestProject !== currentProjectRef.current) return;
      const detail = r.data as ProposalDetail & {
        observations?: EnrichedObs[];
        currentSkill?: { content?: string | null } | null;
      };
      setProposalDetail(detail);
      if (Array.isArray(detail.observations)) {
        setEnrichedObservations(detail.observations);
      }
      const proposalType = detail.proposalType ?? proposal.proposalType;
      if (proposalType !== "create") {
        if (detail.currentSkill) {
          setCurrentSkillContent(detail.currentSkill.content ?? null);
        } else if (detail.targetName) {
          try {
            const skillR = await api.skills.get(detail.targetName, requestProject);
            if (requestId !== proposalDetailRequestId.current || requestProject !== currentProjectRef.current) return;
            setCurrentSkillContent(skillR.data?.content ?? null);
          } catch {
            if (requestId !== proposalDetailRequestId.current || requestProject !== currentProjectRef.current) return;
            setCurrentSkillContent(null);
          }
        }
      }
    } catch {
      if (requestId !== proposalDetailRequestId.current || requestProject !== currentProjectRef.current) return;
      setProposalDetail(null);
    } finally {
      if (requestId === proposalDetailRequestId.current && requestProject === currentProjectRef.current) {
        setDetailLoading(false);
      }
    }
  };

  const closeProposal = () => {
    proposalDetailRequestId.current += 1;
    setSelectedProposal(null);
    setProposalDetail(null);
    setDetailLoading(false);
    setActionError(null);
  };

  const handleApprove = async (reviewer: string, reason: string) => {
    const proposalId = selectedProposal?.id;
    const requestProject = project;
    if (!proposalId) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await api.skills.proposals.approve(proposalId, reviewer, reason || undefined, requestProject);
      if (requestProject !== currentProjectRef.current) return;
      closeProposal();
      refreshProposalData(requestProject);
    } catch (error: unknown) {
      if (requestProject === currentProjectRef.current) {
        setActionError(proposalErrorMessage(error, "Approval failed"));
      }
    } finally {
      if (requestProject === currentProjectRef.current) setActionLoading(false);
    }
  };

  const handleReject = async (reviewer: string, reason: string) => {
    const proposalId = selectedProposal?.id;
    const requestProject = project;
    if (!proposalId) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await api.skills.proposals.reject(proposalId, reviewer, reason || undefined, requestProject);
      if (requestProject !== currentProjectRef.current) return;
      closeProposal();
      refreshProposalData(requestProject);
    } catch (error: unknown) {
      if (requestProject === currentProjectRef.current) {
        setActionError(proposalErrorMessage(error, "Rejection failed"));
      }
    } finally {
      if (requestProject === currentProjectRef.current) setActionLoading(false);
    }
  };

  const handleRollback = async (reviewer: string, reason: string) => {
    const proposalId = selectedProposal?.id;
    const requestProject = project;
    if (!proposalId) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await api.skills.proposals.rollback(proposalId, reviewer, reason, requestProject);
      if (requestProject !== currentProjectRef.current) return;
      closeProposal();
      refreshProposalData(requestProject);
    } catch (error: unknown) {
      if (requestProject === currentProjectRef.current) {
        setActionError(proposalErrorMessage(error, "Rollback failed"));
      }
    } finally {
      if (requestProject === currentProjectRef.current) setActionLoading(false);
    }
  };

  const filtered = [...skills]
    .sort((a, b) => {
      if (sortMode === "newest") return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
      return a.name.localeCompare(b.name);
    })
    .filter((s) => !search || s.name.includes(search) || s.description.includes(search));

  const isMarkdown = selectedFile.endsWith(".md") || selectedFile === "SKILL.md";
  const lang = selectedFile.split(".").pop() || "";
  const activeSkillsError = skillsProject === project && skillsState === "error" ? skillsError : null;
  const activeSkillsReady = skillsProject === project && skillsState === "success";
  const activeSkillsLoading = !activeSkillsReady && activeSkillsError === null;
  const countsForProject = proposalCounts.project === project ? proposalCounts : emptyProposalCounts(null);
  const openPageForProject = openProposalPage.project === project ? openProposalPage : emptyProposalPage(null);
  const historyPageForProject = historyProposalPage.project === project ? historyProposalPage : emptyProposalPage(null);
  const hasProposalDataForProject = countsForProject.project === project
    || openPageForProject.project === project
    || historyPageForProject.project === project;
  const visibleProposalView = hasProposalDataForProject ? proposalView : "open";
  const visibleProposalPage = visibleProposalView === "open" ? openPageForProject : historyPageForProject;
  const proposalTotal = countsForProject.state === "success" ? countsForProject.data?.[visibleProposalView] ?? null : null;
  const proposalViewLoading = visibleProposalPage.state === "idle" || visibleProposalPage.state === "loading";
  const proposalViewError = visibleProposalPage.state === "error" ? visibleProposalPage.error : null;

  const selectProposalView = (view: ProposalView) => {
    setProposalView(view);
  };

  const handleProposalViewKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, view: ProposalView) => {
    let nextView: ProposalView | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextView = view === "open" ? "history" : "open";
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextView = view === "open" ? "history" : "open";
    if (event.key === "Home") nextView = "open";
    if (event.key === "End") nextView = "history";
    if (!nextView) return;
    event.preventDefault();
    setProposalView(nextView);
    document.getElementById(`proposal-filter-${nextView}`)?.focus();
  };

  const retryProposalCounts = () => {
    void loadProposalCounts(project);
  };

  const retryProposalPage = () => {
    void loadProposalPage(visibleProposalView, project);
  };

  const loadMoreProposals = (view: ProposalView) => {
    const page = view === "open" ? openPageForProject : historyPageForProject;
    if (page.loadingMore || !page.hasMore || !page.nextCursor) return;
    void loadProposalPage(view, project, { cursor: page.nextCursor, append: true });
  };

  const renderProposalBadge = (type: string) => (
    <span className={`${BADGE_BASE} ${badgeTones(proposalTypeHue(type))}`}>{type}</span>
  );

  const renderStatusBadge = (status: string) => (
    <span className={`${BADGE_BASE} ${badgeTones(proposalStatusHue(status))}`}>{status}</span>
  );

  return (
    <div className="space-y-8" data-testid="skills-page">
      <h1 className="text-3xl font-bold">
        {activeSkillsReady ? `Active Skills (${skills.length})` : "Active Skills"}
      </h1>
      <p className="text-sm text-[var(--color-text-muted)]" data-testid="skills-project-label">
        Project: <span className="font-medium text-[var(--color-text-secondary)]">{project}</span>
      </p>

      <div className="flex gap-1 border-b border-[var(--color-border)]" data-testid="skills-tabs">
        {([
          ["active", "Active"],
          ["proposals", "Proposals"],
          ["consolidated", "Consolidated Sources"],
        ] as [SkillsTab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            data-testid={`tab-${t}`}
            className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
              tab === t
                ?                 "bg-[var(--color-surface)] text-[var(--color-nav-text-active)] border border-[var(--color-border)] border-b-[var(--color-surface)] -mb-px"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "active" && (
        <>
          {activeSkillsLoading && (
            <p className="text-center py-12 text-[var(--color-text-muted)]" data-testid="active-skills-loading">
              Loading active skills...
            </p>
          )}
          {activeSkillsError && (
            <div className="bg-[var(--color-error-bg)] border border-[var(--color-error-border)] text-[var(--color-error-text)] p-4 rounded" data-testid="active-skills-error" role="alert">
              {activeSkillsError}
            </div>
          )}
          {activeSkillsReady && (
            <>
          <div className="flex flex-col gap-2 items-stretch sm:flex-row">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search skills..."
              className="border border-[var(--color-border)] p-2 rounded text-sm min-w-0 w-full sm:flex-1 h-10"
              data-testid="skills-search"
            />
            <label htmlFor="skills-sort" className="sr-only">Sort skills</label>
            <Select
              wrapperClassName="w-full sm:w-auto shrink-0 h-10"
              id="skills-sort"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as any)}
              className="border border-[var(--color-border)] rounded p-2 text-sm bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] cursor-pointer w-full sm:w-auto shrink-0 h-10"
              data-testid="skills-sort"
            >
              <option value="alpha">Alphabetical</option>
              <option value="newest">Newest first</option>
            </Select>
            <input ref={fileRef} type="file" accept=".md" onChange={handleUpload} className="hidden" data-testid="skills-upload-input" />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploadStatus === "uploading"}
              className="bg-blue-600 text-white p-2 rounded hover:bg-blue-700 disabled:opacity-50 w-full sm:w-auto shrink-0 h-10"
              data-testid="skills-upload-btn"
            >
              {uploadStatus === "uploading" ? "Uploading..." : "Upload Skill"}
            </button>
            {uploadStatus === "success" && <span className="text-sm text-[var(--color-success-text)]" data-testid="upload-success">Uploaded!</span>}
            {uploadStatus === "error" && <span className="text-sm text-[var(--color-error-text)]" data-testid="upload-error">Invalid file. Use a .md with name: and description: frontmatter.</span>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="skills-grid">
            {filtered.length === 0 && (
              <p className="col-span-3 text-center py-12 text-[var(--color-text-muted)]" data-testid="active-skills-empty">
                {search
                  ? "No skills match your search."
                  : `No active skills in ${project}. Use the project selector above to switch projects.`}
              </p>
            )}
            {filtered.map((s) => (
              <button
                type="button"
                key={s.id}
                onClick={() => fetchSkill(s.name)}
                className="w-full bg-[var(--color-surface)] p-4 rounded border border-[var(--color-border)] hover:shadow-md transition-shadow cursor-pointer text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
                data-testid={`skill-card-${s.name}`}
                aria-label={`Open skill ${s.name}`}
              >
                <span className="block font-medium text-[var(--color-text-primary)]">{s.name}</span>
                <span className="block text-sm text-[var(--color-text-muted)] truncate">{s.description}</span>
                {s.tags && <span className="block text-xs mt-1" style={{ color: "var(--color-text-link)" }}>{s.tags}</span>}
              </button>
            ))}
          </div>
            </>
          )}

          {selectedSkill && (
            <Overlay
              isOpen
              onClose={() => setSelectedSkill(null)}
              title={selectedSkill.name}
              subtitle={selectedSkill.description}
              panelClassName="mt-[5dvh] w-11/12 max-w-7xl h-[90dvh] min-h-0"
              bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
            >
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row" data-testid="skill-modal-body">
                <FileTree
                  fileTreeJson={selectedSkill.file_tree ?? undefined}
                  skillContent={selectedSkill.content}
                  skillName={selectedSkill.name}
                  tags={selectedSkill.tags ?? undefined}
                  alwaysApply={selectedSkill.always_apply}
                  onSelectFile={handleSelectFile}
                  selectedFile={selectedFile}
                />
                <section
                  aria-label={`Preview ${selectedFile}`}
                  data-testid="skill-preview"
                  className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                >
                  <div className="flex min-w-0 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] p-4">
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text-muted)] font-mono" title={selectedFile}>{selectedFile}</span>
                    <div className="flex shrink-0 gap-2">
                      {!editMode && (
                        <button onClick={handleEdit} className="text-xs px-3 py-1 border rounded hover:bg-[var(--color-surface-hover)]">Edit</button>
                      )}
                      {editMode && (
                        <>
                          <button onClick={() => { setEditMode(false); setEditText(fileContent); }} className="text-xs px-3 py-1 border rounded hover:bg-[var(--color-surface-hover)]">Cancel</button>
                          <button onClick={handleSave} disabled={saving} className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">{saving ? "Saving..." : "Save"}</button>
                        </>
                      )}
                    </div>
                  </div>
                  <div data-testid="skill-preview-content" className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
                    {editMode ? (
                      <textarea
                        id="skill-editor"
                        aria-label={`Edit ${selectedFile}`}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="h-full min-h-0 w-full p-4 border rounded font-mono text-sm resize-none"
                      />
                    ) : (
                      <div className="min-w-0 break-words [overflow-wrap:anywhere]">
                        <MarkdownViewer content={fileContent} isMarkdown={isMarkdown} language={lang} />
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </Overlay>
          )}
        </>
      )}

      {tab === "proposals" && (
        <>
          <div className="flex gap-1 border-b border-[var(--color-border)]" role="tablist" aria-label="Proposal views" data-testid="proposal-view-tabs">
            {([
              ["open", `Open proposals (${countsForProject.state === "success" ? countsForProject.data?.open.toLocaleString() : "—"})`],
              ["history", `Proposal history (${countsForProject.state === "success" ? countsForProject.data?.history.toLocaleString() : "—"})`],
            ] as [ProposalView, string][]).map(([view, label]) => (
              <button
                key={view}
                type="button"
                role="tab"
                aria-selected={visibleProposalView === view}
                aria-controls="proposal-results"
                onClick={() => selectProposalView(view)}
                onKeyDown={(event) => handleProposalViewKeyDown(event, view)}
                id={`proposal-filter-${view}`}
                data-testid={`proposal-filter-${view}`}
                className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
                  visibleProposalView === view
                    ? "bg-[var(--color-surface)] text-[var(--color-nav-text-active)] border border-[var(--color-border)] border-b-[var(--color-surface)] -mb-px"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {countsForProject.state === "loading" && (
            <p className="mt-3 text-sm text-[var(--color-text-muted)]" data-testid="proposal-counts-loading" role="status">
              Loading proposal totals...
            </p>
          )}
          {countsForProject.state === "error" && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded border border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-4 text-[var(--color-error-text)]" data-testid="proposal-counts-error" role="alert">
              <span>{countsForProject.error}</span>
              <button type="button" onClick={retryProposalCounts} className="underline">Retry totals</button>
            </div>
          )}

          <div
            id="proposal-results"
            role="tabpanel"
            aria-labelledby={`proposal-filter-${visibleProposalView}`}
            aria-busy={proposalViewLoading || visibleProposalPage.loadingMore}
          >
            {proposalViewLoading && (
              <p className="text-center py-12 text-[var(--color-text-muted)]" data-testid={`proposals-${visibleProposalView}-loading`} role="status">
                Loading {visibleProposalView === "open" ? "open proposals" : "proposal history"}...
              </p>
            )}
            {proposalViewError && (
              <div className="flex flex-wrap items-center gap-3 rounded border border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-4 text-[var(--color-error-text)]" data-testid={`proposals-${visibleProposalView}-error`} role="alert">
                <span>{proposalViewError}</span>
                <button type="button" onClick={retryProposalPage} className="underline">Retry {visibleProposalView} proposals</button>
              </div>
            )}

            {!proposalViewLoading && !proposalViewError && (
              <p className="mt-4 text-sm text-[var(--color-text-muted)]" data-testid={`proposals-${visibleProposalView}-showing`}>
                {proposalTotal === null
                  ? `Showing ${visibleProposalPage.rows.length.toLocaleString()} loaded ${visibleProposalView === "open" ? "open proposals" : "history proposals"}.`
                  : `Showing ${visibleProposalPage.rows.length.toLocaleString()} of ${proposalTotal.toLocaleString()} ${visibleProposalView === "open" ? "open proposals" : "history proposals"}.`}
              </p>
            )}

            {!proposalViewLoading && !proposalViewError && visibleProposalPage.rows.length === 0 && (
              <p className="text-center py-12 text-[var(--color-text-muted)]" data-testid={`proposals-${visibleProposalView}-empty`}>
                {visibleProposalView === "open"
                  ? `No open proposals in ${project}.`
                  : `No proposal history in ${project}.`}
              </p>
            )}

            {!proposalViewLoading && !proposalViewError && visibleProposalPage.rows.length > 0 && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="proposals-grid">
                {visibleProposalPage.rows.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => openProposal(p)}
                    className="w-full bg-[var(--color-surface)] p-4 rounded border border-[var(--color-border)] hover:shadow-md transition-shadow cursor-pointer text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
                    data-testid={`proposal-card-${p.id}`}
                    aria-label={`Open ${p.proposalType} proposal for ${p.targetName}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      {renderProposalBadge(p.proposalType)}
                      {renderStatusBadge(p.status)}
                    </div>
                    <h3 className="font-medium text-[var(--color-text-primary)] truncate">{p.targetName}</h3>
                    {p.sourceName && (
                      <p className="text-xs text-[var(--color-text-muted)] truncate">Source: {p.sourceName}</p>
                    )}
                    <div className="mt-2 flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
                      <span data-testid={`proposal-quality-${p.id}`}>Quality: {(p.qualityScore * 100).toFixed(0)}%</span>
                      {p.noveltyScore > 0 && (
                        <span data-testid={`proposal-novelty-${p.id}`}>Novelty: {(p.noveltyScore * 100).toFixed(0)}%</span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </p>
                  </button>
                ))}
              </div>
            )}

            {visibleProposalPage.loadMoreError && (
              <p className="mt-3 text-sm text-[var(--color-error-text)]" data-testid={`proposals-${visibleProposalView}-load-more-error`} role="alert">
                Could not load more {visibleProposalView === "open" ? "open proposals" : "history"}: {visibleProposalPage.loadMoreError}
              </p>
            )}
            {visibleProposalPage.hasMore && visibleProposalPage.nextCursor && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => loadMoreProposals(visibleProposalView)}
                  disabled={visibleProposalPage.loadingMore}
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  data-testid={`proposals-${visibleProposalView}-load-more`}
                >
                  {visibleProposalPage.loadingMore
                    ? `Loading more ${visibleProposalView} proposals...`
                    : `Load more ${visibleProposalView === "open" ? "open proposals" : "history"}`}
                </button>
              </div>
            )}
          </div>

          <ProposalReviewOverlay
            isOpen={selectedProposal !== null}
            onClose={closeProposal}
            proposal={selectedProposal!}
            proposalDetail={proposalDetail}
            detailLoading={detailLoading}
            currentSkillContent={currentSkillContent}
            enrichedObservations={enrichedObservations}
            project={project}
            onApprove={handleApprove}
            onReject={handleReject}
            onRollback={handleRollback}
            actionLoading={actionLoading}
            actionError={actionError}
            onViewSkill={() => { closeProposal(); setTab("active"); }}
          />
        </>
      )}

      {tab === "consolidated" && (
        <>
          <p className="text-sm text-[var(--color-text-muted)]">
            The Phase 3 taxonomy consolidation (2026-07-16) reduced 36 legacy skills to 10 canonical skills.
            Below are the 28 legacy skill names and the canonical skill they were absorbed into.
            Source content is preserved under{" "}
            <code className="bg-[var(--color-code-bg)] px-1.5 py-0.5 rounded text-xs">references/sources/&lt;legacy-name&gt;/</code>{" "}
            in each canonical skill directory.
          </p>

          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded overflow-hidden" data-testid="consolidated-list">
            <div className="grid grid-cols-2 px-4 py-2.5 bg-[var(--color-surface-muted)] border-b border-[var(--color-border)] text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
              <span>Legacy Skill</span>
              <span>Canonical Target</span>
            </div>
            {CONSOLIDATED_SOURCES.map(({ legacy, canonical }) => (
              <div
                key={legacy}
                className="grid grid-cols-2 px-4 py-2 border-b border-[var(--color-border-muted)] last:border-b-0 text-sm hover:bg-[var(--color-surface-hover)] transition-colors"
                data-testid={`consolidated-row-${legacy}`}
              >
                <span className="text-[var(--color-text-primary)] font-mono text-xs">{legacy}</span>
                <span className="text-[var(--color-text-link)]">{canonical}</span>
              </div>
            ))}
          </div>

          <p className="text-xs text-[var(--color-text-muted)]">
            Source: <em>docs/reference/skill-taxonomy.md</em> — Phase 3 consolidation map with SHA-256 provenance hashes.
          </p>
        </>
      )}
    </div>
  );
}
