/**
 * Runtime switches for work that must not outlive a focused API test.
 *
 * The explicit flags are also useful for one-shot maintenance commands. They
 * are intentionally opt-out in production: a normal API process still starts
 * its schedulers and mail maintenance exactly as before.
 */
function isEnabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

export function isApiTestMode(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.NODE_ENV === "test" || isEnabled(environment.INGENIUM_API_TEST_MODE);
}

export function shouldStartBackgroundSchedulers(environment: NodeJS.ProcessEnv = process.env): boolean {
  return !isApiTestMode(environment)
    && !isEnabled(environment.INGENIUM_API_DISABLE_BACKGROUND_SCHEDULERS)
    && !isEnabled(environment.INGENIUM_API_DISABLE_SCHEDULERS);
}

export function shouldStartMailMaintenance(environment: NodeJS.ProcessEnv = process.env): boolean {
  return !isApiTestMode(environment)
    && !isEnabled(environment.INGENIUM_API_DISABLE_MAIL_MAINTENANCE)
    && !isEnabled(environment.INGENIUM_API_DISABLE_MAIL);
}
