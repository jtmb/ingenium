import { Task } from "../schema.js";
export declare function createTask(projectId: string, title: string, description?: string, assignedTo?: string): Task;
export declare function listTasks(projectId: string, columnId?: string): Task[];
export declare function moveTask(taskId: string, columnId: string): Task | undefined;
export declare function completeTask(taskId: string): Task | undefined;
export declare function getNextTask(projectId: string): Task | undefined;
//# sourceMappingURL=tasks.d.ts.map