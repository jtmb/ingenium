import { expect, test } from "./fixture";
import { getDefaultSuiteRuntime } from "./default-suite-runtime";

const routes = [
  { path: "/", heading: "Ingenium" },
  { path: "/chat", heading: "Chat" },
  { path: "/docs", heading: "Welcome to Docs" },
  { path: "/mail", heading: "Mail" },
] as const;

test("implicit dashboard routes use only the run organization home", async ({ page }) => {
  const project = getDefaultSuiteRuntime().project;

  for (const route of routes) {
    await page.goto(route.path, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: route.heading, exact: true }).first()).toBeVisible();
    expect(new URL(page.url()).searchParams.has("project")).toBe(false);
    expect(await page.evaluate(() => ({
      active: localStorage.getItem("ingenium_active_project"),
      global: localStorage.getItem("ingenium_global_project"),
    }))).toEqual({ active: null, global: project });
  }

  const state = await page.evaluate(async () => {
    const [projectsResponse, spacesResponse, accountsResponse] = await Promise.all([
      fetch("/api/v1/projects"),
      fetch("/api/v1/docs/spaces"),
      fetch("/api/v1/emails/accounts?include_hidden=true"),
    ]);
    return {
      projectsStatus: projectsResponse.status,
      projects: (await projectsResponse.json()).data,
      spacesStatus: spacesResponse.status,
      spaces: (await spacesResponse.json()).data,
      accountsStatus: accountsResponse.status,
    };
  });
  expect(state.projectsStatus).toBe(200);
  expect(state.projects).toEqual([expect.objectContaining({ name: project, is_global: 1 })]);
  expect(state.spacesStatus).toBe(200);
  expect(state.spaces).toEqual([
    expect.objectContaining({ slug: expect.stringMatching(/^organization-[0-9a-f]{8}$/) }),
  ]);
  expect(state.accountsStatus).toBe(200);
});

test("an explicit fixture project remains isolated", async ({ page }) => {
  const project = getDefaultSuiteRuntime().project;
  await page.goto(`/?project=${encodeURIComponent(project)}`);

  await expect(page.getByText(`Project: ${project}`)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("ingenium_active_project"))).toBe(project);
  const projects = await page.evaluate(async () => (await (await fetch("/api/v1/projects")).json()).data);
  expect(projects).toEqual([expect.objectContaining({ name: project, is_global: 1 })]);
});
