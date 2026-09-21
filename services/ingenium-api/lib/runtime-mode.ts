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

export type DeploymentMode = "compatibility" | "control-plane" | "user-runtime";

export function deploymentMode(environment: NodeJS.ProcessEnv = process.env): DeploymentMode {
  const value = environment.INGENIUM_DEPLOYMENT_MODE?.trim();
  if (!value) return "compatibility";
  if (value === "compatibility" || value === "control-plane" || value === "user-runtime") return value;
  throw new Error("INGENIUM_DEPLOYMENT_MODE is invalid");
}

export function isControlPlaneMode(environment: NodeJS.ProcessEnv = process.env): boolean {
  return deploymentMode(environment) === "control-plane";
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
