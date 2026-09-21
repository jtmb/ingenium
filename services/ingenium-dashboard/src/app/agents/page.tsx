"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import { useProject } from "../../lib/ProjectContext";
import Overlay from "../components/Overlay";
import MarkdownViewer from "../components/MarkdownViewer";
import Select from "../components/Select";
import { api, type Agent } from "@/lib/api";
import { badgeTones, BADGE_BASE } from "@/lib/badgeTones";

/**
 * AgentsPage — Full CRUD for agent definitions synced to OpenCode.
 *
 * Agents are categorized into `categoryOrder`:
 *   ["primary", "execution", "research", "security"]
 * This ordering is hardcoded rather than alphabetical to reflect the
 * logical hierarchy: orchestrator agents first, then support roles.
 *
 * Each agent maps to a `.opencode/agents/<name>.md` file on disk.
 * Models and enablement are runtime settings in centralized opencode.json.
 */
export default function AgentsPage() {
  const project = useProject();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  // Create form state
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newCat, setNewCat] = useState("execution");
  const [newMode, setNewMode] = useState("subagent");
  const [newModel, setNewModel] = useState("");
  const [newContent, setNewContent] = useState("");

  // Edit state
  const [editContent, setEditContent] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editModel, setEditModel] = useState("");
  const [editCat, setEditCat] = useState("");

  const fetchAgents = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.agents.list(project);
      setAgents(res.data);
    } catch (err: any) {
      setError(err.message || "Failed to load agents");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAgents(); }, [project]);

  const handleCreate = async () => {
    if (!newName || !newContent) return;
    try {
      const data: any = { name: newName, content: newContent, description: newDesc, category: newCat, mode: newMode };
      if (newModel) data.model = newModel;
      await api.agents.create(data, project);
      setShowCreate(false);
      setNewName(""); setNewDesc(""); setNewContent(""); setNewModel("");
      fetchAgents();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleUpdate = async (name: string) => {
    try {
      const data: any = {};
      if (editDesc !== undefined) data.description = editDesc;
      if (editModel !== undefined) data.model = editModel;
      if (editCat !== undefined) data.category = editCat;
      if (editContent !== undefined) data.content = editContent;
      await api.agents.update(name, data, project);
      setEditingId(null);
      fetchAgents();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (name: string) => {
    if (!window.confirm(`Delete agent "${name}"? This will remove its file from disk.`)) return;
    try {
      await api.agents.delete(name, project);
      fetchAgents();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleToggle = async (agent: Agent) => {
    try {
      if (agent.enabled) await api.agents.disable(agent.name, project);
      else await api.agents.enable(agent.name, project);
      fetchAgents();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const startEdit = (agent: Agent) => {
    setEditingId(agent.id);
    setEditContent(agent.content);
    setEditDesc(agent.description);
    setEditModel(agent.model || "");
    setEditCat(agent.category);
  };

  const categoryOrder = ["primary", "execution", "research", "security"];
  const grouped = categoryOrder
    .map(cat => ({ category: cat, items: agents.filter(a => a.category === cat) }))
    .filter(g => g.items.length > 0);

  return (
    <div className="space-y-8 min-w-0">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="min-w-0 break-words text-3xl font-bold">Agents</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="w-full rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 sm:w-auto"
        >
          {showCreate ? "Cancel" : "Add Agent"}
        </button>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-[var(--color-error-text)] px-4 py-3 rounded">
          {error}
          <button onClick={() => setError(null)} className="float-right font-bold">&times;</button>
        </div>
      )}

      {showCreate && (
        <div className="bg-[var(--color-surface)] p-4 rounded border border-[var(--color-border)] space-y-4 hover:shadow-md transition-shadow">
          <h2 className="text-xl font-semibold">Create New Agent</h2>
          <input
            className="border p-2 rounded w-full"
            placeholder="Agent name (e.g., ingenium-qa)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
          />
          <input
            className="border p-2 rounded w-full"
            placeholder="Description"
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
            <Select wrapperClassName="w-full sm:flex-1" aria-label="New agent category" className="w-full cursor-pointer rounded border p-2 hover:bg-[var(--color-surface-hover)] sm:flex-1" value={newCat} onChange={e => setNewCat(e.target.value)}>
              <option value="primary">Primary</option>
              <option value="execution">Execution</option>
              <option value="research">Research</option>
              <option value="security">Security</option>
            </Select>
            <Select wrapperClassName="w-full sm:flex-1" aria-label="New agent mode" className="w-full cursor-pointer rounded border p-2 hover:bg-[var(--color-surface-hover)] sm:flex-1" value={newMode} onChange={e => setNewMode(e.target.value)}>
              <option value="primary">Primary</option>
              <option value="subagent">Subagent</option>
            </Select>
          </div>
          <input
            className="border p-2 rounded w-full"
            placeholder="Runtime model (opencode.json; optional)"
            value={newModel}
            onChange={e => setNewModel(e.target.value)}
          />
          <textarea
            className="border p-2 rounded w-full font-mono text-sm"
            rows={10}
            placeholder="Full agent .md content after the frontmatter..."
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
          />
          <button
            onClick={handleCreate}
            className="w-full rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 sm:w-auto"
          >
            Create Agent
          </button>
        </div>
      )}

      {loading && <p className="text-[var(--color-text-muted)]">Loading agents...</p>}

      {!loading && agents.length === 0 && (
        <div className="text-center py-12 text-[var(--color-text-muted)]">
          <p className="text-lg">No agents registered</p>
          <p className="text-sm">Use "Add Agent" to create your first agent. Agents are written to .opencode/agents/ and synced to global config.</p>
        </div>
      )}

      {grouped.map(group => (
        <div key={group.category}>
          <h2 className="text-2xl font-semibold capitalize mb-4">{group.category}</h2>
          <div className="space-y-4">
            {group.items.map(agent => (
              <div key={agent.id} className="min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow">
                {editingId === agent.id ? (
                  <div className="space-y-4">
                    <input
                      className="border p-2 rounded w-full"
                      placeholder="Description"
                      value={editDesc}
                      onChange={e => setEditDesc(e.target.value)}
                    />
                    <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
                      <Select wrapperClassName="w-full sm:flex-1" aria-label="Agent category" className="w-full cursor-pointer rounded border p-2 hover:bg-[var(--color-surface-hover)] sm:flex-1" value={editCat} onChange={e => setEditCat(e.target.value)}>
                        <option value="primary">Primary</option>
                        <option value="execution">Execution</option>
                        <option value="research">Research</option>
                        <option value="security">Security</option>
                      </Select>
                      <input
                        className="w-full rounded border p-2 sm:flex-1"
                        placeholder="Runtime model (opencode.json)"
                        value={editModel}
                        onChange={e => setEditModel(e.target.value)}
                      />
                    </div>
                    <textarea
                      className="border p-2 rounded w-full font-mono text-sm"
                      rows={8}
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                    />
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        onClick={() => handleUpdate(agent.name)}
                        className="w-full rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 sm:w-auto"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="w-full rounded bg-gray-500 px-3 py-1 text-sm text-white hover:bg-gray-600 sm:w-auto"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="mb-2 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
                        onClick={() => setSelectedAgent(agent)}
                        aria-label={`View agent ${agent.name}`}
                      >
                        <span className="break-all text-lg font-semibold">{agent.name}</span>
                        <span className={`ml-2 ${BADGE_BASE} ${agent.mode === "primary" ? badgeTones("purple") : badgeTones("blue")}`}>{agent.mode}</span>
                        <span className={`ml-2 ${BADGE_BASE} ${agent.enabled ? badgeTones("success") : badgeTones("muted")}`}>{agent.enabled ? "Enabled" : "Disabled"}</span>
                        {agent.description && <span className="mt-2 block break-words text-sm text-[var(--color-text-secondary)]">{agent.description}</span>}
                        {agent.model && <span className="mt-1 block break-all text-xs text-[var(--color-text-muted)]">Runtime model: {agent.model}</span>}
                      </button>
                      <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
                        <button
                          type="button"
                          onClick={() => void handleToggle(agent)}
                          className={`flex-1 rounded px-3 py-1 text-sm text-white sm:flex-none ${agent.enabled ? 'bg-gray-500 hover:bg-gray-600' : 'bg-green-500 hover:bg-green-600'}`}
                        >
                          {agent.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(agent)}
                          className="flex-1 rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 sm:flex-none"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(agent.name)}
                          className="flex-1 rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700 sm:flex-none"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <details className="mt-2">
                      <summary className="text-xs text-[var(--color-text-muted)] cursor-pointer hover:text-[var(--color-text-primary)]">Preview content</summary>
                       <pre className="mt-2 max-h-32 overflow-x-auto overflow-y-auto break-all rounded bg-[var(--color-surface-muted)] p-2 text-xs whitespace-pre-wrap">
                        {agent.content.substring(0, 500)}{agent.content.length > 500 ? '...' : ''}
                      </pre>
                    </details>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      <Overlay
        isOpen={selectedAgent !== null}
        onClose={() => setSelectedAgent(null)}
        title={selectedAgent?.name ?? ""}
        subtitle={selectedAgent?.description}
      >
        {selectedAgent && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div className="break-words"><span className="font-semibold">Category:</span> <span className="text-[var(--color-text-secondary)]">{selectedAgent.category}</span></div>
              <div className="break-words"><span className="font-semibold">Mode:</span> <span className="text-[var(--color-text-secondary)]">{selectedAgent.mode}</span></div>
               {selectedAgent.model && <div className="break-all"><span className="font-semibold">Runtime model (opencode.json):</span> <span className="text-[var(--color-text-secondary)]">{selectedAgent.model}</span></div>}
              <div className="break-words"><span className="font-semibold">Enabled:</span> <span className={selectedAgent.enabled ? "text-[var(--color-success-text)]" : "text-[var(--color-error-text)]"}>{selectedAgent.enabled ? "Yes" : "No"}</span></div>
            </div>
            <MarkdownViewer content={selectedAgent.content} isMarkdown={true} />
          </div>
        )}
      </Overlay>
    </div>
  );
}
