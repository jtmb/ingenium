# Ingenium Dashboard — Styling Guide

This guide was auto-generated from a live screenshot of the running dashboard.
Any visual changes to the dashboard MUST be reflected in this document.

---

## Color Palette

| Role | Value | Tailwind |
|------|-------|----------|
| Primary Background | `#FFFFFF` | `bg-white` |
| Card Background | `#FFFFFF` | `bg-white` |
| Page Background | `#F9FAFB` | `bg-gray-50` |
| Primary Text (Headings) | `#111827` | `text-gray-900` |
| Secondary Text (Body) | `#4B5563` | `text-gray-600` |
| Tertiary Text (Subtle) | `#6B7280` | `text-gray-500` |
| Border | `#E5E7EB` | `border-gray-200` |
| Nav Background | `#FFFFFF` | `bg-white` |
| Nav Border | `#E5E7EB` | `border-b border-gray-200` |

## Typography

| Element | Size | Weight | Tailwind |
|---------|------|--------|----------|
| Page Title (h1) | 28-32px | Bold (700) | `text-3xl font-bold` |
| Card Title (h2) | 16-18px | Semi-Bold (600) | `text-lg font-semibold` |
| Body Text | 14px | Regular (400) | `text-sm` |
| Nav Links | 13-14px | Medium (500) | `text-sm` |
| Logo | 18px | Bold (700) | `text-lg font-bold` |

## Layout

| Element | Value | Tailwind |
|---------|-------|----------|
| Page Max Width | 1200px | `max-w-6xl` |
| Page Padding | 24px | `p-6` |
| Nav Height | 56px | `py-3` |
| Nav Padding (H) | 24px | `px-6` |
| Nav Gap (links) | 24px | `gap-6` |
| Content Spacing | 32px | `space-y-8` |

## Grid

| Element | Value | Tailwind |
|---------|-------|----------|
| Card Grid (Desktop) | 3 columns | `grid grid-cols-1 md:grid-cols-3` |
| Card Gap | 16px | `gap-4` |

## Card Components

| Property | Value | Tailwind |
|----------|-------|----------|
| Background | White | `bg-white` |
| Border | 1px light gray | `border` |
| Border Radius | 6-8px | `rounded-lg` |
| Padding | 24px | `p-6` |
| Hover Effect | Light shadow | `hover:shadow-md` |
| Transition | 150ms | `transition-shadow` |

## Nav Bar

| Property | Value | Tailwind |
|----------|-------|----------|
| Background | White | `bg-white` |
| Bottom Border | 1px gray | `border-b border-gray-200` |
| Link Color (default) | Medium gray | `text-gray-600` |
| Link Color (hover) | Dark gray | `hover:text-gray-900` |
| Active Color | Dark | `text-gray-900` |

## 🔴 Rules That Must Not Be Broken

1. **Card grid is always `md:grid-cols-3`** on desktop. Never change to 2 or 4 without updating this guide.
2. **Hover effects use `transition-shadow`**, not `transition-all` or `transition-transform`. Performance matters.
3. **Nav uses `border-b` not `shadow`**. Flat design, not elevated.
4. **All text must use gray-900/600/500 scale**. No custom hex colors in components.
5. **Cards never have shadows** by default. Only `hover:shadow-md`.
6. **Page max-width is `max-w-6xl`**. No full-width layouts beyond navigation.
