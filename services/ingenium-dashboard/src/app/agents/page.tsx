"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect, useMemo } from "react";
import { useProject } from "../../lib/ProjectContext";
import Overlay from "../components/Overlay";
import MarkdownViewer from "../components/MarkdownViewer";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import { api, type Agent } from "@/lib/api";

/**
 * Agent management page.
 * Full CRUD: create, edit, enable/disable, delete agent definitions synced to OpenCode.
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

  const enabledCount = useMemo(() => agents.filter(a => a.enabled).length, [agents]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Agents"
        subtitle="Manage AI agent definitions"
        stats={[
          { label: "Total", value: agents.length },
          { label: "Enabled", value: enabledCount, color: "green" },
        ]}
      >
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          {showCreate ? "Cancel" : "Add Agent"}
        </button>
      </PageHeader>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error}
          <button onClick={() => setError(null)} className="float-right font-bold">&times;</button>
        </div>
      )}

      {showCreate && (
        <div className="bg-white p-4 rounded border space-y-4 hover:shadow-md transition-shadow">
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
          <div className="flex gap-4">
            <select className="border border-gray-200 bg-white px-3 py-1.5 rounded flex-1 hover:bg-gray-50 cursor-pointer" value={newCat} onChange={e => setNewCat(e.target.value)}>
              <option value="primary">Primary</option>
              <option value="execution">Execution</option>
              <option value="research">Research</option>
              <option value="security">Security</option>
            </select>
            <select className="border border-gray-200 bg-white px-3 py-1.5 rounded flex-1 hover:bg-gray-50 cursor-pointer" value={newMode} onChange={e => setNewMode(e.target.value)}>
              <option value="primary">Primary</option>
              <option value="subagent">Subagent</option>
            </select>
          </div>
          <input
            className="border p-2 rounded w-full"
            placeholder="Model (optional, e.g., deepseek/deepseek-v4-flash)"
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
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
          >
            Create Agent
          </button>
        </div>
      )}

      {loading && <p className="text-gray-500">Loading agents...</p>}

      {!loading && agents.length === 0 && (
        <EmptyState
          message="No agents registered"
          subtitle="Click Add Agent to create one."
          action={{ label: "Add Agent", onClick: () => setShowCreate(true) }}
        />
      )}

      {grouped.map(group => (
        <div key={group.category}>
          <h2 className="text-2xl font-semibold capitalize mb-4">{group.category}</h2>
          <div className="space-y-4">
            {group.items.map(agent => (
              <div key={agent.id} className="bg-white p-4 rounded border hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedAgent(agent)}>
                {editingId === agent.id ? (
                  <div className="space-y-4">
                    <input
                      className="border p-2 rounded w-full"
                      placeholder="Description"
                      value={editDesc}
                      onChange={e => setEditDesc(e.target.value)}
                    />
                    <div className="flex gap-4">
                      <select className="border border-gray-200 bg-white px-3 py-1.5 rounded flex-1 hover:bg-gray-50 cursor-pointer" value={editCat} onChange={e => setEditCat(e.target.value)}>
                        <option value="primary">Primary</option>
                        <option value="execution">Execution</option>
                        <option value="research">Research</option>
                        <option value="security">Security</option>
                      </select>
                      <input
                        className="border p-2 rounded flex-1"
                        placeholder="Model"
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
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleUpdate(agent.name)}
                        className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="bg-gray-500 text-white px-3 py-1 rounded text-sm hover:bg-gray-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="font-semibold text-lg">{agent.name}</span>
                        <span className={`ml-2 text-xs px-2 py-0.5 rounded ${agent.mode === 'primary' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`}>
                          {agent.mode}
                        </span>
                        <span className={`ml-2 text-xs px-2 py-0.5 rounded ${agent.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'}`}>
                          {agent.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggle(agent); }}
                          className={`px-3 py-1 rounded text-sm text-white ${agent.enabled ? 'bg-gray-500 hover:bg-gray-600' : 'bg-green-500 hover:bg-green-600'}`}
                        >
                          {agent.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); startEdit(agent); }}
                          className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
                        >
                          Edit
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(agent.name); }}
                          className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {agent.description && <p className="text-sm text-gray-600 mb-2">{agent.description}</p>}
                    {agent.model && <p className="text-xs text-gray-400">Model: {agent.model}</p>}
                    <details className="mt-2">
                      <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">Preview content</summary>
                      <pre className="mt-2 text-xs bg-gray-50 p-2 rounded overflow-x-auto max-h-32 overflow-y-auto">
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
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="font-semibold">Category:</span> <span className="text-gray-600">{selectedAgent.category}</span></div>
              <div><span className="font-semibold">Mode:</span> <span className="text-gray-600">{selectedAgent.mode}</span></div>
              {selectedAgent.model && <div><span className="font-semibold">Model:</span> <span className="text-gray-600">{selectedAgent.model}</span></div>}
              <div><span className="font-semibold">Enabled:</span> <span className={selectedAgent.enabled ? "text-green-600" : "text-red-600"}>{selectedAgent.enabled ? "Yes" : "No"}</span></div>
            </div>
            <MarkdownViewer content={selectedAgent.content} isMarkdown={true} />
          </div>
        )}
      </Overlay>
    </div>
  );
}
