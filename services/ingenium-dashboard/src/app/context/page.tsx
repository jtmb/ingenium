"use client";

export const dynamic = "force-dynamic";

import ContextWorkspace from "./components/ContextWorkspace";

/** Project-aware immutable conversation memory workspace. */
export default function ContextPage() {
  return <ContextWorkspace />;
}
