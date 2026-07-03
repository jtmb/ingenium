---
name: useful-tests
description: "Write tests that catch real bugs — unit, integration, and E2E with Playwright. Covers app lifecycle (launch → test → teardown), test quality signals, anti-patterns for broken AI-generated tests, and CI readiness. Use when writing any test file (*.test.*, *_test.*, *.spec.*), adding Playwright, or setting up test infrastructure."
---

# Useful Tests — Tests That Actually Catch Bugs

## When to Use

- Writing any new test file (`*.test.*`, `*_test.*`, `*.spec.*`)
- Adding Playwright E2E tests to a project
- Setting up a test infrastructure for a new service
- Reviewing AI-generated code — verify tests exist and are meaningful
- Refactoring brittle or useless tests
- Setting up CI test pipelines

## 🔴 HARD RULE — Every Code Change Must Have Tests

**You MUST write or update tests in the same turn as code changes.** This is not optional. This is not "if it's easy." This is mandatory.

**Triggers — after making these changes, write tests immediately:**

| Code change | Tests required |
|-------------|---------------|
| New function / class / module | At least one unit test covering the happy path + one error path |
| Bug fix | A regression test that fails without the fix and passes with it |
| Refactored logic | Update existing tests; add new ones if behavior changed |
| New API endpoint | Integration test for 200 + 4xx + 5xx |
| New config / env var | Test default behavior and invalid input |
| Script change (bash, etc.) | Run the script in dry-run mode; add assertion to test suite |

**Workflow:**
1. Make the code change
2. Ask: "Did I add, fix, or change logic?"
3. If YES: write at least one test. Run it. Verify it fails before the fix passes.
4. If no test exists that could catch a regression of your change, create one.
5. Never declare a task complete without running `bash tests/test-self-improving.sh` (if it exists) or the project's test suite.

**A test that always passes is useless.** Every test must verify a specific behavior. If you can delete the code and the test still passes, delete the test.

## Core Principle — Tests Must Fail Before They Pass

**Every AI agent writing tests must follow this rule:** Write the test first, run it, watch it fail (because the code doesn't exist yet or is wrong), then write the implementation. A test that passes on first run is probably broken — it's testing nothing.

---

## The Test Pyramid — What to Test Where

```
     ╱  E2E  ╲          Playwright against live running app
    ╱──────────╲         Few tests. Critical user flows only.
   ╱ Integration ╲       API endpoints, DB queries, service boundaries
  ╱───────────────╲     Medium coverage.
 ╱   Unit Tests    ╲    Domain logic, pure functions, edge cases
╱───────────────────╲   Many tests. Fast. No I/O.
```

| Layer | Tool | What it tests | Speed | Count |
|-------|------|--------------|-------|-------|
| **Unit** | Framework-native (Jest, pytest, go test) | Pure logic, edge cases, error paths | <1ms each | Many |
| **Integration** | Framework-native + testcontainers or in-memory | API endpoints, DB queries, serialization | ~10ms each | Medium |
| **E2E** | Playwright test runner | Critical user flows against running app | ~500ms each | Few |

**Rules:**
- **Unit tests never touch network, filesystem, or database.** Mock at the boundary.
- **Integration tests use real infrastructure or lightweight fakes** (SQLite in-memory, testcontainers).
- **E2E tests launch the actual application** — no mocking, no stubbing. The app runs exactly as in production (minus external APIs — use wiremock or similar).

---

## Launching the Application for E2E Tests

E2E tests are useless if they don't run against a real running application. The test script is responsible for the full lifecycle.

### Lifecycle Pattern

```
1. START  → Launch app server (dev mode or production build)
2. WAIT   → Poll health endpoint until 200 OK
3. TEST   → Run Playwright tests against live app
4. STOP   → Kill app server (always, even on failure)
5. REPORT → Exit with pass/fail
```

### Script: `scripts/run-e2e.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

APP_PORT="${APP_PORT:-3000}"
APP_PID=""

cleanup() {
    if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
        echo "Stopping app (PID $APP_PID)..."
        kill "$APP_PID" 2>/dev/null || true
        wait "$APP_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

echo "Starting app..."
npm run dev &
APP_PID=$!

echo "Waiting for app on port $APP_PORT..."
for i in $(seq 1 30); do
    if curl -sf "http://localhost:$APP_PORT/health" >/dev/null 2>&1; then
        echo "App is ready."
        break
    fi
    sleep 1
done

if ! curl -sf "http://localhost:$APP_PORT/health" >/dev/null 2>&1; then
    echo "ERROR: App failed to start within 30s" >&2
    exit 1
fi

echo "Running Playwright tests..."
npx playwright test --reporter=list
PLAYWRIGHT_EXIT=$?

exit $PLAYWRIGHT_EXIT
```

### Script: `scripts/run-e2e-docker.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

cleanup() {
    echo "Stopping containers..."
    docker compose -f docker-compose.test.yml down --volumes 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting test stack..."
docker compose -f docker-compose.test.yml up --build --detach

echo "Waiting for services..."
timeout 60 bash -c 'until curl -sf http://localhost:3000/health; do sleep 1; done'

echo "Running Playwright tests..."
npx playwright test --reporter=list --project=chromium
```

**Rules:**
- **Always use `trap cleanup EXIT`** — the app server MUST be killed even if tests crash.
- **Poll health endpoint, not just the port.** Port-open doesn't mean the app is ready to serve.
- **Timeout with a clear error.** Don't wait forever — 30-60s max, then fail with "App failed to start."
- **Separate docker-compose for tests.** `docker-compose.test.yml` can use different config (no volumes, different ports, test DB).
- **Use one script for both local and CI.** CI runs the same script. No "works on my machine" drift.

---

## Playwright E2E Tests — Patterns That Work

### Playwright Config (`playwright.config.ts`)

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: process.env.CI
    ? undefined
    : {
        command: 'npm run dev',
        port: 3000,
        reuseExistingServer: !process.env.CI,
      },
});
```

### Selectors — Use Data Attributes, Not Classes or Structure

```typescript
// ❌ BAD — brittle, breaks on any UI change
await page.click('.btn-primary');
await page.click('button:nth-child(3)');

// ✅ GOOD — stable, semantic, survives refactors
await page.click('[data-testid="submit-order"]');
await page.fill('[data-testid="email-input"]', 'user@test.com');
await page.locator('[data-testid="cart-item"]').filter({ hasText: 'Widget' });
```

### Test Structure — Narrative Flow

Each E2E test tells a story. The test description reads like a user story.

```typescript
import { test, expect } from '@playwright/test';

test.describe('Checkout flow', () => {
  test('completes purchase with valid credit card', async ({ page }) => {
    // Arrange — set up state via API (faster than clicking through UI)
    await page.request.post('/api/test/seed-product', { data: { id: 'prod-1', price: 29.99 } });

    // Act — user journey
    await page.goto('/products/prod-1');
    await page.click('[data-testid="add-to-cart"]');
    await page.click('[data-testid="go-to-cart"]');
    await page.click('[data-testid="checkout"]');
    await page.fill('[data-testid="card-number"]', '4242424242424242');
    await page.fill('[data-testid="card-expiry"]', '12/28');
    await page.fill('[data-testid="card-cvc"]', '123');
    await page.click('[data-testid="place-order"]');

    // Assert — what the user sees
    await expect(page.locator('[data-testid="order-confirmation"]')).toBeVisible();
    await expect(page.locator('[data-testid="order-total"]')).toHaveText('$29.99');
  });
});
```

**Rules:**
- **Arrange via API, not UI.** Use `page.request.post` to seed data. Clicking through setup is slow and brittle.
- **Assert what the user sees.** `toBeVisible()`, `toHaveText()`, `toHaveURL()`. Not internal state, not network responses.
- **One flow per test.** Don't chain: login → add-to-cart → checkout in one test. Separate them. Failures are isolated.
- **No `page.waitForTimeout(5000)`.** Use `waitForSelector`, `waitForResponse`, or `expect(...).toBeVisible()` with built-in retry.

### API Helpers — Separate Test Infrastructure

```typescript
// e2e/helpers/api.ts
import { APIRequestContext } from '@playwright/test';

export async function seedUser(request: APIRequestContext, email: string) {
  const res = await request.post('/api/test/seed-user', { data: { email } });
  return res.json();
}

export async function loginAs(page, email: string) {
  await page.goto('/login');
  await page.fill('[data-testid="email-input"]', email);
  await page.fill('[data-testid="password-input"]', 'test-password');
  await page.click('[data-testid="login-button"]');
  await expect(page.locator('[data-testid="user-menu"]')).toBeVisible();
}
```

**Add test-only endpoints for seeding:**
```typescript
// Only available when TEST_MODE=true
if (process.env.TEST_MODE === 'true') {
  app.post('/api/test/seed-user', async (req, res) => {
    const user = await createTestUser(req.body.email);
    res.json(user);
  });
}
```

---

## What Makes a Test Useful — The Quality Checklist

Before committing any test, verify ALL of these:

| Signal | Useless Test | Useful Test |
|--------|-------------|-------------|
| **It tests behavior, not implementation** | Asserts `setState` was called with `true` | Asserts the modal is visible on screen |
| **It can fail** | Always passes (no assertion, or tautology) | Fails when the behavior breaks |
| **It isolates the failure** | One test covers 5 features — any failure is ambiguous | Each test covers one behavior — failure points to exact bug |
| **It uses realistic data** | `name: "test"`, `email: "a@b.com"` | `name: "Jane Smith"`, `email: "jane@example.com"` |
| **It catches regressions** | Rewrite the test every time the code changes | Test survives refactors because it tests the contract, not the code |
| **It runs in CI** | `test.skip()` or `test.only()` left in | Every test runs, flaky tests are fixed or removed |
| **It has a descriptive name** | `test('works')` | `test('shows error when email is already registered')` |

---

## Anti-Patterns — AI-Generated Tests That Are Always Broken

| Pattern | Why it happens | Fix |
|---------|---------------|-----|
| **Test that imports the function then calls it with no assertion** | Agent wrote the test skeleton, never filled it in | Every test must have at least one `expect`/`assert` |
| **`expect(true).toBe(true)`** | Agent didn't know what to assert | Delete the test — it's noise |
| **Test that mocks everything including the function under test** | Agent over-mocked to make it pass | Mock only I/O boundaries. Test the real function. |
| **Snapshot test of a random/date value** | Agent snapshotted non-deterministic output | Use fixed seeds, mock `Date.now()`, or assert structure not values |
| **Test that hits a real external API** | Agent didn't realize it's making network calls | Mock external APIs, use test mode endpoints |
| **`waitForTimeout(5000)` everywhere** | Agent didn't know what to wait for | Replace with `waitForSelector` or `expect(...).toBeVisible()` |
| **Test file with no imports of the module it tests** | Agent hallucinated the test | Verify imports match the source file |
| **Test that only checks `no error thrown`** | Agent didn't assert the output | Assert the return value, side effect, or rendered output |
| **Test depends on previous test's state** | Agent wrote sequential tests sharing state | Each test is isolated. Reset state in `beforeEach`. |
| **E2E test that doesn't wait for app to be ready** | Agent ran `npx playwright test` without starting the server | Use the lifecycle script. Always launch → wait → test → teardown. |

---

## Integration Test Pattern — Test the Real Boundary

Integration tests verify that your code works with real infrastructure. Use lightweight fakes, not mocks.

```typescript
// db.test.ts — tests SQL queries against a real (in-memory) database
import { open } from 'better-sqlite3';

let db: Database;

beforeEach(() => {
  db = open(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE)`);
});

afterEach(() => db.close());

it('inserts and retrieves a user', () => {
  db.prepare('INSERT INTO users (email) VALUES (?)').run('jane@example.com');
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get('jane@example.com');
  expect(row.email).toBe('jane@example.com');
});
```

**Rules:**
- **Use in-memory or testcontainers.** Never mock a database driver — test the real query.
- **Integration tests are slower than unit tests.** Keep them in separate files so you can run unit tests in watch mode.
- **Reset state between tests.** `beforeEach` seeds, `afterEach` cleans.

---

## CI Integration — Make Tests Required

### CI Pipeline

```yaml
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test

  e2e:
    runs-on: ubuntu-latest
    needs: unit
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: bash scripts/run-e2e.sh
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

**Rules:**
- **Unit tests before E2E.** If unit tests fail, don't even start E2E. Saves CI minutes.
- **Upload traces and screenshots on failure.** `if: failure()` — golden for debugging.
- **Playwright browsers are cached.** Use `--with-deps` once; subsequent runs use the cache.
- **Timeout the app startup.** If the health check doesn't pass in 60s, fail the CI step.

---

## Testing Checklist for AI Agents

Before the agent declares a task complete, it MUST verify:

- [ ] At least one unit test per new function/module
- [ ] Tests fail without the implementation (verify by commenting out new code temporarily)
- [ ] No `test.skip()`, `test.only()`, or `pytest.mark.skip` left in committed code
- [ ] No `waitForTimeout()` — replaced with proper wait conditions
- [ ] E2E tests use `data-testid` selectors, not CSS classes or DOM structure
- [ ] The app lifecycle script exists: `scripts/run-e2e.sh` or equivalent
- [ ] Integration tests use real infrastructure (SQLite in-memory, testcontainers), not mocked DB
- [ ] All tests pass locally: `npm test && bash scripts/run-e2e.sh`
- [ ] CI pipeline includes test steps with artifact upload on failure

---

## Integration with Other Skills

- **`playwright-mcp`** — Browser automation for exploration and debugging during development. Not for test automation. Use Playwright test runner (`@playwright/test`) for tests.
- **`project-structure`** — Tests co-located: `user.test.ts` next to `user.ts`. E2E in `{service}/e2e/`. Test helpers in `{service}/e2e/helpers/`.
- **`generic-conventions`** — Lint → type-check → build → test → smoke. Tests are step 4 in the mandatory checklist.
- **`containers`** — `docker-compose.test.yml` for integration/E2E test stack. HEALTHCHECK for readiness.
- **`api-design`** — Test-only endpoints under `/api/test/` with `TEST_MODE` guard for seeding data in E2E tests.

---

## Directory Convention

```
service/
├── src/
│   ├── users.ts
│   └── users.test.ts          # Unit + integration tests co-located
├── e2e/
│   ├── checkout.spec.ts        # Playwright E2E tests
│   ├── login.spec.ts
│   └── helpers/
│       └── api.ts              # API seed helpers for tests
├── scripts/
│   └── run-e2e.sh              # App lifecycle: launch → test → teardown
├── playwright.config.ts        # Playwright configuration
└── docker-compose.test.yml     # Dockerized test stack (optional)
```
