"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect, useRef, useCallback } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api, Skill } from "../../lib/api";
import { badgeTones, BADGE_BASE } from "../../lib/badgeTones";
import FileTree from "../components/FileTree";
import MarkdownViewer from "../components/MarkdownViewer";

/** Active tab selection for the skills page. */
type SkillsTab = "active" | "proposals" | "consolidated";

/** DTO shape returned by the API for governance proposals (camelCase via proposalToDto). */
type ProposalDto = {
  id: string;
  projectId: string;
  status: string; // draft | pending | approved | rejected | applied | rolledBack | stale
  proposalType: string; // create | update | merge | archive
  targetSkillId: string | null;
  targetName: string;
  sourceProjectId: string | null;
  sourceName: string | null;
  expectedRevision: number | null;
  expectedSourceRevision: number | null;
  targetRevisionBefore: number | null;
  sourceRevisionBefore: number | null;
  targetCreated: number;
  proposedState: Record<string, unknown>;
  evidence: unknown[];
  observationIds: unknown[];
  qualityScore: number;
  noveltyScore: number;
  contradictionFlag: number;
  candidateGroupKey: string | null;
  reviewer: string | null;
  reviewReason: string | null;
  alwaysApply: number;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  appliedAt: string | null;
  rolledBackAt: string | null;
};

/** Consolidated sources from Phase 3 taxonomy migration (28 legacy → 10 canonical). */
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

/** Map proposal status → badge hue. */
function proposalStatusHue(status: string): string {
  switch (status) {
    case "draft": return "gray";
    case "pending": return "amber";
    case "approved": return "blue";
    case "rejected": return "red";
    case "applied": return "green";
    case "rolledBack": return "orange";
    case "stale": return "slate";
    default: return "gray";
  }
}

/** Map proposal type → badge hue. */
function proposalTypeHue(type: string): string {
  switch (type) {
    case "create": return "emerald";
    case "update": return "blue";
    case "merge": return "purple";
    case "archive": return "orange";
    default: return "gray";
  }
}

/**
 * SkillsPage — Skills browser with governance support.
 *
 * Three tabs:
 *   Active — existing card grid with search/sort/upload and the overlay editor
 *   Proposals — governance proposal list with approve/reject/rollback actions
 *   Consolidated Sources — Phase 3 legacy-to-canonical mapping (28 entries)
 */
export default function SkillsPage() {
  const project = useProject();

  // ── Active tab state ─────────────────────────────────────────────
  const [skills, setSkills] = useState<Skill[]>([]);
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

  // ── Tab & proposal state ─────────────────────────────────────────
  const [tab, setTab] = useState<SkillsTab>("active");
  const [proposals, setProposals] = useState<ProposalDto[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(false);
  const [proposalsError, setProposalsError] = useState<string | null>(null);
  const [selectedProposal, setSelectedProposal] = useState<ProposalDto | null>(null);
  const [proposalDetail, setProposalDetail] = useState<ProposalDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [reviewerName, setReviewerName] = useState("");
  const [reviewReason, setReviewReason] = useState("");
  const [currentSkillContent, setCurrentSkillContent] = useState<string | null>(null);

  // ── Load skills ──────────────────────────────────────────────────
  useEffect(() => {
    api.skills.list(project).then((r) => setSkills(r.data)).catch(() => {});
  }, [project]);

  // ── Load proposals ───────────────────────────────────────────────
  const loadProposals = useCallback(() => {
    setProposalsLoading(true);
    setProposalsError(null);
    api.skills.proposals.list(project)
      .then((r) => setProposals(r.data ?? []))
      .catch((err) => setProposalsError(err?.message ?? "Failed to load proposals"))
      .finally(() => setProposalsLoading(false));
  }, [project]);

  useEffect(() => {
    if (tab === "proposals") loadProposals();
  }, [tab, loadProposals]);

  // ── Fetch skill detail for overlay ───────────────────────────────
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

  // ── Upload ───────────────────────────────────────────────────────
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
      setUploadStatus("success");
      setTimeout(() => setUploadStatus("idle"), 3000);
      const res = await api.skills.list(project);
      setSkills(res.data);
    } catch {
      setUploadStatus("error");
      setTimeout(() => setUploadStatus("idle"), 3000);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  // ── Proposal detail overlay ─────────────────────────────────────
  const openProposal = async (proposal: ProposalDto) => {
    setSelectedProposal(proposal);
    setDetailLoading(true);
    setReviewerName("");
    setReviewReason("");
    setCurrentSkillContent(null);
    try {
      const r = await api.skills.proposals.get(proposal.id, project);
      setProposalDetail(r.data);
      // Fetch current skill content for comparison
      if (proposal.targetName) {
        try {
          const skillR = await api.skills.get(proposal.targetName, project);
          setCurrentSkillContent(skillR.data?.content ?? null);
        } catch {
          setCurrentSkillContent(null);
        }
      }
    } catch {
      setProposalDetail(null);
    }
    setDetailLoading(false);
  };

  const closeProposal = () => {
    setSelectedProposal(null);
    setProposalDetail(null);
  };

  const handleApprove = async () => {
    if (!selectedProposal || !reviewerName.trim()) return;
    setActionLoading(true);
    try {
      await api.skills.proposals.approve(selectedProposal.id, reviewerName.trim(), reviewReason.trim() || undefined, project);
      closeProposal();
      loadProposals();
    } catch {}
    setActionLoading(false);
  };

  const handleReject = async () => {
    if (!selectedProposal || !reviewerName.trim()) return;
    setActionLoading(true);
    try {
      await api.skills.proposals.reject(selectedProposal.id, reviewerName.trim(), reviewReason.trim() || undefined, project);
      closeProposal();
      loadProposals();
    } catch {}
    setActionLoading(false);
  };

  const handleRollback = async () => {
    if (!selectedProposal || !reviewerName.trim() || !reviewReason.trim()) return;
    setActionLoading(true);
    try {
      await api.skills.proposals.rollback(selectedProposal.id, reviewerName.trim(), reviewReason.trim(), project);
      closeProposal();
      loadProposals();
    } catch {}
    setActionLoading(false);
  };

  // ── Filtered skills ─────────────────────────────────────────────
  const filtered = [...skills]
    .sort((a, b) => {
      if (sortMode === "newest") return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
      return a.name.localeCompare(b.name);
    })
    .filter((s) => !search || s.name.includes(search) || s.description.includes(search));

  const isMarkdown = selectedFile.endsWith(".md") || selectedFile === "SKILL.md";
  const lang = selectedFile.split(".").pop() || "";

  // ── Render helpers ───────────────────────────────────────────────
  const renderProposalBadge = (type: string) => (
    <span className={`${BADGE_BASE} ${badgeTones(proposalTypeHue(type))}`}>{type}</span>
  );

  const renderStatusBadge = (status: string) => (
    <span className={`${BADGE_BASE} ${badgeTones(proposalStatusHue(status))}`}>{status}</span>
  );

  return (
    <div className="space-y-8" data-testid="skills-page">
      <h1 className="text-3xl font-bold">Skills ({skills.length})</h1>

      {/* ── Tab bar ──────────────────────────────────────────────── */}
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
                ? "bg-[var(--color-surface)] text-blue-700 border border-[var(--color-border)] border-b-[var(--color-surface)] -mb-px"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════
          ACTIVE TAB — existing skills grid
          ══════════════════════════════════════════════════════════════ */}
      {tab === "active" && (
        <>
          {/* Search + Upload */}
          <div className="flex gap-2 items-stretch">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search skills..."
              className="border border-[var(--color-border)] p-2 rounded text-sm flex-1 h-10"
              data-testid="skills-search"
            />
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as any)}
              className="border border-[var(--color-border)] rounded p-2 text-sm bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] cursor-pointer h-10"
              data-testid="skills-sort"
            >
              <option value="alpha">Alphabetical</option>
              <option value="newest">Newest first</option>
            </select>
            <input ref={fileRef} type="file" accept=".md" onChange={handleUpload} className="hidden" data-testid="skills-upload-input" />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploadStatus === "uploading"}
              className="bg-blue-600 text-white p-2 rounded hover:bg-blue-700 disabled:opacity-50 h-10"
              data-testid="skills-upload-btn"
            >
              {uploadStatus === "uploading" ? "Uploading..." : "Upload Skill"}
            </button>
            {uploadStatus === "success" && <span className="text-sm text-[var(--color-success-text)]" data-testid="upload-success">Uploaded!</span>}
            {uploadStatus === "error" && <span className="text-sm text-[var(--color-error-text)]" data-testid="upload-error">Invalid file. Use a .md with name: and description: frontmatter.</span>}
          </div>

          {/* Card grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="skills-grid">
            {filtered.length === 0 && (
              <p className="col-span-3 text-center py-12 text-[var(--color-text-muted)]">
                {search ? "No skills match your search." : "No skills yet. Upload a skill file to get started."}
              </p>
            )}
            {filtered.map((s) => (
              <div
                key={s.id}
                onClick={() => fetchSkill(s.name)}
                className="bg-[var(--color-surface)] p-4 rounded border border-[var(--color-border)] hover:shadow-md transition-shadow cursor-pointer"
                data-testid={`skill-card-${s.name}`}
              >
                <h3 className="font-medium text-[var(--color-text-primary)]">{s.name}</h3>
                <p className="text-sm text-[var(--color-text-muted)] truncate">{s.description}</p>
                {s.tags && <p className="text-xs mt-1" style={{ color: "var(--color-text-link)" }}>{s.tags}</p>}
              </div>
            ))}
          </div>

          {/* Overlay with split layout */}
          {selectedSkill && (
            <div className="fixed inset-0 z-50 flex items-start justify-center" data-testid="skill-overlay">
              <div className="absolute inset-0 bg-black/50" onClick={() => setSelectedSkill(null)} />
              <div className="relative mt-8 mb-8 w-11/12 max-w-7xl bg-[var(--color-surface)] rounded-lg shadow-2xl flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
                  <div>
                    <h2 className="text-xl font-bold text-[var(--color-text-primary)]">{selectedSkill.name}</h2>
                    <p className="text-sm text-[var(--color-text-muted)]">{selectedSkill.description}</p>
                  </div>
                  <button onClick={() => setSelectedSkill(null)} className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] rounded-full">✕</button>
                </div>
                {/* Body: split layout */}
                <div className="flex flex-1 overflow-hidden">
                  <FileTree
                    fileTreeJson={selectedSkill.file_tree ?? undefined}
                    skillContent={selectedSkill.content}
                    skillName={selectedSkill.name}
                    tags={selectedSkill.tags ?? undefined}
                    alwaysApply={selectedSkill.always_apply}
                    onSelectFile={handleSelectFile}
                    selectedFile={selectedFile}
                  />
                  <div className="flex-1 overflow-y-auto p-4">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-sm text-[var(--color-text-muted)] font-mono">{selectedFile}</span>
                      <div className="flex gap-2">
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
                    {editMode ? (
                      <textarea value={editText} onChange={(e) => setEditText(e.target.value)} className="w-full h-full min-h-[400px] p-4 border rounded font-mono text-sm resize-none" />
                    ) : (
                      <MarkdownViewer content={fileContent} isMarkdown={isMarkdown} language={lang} />
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════
          PROPOSALS TAB
          ══════════════════════════════════════════════════════════════ */}
      {tab === "proposals" && (
        <>
          {/* Proposals loading/error/empty */}
          {proposalsLoading && (
            <p className="text-center py-12 text-[var(--color-text-muted)]" data-testid="proposals-loading">Loading proposals...</p>
          )}
          {proposalsError && (
            <div className="bg-[var(--color-error-bg)] border border-[var(--color-error-border)] text-[var(--color-error-text)] p-4 rounded" data-testid="proposals-error">
              {proposalsError}
            </div>
          )}
          {!proposalsLoading && !proposalsError && proposals.length === 0 && (
            <p className="text-center py-12 text-[var(--color-text-muted)]" data-testid="proposals-empty">
              No governance proposals yet. Proposals are created automatically by the synthesis pipeline when it detects skill changes.
            </p>
          )}

          {/* Proposal cards */}
          {!proposalsLoading && !proposalsError && proposals.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="proposals-grid">
              {proposals.map((p) => (
                <div
                  key={p.id}
                  onClick={() => openProposal(p)}
                  className="bg-[var(--color-surface)] p-4 rounded border border-[var(--color-border)] hover:shadow-md transition-shadow cursor-pointer"
                  data-testid={`proposal-card-${p.id}`}
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
                </div>
              ))}
            </div>
          )}

          {/* ── Proposal detail overlay ──────────────────────────────── */}
          {selectedProposal && (
            <div className="fixed inset-0 z-50 flex items-start justify-center" data-testid="proposal-overlay">
              <div className="absolute inset-0 bg-black/50" onClick={closeProposal} />
              <div className="relative mt-8 mb-8 w-11/12 max-w-7xl bg-[var(--color-surface)] rounded-lg shadow-2xl flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="text-xl font-bold text-[var(--color-text-primary)]">{selectedProposal.targetName}</h2>
                      {renderProposalBadge(selectedProposal.proposalType)}
                      {renderStatusBadge(selectedProposal.status)}
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)] font-mono">{selectedProposal.id}</p>
                  </div>
                  <button onClick={closeProposal} className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] rounded-full">✕</button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6">
                  {detailLoading ? (
                    <p className="text-center py-12 text-[var(--color-text-muted)]">Loading details...</p>
                  ) : !proposalDetail ? (
                    <p className="text-center py-12 text-[var(--color-error-text)]">Failed to load proposal detail.</p>
                  ) : (
                    <div className="space-y-6">
                      {/* Scores */}
                      <div className="grid grid-cols-3 gap-4" data-testid="proposal-scores">
                        <div className="bg-[var(--color-surface-muted)] p-3 rounded">
                          <p className="text-xs text-[var(--color-text-muted)]">Quality</p>
                          <p className="text-lg font-bold">{(proposalDetail.qualityScore * 100).toFixed(0)}%</p>
                        </div>
                        <div className="bg-[var(--color-surface-muted)] p-3 rounded">
                          <p className="text-xs text-[var(--color-text-muted)]">Novelty</p>
                          <p className="text-lg font-bold">{(proposalDetail.noveltyScore * 100).toFixed(0)}%</p>
                        </div>
                        <div className="bg-[var(--color-surface-muted)] p-3 rounded">
                          <p className="text-xs text-[var(--color-text-muted)]">Contradiction</p>
                          <p className="text-lg font-bold">{proposalDetail.contradictionFlag ? "Yes" : "No"}</p>
                        </div>
                      </div>

                      {/* Content comparison */}
                      <div>
                        <h3 className="font-medium mb-2">Content Comparison</h3>
                        <div className="grid grid-cols-2 gap-4" data-testid="proposal-diff">
                          {/* Current content */}
                          <div>
                            <p className="text-xs text-[var(--color-text-muted)] mb-1 font-medium uppercase">Current</p>
                            <div className="border border-[var(--color-border)] rounded p-3 bg-[var(--color-surface-muted)] max-h-64 overflow-y-auto">
                              {proposalDetail.proposalType === "create" ? (
                                <p className="text-sm text-[var(--color-text-muted)] italic">New skill — no current content</p>
                              ) : currentSkillContent !== null ? (
                                <pre className="text-xs font-mono whitespace-pre-wrap">{currentSkillContent || "(empty)"}</pre>
                              ) : (
                                <p className="text-sm text-[var(--color-text-muted)] italic">Loading...</p>
                              )}
                            </div>
                          </div>
                          {/* Proposed content */}
                          <div>
                            <p className="text-xs text-[var(--color-text-muted)] mb-1 font-medium uppercase">Proposed</p>
                            <div className="border border-[var(--color-border)] rounded p-3 bg-[var(--color-surface-muted)] max-h-64 overflow-y-auto">
                              {proposalDetail.proposedState ? (
                                <pre className="text-xs font-mono whitespace-pre-wrap">{prettyJson(proposalDetail.proposedState)}</pre>
                              ) : (
                                <p className="text-sm text-[var(--color-text-muted)] italic">(none)</p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Evidence */}
                      {proposalDetail.evidence && proposalDetail.evidence.length > 0 && (
                        <div>
                          <h3 className="font-medium mb-2">Evidence</h3>
                          <div className="border border-[var(--color-border)] rounded p-3 bg-[var(--color-surface-muted)] max-h-48 overflow-y-auto">
                            <pre className="text-xs font-mono whitespace-pre-wrap" data-testid="proposal-evidence">{prettyJson(proposalDetail.evidence)}</pre>
                          </div>
                        </div>
                      )}

                      {/* Observation IDs */}
                      {proposalDetail.observationIds && proposalDetail.observationIds.length > 0 && (
                        <div>
                          <h3 className="font-medium mb-2">Observation IDs</h3>
                          <div className="flex flex-wrap gap-1" data-testid="proposal-observations">
                            {(proposalDetail.observationIds as number[]).map((oid) => (
                              <span key={oid} className={`${BADGE_BASE} bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300`}>#{oid}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Reviewer info */}
                      {proposalDetail.reviewer && (
                        <div className="bg-[var(--color-info-bg)] border border-[var(--color-info-border)] p-3 rounded text-sm">
                          <p><span className="font-medium">Reviewer:</span> {proposalDetail.reviewer}</p>
                          {proposalDetail.reviewReason && <p className="mt-1"><span className="font-medium">Reason:</span> {proposalDetail.reviewReason}</p>}
                          {proposalDetail.reviewedAt && <p className="mt-1 text-[var(--color-text-muted)]">Reviewed: {new Date(proposalDetail.reviewedAt).toLocaleString()}</p>}
                        </div>
                      )}

                      {/* Timeline */}
                      <div className="text-xs text-[var(--color-text-muted)] space-y-1">
                        <p>Created: {new Date(proposalDetail.createdAt).toLocaleString()}</p>
                        {proposalDetail.appliedAt && <p>Applied: {new Date(proposalDetail.appliedAt).toLocaleString()}</p>}
                        {proposalDetail.rolledBackAt && <p className="text-[var(--color-error-text)]">Rolled back: {new Date(proposalDetail.rolledBackAt).toLocaleString()}</p>}
                      </div>

                      {/* ── Action inputs ──────────────────────────── */}
                      <div className="border-t pt-4 space-y-3">
                        {/* Approve (pending) */}
                        {selectedProposal.status === "pending" && (
                          <div className="space-y-2 p-3 bg-[var(--color-success-bg)] border border-[var(--color-success-border)] rounded" data-testid="proposal-approve-section">
                            <p className="text-sm font-medium text-[var(--color-success-text)]">Approve Proposal</p>
                            <input
                              placeholder="Your name (required)"
                              value={reviewerName}
                              onChange={(e) => setReviewerName(e.target.value)}
                              className="w-full border border-[var(--color-border)] rounded p-2 text-sm"
                              data-testid="proposal-approve-reviewer"
                            />
                            <input
                              placeholder="Reason (optional)"
                              value={reviewReason}
                              onChange={(e) => setReviewReason(e.target.value)}
                              className="w-full border border-[var(--color-border)] rounded p-2 text-sm"
                              data-testid="proposal-approve-reason"
                            />
                            <button
                              onClick={handleApprove}
                              disabled={!reviewerName.trim() || actionLoading}
                              className="px-4 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
                              data-testid="proposal-approve-btn"
                            >
                              {actionLoading ? "Approving..." : "Approve"}
                            </button>
                          </div>
                        )}

                        {/* Reject (pending) */}
                        {selectedProposal.status === "pending" && (
                          <div className="space-y-2 p-3 bg-[var(--color-error-bg)] border border-[var(--color-error-border)] rounded" data-testid="proposal-reject-section">
                            <p className="text-sm font-medium text-[var(--color-error-text)]">Reject Proposal</p>
                            <input
                              placeholder="Your name (required)"
                              value={reviewerName}
                              onChange={(e) => setReviewerName(e.target.value)}
                              className="w-full border border-[var(--color-border)] rounded p-2 text-sm"
                              data-testid="proposal-reject-reviewer"
                            />
                            <input
                              placeholder="Reason (optional)"
                              value={reviewReason}
                              onChange={(e) => setReviewReason(e.target.value)}
                              className="w-full border border-[var(--color-border)] rounded p-2 text-sm"
                              data-testid="proposal-reject-reason"
                            />
                            <button
                              onClick={handleReject}
                              disabled={!reviewerName.trim() || actionLoading}
                              className="px-4 py-1.5 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
                              data-testid="proposal-reject-btn"
                            >
                              {actionLoading ? "Rejecting..." : "Reject"}
                            </button>
                          </div>
                        )}

                        {/* Rollback (applied) */}
                        {selectedProposal.status === "applied" && (
                          <div className="space-y-2 p-3 bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)] rounded" data-testid="proposal-rollback-section">
                            <p className="text-sm font-medium text-[var(--color-warning-text)]">Rollback Proposal</p>
                            <input
                              placeholder="Your name (required)"
                              value={reviewerName}
                              onChange={(e) => setReviewerName(e.target.value)}
                              className="w-full border border-[var(--color-border)] rounded p-2 text-sm"
                              data-testid="proposal-rollback-reviewer"
                            />
                            <input
                              placeholder="Reason (required)"
                              value={reviewReason}
                              onChange={(e) => setReviewReason(e.target.value)}
                              className="w-full border border-[var(--color-border)] rounded p-2 text-sm"
                              data-testid="proposal-rollback-reason"
                            />
                            <button
                              onClick={handleRollback}
                              disabled={!reviewerName.trim() || !reviewReason.trim() || actionLoading}
                              className="px-4 py-1.5 bg-amber-600 text-white text-sm rounded hover:bg-amber-700 disabled:opacity-50"
                              data-testid="proposal-rollback-btn"
                            >
                              {actionLoading ? "Rolling back..." : "Rollback"}
                            </button>
                          </div>
                        )}

                        {/* View Skill button (applied) */}
                        {selectedProposal.status === "applied" && selectedProposal.targetName && (
                          <div>
                            <button
                              onClick={() => { closeProposal(); setTab("active"); }}
                              className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                              data-testid="proposal-view-skill-btn"
                            >
                              View Skill
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════
          CONSOLIDATED SOURCES TAB
          ══════════════════════════════════════════════════════════════ */}
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
            {/* Table header */}
            <div className="grid grid-cols-2 px-4 py-2.5 bg-[var(--color-surface-muted)] border-b border-[var(--color-border)] text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
              <span>Legacy Skill</span>
              <span>Canonical Target</span>
            </div>
            {/* Table rows */}
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
            Source: <em>docs/reference/skill-taxonomy-migration.md</em> — Phase 3 consolidation map with SHA-256 provenance hashes.
          </p>
        </>
      )}
    </div>
  );
}

/** Pretty-print any JSON value as a string. */
function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
