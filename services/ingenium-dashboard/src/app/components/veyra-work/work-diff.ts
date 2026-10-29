export interface WorkFileChange {
  path: string;
  additions: number;
  deletions: number;
  patch?: string;
  before?: string;
  after?: string;
}

export interface WorkDiffRow {
  kind: "context" | "add" | "remove" | "header" | "meta";
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export function normalizeWorkChanges(value: unknown): WorkFileChange[] {
  if (!Array.isArray(value)) throw new Error("The runtime did not return a file-change list.");
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("A file-change entry is invalid.");
    const file = entry as Record<string, unknown>;
    const path = typeof file.path === "string" ? file.path : file.file;
    if (typeof path !== "string" || !path || !Number.isSafeInteger(file.additions) || !Number.isSafeInteger(file.deletions)
      || (file.additions as number) < 0 || (file.deletions as number) < 0) throw new Error("A file-change identity or count is invalid.");
    const counts = { path, additions: file.additions as number, deletions: file.deletions as number };
    if (typeof file.patch === "string") return { ...counts, patch: file.patch };
    if (typeof file.before === "string" && typeof file.after === "string") return { ...counts, before: file.before, after: file.after };
    throw new Error("The runtime returned an unsupported file-change format.");
  });
}

function range(value: string | undefined, sign: string): { start: number; count: number } | null {
  if (!value?.startsWith(sign)) return null;
  const parts = value.slice(1).split(",");
  if (parts.length > 2 || parts.some((part) => !part || ![...part].every((character) => "0123456789".includes(character)))) return null;
  const start = Number(parts[0]);
  const count = parts[1] === undefined ? 1 : Number(parts[1]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(count) ? { start, count } : null;
}

/** Parse only verified text hunks; an unknown/binary patch stays available as raw source. */
export function parseWorkPatch(patch: string): WorkDiffRow[] | null {
  const rows: WorkDiffRow[] = [];
  let oldLine = 0; let newLine = 0;
  let oldRemaining = 0; let newRemaining = 0;
  let inHunk = false;
  const lines = patch.split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const text of lines) {
    if (text.startsWith("@@ ")) {
      if (oldRemaining || newRemaining) return null;
      const parts = text.split(" ");
      const oldRange = range(parts[1], "-"); const newRange = range(parts[2], "+");
      if (!oldRange || !newRange || parts[3] !== "@@") return null;
      oldLine = oldRange.start; newLine = newRange.start;
      oldRemaining = oldRange.count; newRemaining = newRange.count; inHunk = true;
      rows.push({ kind: "header", text, oldLine: null, newLine: null });
    } else if (inHunk && text.startsWith(" ")) {
      if (oldRemaining <= 0 || newRemaining <= 0) return null;
      oldRemaining--; newRemaining--;
      rows.push({ kind: "context", text: text.slice(1), oldLine: oldLine++, newLine: newLine++ });
    } else if (inHunk && text.startsWith("-")) {
      if (oldRemaining <= 0) return null;
      oldRemaining--;
      rows.push({ kind: "remove", text: text.slice(1), oldLine: oldLine++, newLine: null });
    } else if (inHunk && text.startsWith("+")) {
      if (newRemaining <= 0) return null;
      newRemaining--;
      rows.push({ kind: "add", text: text.slice(1), oldLine: null, newLine: newLine++ });
    } else if (text === "\\ No newline at end of file" || !inHunk) {
      rows.push({ kind: "meta", text, oldLine: null, newLine: null });
    } else return null;
  }
  return inHunk && oldRemaining === 0 && newRemaining === 0 ? rows : null;
}

export function splitWorkRows(rows: WorkDiffRow[]): Array<{ before: WorkDiffRow | null; after: WorkDiffRow | null }> {
  const pairs: Array<{ before: WorkDiffRow | null; after: WorkDiffRow | null }> = [];
  for (let index = 0; index < rows.length;) {
    const row = rows[index]!;
    if (row.kind !== "add" && row.kind !== "remove") {
      pairs.push({ before: row, after: row }); index++; continue;
    }
    const before: WorkDiffRow[] = []; const after: WorkDiffRow[] = [];
    let side = row.kind;
    while (index < rows.length) {
      const item = rows[index]!;
      if (item.kind === "remove") { before.push(item); side = item.kind; }
      else if (item.kind === "add") { after.push(item); side = item.kind; }
      else if (item.kind === "meta" && item.text === "\\ No newline at end of file") {
        (side === "remove" ? before : after).push(item);
      } else break;
      index++;
    }
    for (let offset = 0; offset < Math.max(before.length, after.length); offset++) {
      pairs.push({ before: before[offset] ?? null, after: after[offset] ?? null });
    }
  }
  return pairs;
}
