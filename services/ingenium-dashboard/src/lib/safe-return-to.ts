const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]|%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;

export function safeReturnTo(value: string | null): string {
  if (!value || CONTROL_CHARACTERS.test(value) || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  try {
    const url = new URL(value, "http://dashboard.local");
    return url.origin === "http://dashboard.local" && !url.username && !url.password
      ? `${url.pathname}${url.search}${url.hash}`
      : "/";
  } catch {
    return "/";
  }
}
