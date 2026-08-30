import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import EdgeDrawer from "../src/app/components/EdgeDrawer";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EdgeDrawer motion and presence", () => {
  it("opens, retains a closing panel, and unmounts on its transform transition", () => {
    const onClosed = vi.fn();
    const { rerender } = render(
      <EdgeDrawer open={false} side="left" panelClassName="panel" />,
    );
    expect(screen.queryByTestId("edge-drawer-panel")).toBeNull();

    rerender(
      <EdgeDrawer
         open
         side="left"
         panelClassName="panel"
         onClosed={onClosed}
         panelProps={{ "data-testid": "edge-drawer-panel" }}
      >
        Drawer
      </EdgeDrawer>,
    );
    const panel = screen.getByTestId("edge-drawer-panel");
    expect(panel.parentElement?.getAttribute("data-edge-drawer-open")).toBe("true");
    expect(panel.getAttribute("data-edge-drawer-side")).toBe("left");

    rerender(
      <EdgeDrawer
         open={false}
         side="left"
         panelClassName="panel"
         onClosed={onClosed}
         panelProps={{ "data-testid": "edge-drawer-panel" }}
      >
        Drawer
      </EdgeDrawer>,
    );
    expect(screen.getByTestId("edge-drawer-panel").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("edge-drawer-panel").hasAttribute("inert")).toBe(true);

    rerender(
      <EdgeDrawer
         open
         side="left"
         panelClassName="panel"
         onClosed={onClosed}
         panelProps={{ "data-testid": "edge-drawer-panel" }}
      >
        Drawer
      </EdgeDrawer>,
    );
    fireEvent.transitionEnd(screen.getByTestId("edge-drawer-panel"), { propertyName: "transform" });
    expect(screen.getByTestId("edge-drawer-panel").getAttribute("aria-hidden")).toBe("false");

    rerender(
      <EdgeDrawer
         open={false}
         side="left"
         panelClassName="panel"
         onClosed={onClosed}
         panelProps={{ "data-testid": "edge-drawer-panel" }}
      >
        Drawer
      </EdgeDrawer>,
    );
    fireEvent.transitionEnd(screen.getByTestId("edge-drawer-panel"), { propertyName: "opacity" });
    expect(screen.getByTestId("edge-drawer-panel")).toBeTruthy();
    fireEvent.transitionEnd(screen.getByTestId("edge-drawer-panel"), { propertyName: "transform" });
    expect(screen.queryByTestId("edge-drawer-panel")).toBeNull();
    expect(onClosed).toHaveBeenCalledOnce();
  });

  it("uses an immediate deterministic lifecycle when reduced motion is preferred", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { rerender } = render(
      <EdgeDrawer
        open={false}
        side="right"
        panelClassName="panel"
        panelProps={{ "data-testid": "edge-drawer-panel" }}
      />,
    );

    rerender(
      <EdgeDrawer
        open
        side="right"
        panelClassName="panel"
        panelProps={{ "data-testid": "edge-drawer-panel" }}
      />,
    );
    expect(screen.getByTestId("edge-drawer-panel").getAttribute("data-edge-drawer-state")).toBe("open");

    rerender(
      <EdgeDrawer
        open={false}
        side="right"
        panelClassName="panel"
        panelProps={{ "data-testid": "edge-drawer-panel" }}
      />,
    );
    expect(screen.queryByTestId("edge-drawer-panel")).toBeNull();
  });

  it("is used by all six in-scope edge surfaces", () => {
    const sources = [
      "services/ingenium-dashboard/src/app/components/Navigation.tsx",
      "services/ingenium-dashboard/src/app/docs/components/DocsShell.tsx",
      "services/ingenium-dashboard/src/app/chat/components/ChatShell.tsx",
      "services/ingenium-dashboard/src/app/chat/components/MCPDrawer.tsx",
      "services/ingenium-dashboard/src/app/chat/components/ActivityDrawer.tsx",
    ];

    for (const source of sources) {
      expect(readFileSync(resolve(repoRoot, source), "utf8")).toContain("<EdgeDrawer");
    }
  });
});
