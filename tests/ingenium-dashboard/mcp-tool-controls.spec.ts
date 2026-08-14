import { test, expect, type APIRequestContext } from "./fixture";
import { getDefaultSuiteRuntime } from "./default-suite-runtime";

const runtime = getDefaultSuiteRuntime();
const apiUrl = runtime.apiBase;
const project = runtime.project;
const headers = runtime.apiHeaders;
const builtInTool = "ingenium_skill_list";

interface ToolGroup {
  category: string;
  tools: Array<{ tool_name: string; enabled: boolean }>;
}

async function listTools(request: APIRequestContext): Promise<ToolGroup[]> {
  const response = await request.get(`${apiUrl}/mcp-tools?project=${encodeURIComponent(project)}&include_categories=true`, { headers });
  if (!response.ok()) throw new Error(`MCP tool catalog request failed: ${response.status()} ${await response.text()}`);
  const body = await response.json() as { data: ToolGroup[] };
  return body.data;
}

test.describe("MCP-006 tool controls", () => {
  test("controls a built-in through the /mcp-servers UI and persists category state", async ({ page, request }) => {
    const initialGroups = await listTools(request);
    const initialStates = new Map(
      initialGroups.flatMap((group) => group.tools.map((tool) => [tool.tool_name, tool.enabled] as const)),
    );
    const initialSkillStates = initialGroups.find((group) => group.category === "Skills")?.tools ?? [];

    try {
      await page.goto("/mcp-servers");
      await page.getByRole("button", { name: /^Tools/ }).click();
      const skills = page.locator("section").filter({ has: page.getByRole("heading", { name: "Skills", exact: true }) });
      await expect(skills.getByRole("switch", { name: `Disable ${builtInTool}`, exact: true })).toBeVisible();

      await skills.getByRole("switch", { name: `Disable ${builtInTool}`, exact: true }).click();
      await expect(skills.getByRole("switch", { name: `Enable ${builtInTool}`, exact: true })).toBeVisible();
      expect((await listTools(request)).find((group) => group.category === "Skills")?.tools.find((tool) => tool.tool_name === builtInTool)?.enabled).toBe(false);

      await page.reload();
      await page.getByRole("button", { name: /^Tools/ }).click();
      const refreshedSkills = page.locator("section").filter({ has: page.getByRole("heading", { name: "Skills", exact: true }) });
      await expect(refreshedSkills.getByRole("switch", { name: `Enable ${builtInTool}`, exact: true })).toBeVisible();

      await refreshedSkills.getByRole("switch", { name: `Enable ${builtInTool}`, exact: true }).click();
      await expect(refreshedSkills.getByRole("switch", { name: `Disable ${builtInTool}`, exact: true })).toBeVisible();
      await refreshedSkills.getByRole("button", { name: "Disable all" }).click();
      await expect(refreshedSkills.getByRole("button", { name: "Enable all" })).toBeVisible();
      const disabledSkills = (await listTools(request)).find((group) => group.category === "Skills");
      expect(disabledSkills?.tools.every((tool) => !tool.enabled)).toBe(true);

      await refreshedSkills.getByRole("button", { name: "Enable all" }).click();
      await expect(refreshedSkills.getByRole("button", { name: "Disable all" })).toBeVisible();
      const enabledSkills = (await listTools(request)).find((group) => group.category === "Skills");
      expect(enabledSkills?.tools.every((tool) => tool.enabled)).toBe(true);
    } finally {
      for (const tool of initialSkillStates) {
        await request.put(`${apiUrl}/mcp-tools/${encodeURIComponent(tool.tool_name)}?project=${encodeURIComponent(project)}`, {
          headers: { ...headers, "Content-Type": "application/json" },
          data: { enabled: initialStates.get(tool.tool_name) ?? true },
        });
      }
    }
  });
});
