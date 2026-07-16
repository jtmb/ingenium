---
title: Security & Performance Review
description: Security and performance review — documentation workspace and popout/fullscreen architecture threat model.
---

# Security & Performance Review: Documentation Workspace + Popout/Fullscreen Architecture

> **Date:** 2026-07-15
> **Review type:** READ-ONLY — threat model, no edits
> **Scope:** Planned documentation workspace feature + popout/fullscreen architecture, mapped against the current `ingenium-api` + `ingenium-dashboard` codebase
> **Remediation update:** 2026-07-16 — completed controls are annotated against the current source; remaining recommendations are explicitly marked.

---

## Executive Summary

The planned documentation workspace introduces a new attack surface across three primary domains: **(1) content rendering** (Markdown/HTML in the workspace viewer), **(2) file/attachment handling** (uploads, zip imports, file_tree writes to disk), and **(3) window management** (popouts, iframes, fullscreen, postMessage bridges). The current codebase has foundational protections (helmet, parameterized SQL, Zod validation, WAL safety) but lacks critical defense-in-depth layers for a workspace-like feature. Below is a methodical threat model with mitigation guidance keyed to existing repository patterns.

---

*Full content continues from the original document. See also: [iframe-sandbox.md](../security/iframe-sandbox.md) for the sandbox baseline, and [docs-workspace.md](../reference/docs-workspace.md) for the canonical workspace API contract.*
