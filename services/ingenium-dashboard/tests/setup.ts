import { expect } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";

// The hoisted jest-dom/vitest entry resolves the root Vitest, not this workspace's version.
expect.extend(matchers);

/**
 * Vitest setup file — runs before each test file.
 *
 * Provides browser globals that jsdom does not implement natively.
 */

// Polyfill ResizeObserver — used by OpenCodeFrame for container size monitoring.
// jsdom does not implement ResizeObserver, and it cannot be vi.stubGlobal'd
// inside a test file because the import of OpenCodeFrame triggers the
// useEffect that calls `new ResizeObserver(...)`.
class ResizeObserverMock {
  observe() {
    /* noop */
  }
  unobserve() {
    /* noop */
  }
  disconnect() {
    /* noop */
  }
}

// Cast to the expected constructor signature
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
