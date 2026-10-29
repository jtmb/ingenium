import type { FilePart } from "../../../lib/opencode";

export interface WorkArtifact {
  id: string;
  messageId: string;
  name: string;
  mime: string;
  url?: string;
  content?: string;
  size?: number;
}

interface ArtifactMessage { id: string; parts?: Array<{ id: string; type: string }> }
export type WorkArtifactPreview = { kind: "image"; url: string } | { kind: "pdf"; url: string }
  | { kind: "text"; text: string; markdown: boolean; json: boolean }
  | { kind: "unavailable"; reason: string };

export function collectWorkArtifacts(messages: ArtifactMessage[]): WorkArtifact[] {
  return messages.flatMap((message) => (message.parts ?? []).flatMap((part): WorkArtifact[] => {
    if (part.type !== "file") return [];
    const file = part as Partial<FilePart>;
    if (typeof file.mime !== "string") return [];
    return [{ id: JSON.stringify([message.id, part.id]), messageId: message.id,
      name: typeof file.filename === "string" && file.filename ? file.filename : "Untitled file",
      mime: file.mime.toLowerCase(), ...(typeof file.url === "string" ? { url: file.url } : typeof file.dataUrl === "string" ? { url: file.dataUrl } : {}),
      ...(typeof file.content === "string" ? { content: file.content } : {}),
      ...(typeof file.size === "number" && Number.isSafeInteger(file.size) && file.size >= 0 ? { size: file.size } : {}),
    }];
  }));
}

const rasters = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_INLINE_URL = 14 * 1024 * 1024;
const MAX_TEXT = 200_000;

export function workSourceDownload(text: string): string | null {
  try { return `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`; }
  catch { return null; }
}

export function previewWorkArtifact(artifact: WorkArtifact): WorkArtifactPreview {
  const text = (content: string): WorkArtifactPreview => content.length > MAX_TEXT
    ? { kind: "unavailable", reason: "This file exceeds the inline text preview limit. Its original remains on the conversation owner." }
    : { kind: "text", text: content, markdown: artifact.mime === "text/markdown", json: artifact.mime === "application/json" };
  if (artifact.content !== undefined) return text(artifact.content);
  const url = artifact.url;
  if (!url?.startsWith("data:") || url.length > MAX_INLINE_URL) {
    return { kind: "unavailable", reason: "This reference needs an authorized file reader. Work does not fetch arbitrary URLs or local paths." };
  }
  const comma = url.indexOf(",");
  if (comma < 0) return { kind: "unavailable", reason: "The inline file reference is malformed." };
  const header = url.slice(5, comma).toLowerCase().split(";");
  if (header[0] !== artifact.mime) return { kind: "unavailable", reason: "The file MIME type does not match its inline reference." };
  if (rasters.includes(artifact.mime)) return { kind: "image", url };
  if (artifact.mime === "application/pdf") return { kind: "pdf", url };
  if (!artifact.mime.startsWith("text/") && !["application/json", "application/xml", "image/svg+xml"].includes(artifact.mime)) {
    return { kind: "unavailable", reason: "This file format requires its domain viewer. The original file reference is retained." };
  }
  try {
    const payload = url.slice(comma + 1);
    if (!header.includes("base64")) return text(decodeURIComponent(payload));
    const binary = atob(payload);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return text(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { return { kind: "unavailable", reason: "The inline text could not be decoded losslessly. Its original reference is retained." }; }
}
