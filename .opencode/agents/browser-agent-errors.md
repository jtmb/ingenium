## ux-002 — 2026-07-19T20:54:00Z

| # | Step | Error | Attempt | Resolution |
|---|------|-------|---------|------------|
| 1 | Navigate to /chat @ 390x844 | ✅ No JS errors — page loads cleanly | 1/1 | — |
| 2 | Measure main region width vs viewport | `<main>` computed width = 435px on 390px viewport (45px overflow). Grid parent is 390px. **Root cause**: `<main>` grid item lacks `min-width: 0` (grid default is `min-width: auto`). Content intrinsic width > 390px forces grid item expansion. | 1/3 | Add `min-w-0` Tailwind class to `<main>` element (currently `class="p-0"`) |
| 3 | Identify overflow children | 19 elements overflow past 390px. Header toolbar, mobile select row, input area all stretch parent. Body `overflow-x: hidden` clips visually but content is cut off. | 1/1 | `min-w-0` on `<main>` would constrain all children |
| 4 | Check actionable content clipped | **"Compact conversation" button** (x=391, right=419) — clipped. **"Select agent" dropdown** (right=419) — clipped. **Send message button** (right=406) — partially clipped. **Share button** (right=387) — barely fits. | 1/1 | Issue confirmed — these elements are not fully usable at 390px |

### Summary
UX-002 is **CONFIRMED REPRODUCIBLE**. Overflow source: `<main class="p-0">` is a grid child without `min-width: 0`. CSS Grid default `min-width: auto` allows the grid item to expand to 435px despite its 390px grid column. Actionable content (Compact button, Agent selector, Send button) is clipped. Body-level `overflow-x: hidden` masks but doesn't fix.
