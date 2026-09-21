import { describe, expect, it } from "vitest";
import {
  assertCollectorCanDetach,
  isDashboardVscodeRscNavigationAbort,
  toleratedConsoleFailure,
  toleratedDashboardVscodeRscNavigationAbort,
  toleratedRequestFailure,
  toleratedResponseFailure,
} from "./vscode-docker-failure-policy";
import type { FailedRequest } from "./vscode-docker-failure-policy";

const vscodeOrigin = "http://vscode.localhost:3000";
const dashboardOrigin = "http://localhost:3000";
const pinnedVsdaBase = `${vscodeOrigin}/stable-a3fc2899bd0fcd388253c0e79ce33b8acd48c688/static/node_modules/vsda/rust/web/`;
const dashboardRscUrl = (pathname: string) => `${dashboardOrigin}${pathname}?_rsc=abc123`;

describe("VS Code Docker request-failure policy", () => {
  it("tolerates only the exact paired pinned VSDA abort", () => {
    for (const asset of ["vsda.js", "vsda_bg.wasm"]) {
      expect(toleratedRequestFailure({
        url: `${pinnedVsdaBase}${asset}`,
        errorText: "net::ERR_ABORTED",
        responseStatus: 404,
      }, vscodeOrigin, dashboardOrigin)).toBe("pinned-optional-vsda-asset-aborted");
    }
  });

  it("tolerates successful dashboard Next RSC prefetch aborts on any dashboard route", () => {
    for (const pathname of ["/pipeline", "/mail"]) {
      for (const responseStatus of [200, 299]) {
        expect(toleratedRequestFailure({
          url: dashboardRscUrl(pathname),
          method: "GET",
          headers: { "next-router-prefetch": "1" },
          errorText: "net::ERR_ABORTED",
          responseStatus,
        }, vscodeOrigin, dashboardOrigin)).toBe("dashboard-vscode-rsc-prefetch-aborted");
      }
    }
  });

  it("keeps cancellations, HTTP failures, and near matches fatal", () => {
    const request = {
      errorText: "net::ERR_ABORTED",
      responseStatus: 404,
    };

    for (const url of [
      `${pinnedVsdaBase}vsda.js.map`,
      `${pinnedVsdaBase}vsda.js?cache=1`,
      `${vscodeOrigin}/stable-a3fc2899bd0fcd388253c0e79ce33b8acd48c688/static/node_modules/vsda/other/vsda.js`,
      `${vscodeOrigin}/stable-other/static/node_modules/vsda/rust/web/vsda.js`,
      `${vscodeOrigin}/stable/static/out/vs/code/browser/workbench/workbench.js`,
      `${vscodeOrigin}/stable/static/vs/workbench/webWorkerExtensionHostIframe.html`,
    ]) {
       expect(toleratedRequestFailure({ ...request, url }, vscodeOrigin, dashboardOrigin)).toBeUndefined();
    }

    expect(toleratedRequestFailure({
      ...request,
      url: `${pinnedVsdaBase}vsda.js`,
      errorText: "net::ERR_CONNECTION_RESET",
    }, vscodeOrigin, dashboardOrigin)).toBeUndefined();
    expect(toleratedRequestFailure({
      ...request,
      url: `${pinnedVsdaBase}vsda.js`,
      responseStatus: 500,
    }, vscodeOrigin, dashboardOrigin)).toBeUndefined();
    expect(toleratedRequestFailure({
      ...request,
      url: `${pinnedVsdaBase}vsda.js`,
      errorText: "TypeError: Failed to fetch",
    }, vscodeOrigin, dashboardOrigin)).toBeUndefined();
    expect(toleratedRequestFailure({
      ...request,
      url: `${pinnedVsdaBase}vsda.js`,
      errorText: "InvalidStateError: database connection is closing",
    }, vscodeOrigin, dashboardOrigin)).toBeUndefined();
  });

  it("keeps clicked, mismatched, and unsuccessfully observed RSC requests fatal", () => {
    const request = {
      url: dashboardRscUrl("/pipeline"),
      method: "GET",
      headers: { "next-router-prefetch": "1" },
      errorText: "net::ERR_ABORTED",
      responseStatus: 200,
    };

    const candidates: FailedRequest[] = [
      { ...request, url: `${dashboardOrigin}/pipeline` },
      { ...request, headers: {} },
      { ...request, headers: { "next-router-prefetch": "0" } },
      { ...request, headers: { purpose: "prefetch" } },
      { ...request, responseStatus: undefined },
      { ...request, method: "POST" },
      { ...request, url: `http://other.localhost:3000/vscode?_rsc=abc123` },
      ...[300, 404, 500].map((responseStatus) => ({ ...request, responseStatus })),
      { ...request, errorText: " net::ERR_ABORTED " },
      { ...request, errorText: "net::ERR_FAILED" },
    ];
    for (const candidate of candidates) {
      expect(toleratedRequestFailure(candidate, vscodeOrigin, dashboardOrigin)).toBeUndefined();
    }
  });

  it("tolerates the exact sidebar VS Code RSC abort only after its response or completed workbench", () => {
    const request: FailedRequest = {
      url: dashboardRscUrl("/vscode"),
      method: "GET",
      errorText: "net::ERR_ABORTED",
    };
    expect(isDashboardVscodeRscNavigationAbort(request, dashboardOrigin)).toBe(true);
    expect(toleratedDashboardVscodeRscNavigationAbort(
      { ...request, responseStatus: 204 }, dashboardOrigin, false,
    )).toBe("dashboard-vscode-rsc-navigation-aborted-after-2xx");
    expect(toleratedDashboardVscodeRscNavigationAbort(request, dashboardOrigin, true))
      .toBe("dashboard-vscode-rsc-navigation-superseded-by-ready-workbench");
    expect(toleratedDashboardVscodeRscNavigationAbort(request, dashboardOrigin, false)).toBeUndefined();
    expect(toleratedDashboardVscodeRscNavigationAbort(
      { ...request, responseStatus: 429 }, dashboardOrigin, true,
    )).toBeUndefined();
    expect(toleratedDashboardVscodeRscNavigationAbort(
      { ...request, url: dashboardRscUrl("/projects") }, dashboardOrigin, true,
    )).toBeUndefined();
    expect(toleratedDashboardVscodeRscNavigationAbort(
      { ...request, url: `${dashboardOrigin}/vscode?project=global-default&_rsc=abc123` }, dashboardOrigin, true,
    )).toBeUndefined();
  });

  it("classifies only the two missing optional VSDA assets in the pinned archive", () => {
    expect(toleratedResponseFailure({ url: `${pinnedVsdaBase}vsda.js`, status: 404 }, vscodeOrigin))
      .toBe("pinned-optional-vsda-asset-missing");
    expect(toleratedResponseFailure({ url: `${pinnedVsdaBase}vsda_bg.wasm`, status: 404 }, vscodeOrigin))
      .toBe("pinned-optional-vsda-asset-missing");
    expect(toleratedResponseFailure({ url: `${pinnedVsdaBase}vsda.js`, status: 500 }, vscodeOrigin)).toBeUndefined();
    expect(toleratedResponseFailure({ url: `${pinnedVsdaBase}other.js`, status: 404 }, vscodeOrigin)).toBeUndefined();
    expect(toleratedResponseFailure({ url: `${pinnedVsdaBase}vsda.js?cache=1`, status: 404 }, vscodeOrigin)).toBeUndefined();
  });

  it("tolerates only paired pinned VSDA browser resource 404 console errors", () => {
    const message = "Failed to load resource: the server responded with a status of 404 (Not Found)";
    for (const asset of ["vsda.js", "vsda_bg.wasm"]) {
      expect(toleratedConsoleFailure({
        type: "error",
        text: message,
        locationUrl: `${pinnedVsdaBase}${asset}`,
        responseStatus: 404,
      }, vscodeOrigin)).toBe("pinned-optional-vsda-resource-404");
    }
  });

  it("keeps unpaired, non-404, near-match, and other console failures fatal", () => {
    const message = "Failed to load resource: the server responded with a status of 404 (Not Found)";
    const paired = { type: "error", text: message, responseStatus: 404 };
    for (const locationUrl of [
      `${pinnedVsdaBase}vsda.js?cache=1`,
      `${vscodeOrigin}/stable-a3fc2899bd0fcd388253c0e79ce33b8acd48c688/static/node_modules/vsda/other/vsda.js`,
      `${vscodeOrigin}/stable-other/static/node_modules/vsda/rust/web/vsda.js`,
      `${vscodeOrigin}/stable/static/out/vs/code/browser/workbench/workbench.js`,
      `${vscodeOrigin}/stable/static/vs/workbench/webWorkerExtensionHostIframe.html`,
      `${vscodeOrigin}/stable/static/out/vs/workbench/workbench.web.main.css`,
    ]) {
      expect(toleratedConsoleFailure({ ...paired, locationUrl }, vscodeOrigin)).toBeUndefined();
    }

    expect(toleratedConsoleFailure({
      ...paired,
      locationUrl: `${pinnedVsdaBase}vsda.js`,
      responseStatus: undefined,
    }, vscodeOrigin)).toBeUndefined();
    expect(toleratedConsoleFailure({
      ...paired,
      locationUrl: `${pinnedVsdaBase}vsda.js`,
      responseStatus: 500,
    }, vscodeOrigin)).toBeUndefined();
    expect(toleratedConsoleFailure({
      ...paired,
      locationUrl: `${pinnedVsdaBase}vsda.js`,
      type: "warning",
    }, vscodeOrigin)).toBeUndefined();
    expect(toleratedConsoleFailure({
      ...paired,
      locationUrl: `${pinnedVsdaBase}vsda.js`,
      text: "Failed to load resource",
    }, vscodeOrigin)).toBeUndefined();
  });

  it("requires the steady-state assertion before collector detachment", () => {
    expect(() => assertCollectorCanDetach(false)).toThrow(
      "Cannot detach VS Code collectors before steady-state assertion",
    );
    expect(() => assertCollectorCanDetach(true)).not.toThrow();
  });
});
