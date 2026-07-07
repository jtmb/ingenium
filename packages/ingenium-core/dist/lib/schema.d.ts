import { z } from "zod";
export declare const ProjectSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    path: z.ZodOptional<z.ZodString>;
    archived_at: z.ZodOptional<z.ZodString>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
    path?: string | undefined;
    archived_at?: string | undefined;
}, {
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
    path?: string | undefined;
    archived_at?: string | undefined;
}>;
export type Project = z.infer<typeof ProjectSchema>;
export declare const SkillSchema: z.ZodObject<{
    id: z.ZodString;
    project_id: z.ZodString;
    name: z.ZodString;
    description: z.ZodString;
    content: z.ZodString;
    category: z.ZodOptional<z.ZodString>;
    enabled: z.ZodDefault<z.ZodBoolean>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
    project_id: string;
    description: string;
    content: string;
    enabled: boolean;
    category?: string | undefined;
}, {
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
    project_id: string;
    description: string;
    content: string;
    category?: string | undefined;
    enabled?: boolean | undefined;
}>;
export type Skill = z.infer<typeof SkillSchema>;
export declare const LearningSchema: z.ZodObject<{
    id: z.ZodNumber;
    project_id: z.ZodString;
    entry_type: z.ZodEnum<["decision", "bug", "pattern", "preference", "research", "skill", "agent", "config", "hook", "plugin", "architecture"]>;
    content: z.ZodString;
    tags: z.ZodOptional<z.ZodString>;
    priority: z.ZodDefault<z.ZodNumber>;
    session_id: z.ZodOptional<z.ZodString>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: number;
    created_at: string;
    updated_at: string;
    project_id: string;
    content: string;
    entry_type: "decision" | "bug" | "pattern" | "preference" | "research" | "skill" | "agent" | "config" | "hook" | "plugin" | "architecture";
    priority: number;
    tags?: string | undefined;
    session_id?: string | undefined;
}, {
    id: number;
    created_at: string;
    updated_at: string;
    project_id: string;
    content: string;
    entry_type: "decision" | "bug" | "pattern" | "preference" | "research" | "skill" | "agent" | "config" | "hook" | "plugin" | "architecture";
    tags?: string | undefined;
    priority?: number | undefined;
    session_id?: string | undefined;
}>;
export type Learning = z.infer<typeof LearningSchema>;
export declare const TaskSchema: z.ZodObject<{
    id: z.ZodString;
    project_id: z.ZodString;
    title: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    column_id: z.ZodDefault<z.ZodString>;
    assigned_to: z.ZodOptional<z.ZodString>;
    depends_on: z.ZodOptional<z.ZodString>;
    files: z.ZodOptional<z.ZodString>;
    labels: z.ZodOptional<z.ZodString>;
    session_id: z.ZodOptional<z.ZodString>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
    completed_at: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    created_at: string;
    updated_at: string;
    project_id: string;
    title: string;
    column_id: string;
    description?: string | undefined;
    session_id?: string | undefined;
    assigned_to?: string | undefined;
    depends_on?: string | undefined;
    files?: string | undefined;
    labels?: string | undefined;
    completed_at?: string | undefined;
}, {
    id: string;
    created_at: string;
    updated_at: string;
    project_id: string;
    title: string;
    description?: string | undefined;
    session_id?: string | undefined;
    column_id?: string | undefined;
    assigned_to?: string | undefined;
    depends_on?: string | undefined;
    files?: string | undefined;
    labels?: string | undefined;
    completed_at?: string | undefined;
}>;
export type Task = z.infer<typeof TaskSchema>;
export declare const ContextSchema: z.ZodObject<{
    id: z.ZodNumber;
    project_id: z.ZodString;
    content: z.ZodString;
    priority: z.ZodDefault<z.ZodNumber>;
    tags: z.ZodOptional<z.ZodString>;
    session_id: z.ZodOptional<z.ZodString>;
    created_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: number;
    created_at: string;
    project_id: string;
    content: string;
    priority: number;
    tags?: string | undefined;
    session_id?: string | undefined;
}, {
    id: number;
    created_at: string;
    project_id: string;
    content: string;
    tags?: string | undefined;
    priority?: number | undefined;
    session_id?: string | undefined;
}>;
export type ContextEntry = z.infer<typeof ContextSchema>;
export declare const ServerSchema: z.ZodObject<{
    id: z.ZodString;
    project_id: z.ZodString;
    name: z.ZodString;
    command: z.ZodString;
    args: z.ZodOptional<z.ZodString>;
    env: z.ZodOptional<z.ZodString>;
    enabled: z.ZodDefault<z.ZodBoolean>;
    running: z.ZodDefault<z.ZodBoolean>;
    created_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    created_at: string;
    project_id: string;
    enabled: boolean;
    command: string;
    running: boolean;
    args?: string | undefined;
    env?: string | undefined;
}, {
    id: string;
    name: string;
    created_at: string;
    project_id: string;
    command: string;
    enabled?: boolean | undefined;
    args?: string | undefined;
    env?: string | undefined;
    running?: boolean | undefined;
}>;
export type Server = z.infer<typeof ServerSchema>;
export declare const PluginSchema: z.ZodObject<{
    id: z.ZodString;
    project_id: z.ZodString;
    name: z.ZodString;
    file_path: z.ZodString;
    enabled: z.ZodDefault<z.ZodBoolean>;
    source_content: z.ZodOptional<z.ZodString>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
    project_id: string;
    enabled: boolean;
    file_path: string;
    source_content?: string | undefined;
}, {
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
    project_id: string;
    file_path: string;
    enabled?: boolean | undefined;
    source_content?: string | undefined;
}>;
export type Plugin = z.infer<typeof PluginSchema>;
//# sourceMappingURL=schema.d.ts.map