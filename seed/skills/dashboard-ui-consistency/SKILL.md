# Dashboard UI Consistency

## Overview

All dashboard pages follow a consistent visual style defined in STYLING-GUIDE.md. This skill codifies the key patterns.

## Heading Pattern

```tsx
<h1 className="text-3xl font-bold">Page Title</h1>
```

## Spacing Pattern

```tsx
<div className="space-y-8">
  {/* sections */}
</div>
```

## Button Color Rules

| Purpose | Color | Class |
|---------|-------|-------|
| Create/Add/Save | Blue | bg-blue-500 hover:bg-blue-700 |
| Upload | Green | bg-green-500 hover:bg-green-700 |
| Delete | Red | bg-red-500 hover:bg-red-700 |
| Cancel | Gray | bg-gray-500 hover:bg-gray-700 |
| Toggle ON | Green | bg-green-500 |
| Toggle OFF | Gray | bg-gray-300 |

## Card Pattern

```tsx
<div className="bg-white p-4 rounded border hover:shadow-md transition-shadow">
  {/* card content */}
</div>
```

## Grid Pattern

```tsx
<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
  {/* grid items */}
</div>
```

## Form Pattern

```tsx
<input className="border p-2 rounded w-full" />
<button className="bg-blue-500 text-white px-4 py-2 rounded">Save</button>
```

## 🔴 HARD RULE

All pages must use consistent button colors for the same actions. Never use blue for delete or red for create.
