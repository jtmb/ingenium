export interface FailedRequest {
  url: string;
  errorText: string;
  /** The response status observed for this exact request, when available. */
  responseStatus?: number;
  method?: string;
  headers?: Readonly<Record<string, string>>;
}

export type ToleratedRequestFailure =
  | "dashboard-vscode-rsc-prefetch-aborted"
  | "dashboard-vscode-rsc-navigation-aborted-after-2xx"
  | "dashboard-vscode-rsc-navigation-superseded-by-ready-workbench"
  | "pinned-optional-vsda-asset-aborted";
export type ToleratedResponseFailure = "pinned-optional-vsda-asset-missing";
export type ToleratedConsoleFailure = "pinned-optional-vsda-resource-404";

export interface FailedResponse {
  url: string;
  status: number;
}

export interface FailedConsole {
  type: string;
  text: string;
  locationUrl: string;
  /** The response status observed for this exact URL in the same page collector. */
  responseStatus?: number;
}

const PINNED_VSCODE_OPTIONAL_VSDA_PATHS = new Set([
  "/stable-a3fc2899bd0fcd388253c0e79ce33b8acd48c688/static/node_modules/vsda/rust/web/vsda.js",
  "/stable-a3fc2899bd0fcd388253c0e79ce33b8acd48c688/static/node_modules/vsda/rust/web/vsda_bg.wasm",
]);
const BROWSER_RESOURCE_404_MESSAGE =
  "Failed to load resource: the server responded with a status of 404 (Not Found)";

function isBrowserCancellation(errorText: string): boolean {
  return errorText.trim() === "net::ERR_ABORTED";
}

function isExactBrowserCancellation(errorText: string): boolean {
  return errorText === "net::ERR_ABORTED";
}

function isPinnedVscodeOptionalVsdaAsset(url: URL, vscodeOrigin: string): boolean {
  return url.origin === vscodeOrigin
    && url.search === ""
    && url.hash === ""
    && PINNED_VSCODE_OPTIONAL_VSDA_PATHS.has(url.pathname);
}

function isSuccessfulDashboardVscodeRscPrefetch(
  request: FailedRequest,
  url: URL,
  dashboardOrigin: string,
): boolean {
  return url.origin === dashboardOrigin
    && url.searchParams.has("_rsc")
    && request.method === "GET"
    && request.headers?.["next-router-prefetch"] === "1"
    && isExactBrowserCancellation(request.errorText)
    && request.responseStatus !== undefined
    && request.responseStatus >= 200
    && request.responseStatus <= 299;
}

/** The exact same-origin RSC request emitted by the sidebar's VS Code link. */
export function isDashboardVscodeRscNavigationAbort(
  request: FailedRequest,
  dashboardOrigin: string,
): boolean {
  if (request.method !== "GET" || !isExactBrowserCancellation(request.errorText)) return false;
  try {
    const url = new URL(request.url);
    const parameters = [...url.searchParams.entries()];
    return url.origin === dashboardOrigin
      && url.pathname === "/vscode"
      && parameters.length === 1
      && parameters[0]?.[0] === "_rsc";
  } catch {
    return false;
  }
}

/**
 * A failed sidebar RSC request is safe only when its own 2xx response was
 * observed, or when the same collector observed the completed VS Code workbench.
 */
export function toleratedDashboardVscodeRscNavigationAbort(
  request: FailedRequest,
  dashboardOrigin: string,
  destinationReady: boolean,
): ToleratedRequestFailure | undefined {
  if (!isDashboardVscodeRscNavigationAbort(request, dashboardOrigin)) return undefined;
  if (request.responseStatus !== undefined && request.responseStatus >= 200 && request.responseStatus <= 299) {
    return "dashboard-vscode-rsc-navigation-aborted-after-2xx";
  }
  if (request.responseStatus === undefined && destinationReady) {
    return "dashboard-vscode-rsc-navigation-superseded-by-ready-workbench";
  }
  return undefined;
}

/** Only exact paired VSDA or dashboard RSC prefetch aborts are tolerated; every other failure is fatal. */
export function toleratedRequestFailure(
  request: FailedRequest,
  vscodeOrigin: string,
  dashboardOrigin?: string,
): ToleratedRequestFailure | undefined {
  if (!isBrowserCancellation(request.errorText)) return undefined;

  try {
    const url = new URL(request.url);
    if (
      request.responseStatus === 404
      && isPinnedVscodeOptionalVsdaAsset(url, vscodeOrigin)
    ) {
      return "pinned-optional-vsda-asset-aborted";
    }
    if (dashboardOrigin !== undefined && isSuccessfulDashboardVscodeRscPrefetch(request, url, dashboardOrigin)) {
      return "dashboard-vscode-rsc-prefetch-aborted";
    }
  } catch {
    // Non-HTTP request URLs remain genuine request failures.
  }

  return undefined;
}

/**
 * code-server 4.131.0's pinned archive references these optional VSDA web
 * assets but does not ship the package. Keep this exception exact so a gateway
 * regression or a different missing workbench asset remains fatal.
 */
export function toleratedResponseFailure(
  response: FailedResponse,
  vscodeOrigin: string,
): ToleratedResponseFailure | undefined {
  if (response.status !== 404) return undefined;

  try {
    const url = new URL(response.url);
    if (
      isPinnedVscodeOptionalVsdaAsset(url, vscodeOrigin)
    ) {
      return "pinned-optional-vsda-asset-missing";
    }
  } catch {
    // Non-HTTP response URLs remain genuine failures.
  }

  return undefined;
}

/** The browser's resource 404 console error is tolerated only when its paired response was observed. */
export function toleratedConsoleFailure(
  consoleFailure: FailedConsole,
  vscodeOrigin: string,
): ToleratedConsoleFailure | undefined {
  if (
    consoleFailure.type !== "error"
    || consoleFailure.text !== BROWSER_RESOURCE_404_MESSAGE
    || consoleFailure.responseStatus !== 404
  ) {
    return undefined;
  }

  try {
    const url = new URL(consoleFailure.locationUrl);
    if (isPinnedVscodeOptionalVsdaAsset(url, vscodeOrigin)) {
      return "pinned-optional-vsda-resource-404";
    }
  } catch {
    // Non-HTTP console locations remain genuine failures.
  }

  return undefined;
}

export function assertCollectorCanDetach(steadyStateAsserted: boolean): void {
  if (!steadyStateAsserted) {
    throw new Error("Cannot detach VS Code collectors before steady-state assertion");
  }
}
