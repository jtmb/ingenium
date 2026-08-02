import { expect, test, type Page } from "@playwright/test";

type FixtureOptions = {
  project?: string;
  queueEmpty?: boolean;
  eventsEmpty?: boolean;
  queueFailsOnce?: boolean;
  queueMoreFailsOnce?: boolean;
  queueGate?: Promise<void>;
  eventsFailOnce?: boolean;
  paginate?: boolean;
  pollTransition?: boolean;
  activeDeleteConflict?: boolean;
  failList?: boolean;
  failRun?: boolean;
  failToggle?: boolean;
  failLogs?: boolean;
  failCancel?: boolean;
  malicious?: boolean;
  requests?: URL[];
  calls?: { queue: number; events: number; runs: number };
};

const projectRows = (primary: string) => [
  { id: "project-primary", name: primary, is_global: true, created_at: "2026-08-02T00:00:00.000Z", updated_at: "2026-08-02T00:00:00.000Z" },
  { id: "project-second", name: "second-project", is_global: false, created_at: "2026-08-02T00:00:00.000Z", updated_at: "2026-08-02T00:00:00.000Z" },
];

const baseJob = {
  id: "job-primary-00000000-0000-0000-0000-000000000001",
  project_id: "project-primary",
  name: "Archive responder",
  description: "Respond to trusted archive events.",
  agent: "ingenium-orchestrator",
  prompt_template: "Handle the trusted event.",
  schedule_cron: null,
  trigger_event: "context.conversation.archived",
  enabled: true,
  timeout_minutes: 30,
  created_at: "2026-08-02T00:00:00.000Z",
  updated_at: "2026-08-02T00:00:00.000Z",
};

const legacyJob = {
  ...baseJob,
  id: "job-legacy-00000000-0000-0000-0000-000000000002",
  name: "Legacy event job",
  trigger_event: "legacy.webhook",
};

const deliveryStates = ["queued", "leased", "retry_wait", "succeeded", "dead_letter"] as const;

function deliveriesFor(project: string) {
  return deliveryStates.map((state, index) => ({
    id: `delivery-${project}-${state}-00000000-0000-0000-0000-00000000000${index}`,
    trusted_event_id: `event-${project}-${state}-00000000-0000-0000-0000-00000000000${index}`,
    event_type: index % 2 === 0 ? "context.conversation.archived" : "context.conversation.unarchived",
    job_id: baseJob.id,
    job_name: project === "second-project" ? "Second project job" : "Archive responder",
    state,
    attempt_count: index,
    next_attempt_at: state === "queued" || state === "retry_wait" ? "2026-08-02T00:05:00.000Z" : null,
    lease_expires_at: state === "leased" ? "2026-08-02T00:10:00.000Z" : null,
    last_error_code: state === "dead_letter" ? "fixture_failure" : null,
    last_error_message: state === "dead_letter" ? "token=fixture-secret must never render" : null,
    created_at: "2026-08-02T00:00:00.000Z",
    updated_at: `2026-08-02T00:0${index}:00.000Z`,
    // Deliberately present only in the fixture to prove the dashboard ignores it.
    lease_owner_hash: "lease-owner-must-not-render",
    process_id: 1337,
  }));
}

function trustedEventsFor(project: string) {
  return [
    {
      id: `event-${project}-archived-00000000-0000-0000-0000-000000000001`,
      event_type: "context.conversation.archived",
      source_audit_event_id: "audit-00000000-0000-0000-0000-000000000001",
      created_at: "2026-08-02T00:00:00.000Z",
      payload: "payload-must-not-render",
      dedupe_key: "dedupe-must-not-render",
      schema_version: 1,
      title: "title-must-not-render",
    },
    {
      id: `event-${project}-restored-00000000-0000-0000-0000-000000000002`,
      event_type: "context.checkpoint.restored_as_new",
      source_audit_event_id: "audit-00000000-0000-0000-0000-000000000002",
      created_at: "2026-08-02T00:01:00.000Z",
    },
  ];
}

async function installJobsFixture(page: Page, options: FixtureOptions = {}) {
  const project = options.project ?? "fixture-project";
  const calls = options.calls ?? { queue: 0, events: 0, runs: 0 };
  let queueFailures = options.queueFailsOnce ? 1 : 0;
  let queueMoreFailures = options.queueMoreFailsOnce ? 1 : 0;
  let eventFailures = options.eventsFailOnce ? 1 : 0;
  let jobs = [baseJob, legacyJob];

  await page.route("**/api/v1/projects", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: projectRows(project) }) }));
  await page.route("**/api/v1/agents**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [{ id: "agent-1", name: "ingenium-orchestrator", description: "Fixture agent", category: "primary", mode: "primary", content: "", enabled: true, created_at: "2026-08-02T00:00:00.000Z", updated_at: "2026-08-02T00:00:00.000Z" }] }) }));
  await page.route("**/api/v1/jobs**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    options.requests?.push(url);
    const selectedProject = url.searchParams.get("project") ?? project;
    const method = request.method();
    const path = url.pathname;
    const reply = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path.endsWith("/event-deliveries")) {
      calls.queue += 1;
      if (options.queueGate) await options.queueGate;
      if (queueFailures > 0) {
        queueFailures -= 1;
        await reply(503, { error: { message: "Queue fixture unavailable" } });
        return;
      }
      const cursor = url.searchParams.get("cursor");
      if (cursor) {
        if (queueMoreFailures > 0) {
          queueMoreFailures -= 1;
          await reply(503, { error: { message: "More queue fixture unavailable" } });
          return;
        }
        await reply(200, { data: [{ ...deliveriesFor(selectedProject)[0], id: `delivery-${selectedProject}-more-00000000-0000-0000-0000-000000000099`, state: "succeeded", attempt_count: 1 }], nextCursor: null });
        return;
      }
      const data = options.queueEmpty ? [] : deliveriesFor(selectedProject).map((delivery) => options.pollTransition && calls.queue > 1 && delivery.state === "queued" ? { ...delivery, state: "succeeded", updated_at: "2026-08-02T00:20:00.000Z" } : delivery);
      await reply(200, { data, nextCursor: options.paginate ? "opaque-queue-cursor" : null });
      return;
    }

    if (path.endsWith("/events")) {
      calls.events += 1;
      if (eventFailures > 0) {
        eventFailures -= 1;
        await reply(503, { error: { message: "Trusted events fixture unavailable" } });
        return;
      }
      if (url.searchParams.get("cursor")) {
        await reply(200, { data: [{ id: "event-more-00000000-0000-0000-0000-000000000003", event_type: "context.conversation.unarchived", source_audit_event_id: "audit-00000000-0000-0000-0000-000000000003", created_at: "2026-08-02T00:02:00.000Z" }], nextCursor: null });
        return;
      }
      await reply(200, { data: options.eventsEmpty ? [] : trustedEventsFor(selectedProject), nextCursor: options.paginate ? "opaque-events-cursor" : null });
      return;
    }

    if (/\/runs\/[^/]+\/logs$/.test(path)) {
      if (options.failLogs) await reply(503, { error: { message: "Logs fixture unavailable token=fixture-secret" } });
      else await reply(200, { data: options.malicious ? [{ id: 1, run_id: "run-event-00000000-0000-0000-0000-000000000001", seq: 1, stream: "stdout", line: "completed OPENAI_API_KEY=dom-secret for queue-item-7", created_at: "2026-08-02T00:00:00.000Z", payload: "payload-must-not-survive", process_id: 7331 }] : [], total: options.malicious ? 1 : 0 });
      return;
    }
    if (/\/runs\/[^/]+\/cancel$/.test(path)) {
      if (options.failCancel) await reply(503, { error: { message: "Cancel fixture unavailable" } });
      else await reply(200, { data: { id: "run-event-00000000-0000-0000-0000-000000000001", status: "cancelled" } });
      return;
    }
    if (/\/jobs\/[^/]+\/runs$/.test(path)) {
      calls.runs += 1;
      await reply(200, { data: [{ id: "run-event-00000000-0000-0000-0000-000000000001", job_id: baseJob.id, status: "running", trigger: "event", started_at: "2026-08-02T00:00:00.000Z", created_at: "2026-08-02T00:00:00.000Z", event_delivery: { delivery_id: deliveriesFor(selectedProject)[0].id, trusted_event_id: deliveriesFor(selectedProject)[0].trusted_event_id, attempt_number: 2, delivery_state: "leased", ...(options.malicious ? { lease_owner_hash: "lease-owner-must-not-survive" } : {}) }, ...(options.malicious ? { payload: "payload-must-not-survive", prompt_template: "prompt-must-not-survive", environment: { AWS_SECRET_ACCESS_KEY: "dom-secret" }, process_id: 7331 } : {}) }, { id: "run-manual-00000000-0000-0000-0000-000000000002", job_id: baseJob.id, status: "success", trigger: "manual", started_at: "2026-08-01T00:00:00.000Z", finished_at: "2026-08-01T00:01:00.000Z", created_at: "2026-08-01T00:00:00.000Z", event_delivery: null }], total: 2 });
      return;
    }
    if (/\/jobs\/[^/]+\/run$/.test(path) && method === "POST") {
      if (options.failRun) await reply(503, { error: { message: "Run fixture unavailable" } });
      else await reply(202, { data: { id: "run-new", job_id: baseJob.id, status: "running", trigger: "manual", created_at: "2026-08-02T00:00:00.000Z" } });
      return;
    }
    if (/\/jobs\/[^/]+$/.test(path) && method === "DELETE") {
      if (options.activeDeleteConflict) await reply(409, { error: { message: "Job has an active event delivery" } });
      else await route.fulfill({ status: 204 });
      return;
    }
    if (/\/jobs\/[^/]+$/.test(path) && method === "PATCH") {
      if (options.failToggle) {
        await reply(503, { error: { message: "Toggle fixture unavailable" } });
        return;
      }
      const id = path.split("/").at(-1)!;
      const body = request.postDataJSON() as Partial<typeof baseJob>;
      jobs = jobs.map((job) => job.id === id ? { ...job, ...body } : job);
      await reply(200, { data: jobs.find((job) => job.id === id) });
      return;
    }
    if (path.endsWith("/suggest") && method === "POST") {
      await reply(200, { data: { configured: false, prompt_template: null, schedule_cron: null, trigger_event: null } });
      return;
    }
    if (path.endsWith("/jobs") && method === "POST") {
      const body = request.postDataJSON() as Partial<typeof baseJob>;
      const created = { ...baseJob, ...body, id: "job-created-00000000-0000-0000-0000-000000000003", trigger_event: body.trigger_event ?? null };
      jobs = [created, ...jobs];
      await reply(201, { data: created });
      return;
    }
    if (path.endsWith("/jobs") && method === "GET") {
      if (options.failList) await reply(503, { error: { message: "Jobs fixture unavailable" } });
      else await reply(200, { data: selectedProject === "second-project" ? [{ ...baseJob, name: "Second project job" }] : jobs, total: jobs.length });
      return;
    }
    await route.fallback();
  });
  return calls;
}

test.describe("Jobs dashboard", () => {
  test("uses encoded validated project URLs and exposes an accessible three-tab workspace", async ({ page }) => {
    const requests: URL[] = [];
    await installJobsFixture(page, { project: "fixture project", requests });
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });

    const tabs = page.getByRole("tablist", { name: "Jobs workspace views" });
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole("tab")).toHaveCount(3);
    await expect(tabs.getByRole("tab", { name: "Jobs" })).toHaveAttribute("aria-selected", "true");
    expect(requests.some((url) => url.pathname === "/api/v1/jobs" && url.search.includes("project=fixture+project"))).toBe(true);

    await tabs.getByRole("tab", { name: "Event queue" }).click();
    await expect(page.getByRole("heading", { name: /Event queue — loaded results/ })).toBeVisible();
    const queueUrl = requests.find((url) => url.pathname === "/api/v1/jobs/event-deliveries");
    expect(queueUrl?.searchParams.get("project")).toBe("fixture project");
    expect(queueUrl?.searchParams.get("limit")).toBe("20");
  });

  test("uses the exact trusted-event catalog and preserves a legacy value only while editing", async ({ page }) => {
    await installJobsFixture(page);
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: "Create Job" }).click();
    const trigger = page.getByLabel("Trusted event trigger");
    await expect(trigger.locator("option")).toHaveCount(4);
    await expect(trigger.locator("option").allTextContents()).resolves.toEqual([
      "No event",
      "Conversation archived",
      "Conversation unarchived",
      "Checkpoint restored as new",
    ]);
    await expect(page.getByText(/Run Now always starts a fresh manual run/)).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Open job Legacy event job" }).click();
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("option", { name: "Legacy value preserved: legacy.webhook" })).toBeDisabled();
    await expect(page.getByText(/Legacy trigger preserved/)).toBeVisible();
  });

  test("renders all delivery states and bounded metadata without sensitive fields or delivery controls", async ({ page }) => {
    await installJobsFixture(page);
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Event queue" }).click();

    const table = page.getByRole("table", { name: "Event queue loaded results table" });
    await expect(table).toBeVisible();
    for (const label of ["Queued", "Leased", "Retry waiting", "Succeeded", "Dead letter"]) await expect(table.getByText(label, { exact: true })).toBeVisible();
    await expect(table).toContainText("0 / 5");
    await expect(table).toContainText("4 / 5");
    await expect(table).toContainText("Next retry:");
    await expect(table).toContainText("Lease expires:");
    await expect(page.getByText("fixture-secret")).toHaveCount(0);
    await expect(page.getByText("lease-owner-must-not-render")).toHaveCount(0);
    await expect(page.getByText("1337", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /replay|retry|cancel.*delivery/i })).toHaveCount(0);
    await expect(page.getByText(/dead-letter delivery is terminal/i)).toBeVisible();
  });

  test("renders trusted-event audit metadata only, filtering and paging with mobile cards without overflow", async ({ page }) => {
    await installJobsFixture(page, { paginate: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Trusted events" }).click();

    await expect(page.getByTestId("trusted-events-mobile-cards")).toBeVisible();
    await expect(page.getByTestId("trusted-events-table")).toHaveClass(/hidden/);
    await expect(page.getByText("payload-must-not-render")).toHaveCount(0);
    await expect(page.getByText("dedupe-must-not-render")).toHaveCount(0);
    await expect(page.getByText("title-must-not-render")).toHaveCount(0);
    await page.getByLabel("Event type").selectOption("context.checkpoint.restored_as_new");
    await expect(page.getByTestId("trusted-events-mobile-cards").getByText("Checkpoint restored as new")).toBeVisible();
    await page.getByLabel("Event type").selectOption("");
    await page.getByRole("button", { name: "Load more loaded results" }).click();
    await expect(page.getByTestId("trusted-events-mobile-cards").getByLabel("Source audit ID: audit-00000000-0000-0000-0000-000000000003")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("shows a deterministic initial queue loading state before its fixture resolves", async ({ page }) => {
    let releaseQueue!: () => void;
    const queueGate = new Promise<void>((resolve) => { releaseQueue = resolve; });
    await installJobsFixture(page, { queueGate });
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Event queue" }).click();
    await expect(page.getByTestId("event-queue-loading")).toBeVisible();
    releaseQueue();
    await expect(page.getByRole("table", { name: "Event queue loaded results table" })).toBeVisible();
  });

  test("shows queue loading, fatal retry, empty, paging, filters, and project reset without discarding loaded rows", async ({ page }) => {
    const requests: URL[] = [];
    await installJobsFixture(page, { queueFailsOnce: true, paginate: true, requests });
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Event queue" }).click();

    await expect(page.getByTestId("event-queue-error")).toBeVisible();
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByRole("table", { name: "Event queue loaded results table" })).toBeVisible();
    await page.getByLabel("State").selectOption("dead_letter");
    await expect(page.getByText("fixture_failure")).toBeVisible();
    await page.getByLabel("State").selectOption("");
    await page.getByRole("button", { name: "Load more loaded results" }).click();
    await expect(page.getByTestId("event-queue-table").getByLabel(/Delivery ID: delivery-fixture-project-more/)).toBeVisible();
    expect(requests.some((url) => url.pathname.endsWith("/event-deliveries") && url.searchParams.get("cursor") === "opaque-queue-cursor")).toBe(true);

    await page.goto("/jobs?project=second-project", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Second project job Open job" })).toBeVisible();
    await page.getByRole("tab", { name: "Event queue" }).click();
    await expect(page.getByTestId("event-queue-table").getByText("Second project job").first()).toBeVisible();
    expect(requests.some((url) => url.pathname.endsWith("/event-deliveries") && url.searchParams.get("project") === "second-project")).toBe(true);
  });

  test("renders configured empty states and retries trusted-events failures", async ({ page }) => {
    await installJobsFixture(page, { queueEmpty: true, eventsFailOnce: true });
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Event queue" }).click();
    await expect(page.getByTestId("event-queue-empty")).toBeVisible();
    await page.getByRole("tab", { name: "Trusted events" }).click();
    await expect(page.getByTestId("trusted-events-error")).toBeVisible();
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByRole("table", { name: "Trusted events loaded results table" })).toBeVisible();
  });

  test("keeps loaded queue rows visible when a load-more request fails", async ({ page }) => {
    await installJobsFixture(page, { paginate: true, queueMoreFailsOnce: true });
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Event queue" }).click();
    const table = page.getByRole("table", { name: "Event queue loaded results table" });
    await expect(table.locator("tbody tr")).toHaveCount(5);
    await page.getByRole("button", { name: "Load more loaded results" }).click();
    await expect(page.getByText(/More event deliveries could not be loaded/)).toBeVisible();
    await expect(table.locator("tbody tr")).toHaveCount(5);
    await expect(page.getByRole("button", { name: "Load more loaded results" })).toBeVisible();
  });

  test("polls only the active queue and replaces transitioned rows without duplicates", async ({ page }) => {
    const calls = { queue: 0, events: 0, runs: 0 };
    await installJobsFixture(page, { pollTransition: true, calls });
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Event queue" }).click();
    await expect(page.getByTestId("event-queue-table").getByText("Queued", { exact: true })).toBeVisible();
    await expect.poll(() => calls.queue, { timeout: 8_000 }).toBeGreaterThan(1);
    await expect(page.getByTestId("event-queue-table").getByText("Succeeded", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("table", { name: "Event queue loaded results table" }).locator("tbody tr")).toHaveCount(5);
    await page.getByRole("tab", { name: "Trusted events" }).click();
    const callsAfterLeavingQueue = calls.queue;
    await expect.poll(() => calls.queue, { timeout: 6_000 }).toBe(callsAfterLeavingQueue);
  });

  test("keeps detail open and refreshes run and delivery visibility after active-delete conflict", async ({ page }) => {
    const calls = { queue: 0, events: 0, runs: 0 };
    await installJobsFixture(page, { activeDeleteConflict: true, calls });
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Open job Archive responder" }).click();
    await page.getByRole("button", { name: "Delete" }).click();

    await expect(page.getByTestId("job-detail")).toBeVisible();
    await expect(page.getByTestId("jobs-page").getByRole("alert")).toContainText("Wait for the delivery to reach a terminal state");
    await expect.poll(() => calls.runs).toBeGreaterThan(1);
    await expect.poll(() => calls.queue).toBeGreaterThan(0);
  });

  test("labels completed manual and trusted-event runs with delivery attempt metadata", async ({ page }) => {
    await installJobsFixture(page);
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Open job Archive responder" }).click();
    const history = page.getByRole("table", { name: "Run history" });
    await expect(history).toContainText("Trusted event delivery");
    await expect(history).toContainText("Manual run");
    await expect(history).toContainText("Completed (succeeded)");
    await expect(history).toContainText("attempt 2");
  });

  test("uses native keyboard controls to select desktop and mobile run-history entries", async ({ page }) => {
    await installJobsFixture(page);
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Open job Archive responder" }).click();

    const desktopEventRun = page.getByRole("table", { name: "Run history" }).getByRole("button", { name: "Open run run-event-00000000-0000-0000-0000-000000000001" });
    const desktopManualRun = page.getByRole("table", { name: "Run history" }).getByRole("button", { name: "Open run run-manual-00000000-0000-0000-0000-000000000002" });
    await desktopEventRun.focus();
    await page.keyboard.press("Tab");
    await expect(desktopManualRun).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(desktopManualRun).toHaveAttribute("aria-pressed", "true");

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileEventRun = page.getByTestId("run-history-mobile-cards").getByRole("button", { name: "Open run run-event-00000000-0000-0000-0000-000000000001" });
    await mobileEventRun.focus();
    await page.keyboard.press(" ");
    await expect(mobileEventRun).toHaveAttribute("aria-pressed", "true");
  });

  test("drops untrusted Jobs response fields and redacts successful log output before DOM exposure", async ({ page }) => {
    await installJobsFixture(page, { malicious: true });
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Open job Archive responder" }).click();
    await expect(page.getByText("completed OPENAI_API_KEY=[REDACTED] for queue-item-7")).toBeVisible();

    const exposedDom = await page.locator("body").evaluate((body) => [
      body.textContent,
      body.innerHTML,
      ...[...body.querySelectorAll("[aria-label], [aria-description], [title]")].map((element) => [
        element.getAttribute("aria-label"),
        element.getAttribute("aria-description"),
        element.getAttribute("title"),
      ].join(" ")),
    ].join(" "));
    for (const forbidden of ["dom-secret", "payload-must-not-survive", "lease-owner-must-not-survive", "prompt-must-not-survive", "7331"]) {
      expect(exposedDom).not.toContain(forbidden);
    }
  });

  test("keeps the jobs view available after a list failure", async ({ page }) => {
    await installJobsFixture(page, { failList: true });
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/Jobs could not be loaded/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Job" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Jobs" })).toBeVisible();
  });

  test("keeps existing job views on list, run, toggle, cancel, and log errors", async ({ page }) => {
    await installJobsFixture(page, { failRun: true, failToggle: true, failLogs: true, failCancel: true });
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Run Archive responder now" }).click();
    await expect(page.getByTestId("jobs-page").getByRole("alert")).toContainText("Job could not be started");
    await page.getByRole("button", { name: "Open job Archive responder" }).click();
    await page.getByRole("checkbox").first().click();
    await expect(page.getByText(/Job could not be disabled/)).toBeVisible();
    await expect(page.getByTestId("job-detail")).toBeVisible();
    await page.getByRole("button", { name: "Cancel Run" }).click();
    await expect(page.getByText(/Run could not be cancelled/)).toBeVisible();
    await expect(page.getByText(/Run logs could not be loaded/)).toBeVisible();
  });

  test("supports keyboard tab navigation, focusable result regions, semantic headings, and desktop/mobile classes", async ({ page }) => {
    await installJobsFixture(page);
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    const jobsTab = page.getByRole("tab", { name: "Jobs" });
    await jobsTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Event queue" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Trusted events" })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "Event queue" })).toBeFocused();
    await expect(page.getByRole("region", { name: "Event queue loaded results table" })).toHaveAttribute("tabindex", "0");
    await expect(page.getByRole("table", { name: "Event queue loaded results table" }).getByRole("columnheader")).toHaveCount(6);
    await expect(page.getByTestId("event-queue-mobile-cards")).toHaveClass(/md:hidden/);
    await expect(page.getByTestId("event-queue-table")).toHaveClass(/md:block/);
  });
});
