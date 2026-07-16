# Agent Workflow for Documentation

## Step 1: Search for Existing Pages

Before creating anything, search for existing content:

```
ingenium_docs_search(query="topic keywords")
```

If a relevant page exists, update it instead of creating a duplicate.

## Step 2: Choose or Create the Right Space

- List spaces: `ingenium_docs_list_spaces`
- Create a new space if none fits: `ingenium_docs_create_space(name="Engineering")`

## Step 3: Create the Page as Draft

```
ingenium_docs_create_page(
  slug="page-slug",
  title="Page Title",
  space="Engineering",
  content="# Content...",
  status="draft"
)
```

## Step 4: Write Content with Wikilinks

Use `[[other-page]]` to link related pages. Keep one topic per page.

## Step 5: Add Tags and Link Projects

```
ingenium_docs_add_tag(slug="page-slug", tag="api")
ingenium_docs_link_project(slug="page-slug", project="my-project")
```

## Step 6: Review and Publish

When content is complete and reviewed:

```
ingenium_docs_update_page(
  slug="page-slug",
  content="# Updated...",
  status="published",
  expectedRevision=2
)
```

## Step 7: Verify Backlinks

After creating or moving a page, verify existing references:

```
ingenium_docs_get_backlinks(slug="page-slug")
```

Update any broken `[[wikilinks]]` in other pages that reference the moved page.
