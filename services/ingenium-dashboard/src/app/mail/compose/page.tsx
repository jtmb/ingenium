"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import EmailComposer from "../components/EmailComposer";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4097/api/v1";
const PROJECT = "gh-llm-bootstrap";

/**
 * Compose page — create and send a new email or save as draft.
 */
export default function ComposePage() {
  const router = useRouter();
  const [sending, setSending] = useState(false);

  const handleSend = useCallback(
    async (data: any) => {
      setSending(true);
      try {
        // Transform form data to API format: account, to: [{address: string}], cc?, bcc?, subject, text?
        const body: Record<string, any> = { account: data.accountId, subject: data.subject };
        if (data.to) body.to = data.to.split(",").map((s: string) => ({ address: s.trim() })).filter((s: any) => s.address);
        if (data.cc) body.cc = data.cc.split(",").map((s: string) => ({ address: s.trim() })).filter((s: any) => s.address);
        if (data.bcc) body.bcc = data.bcc.split(",").map((s: string) => ({ address: s.trim() })).filter((s: any) => s.address);
        if (data.body) body.text = data.body;

        const res = await fetch(`${API_BASE}/emails?project=${PROJECT}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          router.push("/mail");
        } else {
          const errData = await res.json().catch(() => ({ error: { message: "Send failed" } }));
          alert(errData.error?.message || "Failed to send");
        }
      } catch (err: any) {
        alert(err.message || "Failed to send");
      } finally {
        setSending(false);
      }
    },
    [router]
  );

  const handleSave = useCallback(
    async (data: any) => {
      try {
        // Transform form data to API format
        const body: Record<string, any> = { account: data.accountId, subject: data.subject };
        if (data.to) body.to = data.to.split(",").map((s: string) => ({ address: s.trim() })).filter((s: any) => s.address);
        if (data.cc) body.cc = data.cc.split(",").map((s: string) => ({ address: s.trim() })).filter((s: any) => s.address);
        if (data.bcc) body.bcc = data.bcc.split(",").map((s: string) => ({ address: s.trim() })).filter((s: any) => s.address);
        if (data.body) body.text = data.body;

        const res = await fetch(`${API_BASE}/emails/draft?project=${PROJECT}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          router.push("/mail");
        } else {
          const errData = await res.json().catch(() => ({ error: { message: "Save failed" } }));
          alert(errData.error?.message || "Failed to save draft");
        }
      } catch (err: any) {
        alert(err.message || "Failed to save draft");
      }
    },
    [router]
  );

  const handleCancel = useCallback(() => {
    if (window.confirm("Discard this message?")) {
      router.push("/mail");
    }
  }, [router]);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">New Message</h1>
      <EmailComposer
        onSend={handleSend}
        onSave={handleSave}
        onCancel={handleCancel}
      />
      {sending && (
        <p className="text-sm text-gray-500 text-center">Sending...</p>
      )}
    </div>
  );
}
