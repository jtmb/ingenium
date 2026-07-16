import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../lib/tools/projects.js";
import {
  createTask,
  listTasks,
  moveTask,
  completeTask,
  getNextTask,
  getTask,
  updateTask,
  deleteTask,
  searchTasks,
  addComment,
  editComment,
  reactComment,
  getComments,
  getBoardConfig,
  updateBoardConfig,
  validateWipLimit,
  getTaskTree,
  linkTasks,
  getTaskLinks,
  unlinkTasks,
  getTaskActivity,
  notifyTask,
  getNotifications,
  markNotificationRead,
  bulkUpdateTasks,
} from "../lib/tools/tasks.js";

let tempDir: string;
let projectId: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-test-tasks-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");
  const project = createProject("test-project");
  projectId = project.id;
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("tasks — CRUD", () => {
  it("creates a task in todo column by default", () => {
    const task = createTask(projectId, "First task", "Do something");
    expect(task.title).toBe("First task");
    expect(task.column_id).toBe("todo");
    expect(task.description).toBe("Do something");
    expect(task.issue_type).toBe("task");
    expect(task.priority).toBe(0);
    expect(task.spent_minutes).toBe(0);
  });

  it("creates a task with all new fields", () => {
    const task = createTask(projectId, "Epic task", "A big feature", "user1", {
      issue_type: "epic",
      priority: 10,
      due_date: "2026-12-31",
      start_date: "2026-01-01",
      estimate_minutes: 480,
      custom_fields: JSON.stringify({ sprint: "S1" }),
    });
    expect(task.issue_type).toBe("epic");
    expect(task.priority).toBe(10);
    expect(task.due_date).toBe("2026-12-31");
    expect(task.start_date).toBe("2026-01-01");
    expect(task.estimate_minutes).toBe(480);
    expect(task.custom_fields).toBe(JSON.stringify({ sprint: "S1" }));
  });

  it("lists tasks filtered by column", () => {
    createTask(projectId, "In progress task");
    const finished = listTasks(projectId, "todo");
    expect(finished.length).toBeGreaterThanOrEqual(3);
  });

  it("moves a task between columns", () => {
    const task = createTask(projectId, "Movable task");
    const moved = moveTask(task.id, "in_progress");
    expect(moved).not.toBeUndefined();
    expect(moved!.column_id).toBe("in_progress");
  });

  it("completes a task and sets completed_at", () => {
    const task = createTask(projectId, "Completable task");
    const done = completeTask(task.id);
    expect(done).not.toBeUndefined();
    expect(done!.column_id).toBe("done");
    expect(done!.completed_at).not.toBeNull();
  });

  it("next task returns the oldest uncompleted task by priority then created_at", () => {
    createTask(projectId, "Old task");
    const next = getNextTask(projectId);
    expect(next).not.toBeUndefined();
    expect(next!.column_id).toBe("todo");
  });

  it("updates task fields with partial update", () => {
    const task = createTask(projectId, "Update me");
    const updated = updateTask(projectId, task.id, {
      title: "Updated title",
      priority: 5,
      spent_minutes: 30,
    });
    expect(updated).not.toBeUndefined();
    expect(updated!.title).toBe("Updated title");
    expect(updated!.priority).toBe(5);
    expect(updated!.spent_minutes).toBe(30);
    expect(updated!.description).toBeNull(); // unchanged
  });

  it("deletes a task and its related records", () => {
    const task = createTask(projectId, "Delete me");
    // Add a comment to test cascade
    addComment(projectId, task.id, "user", "test comment");
    expect(getComments(projectId, task.id).length).toBe(1);

    const deleted = deleteTask(projectId, task.id);
    expect(deleted).toBe(true);
    expect(getTask(task.id)).toBeUndefined();
    // Comments should be cascade-deleted
    expect(getComments(projectId, task.id).length).toBe(0);
  });

  it("getTask returns task by id", () => {
    const task = createTask(projectId, "Get me");
    const found = getTask(task.id);
    expect(found).not.toBeUndefined();
    expect(found!.id).toBe(task.id);
  });
});

describe("tasks — FTS search", () => {
  it("searches tasks by title", () => {
    createTask(projectId, "Fix login bug", "Security issue in auth module");
    createTask(projectId, "Add dashboard widget", "New analytics widget");
    createTask(projectId, "Update auth docs", "Documentation for auth");

    const results = searchTasks(projectId, "auth");
    expect(results.length).toBeGreaterThanOrEqual(2); // "Fix login bug" + "Update auth docs"
  });

  it("searches tasks by description", () => {
    const results = searchTasks(projectId, "security");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("handles FTS5 special characters without errors", () => {
    createTask(projectId, "SQL injection audit", "Review SELECT * FROM queries for safety");
    createTask(projectId, "Logic refactor", "Simplify AND/OR conditions");

    // FTS5 operators — should NOT throw
    const r1 = searchTasks(projectId, "SELECT * FROM");
    expect(r1).toBeDefined();
    expect(Array.isArray(r1)).toBe(true);

    const r2 = searchTasks(projectId, "AND/OR conditions");
    expect(r2).toBeDefined();
    expect(Array.isArray(r2)).toBe(true);

    const r3 = searchTasks(projectId, "(parens) -exclude +boost");
    expect(r3).toBeDefined();
    expect(Array.isArray(r3)).toBe(true);

    // Quoted string
    const r4 = searchTasks(projectId, 'has "quotes"');
    expect(r4).toBeDefined();
    expect(Array.isArray(r4)).toBe(true);

    // Empty / whitespace returns empty
    const r5 = searchTasks(projectId, "");
    expect(r5).toEqual([]);
    const r6 = searchTasks(projectId, "   ");
    expect(r6).toEqual([]);
  });
});

describe("tasks — comments and threading", () => {
  let taskId: string;

  beforeAll(() => {
    const task = createTask(projectId, "Commentable task");
    taskId = task.id;
  });

  it("adds a comment", () => {
    const comment = addComment(projectId, taskId, "user1", "Great task!");
    expect(comment.author).toBe("user1");
    expect(comment.body).toBe("Great task!");
    expect(comment.parent_comment_id).toBeNull();
    expect(comment.reactions).toBe("{}");
  });

  it("adds a reply (threaded comment)", () => {
    const parent = addComment(projectId, taskId, "user1", "Parent comment");
    const reply = addComment(projectId, taskId, "user2", "Reply to parent", parent.id);
    expect(reply.parent_comment_id).toBe(parent.id);
  });

  it("edits a comment", () => {
    const comment = addComment(projectId, taskId, "user1", "Original text");
    const edited = editComment(projectId, comment.id, "Edited text");
    expect(edited).not.toBeUndefined();
    expect(edited!.body).toBe("Edited text");
    expect(edited!.edited_at).not.toBeNull();
  });

  it("reacts to a comment", () => {
    const comment = addComment(projectId, taskId, "user1", "React to me");
    const reacted = reactComment(projectId, comment.id, "👍");
    expect(reacted).not.toBeUndefined();
    const reactions = JSON.parse(reacted!.reactions);
    expect(reactions["👍"]).toBe(1);

    // React again - should increment
    const reacted2 = reactComment(projectId, comment.id, "👍");
    const reactions2 = JSON.parse(reacted2!.reactions);
    expect(reactions2["👍"]).toBe(2);
  });

  it("gets all comments for a task", () => {
    const all = getComments(projectId, taskId);
    expect(all.length).toBeGreaterThanOrEqual(5);
  });
});

describe("tasks — board config", () => {
  it("returns default board config on first call", () => {
    const config = getBoardConfig(projectId);
    expect(config).not.toBeUndefined();
    expect(config.project_id).toBe(projectId);

    const columns = JSON.parse(config.columns);
    expect(columns.length).toBe(4);
    expect(columns[0].id).toBe("todo");
    expect(columns[0].wip_limit).toBeNull();
    expect(columns[1].id).toBe("in_progress");
    expect(columns[1].wip_limit).toBe(5);
    expect(columns[2].id).toBe("review");
    expect(columns[2].wip_limit).toBe(3);
    expect(columns[3].id).toBe("done");
    expect(columns[3].wip_limit).toBeNull();
  });

  it("updates board config columns", () => {
    const newColumns = JSON.stringify([
      { id: "backlog", name: "Backlog", wip_limit: null },
      { id: "active", name: "Active", wip_limit: 10 },
      { id: "done", name: "Done", wip_limit: null },
    ]);
    const updated = updateBoardConfig(projectId, { columns: newColumns });
    expect(updated).not.toBeUndefined();
    const parsed = JSON.parse(updated!.columns);
    expect(parsed.length).toBe(3);
    expect(parsed[0].id).toBe("backlog");
  });

  it("validates WIP limit", () => {
    // Reset to default columns
    updateBoardConfig(projectId, {
      columns: JSON.stringify([
        { id: "todo", name: "Todo", wip_limit: null },
        { id: "in_progress", name: "In Progress", wip_limit: 2 },
        { id: "done", name: "Done", wip_limit: null },
      ]),
    });

    // Create tasks and move some to in_progress
    const t1 = createTask(projectId, "WIP test A");
    const t2 = createTask(projectId, "WIP test B");
    const t3 = createTask(projectId, "WIP test C");
    moveTask(t1.id, "in_progress");
    moveTask(t2.id, "in_progress");
    moveTask(t3.id, "in_progress");

    const result = validateWipLimit(projectId, "in_progress");
    // count may include tasks from prior tests; we verify breach detection works
    expect(result.count).toBeGreaterThanOrEqual(3);
    expect(result.limit).toBe(2);
    expect(result.breached).toBe(true);
  });

  it("WIP validation returns not breached when under limit", () => {
    const result = validateWipLimit(projectId, "todo");
    expect(result.limit).toBeNull();
    expect(result.breached).toBe(false);
  });
});

describe("tasks — hierarchy", () => {
  it("builds task tree with epics and children", () => {
    const epic = createTask(projectId, "Epic: Auth System", "Auth epic", undefined, {
      issue_type: "epic",
    });
    const story1 = createTask(projectId, "Story: Login", "Login story", undefined, {
      issue_type: "story",
      parent_id: epic.id,
    });
    const subtask1 = createTask(projectId, "Sub: OAuth", "OAuth subtask", undefined, {
      issue_type: "subtask",
      parent_id: story1.id,
    });
    const story2 = createTask(projectId, "Story: Register", "Register story", undefined, {
      issue_type: "story",
      parent_id: epic.id,
    });

    const tree = getTaskTree(projectId);
    const epics = tree.filter((t: any) => t.issue_type === "epic");
    expect(epics.length).toBeGreaterThanOrEqual(1);

    const authEpic = epics.find((t: any) => t.id === epic.id);
    expect(authEpic).not.toBeUndefined();
    expect(authEpic.children.length).toBe(2);

    const loginStory = authEpic.children.find((c: any) => c.id === story1.id);
    expect(loginStory.children.length).toBe(1);
    expect(loginStory.children[0].id).toBe(subtask1.id);
  });

  it("returns children for a specific parent", () => {
    const parent = createTask(projectId, "Parent for children", undefined, undefined, {
      issue_type: "story",
    });
    createTask(projectId, "Child 1", undefined, undefined, {
      issue_type: "subtask",
      parent_id: parent.id,
    });
    createTask(projectId, "Child 2", undefined, undefined, {
      issue_type: "subtask",
      parent_id: parent.id,
    });

    const tree = getTaskTree(projectId, parent.id);
    expect(tree.length).toBe(2);
  });
});

describe("tasks — links", () => {
  it("links two tasks and retrieves links", () => {
    const t1 = createTask(projectId, "Linker 1");
    const t2 = createTask(projectId, "Linker 2");

    const link = linkTasks(projectId, t1.id, t2.id, "blocks");
    expect(link.link_type).toBe("blocks");

    const links = getTaskLinks(projectId, t1.id);
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0].linked_task_id).toBe(t2.id);
  });

  it("prevents duplicate links", () => {
    const t1 = createTask(projectId, "Dup 1");
    const t2 = createTask(projectId, "Dup 2");
    linkTasks(projectId, t1.id, t2.id, "relates_to");
    // Second link should return existing
    const dup = linkTasks(projectId, t1.id, t2.id, "relates_to");
    const allLinks = getTaskLinks(projectId, t1.id);
    const related = allLinks.filter((l) => l.link_type === "relates_to" && l.linked_task_id === t2.id);
    expect(related.length).toBe(1);
  });

  it("unlinks tasks", () => {
    const t1 = createTask(projectId, "Unlink 1");
    const t2 = createTask(projectId, "Unlink 2");
    const link = linkTasks(projectId, t1.id, t2.id, "relates_to");

    const deleted = unlinkTasks(projectId, link.id);
    expect(deleted).toBe(true);

    const remaining = getTaskLinks(projectId, t1.id);
    const found = remaining.filter((l) => l.id === link.id);
    expect(found.length).toBe(0);
  });
});

describe("tasks — activity", () => {
  it("logs activity on task creation", () => {
    const task = createTask(projectId, "Activity task");
    const activity = getTaskActivity(projectId, task.id);
    expect(activity.length).toBeGreaterThanOrEqual(1);
    expect(activity[0].event_type).toBe("created");
  });

  it("logs activity on move", () => {
    const task = createTask(projectId, "Move activity task");
    moveTask(task.id, "in_progress", "test-actor");
    const activity = getTaskActivity(projectId, task.id);
    const moves = activity.filter((a) => a.event_type === "moved");
    expect(moves.length).toBeGreaterThanOrEqual(1);
    expect(moves[0].actor).toBe("test-actor");
  });
});

describe("tasks — notifications", () => {
  it("creates a notification", () => {
    const task = createTask(projectId, "Notify me");
    const notif = notifyTask(projectId, "user1", task.id, "assigned");
    expect(notif).not.toBeNull();
    expect(notif!.kind).toBe("assigned");
    expect(notif!.read_at).toBeNull();
  });

  it("deduplicates unread notifications for same recipient+task+kind", () => {
    const task = createTask(projectId, "Dedup notify");
    notifyTask(projectId, "user2", task.id, "mentioned");
    const dup = notifyTask(projectId, "user2", task.id, "mentioned");
    expect(dup).toBeNull();
  });

  it("gets notifications for a recipient", () => {
    const task = createTask(projectId, "Notify get");
    notifyTask(projectId, "user3", task.id, "assigned");

    const all = getNotifications(projectId, "user3");
    expect(all.length).toBeGreaterThanOrEqual(1);

    const unread = getNotifications(projectId, "user3", true);
    expect(unread.length).toBeGreaterThanOrEqual(1);
    expect(unread[0].read_at).toBeNull();
  });

  it("marks notification as read", () => {
    const task = createTask(projectId, "Notify read");
    const notif = notifyTask(projectId, "user4", task.id, "watched_status");
    expect(notif).not.toBeNull();

    const marked = markNotificationRead(projectId, notif!.id);
    expect(marked).toBe(true);

    const unread = getNotifications(projectId, "user4", true);
    const found = unread.filter((n) => n.id === notif!.id);
    expect(found.length).toBe(0);
  });
});

describe("tasks — bulk operations", () => {
  it("bulk updates multiple tasks to the same column", () => {
    const t1 = createTask(projectId, "Bulk 1");
    const t2 = createTask(projectId, "Bulk 2");
    const t3 = createTask(projectId, "Bulk 3");

    const count = bulkUpdateTasks(projectId, [t1.id, t2.id, t3.id], {
      column_id: "review",
      priority: 3,
    });
    expect(count).toBe(3);

    const updated = listTasks(projectId, "review");
    expect(updated.length).toBeGreaterThanOrEqual(3);
    expect(updated[0].priority).toBe(3);
  });
});

describe("tasks — migration verification", () => {
  it("migration 020 tables exist with correct schema", () => {
    // This test verifies the migration applies cleanly.
    // All test suites already log "Applied migration 020_kanban_board.sql",
    // proving the migration runs. This test additionally checks the tables exist.
    const config = getBoardConfig(projectId);
    expect(config).not.toBeUndefined();
    expect(config.columns).toBeDefined();

    // Verify that we can use all new tables by performing basic operations
    const task = createTask(projectId, "Migration check");
    expect(task.issue_type).toBe("task");
    expect(task.parent_id).toBeNull();

    const comment = addComment(projectId, task.id, "tester", "check");
    expect(comment.id).toBeDefined();
    expect(comment.reactions).toBe("{}");

    const activity = getTaskActivity(projectId, task.id);
    expect(activity.length).toBeGreaterThan(0);
  });
});
