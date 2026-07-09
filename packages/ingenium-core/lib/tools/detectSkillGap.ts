import { getDb } from "../db.js";
import { logger } from "../logger.js";
import { Learning } from "../schema.js";
import { searchSkills } from "./skills.js";
import { createTask } from "./tasks.js";

const STOPWORDS = new Set([
  "the","and","for","with","this","that","from","have","are","was",
  "not","but","all","can","has","been","will","would","should","could",
  "when","where","what","which","their","them","they","then","than",
  "also","just","like","about","into","over","after","before","between",
  "through","during","because","other","some","such","only","very",
  "each","every","both","few","more","most","its","his","her","our",
  "your","these","those","here","there","now","well","back","still",
  "already","always","never","sometimes","often","usually","really",
  "file","files","line","lines","code","function","functions","use",
  "using","used","new","old","add","added","change","changed","update",
  "updated","remove","removed","delete","deleted","fix","fixed","make",
  "made","need","needed","work","works","working","done","doing",
  "one","two","way","see","get","set","put","run","call","calls",
  "called","must","may","might","does","part","end","case","even",
]);

export function extractKeywords(content: string, max: number = 10): string[] {
  const words = content.toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));

  const freq: Record<string, number> = {};
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1;
  }

  return Object.entries(freq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, max)
    .map(([w]) => w);
}

export function detectSkillGap(projectId: string, learning: Learning): string | null {
  // Guard 1: never re-detect from auto-created skills (prevents infinite loops)
  if (learning.entry_type === "skill") {
    logger.debug({ learningId: learning.id }, "Skipping skill-type learning (loop guard)");
    return null;
  }

  // Guard 2: only high-signal entries trigger
  if ((learning.priority ?? 5) < 5) {
    return null;
  }

  // Extract keywords from learning content
  const keywords = extractKeywords(learning.content, 10);
  if (keywords.length < 3) {
    logger.debug({ learningId: learning.id, keywordCount: keywords.length },
      "Too few keywords, skipping");
    return null;
  }

  // Search existing skills with top keywords
  const query = keywords.slice(0, 5).map(k => `"${k}"`).join(" OR ");
  const existingSkills = searchSkills(projectId, query).slice(0, 5);

  if (existingSkills.length === 0) {
    return createSkillGapTask(projectId, learning, keywords, []);
  }

  // Check keyword overlap in skill name + description only (NOT full content, which is noisy).
  // Uses exact word matching (split on non-alphanum) to avoid substring false matches:
  // "conventions" should NOT match "convention", "gitignore" should NOT match "git".
  // Hyphenated names like "idempotent-seeding" split to ["idempotent","seeding"] — correct.
  const topKw = keywords.slice(0, 5);
  const hasMatch = (existingSkills as any[]).some(skill => {
    const targetWords = new Set(
      ((skill.name || "") + " " + (skill.description || ""))
        .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    );
    const hits = topKw.filter(kw => targetWords.has(kw));
    return hits.length >= 2;
  });

  if (!hasMatch) {
    return createSkillGapTask(projectId, learning, keywords, existingSkills);
  }

  logger.debug({ learningId: learning.id, matchCount: existingSkills.length },
    "Existing skills cover this learning");
  return null;
}

export function createSkillGapTask(
  projectId: string,
  learning: Learning,
  keywords: string[],
  existingSkills: any[]
): string | null {
  const skillName = keywords.slice(0, 3).join("-") + "-" + learning.entry_type;

  // Guard 3: deduplication — don't create duplicate tasks for the same gap
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const recentTasks = db.prepare(
    `SELECT * FROM tasks WHERE project_id = ? AND title LIKE ? AND column_id IN ('todo', 'in_progress')
     ORDER BY created_at DESC LIMIT 5`
  ).all(projectId, `%${keywords[0]}%`) as any[];

  const duplicate = recentTasks.find((t: any) =>
    keywords.some(k => (t.title || "").toLowerCase().includes(k))
  );
  if (duplicate) {
    logger.info({ learningId: learning.id, duplicateTaskId: duplicate.id },
      "Similar skill gap task already exists, skipping");
    return null;
  }

  // Build context-rich task description for AI engineer
  const existingInfo = existingSkills.length > 0
    ? `\n**Existing skills that partially match**: ${(existingSkills as any[]).map(s => `\`${s.name}\``).join(", ")}\n`
    : "\n**No existing skills match these keywords.**\n";

  const description = [
    `🔴 **AUTO-DETECTED SKILL GAP**`,
    ``,
    `**Source learning** (#${learning.id}):`,
    `> ${learning.content.substring(0, 300)}`,
    ``,
    `**Entry type**: \`${learning.entry_type}\``,
    `**Keywords**: ${keywords.slice(0, 5).map(k => `\`${k}\``).join(", ")}`,
    existingInfo,
    `**Your task**: Compose a full \`SKILL.md\` for a new skill named **\`${skillName}\`**.`,
    ``,
    `1. Search related learnings for context: \`ingenium_learning_search(project="ingenium", query="${keywords.slice(0, 3).join(" ")}")\``,
    `2. Check existing skills to avoid overlap: \`ingenium_skill_search(project="ingenium", query="${keywords.slice(0, 3).join(" ")}")\``,
    `3. Design the skill: name, description, category, 🔴 HARD RULEs, code examples`,
    `4. Create it: \`ingenium_skill_create(project="ingenium", name="${skillName}", description="...", content="...", category="${learning.entry_type}")\``,
    `5. Log it: \`ingenium_learning_log(project="ingenium", entry_type="skill", content="Created ${skillName} skill from auto-detected gap (learning #${learning.id})", tags="skill,auto-detected")\``,
  ].join("\n");

  const task = createTask(
    projectId,
    `Auto-detected skill gap: ${skillName}`,
    description,
    "@ingenium-software-engineer-fast"
  );

  logger.info({ learningId: learning.id, taskId: task.id, skillName },
    "Skill gap detected — task created for AI engineer");

  return task.id;
}
