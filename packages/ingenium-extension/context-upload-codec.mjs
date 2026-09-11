const marker = "[REDACTED]";

export function redactContextText(text) {
  return text
    .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]*PRIVATE KEY-----|$)/g, marker)
    .replace(/\b[a-z][a-z0-9+.-]{0,20}:\/\/[^\s<>"'`]+/gi, (value) => {
      try {
        const url = new URL(value);
        if (url.username || url.password || /webhooks?|hooks|services/i.test(url.pathname)
          || [...url.searchParams.keys()].some((key) => /token|key|secret|sig|credential|auth|code/i.test(key))) return marker;
      } catch { return marker; }
      return value;
    })
    .replace(/\b(?:Bearer|Basic)\s+[^\s,"'`<>]+/gi, marker)
    .replace(/\b[\w-]{0,80}(?:token|secret|password|credential|webhook|api[_-]?key|authorization)[\w-]{0,80}\b["']?\s*[:=]\s*[^\r\n]*/gi, (value) => `${value.slice(0, value.search(/[:=]/) + 1)} ${marker}`)
    .replace(/\b(?:sk-|gh[pousr]_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]+\b/g, marker)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, marker);
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hidden(value) {
  return ["hidden", "synthetic", "ignored", "ignore"].some((key) =>
    Object.hasOwn(value, key) && ![false, 0, "false", "0"].includes(value[key]));
}

export function completedAssistant(info) {
  return !info.error && typeof info.time?.completed === "number" && Number.isFinite(info.time.completed);
}

export function visibleContextExport(value, session, worktree) {
  if (!record(value) || !record(value.info) || value.info.id !== session
    || value.info.directory !== worktree || !Array.isArray(value.messages)) throw new Error("CONTEXT_SESSION_MISMATCH");
  const messages = [];
  const ids = new Set();
  for (const message of value.messages) {
    const info = message?.info;
    if (!record(info) || info.sessionID !== session || typeof info.id !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(info.id) || ids.has(info.id)) throw new Error("CONTEXT_SESSION_MISMATCH");
    ids.add(info.id);
    if (hidden(message) || hidden(info) || !["user", "assistant"].includes(info.role) || info.error) continue;
    // Stop at the first unfinished assistant so later completion can only append.
    if (info.role === "assistant" && !completedAssistant(info)) break;
    const text = (Array.isArray(message.parts) ? message.parts : [])
      .filter((part) => record(part) && part.type === "text" && !hidden(part) && typeof part.text === "string")
      .map((part) => part.text).join("\n");
    if (!text.trim()) continue;
    messages.push({ info: { id: info.id, sessionID: session, role: info.role,
      ...(info.role === "assistant" ? { time: { completed: info.time.completed } } : {}) },
    parts: [{ type: "text", text: redactContextText(text) }] });
  }
  return { info: { id: session, directory: worktree,
    ...(value.info.contextUploadAutomatic === true ? { contextUploadAutomatic: true } : {}) }, messages };
}
