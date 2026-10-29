const refusedStatuses = new Set([400, 401, 403, 404, 409, 413, 415, 422, 423, 429]);

export function skillWriteFailure(error) {
  const status = typeof error?.status === "number" ? error.status : null;
  const code = typeof error?.code === "string" ? error.code : null;
  const message = typeof error?.message === "string" && error.message
    ? error.message.slice(0, 600) : "The service did not provide an error description.";
  const cancelledBeforeSend = error?.name === "AbortError" &&
    error.message === "Authentication confirmation was cancelled.";
  return { status, code, message, original: error,
    outcome: refusedStatuses.has(status) || cancelledBeforeSend ? "refused" : "unknown" };
}

export function parseSkillUpload(text) {
  if (typeof text !== "string") return null;
  // Retain the existing upload format and trimming behavior in this error-state fix.
  const match = text.match(/^---\s*\nname:\s*(.+)\ndescription:\s*(.+)\n---\s*\n([\s\S]*)$/m);
  if (!match) return null;
  const name = match[1].trim();
  if (!name || name.length > 64 || name === "." || name === ".." ||
      name.includes("/") || name.includes("\\") || name.includes("\0")) return null;
  return { name, description: match[2].trim(), content: match[3].trim() };
}

export function skillWriteBlocked(result) {
  return Boolean(result && ["unknown", "saved-refresh-failed", "conflict"].includes(result.status));
}

export function skillResourcePath(name, project) {
  if (!project?.trim() || !name) throw new Error("An exact skill and authorized project are required.");
  return "/skills/" + encodeURIComponent(name) + "?project=" + encodeURIComponent(project);
}

function fileContent(skill, path) {
  if (path === "SKILL.md") return skill?.content;
  try {
    const files = JSON.parse(skill?.file_tree ?? "null");
    return files && typeof files === "object" && !Array.isArray(files) && Object.hasOwn(files, path)
      ? files[path] : undefined;
  } catch { return undefined; }
}

export function skillSavePayload(skill, path, text) {
  let files = skill.file_tree ?? undefined;
  if (path !== "SKILL.md") {
    const tree = JSON.parse(files ?? "null");
    if (!tree || typeof tree !== "object" || Array.isArray(tree) || !Object.hasOwn(tree, path)) {
      throw new Error("The selected reference is missing from stored metadata. Reload before saving.");
    }
    files = JSON.stringify({ ...tree, [path]: text });
  }
  return {
    content: path === "SKILL.md" ? text : skill.content,
    extra: { tags: skill.tags ?? undefined, always_apply: skill.always_apply, files },
  };
}

export async function runSkillUpload(text, project, ports) {
  const value = parseSkillUpload(text);
  if (!value || !project?.trim()) return { status: "validation-error", writeConfirmed: false,
    message: "Invalid Markdown frontmatter. Use name: and description: before the skill body." };
  const attempt = { ...value, project };
  try {
    const created = await ports.create(value, project);
    if (typeof created?.id === "string") attempt.id = created.id;
    if (typeof created?.project_id === "string") attempt.projectId = created.project_id;
  }
  catch (error) {
    const failure = skillWriteFailure(error);
    return { status: failure.outcome, writeConfirmed: false, attempt, failure,
      message: failure.outcome === "refused"
        ? "Upload refused by the service: " + failure.message
        : "Upload outcome is unknown: " + failure.message + " Verify stored content before another write." };
  }
  try {
    if (!await ports.refresh()) throw new Error("The active skill list could not be refreshed.");
    return { status: "success", writeConfirmed: true, attempt, message: "Uploaded and reloaded." };
  } catch (error) {
    return { status: "saved-refresh-failed", writeConfirmed: true, attempt, failure: skillWriteFailure(error),
      message: "The skill was created, but refresh failed. Verify stored content before another upload." };
  }
}

export async function verifySkillUpload(previous, ports) {
  if (!previous.attempt) return previous;
  const attempt = previous.attempt;
  try {
    const record = await ports.read(attempt.name, attempt.project);
    if (record?.name !== attempt.name || record.content !== attempt.content || record.description !== attempt.description ||
        (attempt.id && record.id !== attempt.id) || (attempt.projectId && record.project_id !== attempt.projectId)) {
      return { ...previous, status: "conflict", message: "Stored content differs from the submitted file. The upload has not been replayed." };
    }
    if (!await ports.refresh()) {
      return { ...previous, status: "saved-refresh-failed", record,
        message: "Stored content matches the file, but the list could not be refreshed. No upload was replayed." };
    }
    return { ...previous, status: "verified", record,
      message: previous.writeConfirmed ? "Created skill verified and reloaded."
        : "Stored content matches the submitted file. Original request outcome remains unconfirmed; no upload was replayed." };
  } catch (error) {
    return { ...previous, failure: previous.failure ?? skillWriteFailure(error), lastVerificationFailure: skillWriteFailure(error),
      message: "Upload result is still unverified: " + skillWriteFailure(error).message + " No upload was replayed." };
  }
}

export async function runSkillSave(skill, path, text, project, ports) {
  const attempt = { name: skill.name, id: skill.id, projectId: skill.project_id, project, path, text };
  let payload;
  try { payload = skillSavePayload(skill, path, text); }
  catch (error) { return { status: "validation-error", writeConfirmed: false, attempt,
    failure: skillWriteFailure(error), message: "No save was submitted: " + skillWriteFailure(error).message }; }
  try { await ports.write(skill.name, payload, project); }
  catch (error) {
    const failure = skillWriteFailure(error);
    return { status: failure.outcome, writeConfirmed: false, attempt, failure,
      message: failure.outcome === "refused" ? "Save refused: " + failure.message + " Your draft is retained."
        : "Save outcome is unknown: " + failure.message + " Your draft is retained; verify before another write." };
  }
  const confirmed = { status: "saved-refresh-failed", writeConfirmed: true, attempt,
    message: "Save accepted, but stored content could not be verified. Your draft is retained." };
  return verifySkillSave(confirmed, ports);
}

export async function verifySkillSave(previous, ports) {
  if (!previous.attempt) return previous;
  const attempt = previous.attempt;
  try {
    const record = await ports.read(attempt.name, attempt.project);
    if (record?.id !== attempt.id || record.project_id !== attempt.projectId ||
        record.name !== attempt.name || fileContent(record, attempt.path) !== attempt.text) {
      return { ...previous, status: previous.writeConfirmed ? "saved-refresh-failed" : "conflict",
        message: "Stored content does not match this draft. The draft is retained and no save was replayed." };
    }
    return { ...previous, status: "verified", record,
      message: previous.writeConfirmed ? "Saved and verified." : "Stored draft verified; no additional save was sent." };
  } catch (error) {
    return { ...previous, failure: previous.failure ?? skillWriteFailure(error), lastVerificationFailure: skillWriteFailure(error),
      message: previous.writeConfirmed ? "Save accepted, but readback failed. Your draft is retained."
        : "Save remains unverified. Your draft is retained; no additional save was sent." };
  }
}
