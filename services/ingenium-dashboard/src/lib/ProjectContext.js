"use client";
import { useSearchParams } from "next/navigation";
const DEFAULT_PROJECT = "gh-llm-bootstrap";
const STORAGE_KEY = "ingenium_active_project";
export function useProject() {
    const searchParams = useSearchParams();
    const fromUrl = searchParams.get("project");
    if (fromUrl) {
        if (typeof window !== "undefined")
            localStorage.setItem(STORAGE_KEY, fromUrl);
        return fromUrl;
    }
    if (typeof window !== "undefined") {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored)
            return stored;
    }
    return DEFAULT_PROJECT;
}
export function persistProject(name) {
    if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, name);
    }
}
