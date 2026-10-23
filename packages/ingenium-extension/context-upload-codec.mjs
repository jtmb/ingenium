const marker = "[REDACTED]";
const tokenPattern = /\b(?:sk-|gh[pousr]_|github_pat_|xox[baprs]-|xapp-|glpat-|npm_)[A-Za-z0-9_-]+\b|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|\bAKIA[A-Z0-9]{16}\b/g;
const urlTokenPattern = new RegExp(tokenPattern.source);
const sensitiveUrlKey = /token|key|secret|sig|credential|auth|code|pass(?:word|[ _-]?phrase)/i;

function redactUrl(value) {
  try {
    const url = new URL(value);
    const material = decodeURIComponent(`${url.pathname}${url.search}${url.hash}`);
    // Nested encodings and opaque URL capabilities are unsafe even without a secret-labelled key.
    if (url.username || url.password || /%[0-9a-f]{2}/i.test(material)
      || /webhooks?|hooks|services/i.test(material)
      || urlTokenPattern.test(material) || /[A-Za-z0-9_+=-]{32,}/.test(material)
      || /(?:[/?&#])[^/?&#=]{0,80}(?:token|secret|credential|pass(?:word|[ _-]?phrase)|api[_-]?key|authorization)[^/?&#=]{0,80}[=/:]/i.test(material)
      || [...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()].some((key) => sensitiveUrlKey.test(key))) return marker;
  } catch { return marker; }
  return value;
}

export function redactContextText(text) {
  return text
    .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]*PRIVATE KEY-----|$)/g, marker)
    .replace(/\b[a-z][a-z0-9+.-]{0,20}:\/\/[^\s<>"'`]+/gi, redactUrl)
    .replace(/\b(?:Bearer|Basic)\s+[^\s,"'`<>]+/gi, marker)
    // Preserve text after explicitly quoted values; an unquoted phrase has no safe word boundary.
    .replace(/(\b[\w-]{0,80}(?:token|secret|pass(?:word|[ _-]?phrase)|credential|webhook|api[ _-]?key|authorization)[\w-]{0,80}\b["'`*_]{0,2}\s*(?:[:=]|\bis\b)[*_]{0,2})\s*("(?:\\(?:[\s\S]|$)|[^"\\])*(?:"|$)|'(?:\\(?:[\s\S]|$)|[^'\\])*(?:'|$)|```[\s\S]*?(?:```|$)|`[^`]*(?:`|$)|[^\r\n]*)/gi,
      (_, label, value) => {
        const quote = value.startsWith("```") ? "```" : /^["'`]/.test(value) ? value[0] : "";
        return `${label} ${quote}${marker}${quote}`;
      })
    .replace(tokenPattern, marker);
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
