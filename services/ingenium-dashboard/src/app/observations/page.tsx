"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useProject } from "../../lib/ProjectContext";
import { api, Observation } from "../../lib/api";
import Overlay from "../components/Overlay";
import PageHeader from "../components/PageHeader";
import Toolbar from "../components/Toolbar";
import FilterPills from "../components/FilterPills";
import SearchInput from "../components/SearchInput";
import Badge from "../components/Badge";
import EmptyState from "../components/EmptyState";

const TYPE_COLORS: Record<string, string> = {
  correction: "bg-red-100 text-red-700",
  preference: "bg-purple-100 text-purple-700",
  pattern: "bg-green-100 text-green-700",
  insight: "bg-blue-100 text-blue-700",
  feedback: "bg-yellow-100 text-yellow-700",
  behavior: "bg-orange-100 text-orange-700",
  terminology: "bg-indigo-100 text-indigo-700",
  workflow: "bg-teal-100 text-teal-700",
  error: "bg-red-200 text-red-800",
  goal: "bg-pink-100 text-pink-700",
};

const TYPE_BORDER: Record<string, string> = {
  correction: "border-l-red-400",
  preference: "border-l-purple-400",
  pattern: "border-l-green-400",
  insight: "border-l-blue-400",
  feedback: "border-l-yellow-400",
  behavior: "border-l-orange-400",
  terminology: "border-l-indigo-400",
  workflow: "border-l-teal-400",
  error: "border-l-red-600",
  goal: "border-l-pink-400",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  processed: "bg-green-100 text-green-700",
  skipped: "bg-gray-100 text-gray-500",
  failed: "bg-red-100 text-red-700",
};

const TYPE_COLOR_MAP: Record<string, BadgeColor> = {
  correction: "red",
  preference: "purple",
  pattern: "green",
  insight: "blue",
  feedback: "yellow",
  behavior: "orange",
  terminology: "indigo",
  workflow: "teal",
  error: "red",
  goal: "pink",
};

type BadgeColor = "blue" | "green" | "red" | "yellow" | "purple" | "gray" | "indigo" | "teal" | "orange" | "pink";

const STATUS_OPTIONS = ["pending", "processed", "skipped", "failed"];
const TYPE_OPTIONS = [
  "correction", "preference", "pattern", "insight", "feedback",
  "behavior", "terminology", "workflow", "error", "goal",
];

function safeParseJson(raw: string | undefined | null): object | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default function ObservationsPage() {
  const router = useRouter();
  const project = useProject();
  const [observations, setObservations] = useState<Observation[]>([]);
  const [statusFilter, setStatusFilter] = useState(new Set<string>(new Set<string>()));
  const [typeFilter, setTypeFilter] = useState(new Set<string>(new Set<string>()));
  const [searchText, setSearchText] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [stats, setStats] = useState({ total: 0, pending: 0 });

  useEffect(() => {
    api.observations.list(project, "", "").then((r) => setObservations(r.data || [])).catch(() => {});
    api.observations.stats(project).then((r) => setStats(r.data || { total: 0, pending: 0 })).catch(() => {});
  }, [project]);

  const filtered = useMemo(() => {
    return observations.filter((o) => {
      if (statusFilter.size > 0 && !statusFilter.has(o.status)) return false;
      if (typeFilter.size > 0 && !typeFilter.has(o.observation_type)) return false;
      if (searchText && !o.content.toLowerCase().includes(searchText.toLowerCase())) return false;
      return true;
    });
  }, [observations, statusFilter, typeFilter, searchText]);

  const toggleFilter = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    key: string,
  ) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Observations"
        subtitle="Agent observations and behavior patterns"
        stats={[
          { label: "Total", value: stats.total },
          { label: "Pending", value: stats.pending, color: "yellow" },
        ]}
      />

      <Toolbar>
        <FilterPills
          label="Status:"
          options={STATUS_OPTIONS.map((s) => ({ key: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
          selected={statusFilter}
          onToggle={(key) => toggleFilter(setStatusFilter, key)}
        />
        <FilterPills
          label="Type:"
          options={TYPE_OPTIONS.map((t) => ({ key: t, label: t.charAt(0).toUpperCase() + t.slice(1), color: TYPE_COLOR_MAP[t] ?? "gray" }))}
          selected={typeFilter}
          onToggle={(key) => toggleFilter(setTypeFilter, key)}
        />
        <div className="flex-1 min-w-[200px]">
          <SearchInput
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search content..."
          />
        </div>
      </Toolbar>

      <div className="space-y-2">
        {observations.length === 0 ? (
          <EmptyState
            message="No observations yet."
            subtitle="The agent will record observations automatically during interactions."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            message="No matching observations."
            subtitle="Try adjusting the filters or search term."
          />
        ) : (
          filtered.map((o: Observation) => (
            <div
              key={o.id}
              className={`bg-white p-4 rounded border-l-4 ${TYPE_BORDER[o.observation_type] || "border-l-gray-300"} border border-l-4 hover:shadow-md transition-shadow group cursor-pointer`}
              onClick={() => setSelected(o)}
            >
              <div className="flex gap-2 items-center mb-1 flex-wrap">
                <Badge color={TYPE_COLOR_MAP[o.observation_type] || "gray"} variant="solid">
                  {o.observation_type}
                </Badge>
                <Badge color={o.status === "pending" ? "yellow" : o.status === "processed" ? "green" : o.status === "failed" ? "red" : "gray"} variant="solid">
                  {o.status}
                </Badge>
                <span className="text-xs text-gray-400">{new Date(o.created_at).toLocaleString()}</span>
                {o.importance && <span className="text-xs text-gray-400">Importance: {o.importance}/10</span>}
                <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/observations/${o.id}`);
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800 underline"
                    title="View full details"
                  >
                    Open
                  </button>
                </span>
              </div>
              <p className="text-sm">{o.content}</p>
              {o.context && <pre className="text-xs text-gray-400 mt-1 truncate">{o.context}</pre>}
            </div>
          ))
        )}
      </div>

      <Overlay isOpen={selected !== null} onClose={() => setSelected(null)} title={`Observation #${selected?.id ?? ""}`}
        subtitle={selected?.observation_type ? `Type: ${selected.observation_type}` : undefined}>
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="font-semibold">Type:</span> <span className={`inline-block px-2 py-0.5 rounded text-xs ${TYPE_COLORS[selected.observation_type] || ""}`}>{selected.observation_type}</span></div>
              <div><span className="font-semibold">Status:</span> <span className={`inline-block px-2 py-0.5 rounded text-xs ${STATUS_COLORS[selected.status] || ""}`}>{selected.status}</span></div>
              <div><span className="font-semibold">Importance:</span> <span className="text-gray-600">{selected.importance ?? 5}/10</span></div>
              <div><span className="font-semibold">Source:</span> <span className="text-gray-600">{selected.source || "agent"}</span></div>
              <div><span className="font-semibold">Created:</span> <span className="text-gray-600">{new Date(selected.created_at).toLocaleString()}</span></div>
            </div>
            <div>
              <h3 className="font-semibold mb-1">Content</h3>
              <pre className="bg-gray-50 p-4 rounded border overflow-x-auto text-sm font-mono whitespace-pre-wrap">{selected.content}</pre>
            </div>
            {selected.context && (
              <div>
                <h3 className="font-semibold mb-1">Context</h3>
                {(() => {
                  const parsed = safeParseJson(selected.context);
                  return parsed ? (
                    <pre className="bg-gray-50 p-4 rounded border overflow-x-auto text-xs font-mono">{JSON.stringify(parsed, null, 2)}</pre>
                  ) : (
                    <pre className="bg-gray-50 p-4 rounded border overflow-x-auto text-xs font-mono whitespace-pre-wrap text-gray-600">{selected.context}</pre>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </Overlay>
    </div>
  );
}
