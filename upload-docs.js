#!/usr/bin/env node
/**
 * upload-docs.js — Upload refactored docs from filesystem to Docs Workspace
 *
 * Usage: node upload-docs.js
 *
 * Prerequisites:
 *   - API running at http://localhost:4097
 *   - Node.js 22+ (for native fetch)
 */

const BASE = "http://localhost:4097/api/v1/docs";
const PROJECT = "global-default";
const FS_BASE = "/home/brajam/repos/gh-llm-bootstrap/docs";

// ── PAGE DEFINITIONS ───────────────────────────────────────────────────────────
// Ordered parent-before-child for import

const PAGES = [
  // Root landing page
  { slug: "index", title: "Ingenium Documentation", file: "index.md", parentSlug: null },

  // Getting Started
  { slug: "getting-started", title: "Getting Started", file: "operations/getting-started.md", parentSlug: null },

  // ── Usage section ──
  { slug: "usage/index", title: "Usage Guides", file: "usage/index.md", parentSlug: null },
  { slug: "usage/dashboard", title: "Dashboard User Guide", file: "usage/dashboard.md", parentSlug: "usage/index" },
  { slug: "usage/opencode", title: "OpenCode Web/CLI", file: "usage/opencode.md", parentSlug: "usage/index" },
  { slug: "usage/mail", title: "Mail", file: "usage/mail.md", parentSlug: "usage/index" },
  { slug: "usage/tasks", title: "Tasks", file: "usage/tasks.md", parentSlug: "usage/index" },
  { slug: "usage/docs-workspace", title: "Docs Workspace", file: "usage/docs-workspace.md", parentSlug: "usage/index" },

  // ── Configure section ──
  { slug: "configure/index", title: "Configuration Guides", file: "configure/index.md", parentSlug: null },
  { slug: "configure/config", title: "Config", file: "configure/config.md", parentSlug: "configure/index" },
  { slug: "configure/projects", title: "Projects", file: "configure/projects.md", parentSlug: "configure/index" },
  { slug: "configure/agents", title: "Agent Architecture", file: "configure/agents.md", parentSlug: "configure/index" },
  { slug: "configure/plugins", title: "Plugins", file: "configure/plugins.md", parentSlug: "configure/index" },
  { slug: "configure/mcp-servers", title: "MCP Servers", file: "configure/mcp-servers.md", parentSlug: "configure/index" },
  { slug: "configure/email-setup", title: "Email Setup", file: "configure/email-setup.md", parentSlug: "configure/index" },
  { slug: "configure/synthesis", title: "Synthesis Pipeline", file: "configure/synthesis.md", parentSlug: "configure/index" },

  // ── Concepts section ──
  { slug: "concepts/index", title: "Concepts", file: "concepts/index.md", parentSlug: null },
  { slug: "concepts/architecture", title: "Architecture", file: "concepts/architecture.md", parentSlug: "concepts/index" },
  { slug: "concepts/tech-stack", title: "Tech Stack", file: "concepts/tech-stack.md", parentSlug: "concepts/index" },
  { slug: "concepts/conventions", title: "Conventions", file: "concepts/conventions.md", parentSlug: "concepts/index" },
  { slug: "concepts/skill-system", title: "Skill System Architecture", file: "concepts/skill-system.md", parentSlug: "concepts/index" },
  { slug: "concepts/self-learning", title: "Self-Learning Pipeline", file: "concepts/self-learning.md", parentSlug: "concepts/index" },

  // ── Develop section ──
  { slug: "develop/index", title: "Development Reference", file: "develop/index.md", parentSlug: null },
  { slug: "develop/api", title: "API Reference", file: "develop/api.md", parentSlug: "develop/index" },
  { slug: "develop/database", title: "Database Migrations", file: "develop/database.md", parentSlug: "develop/index" },
  { slug: "develop/variables", title: "Environment Variables", file: "develop/variables.md", parentSlug: "develop/index" },

  // ── Operations section ──
  { slug: "operations/index", title: "Operations", file: "operations/index.md", parentSlug: null },
  { slug: "operations/deployment", title: "Deployment Guide", file: "operations/deployment.md", parentSlug: "operations/index" },
  { slug: "operations/backup-restore", title: "Backup and Restore", file: "operations/backup-restore.md", parentSlug: "operations/index" },
  { slug: "operations/jobs", title: "Jobs", file: "operations/jobs.md", parentSlug: "operations/index" },
  { slug: "operations/logs", title: "Logs", file: "operations/logs.md", parentSlug: "operations/index" },
  { slug: "operations/status", title: "Status", file: "operations/status.md", parentSlug: "operations/index" },

  // ── Security section ──
  { slug: "security/index", title: "Security Documentation", file: "security/index.md", parentSlug: null },
  { slug: "security/credential-rotation", title: "Credential Rotation", file: "security/credential-rotation.md", parentSlug: "security/index" },
  { slug: "security/iframe-sandbox", title: "Iframe Sandbox Baseline", file: "security/iframe-sandbox.md", parentSlug: "security/index" },
  { slug: "security/review-docs-workspace", title: "Security & Performance Review", file: "security/review-docs-workspace.md", parentSlug: "security/index" },

  // ── Reference section ──
  { slug: "reference/index", title: "Reference Documentation", file: "reference/index.md", parentSlug: null },
  { slug: "reference/variables", title: "Environment Variables — Comprehensive Reference", file: "reference/variables.md", parentSlug: "reference/index" },
  { slug: "reference/mcp-tools", title: "MCP Tools Reference", file: "reference/mcp-tools.md", parentSlug: "reference/index" },
  { slug: "reference/skill-taxonomy", title: "Skill Taxonomy Migration", file: "reference/skill-taxonomy.md", parentSlug: "reference/index" },
  { slug: "reference/docs-workspace", title: "Docs Workspace Reference", file: "reference/docs-workspace.md", parentSlug: "reference/index" },
];

// ── TAG DEFINITIONS ────────────────────────────────────────────────────────────

const TAGS = {
  "getting-started": ["getting-started"],
  "usage/index": ["how-to"],
  "usage/dashboard": ["how-to"],
  "usage/opencode": ["how-to"],
  "usage/mail": ["how-to"],
  "usage/tasks": ["how-to"],
  "usage/docs-workspace": ["how-to"],
  "configure/index": ["how-to"],
  "configure/config": ["how-to"],
  "configure/projects": ["how-to"],
  "configure/agents": ["how-to"],
  "configure/plugins": ["how-to"],
  "configure/mcp-servers": ["how-to"],
  "configure/email-setup": ["how-to"],
  "configure/synthesis": ["how-to"],
  "concepts/index": ["concepts"],
  "concepts/architecture": ["concepts"],
  "concepts/tech-stack": ["concepts"],
  "concepts/conventions": ["concepts"],
  "concepts/skill-system": ["concepts"],
  "concepts/self-learning": ["concepts"],
  "reference/index": ["reference"],
  "reference/variables": ["reference"],
  "reference/mcp-tools": ["reference"],
  "reference/skill-taxonomy": ["reference"],
  "reference/docs-workspace": ["reference"],
};

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Strip YAML frontmatter from markdown content */
function stripFrontmatter(content) {
  return content.replace(/^---[\s\S]*?---\r?\n?/, "");
}

/** Convert markdown links to wikilinks: [text](path/to/file.md) -> [[file|text]] */
function convertLinks(content) {
  // Known page slugs for resolution
  const knownSlugs = new Set(PAGES.map(p => {
    // Extract the last path component as slug reference
    const parts = p.slug.split("/");
    return parts[parts.length - 1];
  }));

  return content.replace(
    /\[([^\]]*)\]\(((?:\.\.?\/)?[^\)]+)\)/g,
    (match, text, path) => {
      // Skip external links and anchors
      if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("#") || path.startsWith("mailto:")) {
        return match;
      }

      // Extract filename without extension from path
      // Handle patterns like:
      //   file.md
      //   ./file.md
      //   ../section/file.md
      //   path/to/file.md
      //   file.md#section
      const cleanPath = path.split("#")[0]; // Remove anchor
      const basename = cleanPath.split("/").pop(); // Get filename
      const slug = basename ? basename.replace(/\.md$/i, "") : null;

      if (!slug) return match;

      // Convert to wikilink
      // Skip if slug is not a known page (e.g., external refs without http prefix)
      // But still convert since the slug might match a page we're creating
      return `[[${slug}|${text}]]`;
    }
  );
}

/** Read a file from the docs filesystem */
function readDocFile(filePath) {
  const fs = require("fs");
  const path = require("path");
  const fullPath = path.join(FS_BASE, filePath);
  return fs.readFileSync(fullPath, "utf-8");
}

async function api(method, url, body = undefined) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }

  const fullUrl = `${BASE}${url}`;
  console.log(`  ${method} ${fullUrl}`);

  const res = await fetch(fullUrl, opts);
  const data = await res.json();

  if (!res.ok) {
    const errMsg = data?.error?.message || JSON.stringify(data);
    throw new Error(`HTTP ${res.status}: ${errMsg}`);
  }

  return data;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("=".repeat(70));
  console.log("INGENIUM DOCS WORKSPACE UPLOAD");
  console.log("=".repeat(70));
  console.log();

  // ── Step 0: Check connectivity and existing state ──
  console.log("── Step 0: Check connectivity ──");
  let spaces;
  try {
    spaces = await api("GET", `/spaces?project=${PROJECT}`);
    console.log(`  Existing spaces: ${spaces.data.map(s => s.name).join(", ")}`);
  } catch (err) {
    console.error(`  ❌ API not reachable: ${err.message}`);
    console.log("  Make sure the API is running at http://localhost:4097");
    process.exit(1);
  }
  console.log();

  // Export existing space for rollback if content exists
  const personalSpace = spaces.data.find(s => s.slug === "personal");
  if (personalSpace) {
    console.log(`  Exporting Personal space (ID ${personalSpace.id}) for rollback...`);
    try {
      const exportData = await api("GET", `/spaces/${personalSpace.id}/export?project=${PROJECT}`);
      const fs = require("fs");
      const path = require("path");
      fs.writeFileSync(
        path.join(FS_BASE, "..", "personal-space-backup.json"),
        JSON.stringify(exportData, null, 2)
      );
      console.log("  ✅ Personal space exported to personal-space-backup.json");
    } catch (err) {
      console.log(`  ⚠️ Could not export Personal space: ${err.message}`);
    }
  }
  console.log();

  // ── Step 1: Create Ingenium space ──
  console.log("── Step 1: Create Ingenium space ──");
  let ingeniumSpace = spaces.data.find(s => s.slug === "ingenium");
  if (ingeniumSpace) {
    console.log(`  ✅ Ingenium space already exists (ID ${ingeniumSpace.id}), reusing`);
  } else {
    const created = await api("POST", `/spaces?project=${PROJECT}`, {
      name: "Ingenium",
      slug: "ingenium",
      description: "Ingenium MCP Server documentation — AI agent skill system, dashboard, and self-learning pipeline",
      icon: "book",
    });
    ingeniumSpace = created.data;
    console.log(`  ✅ Created Ingenium space (ID ${ingeniumSpace.id})`);
  }
  const spaceId = ingeniumSpace.id;
  console.log();

  // ── Step 2: Purge trash for clean slate ──
  console.log("── Step 2: Clean up existing pages ──");
  try {
    const existingTree = await api("GET", `/spaces/${spaceId}/tree?project=${PROJECT}`);
    if (existingTree.data && existingTree.data.length > 0) {
      console.log(`  Found ${existingTree.data.length} existing pages, deleting...`);
      for (const page of existingTree.data) {
        try {
          await api("DELETE", `/pages/${page.id}?project=${PROJECT}`);
          console.log(`    Deleted page: ${page.slug} (ID ${page.id})`);
        } catch (err) {
          console.log(`    ⚠️ Could not delete ${page.slug}: ${err.message}`);
        }
        await sleep(100);
      }
      // Purge trash
      try {
        await api("DELETE", `/spaces/${spaceId}/trash?project=${PROJECT}`);
        console.log("  ✅ Trash purged");
      } catch (err) {
        console.log(`  ⚠️ Could not purge trash: ${err.message}`);
      }
    } else {
      console.log("  No existing pages found");
    }
  } catch (err) {
    console.log(`  ⚠️ Could not check existing pages: ${err.message}`);
  }
  console.log();

  // ── Step 3: Read files and prepare import ──
  console.log("── Step 3: Prepare import payload ──");
  const importPages = [];
  for (const page of PAGES) {
    let content;
    try {
      const raw = readDocFile(page.file);
      content = stripFrontmatter(raw);
    } catch (err) {
      console.error(`  ❌ Cannot read ${page.file}: ${err.message}`);
      process.exit(1);
    }

    // Convert links to wikilinks
    content = convertLinks(content);

    importPages.push({
      title: page.title,
      slug: page.slug,
      content,
      parentSlug: page.parentSlug,
    });
    console.log(`  ✅ Prepared: ${page.slug} (${page.file})`);
  }
  console.log(`  Total pages: ${importPages.length}`);
  console.log();

  // ── Step 4: Import all pages ──
  console.log("── Step 4: Import pages ──");
  try {
    const imported = await api("POST", `/import?project=${PROJECT}`, {
      spaceId: Number(spaceId),
      format: "json",
      data: importPages,
    });
    console.log(`  ✅ Imported ${imported.data.length} pages`);
  } catch (err) {
    console.error(`  ❌ Import failed: ${err.message}`);
    process.exit(1);
  }
  console.log();

  // ── Step 5: Get page tree to map slugs to IDs ──
  console.log("── Step 5: Map slugs to IDs ──");
  let tree;
  try {
    tree = await api("GET", `/spaces/${spaceId}/tree?project=${PROJECT}`);
  } catch (err) {
    console.error(`  ❌ Cannot get page tree: ${err.message}`);
    process.exit(1);
  }

  // Flatten the tree into a slug→id map
  const slugToId = {};
  function flattenTree(nodes) {
    for (const node of nodes) {
      slugToId[node.slug] = node.id;
      if (node.children && node.children.length > 0) {
        flattenTree(node.children);
      }
    }
  }
  flattenTree(tree.data);
  console.log(`  Mapped ${Object.keys(slugToId).length} pages`);
  console.log();

  // ── Step 6: Publish all pages ──
  console.log("── Step 6: Publish all pages ──");
  let publishCount = 0;
  let publishErrors = 0;
  for (const page of PAGES) {
    const id = slugToId[page.slug];
    if (!id) {
      console.error(`  ❌ No ID found for slug: ${page.slug}`);
      publishErrors++;
      continue;
    }
    try {
      await api("POST", `/pages/${id}/publish?project=${PROJECT}`, { expectedRevision: 0 });
      publishCount++;
      process.stdout.write(".");
    } catch (err) {
      // Might already be published — try without expectedRevision
      try {
        // Re-fetch the page to get its current revision
        const pageData = await api("GET", `/pages/${id}?project=${PROJECT}`);
        const revision = pageData.data.revision;
        await api("POST", `/pages/${id}/publish?project=${PROJECT}`, { expectedRevision: revision });
        publishCount++;
        process.stdout.write(".");
      } catch (err2) {
        console.error(`\n  ❌ Cannot publish ${page.slug}: ${err2.message}`);
        publishErrors++;
      }
    }
    await sleep(50);
  }
  console.log(`\n  ✅ Published ${publishCount} pages (${publishErrors} errors)`);
  console.log();

  // ── Step 7: Add tags ──
  console.log("── Step 7: Add tags ──");
  let tagCount = 0;
  let tagErrors = 0;
  for (const [slug, tags] of Object.entries(TAGS)) {
    const id = slugToId[slug];
    if (!id) {
      console.error(`  ❌ No ID for ${slug}, skipping tags`);
      tagErrors++;
      continue;
    }
    for (const tag of tags) {
      try {
        await api("POST", `/pages/${id}/tags?project=${PROJECT}`, { tagName: tag });
        tagCount++;
        process.stdout.write(".");
      } catch (err) {
        // Tag might already exist — silently continue
        process.stdout.write("s");
      }
      await sleep(30);
    }
  }
  console.log(`\n  ✅ Added ${tagCount} tags (${tagErrors} errors)`);
  console.log();

  // ── Step 8: Verification ──
  console.log("── Step 8: Verification ──");
  let verified = 0;
  let failed = 0;

  // Search for "database migration"
  try {
    const searchDb = await api("GET", `/search?project=${PROJECT}&q=database+migration`);
    console.log(`  🔍 Search "database migration": ${searchDb.data.length} results`);
    if (searchDb.data.length > 0) verified++;
    else { console.log("  ⚠️ No results for 'database migration'"); failed++; }
  } catch (err) {
    console.log(`  ⚠️ Search failed: ${err.message}`);
    failed++;
  }

  // Search for "Docker"
  try {
    const searchDocker = await api("GET", `/search?project=${PROJECT}&q=Docker`);
    console.log(`  🔍 Search "Docker": ${searchDocker.data.length} results`);
    if (searchDocker.data.length > 0) verified++;
    else { console.log("  ⚠️ No results for 'Docker'"); failed++; }
  } catch (err) {
    console.log(`  ⚠️ Search failed: ${err.message}`);
    failed++;
  }

  // Count pages
  try {
    const stats = await api("GET", `/stats?project=${PROJECT}`);
    console.log(`  📊 Stats: ${JSON.stringify(stats.data)}`);
    verified++;
  } catch (err) {
    console.log(`  ⚠️ Stats failed: ${err.message}`);
    failed++;
  }

  // Check page statuses
  try {
    const pageList = await api("GET", `/spaces/${spaceId}/pages?project=${PROJECT}`);
    const draftPages = pageList.data.filter(p => p.status !== "published");
    if (draftPages.length > 0) {
      console.log(`  ⚠️ ${draftPages.length} pages are not published:`);
      for (const p of draftPages) {
        console.log(`    - ${p.slug} (${p.status})`);
      }
      failed++;
    } else {
      console.log(`  ✅ All ${pageList.data.length} pages are published`);
      verified++;
    }
  } catch (err) {
    console.log(`  ⚠️ Status check failed: ${err.message}`);
    failed++;
  }
  console.log();

  // ── Final Summary ──
  console.log("=".repeat(70));
  console.log("UPLOAD SUMMARY");
  console.log("=".repeat(70));
  console.log(`  Space: Ingenium (ID ${spaceId})`);
  console.log(`  Pages defined: ${PAGES.length}`);
  console.log(`  Pages imported: ${importPages.length}`);
  console.log(`  Pages published: ${publishCount}`);
  console.log(`  Tags added: ${tagCount}`);
  console.log(`  Verification: ${verified} passed, ${failed} failed`);
  console.log();
  console.log("Page tree structure:");
  printTree(tree.data, 0);
  console.log();
  console.log("STATUS: " + (failed === 0 ? "✅ SUCCESS" : "⚠️ PARTIAL — see issues above"));
}

function printTree(nodes, depth) {
  const prefix = "  ".repeat(depth + 1);
  for (const node of nodes) {
    const status = node.status || "draft";
    const icon = status === "published" ? "📄" : "📝";
    console.log(`${prefix}${icon} ${node.slug} (${status})`);
    if (node.children && node.children.length > 0) {
      printTree(node.children, depth + 1);
    }
  }
}

main().catch(err => {
  console.error("\n❌ Fatal error:", err.message);
  process.exit(1);
});
