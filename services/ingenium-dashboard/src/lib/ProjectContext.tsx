"use client";

import { useSearchParams } from "next/navigation";

export function useProject() {
  const searchParams = useSearchParams();
  return searchParams.get("project") || "gh-llm-bootstrap";
}
