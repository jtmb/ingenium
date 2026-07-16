# Markdown Conventions for Docs Pages

## GFM Tables

```markdown
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
```

## GFM Task Lists

```markdown
- [x] Completed task
- [ ] Pending task
```

## Code Blocks

Always specify the language for syntax highlighting:

```markdown
```typescript
const x = 1;
```
```

## Callout Blocks

Use blockquote-based callouts:

```markdown
> **Note:** Useful information.
> **Warning:** Be careful.
> **Info:** Additional context.
> **Tip:** Helpful suggestion.
> **Danger:** Critical warning.
> **Success:** Completed or confirmed.
```

## Wikilinks

Link to other pages using double-bracket syntax:

```markdown
[[page-slug]]
[[page-slug|Display Text]]
```

## Frontmatter

Pages should start with YAML frontmatter:

```markdown
---
title: Page Title
tags: [tag1, tag2]
status: draft
created: 2024-01-01
---
```

## Images and Attachments

```markdown
![Alt text](path/to/image.png)
[Download file](path/to/attachment.pdf)
```
