"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useProject } from "../../../lib/ProjectContext";
import { api, Observation } from "../../../lib/api";

const TYPE_COLORS: Record<string, string> = {
  correction: "bg-red-100 text-[var(--color-error-text)]",
  preference: "bg-purple-100 text-purple-700",
  pattern: "bg-[var(--color-success-bg)] text-green-700",
  insight: "bg-[var(--color-selection-bg)] text-[var(--color-accent)]",
  feedback: "bg-yellow-100 text-yellow-700",
  behavior: "bg-orange-100 text-orange-700",
  terminology: "bg-indigo-100 text-indigo-700",
  workflow: "bg-teal-100 text-teal-700",
  error: "bg-red-200 text-red-800",
  goal: "bg-pink-100 text-pink-700",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  processed: "bg-[var(--color-success-bg)] text-green-700",
  skipped: "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]",
  failed: "bg-red-100 text-[var(--color-error-text)]",
};

function safeParseJson(raw: string | undefined | null): object | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * ObservationDetailPage — Full-page detail view for a single observation.
 *
 * The `id` param is resolved from the dynamic route segment. It is parsed
 * to an integer for the API call; non-numeric IDs render a 404-like error
 * state. Context is parsed as JSON when possible for rich display.
 */
export default function ObservationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const project = useProject();
  const [observation, setObservation] = useState<Observation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const numericId = parseInt(id);
    if (isNaN(numericId)) {
      setError("Invalid observation ID");
      return;
    }
    api.observations
      .get(numericId, project)
      .then((r) => setObservation(r.data))
      .catch((err) => setError(err.message ?? "Failed to load observation"));
  }, [id, project]);

  if (error) {
    return (
      <div className="text-center py-20">
        <h1 className="text-4xl font-bold text-[var(--color-text-muted)]">404</h1>
        <p className="text-[var(--color-text-muted)] mt-2">Observation not found</p>
        <button
          onClick={() => router.push("/observations")}
          className="mt-4 text-[var(--color-text-link)] hover:underline"
        >
          Back to observations
        </button>
      </div>
    );
  }

  if (!observation) {
    return (
      <div className="text-center py-20">
        <div className="animate-spin h-8 w-8 border-2 border-gray-300 border-t-blue-600 rounded-full mx-auto" />
        <p className="text-[var(--color-text-muted)] mt-4">Loading observation...</p>
      </div>
    );
  }

  const parsedContext = safeParseJson(observation.context);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Observation #{observation.id}</h1>
        <button
          onClick={() => router.push("/observations")}
          className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        >
          &larr; Back to list
        </button>
      </div>

      <div className="bg-[var(--color-surface)] p-6 rounded border border-[var(--color-border)] shadow-sm space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="font-semibold">Type:</span>{" "}
            <span
              className={`inline-block px-2 py-0.5 rounded text-xs ${
                TYPE_COLORS[observation.observation_type] || ""
              }`}
            >
              {observation.observation_type}
            </span>
          </div>
          <div>
            <span className="font-semibold">Status:</span>{" "}
            <span
              className={`inline-block px-2 py-0.5 rounded text-xs ${
                STATUS_COLORS[observation.status] || ""
              }`}
            >
              {observation.status}
            </span>
          </div>
          <div>
            <span className="font-semibold">Importance:</span>{" "}
            <span className="text-[var(--color-text-secondary)]">{observation.importance ?? 5}/10</span>
          </div>
          <div>
            <span className="font-semibold">Source:</span>{" "}
            <span className="text-[var(--color-text-secondary)]">{observation.source || "agent"}</span>
          </div>
          <div>
            <span className="font-semibold">Created:</span>{" "}
            <span className="text-[var(--color-text-secondary)]">
              {new Date(observation.created_at).toLocaleString()}
            </span>
          </div>
          <div>
            <span className="font-semibold">Project:</span>{" "}
            <span className="text-[var(--color-text-secondary)]">{observation.project_id}</span>
          </div>
        </div>

        <div>
          <h3 className="font-semibold mb-2">Content</h3>
          <pre className="bg-[var(--color-surface-muted)] p-4 rounded border border-[var(--color-border)] overflow-x-auto text-sm font-mono whitespace-pre-wrap">
            {observation.content}
          </pre>
        </div>

        {observation.context && (
          <div>
            <h3 className="font-semibold mb-2">Context</h3>
            {parsedContext ? (
              <pre className="bg-[var(--color-surface-muted)] p-4 rounded border border-[var(--color-border)] overflow-x-auto text-xs font-mono">
                {JSON.stringify(parsedContext, null, 2)}
              </pre>
            ) : (
              <pre className="bg-[var(--color-surface-muted)] p-4 rounded border border-[var(--color-border)] overflow-x-auto text-xs font-mono whitespace-pre-wrap text-[var(--color-text-secondary)]">
                {observation.context}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
