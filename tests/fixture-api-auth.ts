export const TEST_API_TOKEN = "A".repeat(48);
export const FIXTURE_INTERNAL_SERVICE_HEADER = "x-ingenium-internal-service";
export const FIXTURE_RUN_NONCE_HEADER = "x-ingenium-fixture-run-nonce";
export const FIXTURE_PROJECT_HEADER = "x-ingenium-fixture-project";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface FixtureApiBinding {
  mode: "fixture";
  runNonce: string;
  project: string;
}

/** Build server-side direct API auth without making the fixture marker a default bearer property. */
export function directApiAuthHeaders(
  token: string,
  binding?: FixtureApiBinding,
): Record<string, string> {
  const headers = { Authorization: `Bearer ${token}` };
  if (!binding) return headers;
  if (!UUID_PATTERN.test(binding.runNonce) || !binding.project.startsWith("playwright-test-")) {
    throw new Error("Fixture API authentication requires a run-owned nonce and project");
  }
  return {
    ...headers,
    [FIXTURE_INTERNAL_SERVICE_HEADER]: "1",
    [FIXTURE_RUN_NONCE_HEADER]: binding.runNonce,
    [FIXTURE_PROJECT_HEADER]: binding.project,
  };
}

export function testRunApiAuthHeaders(context: Pick<FixtureApiBinding, "runNonce" | "project">): Record<string, string> {
  return directApiAuthHeaders(TEST_API_TOKEN, { mode: "fixture", ...context });
}
