import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../lib/tools/projects.js";
import { createTask, listTasks, moveTask, completeTask, getNextTask } from "../lib/tools/tasks.js";

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

describe("tasks", () => {
  it("creates a task in todo column by default", () => {
    const task = createTask(projectId, "First task", "Do something");
    expect(task.title).toBe("First task");
    expect(task.column_id).toBe("todo");
    expect(task.description).toBe("Do something");
  });

  it("lists tasks filtered by column", () => {
    createTask(projectId, "In progress task");
    const finished = listTasks(projectId, "todo");
    expect(finished.length).toBeGreaterThanOrEqual(2);
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

  it("next task returns the oldest uncompleted task", () => {
    createTask(projectId, "Old task");
    const next = getNextTask(projectId);
    expect(next).not.toBeUndefined();
    expect(next!.column_id).toBe("todo");
  });
});
