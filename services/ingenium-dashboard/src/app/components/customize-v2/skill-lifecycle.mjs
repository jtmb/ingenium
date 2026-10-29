function projectQuery(project) {
  if (typeof project !== "string" || !project.trim()) throw new Error("Select an authorized project.");
  return "?project=" + encodeURIComponent(project);
}

export function createSkillLifecycle(request) {
  return {
    async list(project) {
      const query = projectQuery(project);
      const [active, archived] = await Promise.all([
        request("/skills" + query),
        request("/skills/archived" + query),
      ]);
      return { active: active.data, archived: archived.data };
    },
    async change(project, name, action) {
      const query = projectQuery(project);
      if (!["archive", "restore"].includes(action) || !name) throw new Error("Invalid skill action.");
      try {
        await request("/skills/" + encodeURIComponent(name) + "/" + action + query, { method: "POST" });
        return { outcome: "succeeded" };
      } catch (error) {
        // Only explicit validation/authorization/not-found/lock refusals prove no write.
        const refused = [400, 401, 403, 404, 409, 422, 423, 429].includes(error?.status);
        return {
          outcome: refused ? "refused" : "unknown",
          message: refused ? "The service refused this change. Check permissions and maintenance locks." : "The change outcome is unknown. Refresh the authoritative lists before trying another change.",
        };
      }
    },
  };
}
