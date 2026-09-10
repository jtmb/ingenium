import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  validate: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("../src/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/api")>();
  return { ...original, api: { ...original.api, cloudflare: mocks } };
});

import CloudflarePanel from "../src/app/components/settings/panels/CloudflarePanel";
import type { CloudflareTunnelStatus } from "../src/lib/api";

const status: CloudflareTunnelStatus = {
  desired: { enabled: false, configuration: "valid" },
  inventory: { status: "ready", error: null },
  config: {
    enabled: false,
    tunnelName: "ingenium-production",
    services: {
      dashboard: { enabled: true, publicUrl: "https://dashboard.example.com/" },
      opencode: { enabled: false, publicUrl: "" },
      cli: { enabled: false, publicUrl: "" },
      vscode: { enabled: false, publicUrl: "" },
      api: { enabled: false, publicUrl: "" },
    },
  },
  token: { configured: true, readiness: "ready" },
  connector: { state: "absent", observedAt: "2026-09-05T00:00:00.000Z" },
  routes: ["dashboard", "opencode", "cli", "vscode", "api"].map((service) => ({
    service: service as "dashboard" | "opencode" | "cli" | "vscode" | "api",
    enabled: service === "dashboard",
    publicUrl: service === "dashboard" ? "https://dashboard.example.com/" : "",
    target: `authenticated-${service}`,
    availableOrigins: [`https://${service}.example.com/`],
    health: service === "dashboard" ? "unavailable" : "disabled",
  })),
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.get.mockResolvedValue({ data: status });
  mocks.update.mockResolvedValue({ data: { ...status, desired: { ...status.desired, enabled: true } } });
  mocks.validate.mockResolvedValue({ data: status });
  mocks.connect.mockRejectedValue(new Error("The fixed Cloudflare connector runtime is not installed"));
  mocks.disconnect.mockResolvedValue({ data: status });
});

afterEach(cleanup);

describe("CloudflarePanel", () => {
  it("announces its initial loading state", () => {
    mocks.get.mockReturnValue(new Promise(() => {}));

    render(<CloudflarePanel />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading Cloudflare settings...");
  });

  it("renders write-only token state and sends exact per-service configuration", async () => {
    render(<CloudflarePanel />);
    expect(await screen.findByText("Configured (Ready)")).toBeTruthy();
    expect(screen.queryByDisplayValue(/eyJ/)).toBeNull();
    const origins = screen.getAllByRole("combobox", { name: "Public HTTPS origin" });
    expect(origins).toHaveLength(5);
    fireEvent.change(origins[1], { target: { value: "https://opencode.example.com/" } });

    fireEvent.click(screen.getByRole("checkbox", { name: "Enable desired connector configuration" }));
    fireEvent.change(screen.getByLabelText("Tunnel token (write only)"), { target: { value: "eyJhIjoiY2xvdWRmbGFyZS1kYXNoYm9hcmQtdGVzdC10b2tlbiJ9.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        services: expect.objectContaining({
          dashboard: { enabled: true, publicUrl: "https://dashboard.example.com/" },
          opencode: { enabled: false, publicUrl: "https://opencode.example.com/" },
        }),
      }),
      { action: "replace", value: "eyJhIjoiY2xvdWRmbGFyZS1kYXNoYm9hcmQtdGVzdC10b2tlbiJ9.test" },
    );
  });

  it("wires validation and lifecycle actions while surfacing an unavailable connector", async () => {
    render(<CloudflarePanel />);
    await screen.findByRole("button", { name: "Validate" });

    fireEvent.click(screen.getByRole("button", { name: "Validate" }));
    await waitFor(() => expect(mocks.validate).toHaveBeenCalledOnce());
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("fixed Cloudflare connector runtime is not installed");
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(mocks.disconnect).toHaveBeenCalledOnce());
  });
});
