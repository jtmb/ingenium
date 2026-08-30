import { expect, test, type APIRequestContext, type APIResponse, type Page, type Request } from "./fixture";
import { getDefaultSuiteRuntime } from "./default-suite-runtime";

const runtime = getDefaultSuiteRuntime();
const JSON_HEADERS = { ...runtime.apiHeaders, "content-type": "application/json" };
const FIXTURE_OPENCODE_PROJECT_ID = "fixture-project";
// This is fixture-owned message content. The test never sends a provider prompt.
const FIXTURE_TRANSCRIPT_SENTINEL = "Hello from E2E test";

type Project = {
  id: string;
  name: string;
  is_global: boolean | number;
  archived_at?: string | null;
};

type CaptureResult = {
  task: { id: string; title: string; project_id: string };
  reference: {
    id: string;
    source_type: "chat" | "docs";
    display_title: string;
    display_detail: string | null;
    availability: string;
  };
};

function captureRequestMatches(request: Request, sourceType: "chat" | "docs"): boolean {
  if (request.method() !== "POST" || new URL(request.url()).pathname !== "/api/v1/tasks/captures") return false;
  try {
    return (request.postDataJSON() as { source_type?: unknown }).source_type === sourceType;
  } catch {
    return false;
  }
}

async function captureFromDialog(
  page: Page,
  expectedBody: Record<string, string | number>,
  expectedStatus: 200 | 201,
): Promise<CaptureResult> {
  const sourceType = expectedBody.source_type as "chat" | "docs";
  const captureRequest = page.waitForRequest((request) => captureRequestMatches(request, sourceType));
  const captureResponse = page.waitForResponse((response) =>
    captureRequestMatches(response.request(), sourceType),
  );

  const dialog = page.getByRole("dialog", { name: "Create Task" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Title" }).fill(String(expectedBody.title));
  await dialog.getByRole("button", { name: "Create Task", exact: true }).click();

  const [request, response] = await Promise.all([captureRequest, captureResponse]);
  expect(request.postDataJSON()).toEqual(expectedBody);
  expect(Object.keys(request.postDataJSON() as Record<string, unknown>).sort()).toEqual(Object.keys(expectedBody).sort());
  expect(response.status()).toBe(expectedStatus);
  return (await response.json() as { data: CaptureResult }).data;
}

async function json<T>(response: APIResponse, expectedStatus: number): Promise<T> {
  expect(response.status()).toBe(expectedStatus);
  return await response.json() as T;
}

async function taskReferences(
  request: APIRequestContext,
  project: string,
  taskId: string,
): Promise<Array<CaptureResult["reference"]>> {
  const response = await request.get(
    `${runtime.apiBase}/tasks/${encodeURIComponent(taskId)}/references?project=${encodeURIComponent(project)}`,
    { headers: runtime.apiHeaders },
  );
  return (await json<{ data: Array<CaptureResult["reference"]> }>(response, 200)).data;
}

async function openTaskDetail(page: Page, taskTitle: string, taskId: string): Promise<void> {
  const referencesResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/v1/tasks/${taskId}/references`
      && url.searchParams.get("project") === runtime.project
      && response.request().method() === "GET"
      && response.status() === 200;
  });
  await page.getByText(taskTitle, { exact: true }).first().click();
  await referencesResponse;
  await expect(page.getByRole("heading", { name: "Source references", exact: true })).toBeVisible();
}

async function expectCleanupStatus(response: APIResponse, resource: string): Promise<void> {
  expect([204, 404], `${resource} cleanup returned ${response.status()}: ${await response.text()}`).toContain(response.status());
}

test.describe("TASK-102 task capture", () => {
  test("captures only chat and Docs identities through the production fixture", async ({ page, request }) => {
    test.setTimeout(60_000);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pageTitle = `TASK-102 linked page ${suffix}`;
    const pageContentSentinel = `TASK-102-page-content-${suffix}`;
    const chatTitle = `TASK-102 chat task ${suffix}`;
    const chatRetryTitle = `TASK-102 chat retry ${suffix}`;
    const docsTitle = `TASK-102 Docs task ${suffix}`;
    const docsRetryTitle = `TASK-102 Docs retry ${suffix}`;
    const providerWrites: string[] = [];
    let globalProject: Project | undefined;
    let fixtureProject: Project | undefined;
    let spaceId: number | undefined;
    let pageId: number | undefined;
    let chatTaskId: string | undefined;
    let docsTaskId: string | undefined;
    let pageArchived = false;

    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        request.method() === "POST"
        && (/\/opencode\/sessions\/[^/]+\/messages$/.test(url.pathname) || /\/prompt$/.test(url.pathname))
      ) {
        providerWrites.push(`${request.method()} ${url.pathname}`);
      }
    });

    try {
      const projects = await json<{ data: Project[] }>(
        await request.get(`${runtime.apiBase}/projects`, { headers: runtime.apiHeaders }),
        200,
      );
      const activeGlobals = projects.data.filter((project) => Boolean(project.is_global) && !project.archived_at);
      expect(activeGlobals).toHaveLength(1);
      globalProject = activeGlobals[0];
      fixtureProject = projects.data.find((project) => project.name === runtime.project);
      expect(globalProject).toBeDefined();
      expect(fixtureProject).toBeDefined();
      if (!globalProject || !fixtureProject) throw new Error("Fixture projects were not provisioned");

      const mapping = await json<{ data: { opencodeProjectId: string; status: string } }>(
        await request.put(`${runtime.apiBase}/usage/mappings?project=${encodeURIComponent(globalProject.name)}`, {
          headers: JSON_HEADERS,
          data: { opencodeProjectId: FIXTURE_OPENCODE_PROJECT_ID },
        }),
        201,
      );
      expect(mapping.data).toMatchObject({ opencodeProjectId: FIXTURE_OPENCODE_PROJECT_ID, status: "mapped" });

      const space = await json<{ data: { id: number } }>(
        await request.post(`${runtime.apiBase}/docs/spaces?project=${encodeURIComponent(fixtureProject.name)}`, {
          headers: JSON_HEADERS,
          data: {
            name: `TASK-102 space ${suffix}`,
            slug: `task-102-${suffix}`,
            description: "Run-owned task-capture fixture space",
          },
        }),
        201,
      );
      spaceId = space.data.id;

      const docsPage = await json<{ data: { id: number } }>(
        await request.post(`${runtime.apiBase}/docs/spaces/${spaceId}/pages?project=${encodeURIComponent(fixtureProject.name)}`, {
          headers: JSON_HEADERS,
          data: {
            title: pageTitle,
            slug: `task-102-page-${suffix}`,
            content: `# TASK-102\n\n${pageContentSentinel}`,
          },
        }),
        201,
      );
      pageId = docsPage.data.id;
      await json(
        await request.post(`${runtime.apiBase}/docs/pages/${pageId}/projects?project=${encodeURIComponent(fixtureProject.name)}`, {
          headers: JSON_HEADERS,
          data: { projectId: fixtureProject.id },
        }),
        201,
      );

      await page.goto("/chat", { waitUntil: "domcontentloaded" });
      const chatCreateTask = page.getByRole("button", { name: "Create task from conversation" });
      await expect(chatCreateTask).toBeEnabled({ timeout: 20_000 });
      const upstreamSession = await request.get(
        `${runtime.apiBase}/opencode/sessions/fixture-session-1`,
        { headers: runtime.apiHeaders },
      );
      expect(upstreamSession.status(), await upstreamSession.text()).toBe(200);
      expect((await upstreamSession.json() as { data: { projectID: string } }).data.projectID)
        .toBe(FIXTURE_OPENCODE_PROJECT_ID);
      const currentMappings = await request.get(
        `${runtime.apiBase}/usage/mappings?project=${encodeURIComponent(globalProject.name)}`,
        { headers: runtime.apiHeaders },
      );
      expect(currentMappings.status(), await currentMappings.text()).toBe(200);
      expect((await currentMappings.json() as { data: Array<{ opencodeProjectId: string; status: string }> }).data)
        .toContainEqual(expect.objectContaining({ opencodeProjectId: FIXTURE_OPENCODE_PROJECT_ID, status: "mapped" }));

      await chatCreateTask.click();
      const chatCapture = await captureFromDialog(page, {
        title: chatTitle,
        source_type: "chat",
        session_id: "fixture-session-1",
      }, 201);
      chatTaskId = chatCapture.task.id;
      await expect(page.getByTestId("chat-task-capture-status")).toContainText(chatTitle);

      await chatCreateTask.click();
      const repeatedChatCapture = await captureFromDialog(page, {
        title: chatRetryTitle,
        source_type: "chat",
        session_id: "fixture-session-1",
      }, 200);
      expect(repeatedChatCapture.task.id).toBe(chatCapture.task.id);
      expect(repeatedChatCapture.reference.id).toBe(chatCapture.reference.id);

      const storedChatTask = await json<{ data: CaptureResult["task"] }>(
        await request.get(`${runtime.apiBase}/tasks/${encodeURIComponent(chatTaskId)}?project=${encodeURIComponent(globalProject.name)}`, {
          headers: runtime.apiHeaders,
        }),
        200,
      );
      const chatReferences = await taskReferences(request, globalProject.name, chatTaskId);
      expect(storedChatTask.data.id).toBe(chatCapture.task.id);
      expect(chatReferences).toEqual([expect.objectContaining({ id: chatCapture.reference.id, source_type: "chat" })]);

      await page.goto(runtime.dashboardRoute(`/docs?space=${spaceId}&page=${pageId}`), { waitUntil: "domcontentloaded" });
      const docsCreateTask = page.getByRole("button", { name: "Create task", exact: true });
      await expect(docsCreateTask).toBeVisible();

      await docsCreateTask.click();
      const docsCapture = await captureFromDialog(page, {
        title: docsTitle,
        source_type: "docs",
        page_id: pageId,
      }, 201);
      docsTaskId = docsCapture.task.id;

      await docsCreateTask.click();
      const repeatedDocsCapture = await captureFromDialog(page, {
        title: docsRetryTitle,
        source_type: "docs",
        page_id: pageId,
      }, 200);
      expect(repeatedDocsCapture.task.id).toBe(docsCapture.task.id);
      expect(repeatedDocsCapture.reference.id).toBe(docsCapture.reference.id);

      const storedDocsTask = await json<{ data: CaptureResult["task"] }>(
        await request.get(`${runtime.apiBase}/tasks/${encodeURIComponent(docsTaskId)}?project=${encodeURIComponent(fixtureProject.name)}`, {
          headers: runtime.apiHeaders,
        }),
        200,
      );
      const docsReferences = await taskReferences(request, fixtureProject.name, docsTaskId);
      expect(storedDocsTask.data.id).toBe(docsCapture.task.id);
      expect(docsReferences).toEqual([expect.objectContaining({
        id: docsCapture.reference.id,
        source_type: "docs",
        display_title: pageTitle,
        display_detail: "Documentation page",
        availability: "available",
      })]);

      const safeResponses = [
        chatCapture,
        repeatedChatCapture,
        storedChatTask,
        chatReferences,
        docsCapture,
        repeatedDocsCapture,
        storedDocsTask,
        docsReferences,
      ];
      const serializedSafeResponses = JSON.stringify(safeResponses);
      expect(serializedSafeResponses).not.toContain(pageContentSentinel);
      expect(serializedSafeResponses).not.toContain(FIXTURE_TRANSCRIPT_SENTINEL);

      await page.goto(runtime.dashboardRoute("/tasks"), { waitUntil: "domcontentloaded" });
      await expect(page.getByText(docsTitle, { exact: true })).toBeVisible();
      await openTaskDetail(page, docsTitle, docsTaskId);
      await expect(page.getByText(pageTitle, { exact: true })).toBeVisible();
      await expect(page.getByText("Documentation page", { exact: true })).toBeVisible();
      await expect(page.getByText("Type: docs", { exact: true })).toBeVisible();
      await expect(page.getByText("Available", { exact: true })).toBeVisible();

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByText(docsTitle, { exact: true })).toBeVisible();
      await openTaskDetail(page, docsTitle, docsTaskId);
      await expect(page.getByText(pageTitle, { exact: true })).toBeVisible();

      await page.goto(runtime.dashboardRoute(`/docs?space=${spaceId}&page=${pageId}`), { waitUntil: "domcontentloaded" });
      const archiveResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname === `/api/v1/docs/pages/${pageId}`
        && response.request().method() === "DELETE",
      );
      await page.getByRole("button", { name: "Archive page", exact: true }).click();
      expect((await archiveResponse).status()).toBe(204);
      pageArchived = true;
      await expect(page.getByRole("status")).toContainText("Page archived (moved to trash)");

      await page.goto(runtime.dashboardRoute("/tasks"), { waitUntil: "domcontentloaded" });
      await openTaskDetail(page, docsTitle, docsTaskId);
      await expect(page.getByText("This source is no longer available. Update the task details if you need replacement context.")).toBeVisible();

      const missingDocsReferences = await taskReferences(request, fixtureProject.name, docsTaskId);
      expect(missingDocsReferences).toEqual([expect.objectContaining({
        id: docsCapture.reference.id,
        source_type: "docs",
        availability: "missing",
      })]);
      expect(JSON.stringify(missingDocsReferences)).not.toContain(pageContentSentinel);
      expect(providerWrites).toEqual([]);
    } finally {
      if (docsTaskId && fixtureProject) {
        await expectCleanupStatus(
          await request.delete(`${runtime.apiBase}/tasks/${encodeURIComponent(docsTaskId)}?project=${encodeURIComponent(fixtureProject.name)}`, { headers: runtime.apiHeaders }),
          "Docs task",
        );
      }
      if (chatTaskId && globalProject) {
        await expectCleanupStatus(
          await request.delete(`${runtime.apiBase}/tasks/${encodeURIComponent(chatTaskId)}?project=${encodeURIComponent(globalProject.name)}`, { headers: runtime.apiHeaders }),
          "Chat task",
        );
      }
      if (pageId && fixtureProject && !pageArchived) {
        await expectCleanupStatus(
          await request.delete(`${runtime.apiBase}/docs/pages/${pageId}?project=${encodeURIComponent(fixtureProject.name)}`, { headers: runtime.apiHeaders }),
          "Docs page",
        );
      }
      if (spaceId && fixtureProject) {
        await expectCleanupStatus(
          await request.delete(`${runtime.apiBase}/docs/spaces/${spaceId}/trash?project=${encodeURIComponent(fixtureProject.name)}`, { headers: runtime.apiHeaders }),
          "Docs trash",
        );
        await expectCleanupStatus(
          await request.delete(`${runtime.apiBase}/docs/spaces/${spaceId}?project=${encodeURIComponent(fixtureProject.name)}`, { headers: runtime.apiHeaders }),
          "Docs space",
        );
      }
    }
  });
});
