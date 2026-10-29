export const WORK_WEB_PROTOCOL = "opencode-2.0.11-server-session-v1";

export function workWebSessionUrl(authorizedRoot: string, sessionId: string, protocol = WORK_WEB_PROTOCOL): string {
  if (protocol !== WORK_WEB_PROTOCOL) throw new Error("Unsupported OpenCode Web session protocol.");
  const root = new URL(authorizedRoot);
  if ((root.protocol !== "https:" && root.protocol !== "http:") || root.username || root.password
    || root.pathname !== "/" || root.search || root.hash) throw new Error("Expected an authorized runtime gateway root.");
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";
  if (!sessionId || sessionId.length > 256 || ![...sessionId].every((character) => alphabet.includes(character))) {
    throw new Error("Invalid engine session identity.");
  }
  const serverBytes = new TextEncoder().encode(root.origin);
  const binary = Array.from(serverBytes, (byte) => String.fromCharCode(byte)).join("");
  const serverKey = btoa(binary).split("+").join("-").split("/").join("_").split("=").join("");
  return `${root.origin}/server/${serverKey}/session/${sessionId}`;
}
