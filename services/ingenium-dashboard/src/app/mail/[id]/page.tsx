"use client";

import { useState, useEffect, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import EmailReader from "../components/EmailReader";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4097/api/v1";
const PROJECT = "gh-llm-bootstrap";

/**
 * Email detail page — full-page reader for a single email by UID.
 * If `id` is "compose", redirects to the compose page.
 */
export default function EmailDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = resolvedParams.id;
  const accountId = searchParams.get("account") || "";
  const folder = searchParams.get("folder") || "INBOX";

  const [email, setEmail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Redirect "compose" id to inbox (compose is now an overlay on /mail)
  useEffect(() => {
    if (id === "compose") {
      router.replace("/mail");
    }
  }, [id, router]);

  // Fetch email by UID
  useEffect(() => {
    if (!id || id === "compose") return;

    const fetchEmail = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${API_BASE}/emails/${id}?project=${PROJECT}&account=${accountId}&folder=${encodeURIComponent(folder)}`
        );
        if (res.ok) {
          const data = await res.json();
          setEmail(data.data);
        } else {
          const errData = await res.json().catch(() => ({ error: { message: "Email not found" } }));
          setError(errData.error?.message || "Email not found");
        }
      } catch (err: any) {
        setError(err.message || "Failed to load email");
      } finally {
        setLoading(false);
      }
    };
    fetchEmail();
  }, [id]);

  const handleReply = () => {
    if (email) {
      router.push("/mail");
    }
  };

  const handleForward = () => {
    if (email) {
      router.push("/mail");
    }
  };

  const handleDelete = async () => {
    if (!email) return;
    try {
      const res = await fetch(`${API_BASE}/emails/${email.uid}?project=${PROJECT}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: accountId }),
      });
      if (res.ok) {
        router.push("/mail");
      }
    } catch {
      // silently fail
    }
  };

  const handleArchive = async () => {
    if (!email) return;
    try {
      const res = await fetch(`${API_BASE}/emails/${email.uid}/move?project=${PROJECT}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: accountId, fromFolder: folder, toFolder: "Archive" }),
      });
      if (res.ok) {
        router.push("/mail");
      }
    } catch {
      // silently fail
    }
  };

  if (id === "compose") return null;

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-6">Email</h1>
        <div className="border border-[var(--color-border)] rounded bg-[var(--color-surface)]">
          <EmailReader email={null} loading={true} accountId={accountId} onReply={() => {}} onForward={() => {}} onDelete={() => {}} onArchive={() => {}} />
        </div>
      </div>
    );
  }

  if (error || !email) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-6">Email</h1>
        <div className="bg-[var(--color-surface)] p-6 rounded-lg border text-center">
          <p className="text-[var(--color-text-muted)] text-sm mb-4">{error || "Email not found"}</p>
          <button
            onClick={() => router.push("/mail")}
            className="bg-blue-600 text-white py-2 px-4 rounded text-sm font-medium"
          >
            Back to Inbox
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => router.push("/mail")}
          className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          ← Back to Inbox
        </button>
      </div>
      <div className="border border-[var(--color-border)] rounded bg-[var(--color-surface)]">
        <EmailReader
          email={email}
          loading={false}
          accountId={accountId}
          onReply={handleReply}
          onForward={handleForward}
          onDelete={handleDelete}
          onArchive={handleArchive}
        />
      </div>
    </div>
  );
}
