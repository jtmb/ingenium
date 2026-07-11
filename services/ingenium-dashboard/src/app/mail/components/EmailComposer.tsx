"use client";

import { useState } from "react";

/**
 * EmailComposer — simple compose form with From/To/CC/BCC/Subject/Body.
 * Uses <textarea> for body (TipTap integration deferred to follow-up).
 */
export default function EmailComposer({
  initialData,
  onSend,
  onSave,
  onCancel,
}: {
  initialData?: { to?: string; subject?: string; body?: string };
  onSend: (data: any) => void;
  onSave: (data: any) => void;
  onCancel: () => void;
}) {
  const [to, setTo] = useState(initialData?.to || "");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState(initialData?.subject || "");
  const [body, setBody] = useState(initialData?.body || "");
  const [fromAccount, setFromAccount] = useState("");

  const formData = { to, cc: showCc ? cc : "", bcc: showBcc ? bcc : "", subject, body, accountId: fromAccount };

  return (
    <div className="bg-white p-6 rounded-lg border space-y-4 max-w-2xl mx-auto">
      {/* From */}
      <div>
        <label className="block text-sm font-medium text-gray-900 mb-1">From</label>
        <select
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm text-gray-900 hover:bg-gray-50 cursor-pointer"
          value={fromAccount}
          onChange={(e) => setFromAccount(e.target.value)}
        >
          <option value="">Select account</option>
        </select>
      </div>

      {/* To */}
      <div>
        <label className="block text-sm font-medium text-gray-900 mb-1">To</label>
        <input
          type="text"
          placeholder="To"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500"
        />
      </div>

      {/* CC/BCC toggles */}
      <div className="flex gap-4 text-sm">
        <button
          type="button"
          onClick={() => setShowCc(!showCc)}
          className="text-gray-600 hover:text-gray-900"
        >
          {showCc ? "− CC" : "+ CC"}
        </button>
        <button
          type="button"
          onClick={() => setShowBcc(!showBcc)}
          className="text-gray-600 hover:text-gray-900"
        >
          {showBcc ? "− BCC" : "+ BCC"}
        </button>
      </div>

      {showCc && (
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">CC</label>
          <input
            type="text"
            placeholder="CC"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500"
          />
        </div>
      )}

      {showBcc && (
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">BCC</label>
          <input
            type="text"
            placeholder="BCC"
            value={bcc}
            onChange={(e) => setBcc(e.target.value)}
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500"
          />
        </div>
      )}

      {/* Subject */}
      <div>
        <label className="block text-sm font-medium text-gray-900 mb-1">Subject</label>
        <input
          type="text"
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500"
        />
      </div>

      {/* Body */}
      <div>
        <label className="block text-sm font-medium text-gray-900 mb-1">Message</label>
        <textarea
          placeholder="Write your message..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 min-h-[300px] resize-y"
        />
      </div>

      {/* Buttons */}
      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={() => onSend(formData)}
          className="bg-blue-600 text-white py-2 px-4 rounded text-sm font-medium"
        >
          Send
        </button>
        <button
          onClick={() => onSave(formData)}
          className="text-gray-600 hover:text-gray-900 py-2 px-4 rounded text-sm font-medium"
        >
          Save Draft
        </button>
        <button
          onClick={onCancel}
          className="text-gray-600 hover:text-gray-900 py-2 px-4 rounded text-sm font-medium ml-auto"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
