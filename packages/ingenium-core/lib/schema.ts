import { z } from "zod";

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(64),
  path: z.string().optional(),
  archived_at: z.string().datetime().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const SkillSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string(),
  name: z.string().min(1).max(64),
  description: z.string(),
  content: z.string(),
  category: z.string().optional(),
  enabled: z.coerce.boolean().default(true),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Skill = z.infer<typeof SkillSchema>;

export const LearningSchema = z.object({
  id: z.number(),
  project_id: z.string(),
  entry_type: z.enum(["decision", "bug", "pattern", "preference", "research", "skill", "agent", "config", "hook", "plugin", "architecture"]),
  content: z.string().min(1),
  tags: z.string().optional(),
  priority: z.number().min(0).max(10).default(5),
  session_id: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Learning = z.infer<typeof LearningSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  column_id: z.string().default("todo"),
  assigned_to: z.string().optional(),
  depends_on: z.string().optional(),
  files: z.string().optional(),
  labels: z.string().optional(),
  session_id: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
});
export type Task = z.infer<typeof TaskSchema>;

export const ContextSchema = z.object({
  id: z.number(),
  project_id: z.string(),
  content: z.string().min(1),
  priority: z.number().min(0).max(10).default(5),
  tags: z.string().optional(),
  session_id: z.string().optional(),
  created_at: z.string().datetime(),
});
export type ContextEntry = z.infer<typeof ContextSchema>;

export const ServerSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string().min(1).max(64),
  command: z.string(),
  args: z.string().optional(),
  env: z.string().optional(),
  enabled: z.coerce.boolean().default(true),
  running: z.coerce.boolean().default(false),
  created_at: z.string().datetime(),
});
export type Server = z.infer<typeof ServerSchema>;

export const PluginSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string().min(1).max(64),
  file_path: z.string(),
  enabled: z.coerce.boolean().default(true),
  source_content: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Plugin = z.infer<typeof PluginSchema>;
