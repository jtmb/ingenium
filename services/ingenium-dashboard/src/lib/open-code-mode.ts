export type OpenCodeMode = "web" | "cli";

export function parseOpenCodeMode(value: string | null | undefined): OpenCodeMode {
  return value === "cli" ? "cli" : "web";
}
