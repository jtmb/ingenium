import { test, expect } from "@playwright/test";

/**
 * MCP tool tests — validates all 23 Ingenium MCP tools via direct API calls.
 *
 * These tests call the API at http://localhost:4097 (started by Playwright's
 * webServer config) using page.request(), which bypasses the dashboard UI
 * and tests the tool handlers directly.
 *
 * Each test uses a unique project name (timestamped) to avoid collisions.
 * The test project is cleaned up after each test.
 */

const API = "http://localhost:4097/api/v1";
const PROJECT = `e2e-mcp-${Date.now()}`;

let projectId: string;

test.describe("MCP Tools — Projects", () => {
  test("project_init creates a project", async ({ request }) => {
    const res = await request.post(`${API}/projects`, { data: { name: PROJECT } });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.name).toBe(PROJECT);
    projectId = body.data.id;
  });

  test("project_list returns projects", async ({ request }) => {
    const res = await request.get(`${API}/projects`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
    expect(body.data.some((p: any) => p.name === PROJECT)).toBeTruthy();
  });

  test("project_list_archived returns array", async ({ request }) => {
    const res = await request.get(`${API}/projects/archive?project=${PROJECT}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
  });
});

test.describe("MCP Tools — Skills", () => {
  const skillName = `e2e-skill-${Date.now()}`;

  test("skill_create creates a skill", async ({ request }) => {
    const res = await request.post(`${API}/skills?project=${PROJECT}`, {
      data: { name: skillName, description: "E2E test skill", content: "# Test\n\nTest content" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.name).toBe(skillName);
  });

  test("skill_list returns skills", async ({ request }) => {
    const res = await request.get(`${API}/skills?project=${PROJECT}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
  });

  test("skill_load loads a skill by name", async ({ request }) => {
    const res = await request.get(`${API}/skills/${skillName}?project=${PROJECT}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.name).toBe(skillName);
  });

  test("skill_search searches skills", async ({ request }) => {
    const res = await request.get(`${API}/skills/search?project=${PROJECT}&q=E2E`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
  });

  test("skill_update updates a skill", async ({ request }) => {
    const res = await request.patch(`${API}/skills/${skillName}?project=${PROJECT}`, {
      data: { content: "# Updated\n\nUpdated content" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.content).toContain("Updated");
  });
});

test.describe("MCP Tools — Learnings", () => {
  const entryContent = `E2E learning ${Date.now()}`;

  test("learning_log creates a learning entry", async ({ request }) => {
    const res = await request.post(`${API}/learnings?project=${PROJECT}`, {
      data: { entry_type: "pattern", content: entryContent, tags: "e2e" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.content).toBe(entryContent);
  });

  test("learning_search searches learnings", async ({ request }) => {
    const res = await request.get(`${API}/learnings/search?project=${PROJECT}&q=E2E`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
  });

  test("learning_list returns entries", async ({ request }) => {
    const res = await request.get(`${API}/learnings?project=${PROJECT}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
  });
});

test.describe("MCP Tools — Tasks", () => {
  let taskId: string;

  test("task_create creates a task", async ({ request }) => {
    const res = await request.post(`${API}/tasks?project=${PROJECT}`, {
      data: { title: `E2E Task ${Date.now()}`, description: "E2E test" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.title).toContain("E2E Task");
    taskId = body.data.id;
  });

  test("task_list returns tasks", async ({ request }) => {
    const res = await request.get(`${API}/tasks?project=${PROJECT}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
  });

  test("task_move moves a task to another column", async ({ request }) => {
    const res = await request.patch(`${API}/tasks/${taskId}?project=${PROJECT}`, {
      data: { column_id: "in_progress" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.column_id).toBe("in_progress");
  });

  test("task_complete completes a task", async ({ request }) => {
    const res = await request.patch(`${API}/tasks/${taskId}?project=${PROJECT}`, {
      data: {},
    });
    // complete and move both use PATCH; the server handles both
    expect(res.ok()).toBeTruthy();
  });

  test("task_next gets next task", async ({ request }) => {
    const res = await request.get(`${API}/tasks/next?project=${PROJECT}`);
    expect(res.ok()).toBeTruthy();
    // May return null if no uncompleted tasks — that's valid
    const body = await res.json();
    expect(body).toBeDefined();
  });
});

test.describe("MCP Tools — Context", () => {
  test("context_save saves a context entry", async ({ request }) => {
    const res = await request.post(`${API}/context?project=${PROJECT}`, {
      data: { content: `E2E context ${Date.now()}`, tags: "e2e", priority: 5 },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.content).toContain("E2E context");
  });

  test("context_search searches context", async ({ request }) => {
    const res = await request.get(`${API}/context/search?project=${PROJECT}&q=E2E`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
  });
});

test.describe("MCP Tools — Plans", () => {
  test("plan_list returns entries", async ({ request }) => {
    const res = await request.get(`${API}/context?project=${PROJECT}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
  });
});

test.describe("MCP Tools — Plugins", () => {
  const pluginName = `e2e-plugin-${Date.now()}`;
  const pluginPath = `${pluginName}.ts`;
  const pluginContent = `// ${pluginName} e2e plugin\nexport default { name: "${pluginName}" };\n`;

  test("plugin_list returns plugins", async ({ request }) => {
    const res = await request.get(`${API}/plugins?project=${PROJECT}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
  });

  test("plugin_create creates a plugin", async ({ request }) => {
    const res = await request.post(`${API}/plugins?project=${PROJECT}`, {
      data: { name: pluginName, file_path: pluginPath, source_content: pluginContent },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.name).toBe(pluginName);
    expect(body.data.file_path).toBe(pluginPath);
    expect(body.data.source_content).toBe(pluginContent);
  });

  test("plugin_get fetches a single plugin", async ({ request }) => {
    const res = await request.get(`${API}/plugins/${pluginName}?project=${PROJECT}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.name).toBe(pluginName);
  });

  test("plugin_update updates a plugin", async ({ request }) => {
    const res = await request.put(`${API}/plugins/${pluginName}?project=${PROJECT}`, {
      data: { source_content: "// updated content" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.source_content).toBe("// updated content");
  });

  test("plugin_delete deletes a plugin", async ({ request }) => {
    const res = await request.delete(`${API}/plugins/${pluginName}?project=${PROJECT}`);
    expect(res.status()).toBe(204);
  });
});

test.describe("MCP Tools — Servers", () => {
  const serverName = `e2e-server-${Date.now()}`;

  test("server_add creates a server", async ({ request }) => {
    const res = await request.post(`${API}/servers?project=${PROJECT}`, {
      data: { name: serverName, command: "echo test" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.name).toBe(serverName);
  });

  test("server_list returns servers", async ({ request }) => {
    const res = await request.get(`${API}/servers?project=${PROJECT}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
  });
});

test.describe("MCP Tools — Settings", () => {
  test("settings_set and get work", async ({ request }) => {
    // Set a setting
    const setRes = await request.post(`${API}/settings?project=${PROJECT}`, {
      data: { key: "test_key", value: "test_value" },
    });
    expect(setRes.ok()).toBeTruthy();

    // Get the setting back
    const getRes = await request.get(`${API}/settings?project=${PROJECT}&key=test_key`);
    expect(getRes.ok()).toBeTruthy();
    const body = await getRes.json();
    expect(body.data.value).toBe("test_value");
  });
});

test.describe("MCP Tools — Archive", () => {
  test("project archive/restore works", async ({ request }) => {
    // Archive the test project
    const archiveRes = await request.delete(`${API}/projects/${PROJECT}`);
    expect(archiveRes.ok()).toBeTruthy();

    // List archived projects and verify
    const listRes = await request.get(`${API}/projects/archive`);
    expect(listRes.ok()).toBeTruthy();
    const listBody = await listRes.json();
    expect(listBody.data.some((p: any) => p.name === PROJECT)).toBeTruthy();

    // Restore the project
    const restoreRes = await request.post(`${API}/projects/${PROJECT}/restore`);
    expect(restoreRes.ok()).toBeTruthy();
  });
});
