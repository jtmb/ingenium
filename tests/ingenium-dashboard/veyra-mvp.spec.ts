import { test, expect } from "./fixture";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { visualQaRunDirectory } from "./visual-qa-artifacts";
import { getDefaultSuiteRuntime } from "./default-suite-runtime";

test("Veyra recent work reopens real items, sorts the catalog and loads the next page", async ({ page, request }) => {
  test.setTimeout(120_000);
  const runtime = getDefaultSuiteRuntime();
  const projectQuery = `project=${encodeURIComponent(runtime.project)}`;
  const jsonHeaders = { ...runtime.apiHeaders, "Content-Type": "application/json" };
  const projectsResponse = await request.get(`${runtime.apiBase}/projects`, { headers: runtime.apiHeaders });
  expect(projectsResponse.status()).toBe(200);
  const project = (await projectsResponse.json()).data.find((entry: { name: string }) => entry.name === runtime.project);
  expect(project).toBeDefined();
  let newestTask!: { id: string; title: string };
  for (let index = 0; index < 22; index++) {
    const response = await request.post(`${runtime.apiBase}/tasks?${projectQuery}`, {
      headers: jsonHeaders, data: { title: `Recent work task ${index + 1}`, description: `Actual fixture task ${index + 1}` },
    });
    expect(response.status(), await response.text()).toBe(201);
    newestTask = (await response.json()).data;
  }
  const spaceResponse = await request.post(`${runtime.apiBase}/docs/spaces?${projectQuery}`, {
    headers: jsonHeaders, data: { name: "Recent work documents", slug: "recent-work-documents", description: "Owned browser fixture" },
  });
  expect(spaceResponse.status(), await spaceResponse.text()).toBe(201);
  const spaceId = (await spaceResponse.json()).data.id as number;
  const documentResponse = await request.post(`${runtime.apiBase}/docs/spaces/${spaceId}/pages?${projectQuery}`, {
    headers: jsonHeaders, data: { title: "Recent work exact document", slug: "recent-work-exact-document", content: "Owned Recent Work document content" },
  });
  expect(documentResponse.status(), await documentResponse.text()).toBe(201);
  const pageId = (await documentResponse.json()).data.id as number;
  const linkResponse = await request.post(`${runtime.apiBase}/docs/pages/${pageId}/projects?${projectQuery}`, {
    headers: jsonHeaders, data: { projectId: project.id },
  });
  expect(linkResponse.status(), await linkResponse.text()).toBe(201);

  await page.goto("/chat", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-composer")).toBeEnabled({ timeout: 20_000 });
  const promptRequest = page.waitForRequest(request => request.method() === "POST" && /\/opencode\/sessions\/[^/]+\/prompt$/.test(new URL(request.url()).pathname));
  await page.getByTestId("chat-composer").fill("Recent Work exact conversation");
  await expect(page.getByTestId("chat-send-btn")).toBeEnabled();
  await page.getByTestId("chat-composer").press("Enter");
  const sessionId = decodeURIComponent(new URL((await promptRequest).url()).pathname.match(/\/sessions\/([^/]+)\/prompt$/)![1]!);
  await expect(page.getByText("I've completed the analysis. The chat pipeline is working correctly.")).toBeVisible({ timeout: 30_000 });
  await page.setViewportSize({ width: 1586, height: 992 });
  const recentWorkResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/dashboard/recent-work"));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const recentWork = await recentWorkResponse;
  expect(recentWork.status()).toBe(200);
  expect((await recentWork.json()).data.items.some((item: { open: { sessionId?: string } }) => item.open.sessionId === sessionId)).toBe(true);
  const table = page.getByRole("table", { name: "Recent work" });
  await expect(table).toBeVisible();
  await expect(table.locator("tbody tr")).toHaveCount(3);
  for (const [name, path] of [["Tasks", "/tasks"], ["Mail", "/mail"], ["Pipeline", "/pipeline"]]) {
    await expect(page.getByRole("navigation", { name: "Quick links", exact: true }).getByRole("link", { name: new RegExp(name!) }))
      .toHaveAttribute("href", `${path}?${projectQuery}`);
  }
  await expect(page.getByRole("columnheader", { name: "Updated" })).toHaveAttribute("aria-sort", "descending");
  const artifacts = visualQaRunDirectory(runtime.context.runId);
  mkdirSync(artifacts, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(artifacts, "veyra-home-recent-work-fixture.png"), fullPage: true });

  const ascending = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/dashboard/recent-work") && new URL(response.url()).searchParams.get("direction") === "asc");
  await page.getByRole("button", { name: "Updated", exact: true }).click();
  expect((await ascending).status()).toBe(200);
  await expect(page.getByRole("columnheader", { name: "Updated" })).toHaveAttribute("aria-sort", "ascending");
  await page.getByRole("button", { name: "View all", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(20);
  const nextPageResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/dashboard/recent-work") && new URL(response.url()).searchParams.has("cursor"));
  await page.getByRole("button", { name: "Load more work", exact: true }).click();
  const nextPage = await nextPageResponse;
  expect(nextPage.status()).toBe(200);
  const nextItems = (await nextPage.json()).data.items;
  expect(nextItems.length).toBeGreaterThanOrEqual(4);
  await expect(table.locator("tbody tr")).toHaveCount(20 + nextItems.length);
  const links = await table.locator("tbody a").evaluateAll(elements => elements.map(element => (element as HTMLAnchorElement).href));
  expect(new Set(links).size).toBe(links.length);

  const conversationHref = links.find(href => new URL(href).searchParams.get("session") === sessionId);
  expect(conversationHref).toBeDefined();
  await table.locator(`a[href=${JSON.stringify(new URL(conversationHref!).pathname + new URL(conversationHref!).search)}]`).click();
  await expect(page).toHaveURL(url => url.pathname === "/chat" && url.searchParams.get("session") === sessionId && url.searchParams.get("project") === runtime.project);
  await expect(page.getByTestId("chat-user-message").filter({ hasText: "Recent Work exact conversation" })).toBeVisible();

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "View all", exact: true }).click();
  const documentHref = `/docs?space=${spaceId}&page=${pageId}&${projectQuery}`;
  await table.locator(`a[href=${JSON.stringify(documentHref)}]`).click();
  await expect(page).toHaveURL(url => url.pathname === "/docs" && url.searchParams.get("page") === String(pageId) && url.searchParams.get("space") === String(spaceId) && url.searchParams.get("project") === runtime.project);
  await expect(page.getByRole("button", { name: "Archive page", exact: true })).toBeVisible();
  await expect(page.getByText("Recent work exact document", { exact: true }).first()).toBeVisible();

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "View all", exact: true }).click();
  await table.locator(`a[href=${JSON.stringify(`/tasks?task=${newestTask.id}&${projectQuery}`)}]`).click();
  await expect(page.getByRole("dialog", { name: newestTask.title, exact: true })).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("dialog", { name: newestTask.title, exact: true })).toBeVisible();
  await page.goto(`/tasks?task=unavailable-recent-work-task&${projectQuery}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("That task is unavailable in this project.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Veyra Home creates its own conversation and sends actual selected attachment payloads", async ({ page }) => {
  test.setTimeout(90_000);
  const runtime = getDefaultSuiteRuntime();
  await page.setViewportSize({ width: 1586, height: 992 });
  const creates: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/opencode/sessions")) creates.push(request.url());
  });
  await page.goto("/chat", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-composer")).toBeEnabled({ timeout: 20_000 });
  const oldRequest = page.waitForRequest(request => request.method() === "POST" && /\/opencode\/sessions\/[^/]+\/prompt$/.test(new URL(request.url()).pathname));
  await page.getByTestId("chat-composer").fill("Prior conversation stays separate");
  await page.getByTestId("chat-composer").press("Enter");
  const oldSessionId = new URL((await oldRequest).url()).pathname.match(/\/sessions\/([^/]+)\/prompt$/)![1]!;
  await expect(page.getByText("I've completed the analysis. The chat pipeline is working correctly.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("chat-stop-btn")).toBeHidden();
  const beforeHome = creates.length;
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Welcome back", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Home chat model" })).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByTestId("chat-composer")).toBeEnabled();
  expect(creates).toHaveLength(beforeHome);
  const artifacts = visualQaRunDirectory(runtime.context.runId);
  mkdirSync(artifacts, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(artifacts, "veyra-home-composer-fixture.png"), fullPage: true });
  await page.locator('input[type="file"]').setInputFiles([
    { name: "home-first.txt", mimeType: "text/plain", buffer: Buffer.from("first Home file") },
    { name: "home-second.txt", mimeType: "text/plain", buffer: Buffer.from("second Home file") },
  ]);
  await page.getByTestId("chat-composer").fill("Read both Home attachments");
  const nextRequest = page.waitForRequest(request => request.method() === "POST" && /\/opencode\/sessions\/[^/]+\/prompt$/.test(new URL(request.url()).pathname));
  await page.getByTestId("chat-send-btn").click();
  const sent = await nextRequest;
  const newSessionId = new URL(sent.url()).pathname.match(/\/sessions\/([^/]+)\/prompt$/)![1]!;
  expect(newSessionId).not.toBe(oldSessionId);
  expect(sent.postDataJSON().parts).toEqual([
    { type: "text", text: "Read both Home attachments" },
    { type: "file", filename: "home-first.txt", mime: "text/plain", url: "data:text/plain;base64," + Buffer.from("first Home file").toString("base64") },
    { type: "file", filename: "home-second.txt", mime: "text/plain", url: "data:text/plain;base64," + Buffer.from("second Home file").toString("base64") },
  ]);
  await expect(page).toHaveURL(url => url.pathname === "/chat" && url.searchParams.get("session") === decodeURIComponent(newSessionId)
    && url.searchParams.get("project") === runtime.project && !!url.searchParams.get("runtime"));
  await expect(page.getByTestId("chat-user-message").filter({ hasText: "Read both Home attachments" })).toBeVisible();
  await expect(page.getByTestId("chat-user-message").filter({ hasText: "Prior conversation stays separate" })).toHaveCount(0);
  await page.screenshot({ path: join(artifacts, "veyra-home-new-conversation-fixture.png"), fullPage: true });
});

test("Veyra chat keeps real send/stream/history controls within the quiet shell", async ({ page }) => {
  test.setTimeout(90_000);
  const runtime = getDefaultSuiteRuntime();
  await page.goto("/chat", { waitUntil: "domcontentloaded" });
  const composer = page.getByTestId("chat-composer");
  await expect(composer).toBeEnabled({ timeout: 20_000 });
  await expect.poll(() => page.locator(".veyra-brand img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "Ready when you are." })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspace mode" }).getByRole("link", { name: "Work" })).toHaveAttribute("href", "/opencode");
  const modelPicker = page.getByRole("combobox", { name: "Chat model", exact: true });
  await expect(modelPicker).toBeEnabled();
  const controls = [page.getByRole("button", { name: "Attach files", exact: true }), composer, modelPicker,
    modelPicker.locator("..").locator("svg"), page.getByRole("button", { name: "Dictation unavailable", exact: true }), page.getByTestId("chat-send-btn")];
  const centers = await Promise.all(controls.map(async control => {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    return box!.y + box!.height / 2;
  }));
  expect(Math.max(...centers) - Math.min(...centers), "Composer controls share one horizontal centerline").toBeLessThanOrEqual(1);
  await modelPicker.focus();
  await expect(modelPicker).toBeFocused();
  await page.getByRole("button", { name: "Draft release notes", exact: true }).click();
  await expect(composer).toHaveValue("Draft release notes");
  await expect(page.getByTestId("chat-stop-btn")).toHaveCount(0);
  await composer.fill("");
  await page.mouse.move(0, 0);
  const artifacts = visualQaRunDirectory(runtime.context.runId);
  mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: join(artifacts, "veyra-chat-empty-fixture.png"), fullPage: true });
  const desktopViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  const shellBox = await page.getByTestId("chat-composer-shell").boundingBox();
  const mobileBoxes = await Promise.all(controls.map(control => control.boundingBox()));
  expect(shellBox).not.toBeNull();
  for (const box of mobileBoxes) {
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(shellBox!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(shellBox!.x + shellBox!.width);
  }
  const mobileCenters = mobileBoxes.filter((_, index) => index !== 1).map(box => box!.y + box!.height / 2);
  expect(Math.max(...mobileCenters) - Math.min(...mobileCenters), "Mobile model and action controls share one centerline").toBeLessThanOrEqual(1);
  expect(mobileBoxes[1]!.y + mobileBoxes[1]!.height).toBeLessThanOrEqual(mobileBoxes[0]!.y);
  await page.screenshot({ path: join(artifacts, "veyra-chat-mobile-fixture.png"), fullPage: true });
  await page.setViewportSize(desktopViewport);
  await composer.fill("Hello from E2E test");
  await composer.press("Enter");
  await expect(page.getByText("I've completed the analysis. The chat pipeline is working correctly.")).toBeVisible({ timeout: 30_000 });
  await expect(composer).toHaveValue("");
  await expect(page.getByTestId("chat-stop-btn")).toBeHidden();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Chat sessions", exact: true })).toBeVisible();
  await page.screenshot({ path: join(artifacts, "veyra-chat-conversation-fixture.png"), fullPage: true });
});

test("Veyra settings and navigation remain discoverable and keyboard reachable", async ({ page }) => {
  await page.goto("/chat", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-composer")).toBeEnabled({ timeout: 20_000 });
  const expand = page.getByRole("button", { name: "Expand navigation", exact: true });
  await expand.click();
  const navigation = page.getByRole("navigation", { name: "Desktop navigation" });
  for (const name of ["Chat", "OpenCode", "VS Code", "Mail", "Tasks", "Docs", "Skills", "Agents", "Observations", "Personality", "Context", "Pipeline", "Jobs", "Backups", "Logs", "Usage", "Status", "Projects", "Organizations", "Plugins", "MCP Servers", "Config", "Secrets"]) {
    await expect(navigation.getByRole("link", { name, exact: true })).toHaveAttribute("href", /\//);
  }
  await page.getByText("Context and memory", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Use saved memory", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save this message to memory", exact: true })).toBeVisible();
  await page.getByText("Conversation options", { exact: true }).click();
  await expect(page.getByTestId("chat-header-provider")).toBeVisible();
  await expect(page.getByTestId("chat-header-model")).toBeVisible();
});
