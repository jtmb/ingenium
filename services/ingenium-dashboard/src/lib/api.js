const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4097/api/v1";
const DEFAULT_PROJECT = "gh-llm-bootstrap";
/** Internal fetch wrapper that handles errors and content types uniformly. */
async function request(path, options) {
    const res = await fetch(`${API_URL}${path}`, {
        headers: { "Content-Type": "application/json" },
        ...options,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
        throw new Error(err.error?.message ?? res.statusText);
    }
    // Handle 204 No Content
    if (res.status === 204)
        return undefined;
    return res.json();
}
/**
 * Typed API client for the Ingenium backend.
 * All methods accept an optional `project` parameter that defaults to "ingenium".
 */
export const api = {
    projects: {
        list: () => request("/projects"),
        create: (name) => request("/projects", { method: "POST", body: JSON.stringify({ name }) }),
        archive: (name) => request(`/projects/${name}`, { method: "DELETE" }),
        restore: (name) => request(`/projects/${name}/restore`, { method: "POST" }),
        purge: (retentionDays) => request("/projects/purge", { method: "POST", body: JSON.stringify({ retention_days: retentionDays ?? 7 }) }),
        listArchived: () => request("/projects/archive"),
        update: (currentName, newName) => request(`/projects/${encodeURIComponent(currentName)}`, { method: "PATCH", body: JSON.stringify({ name: newName }) }),
        detail: (name) => request(`/projects/${encodeURIComponent(name)}/detail`),
        purgeOne: (name) => request(`/projects/${encodeURIComponent(name)}/purge`, { method: "DELETE" }),
    },
    skills: {
        list: (project = DEFAULT_PROJECT) => request(`/skills?project=${project}`),
        get: (name, project = DEFAULT_PROJECT) => request(`/skills/${name}?project=${project}`),
        create: (name, description, content, project = DEFAULT_PROJECT) => request(`/skills?project=${project}`, { method: "POST", body: JSON.stringify({ name, description, content }) }),
        update: (name, content, extra, project = DEFAULT_PROJECT) => request(`/skills/${encodeURIComponent(name)}?project=${project}`, {
            method: "PATCH",
            body: JSON.stringify({ content, ...(extra || {}) })
        }),
    },
    learnings: {
        list: (project = DEFAULT_PROJECT) => request(`/learnings?project=${project}`),
        create: (entry_type, content, tags, project = DEFAULT_PROJECT) => request(`/learnings?project=${project}`, { method: "POST", body: JSON.stringify({ entry_type, content, tags }) }),
    },
    tasks: {
        list: (project = DEFAULT_PROJECT) => request(`/tasks?project=${project}`),
        create: (title, project = DEFAULT_PROJECT) => request(`/tasks?project=${project}`, { method: "POST", body: JSON.stringify({ title }) }),
        move: (id, column_id, project = DEFAULT_PROJECT) => request(`/tasks/${id}?project=${project}`, { method: "PATCH", body: JSON.stringify({ column_id }) }),
        update: (id, fields, project = DEFAULT_PROJECT) => request(`/tasks/${id}?project=${project}`, { method: "PATCH", body: JSON.stringify(fields) }),
        delete: (id, project = DEFAULT_PROJECT) => request(`/tasks/${id}?project=${project}`, { method: "DELETE" }),
        complete: (id, project = DEFAULT_PROJECT) => request(`/tasks/${id}?project=${project}`, { method: "PATCH", body: "{}" }),
        search: (query, project = DEFAULT_PROJECT) => request(`/tasks/search?project=${project}&q=${encodeURIComponent(query)}`),
        comments: (taskId, project = DEFAULT_PROJECT) => request(`/tasks/${taskId}/comments?project=${project}`),
        addComment: (taskId, body, parentCommentId, project = DEFAULT_PROJECT) => request(`/tasks/${taskId}/comments?project=${project}`, { method: "POST", body: JSON.stringify({ body, parent_comment_id: parentCommentId }) }),
        reactToComment: (taskId, commentId, reaction, project = DEFAULT_PROJECT) => request(`/tasks/${taskId}/comments/${commentId}/react?project=${project}`, { method: "POST", body: JSON.stringify({ reaction }) }),
        boardConfig: (project = DEFAULT_PROJECT) => request(`/tasks/board-config?project=${project}`),
        updateBoardConfig: (data, project = DEFAULT_PROJECT) => request(`/tasks/board-config?project=${project}`, { method: "PUT", body: JSON.stringify(data) }),
        notifications: (recipient, unread, project = DEFAULT_PROJECT) => {
            const params = new URLSearchParams({ project });
            if (recipient)
                params.set("recipient", recipient);
            if (unread)
                params.set("unread", "1");
            return request(`/tasks/notifications?${params}`);
        },
        readNotification: (notificationId, project = DEFAULT_PROJECT) => request(`/tasks/notifications/${notificationId}/read?project=${project}`, { method: "POST" }),
        activity: (taskId, project = DEFAULT_PROJECT) => request(`/tasks/${taskId}/activity?project=${project}`),
        links: (taskId, project = DEFAULT_PROJECT) => request(`/tasks/${taskId}/links?project=${project}`),
        addLink: (taskId, data, project = DEFAULT_PROJECT) => request(`/tasks/${taskId}/links?project=${project}`, { method: "POST", body: JSON.stringify(data) }),
        removeLink: (taskId, linkId, project = DEFAULT_PROJECT) => request(`/tasks/${taskId}/links/${linkId}?project=${project}`, { method: "DELETE" }),
        bulkUpdate: (data, project = DEFAULT_PROJECT) => request(`/tasks/bulk?project=${project}`, { method: "POST", body: JSON.stringify(data) }),
    },
    plugins: {
        list: (project = DEFAULT_PROJECT) => request(`/plugins?project=${project}`),
        get: (name, project = DEFAULT_PROJECT) => request(`/plugins/${name}?project=${project}`),
        create: (name, file_path, source_content, project = DEFAULT_PROJECT) => request(`/plugins?project=${project}`, {
            method: "POST", body: JSON.stringify({ name, file_path, source_content }),
        }),
        update: (name, data, project = DEFAULT_PROJECT) => request(`/plugins/${name}?project=${project}`, {
            method: "PUT", body: JSON.stringify(data),
        }),
        delete: (name, project = DEFAULT_PROJECT) => request(`/plugins/${name}?project=${project}`, { method: "DELETE" }),
        enable: (name, project = DEFAULT_PROJECT) => request(`/plugins/${name}/enable?project=${project}`, { method: "POST" }),
        disable: (name, project = DEFAULT_PROJECT) => request(`/plugins/${name}/disable?project=${project}`, { method: "POST" }),
        getSource: (name, project = DEFAULT_PROJECT) => request(`/plugins/${encodeURIComponent(name)}/source?project=${project}`),
    },
    agents: {
        list: (project = DEFAULT_PROJECT, category) => {
            const url = category ? `/agents?project=${project}&category=${encodeURIComponent(category)}` : `/agents?project=${project}`;
            return request(url);
        },
        get: (name, project = DEFAULT_PROJECT) => request(`/agents/${encodeURIComponent(name)}?project=${project}`),
        create: (data, project = DEFAULT_PROJECT) => request(`/agents?project=${project}`, { method: "POST", body: JSON.stringify(data) }),
        update: (name, data, project = DEFAULT_PROJECT) => request(`/agents/${encodeURIComponent(name)}?project=${project}`, { method: "PUT", body: JSON.stringify(data) }),
        delete: (name, project = DEFAULT_PROJECT) => request(`/agents/${encodeURIComponent(name)}?project=${project}`, { method: "DELETE" }),
        enable: (name, project = DEFAULT_PROJECT) => request(`/agents/${encodeURIComponent(name)}/enable?project=${project}`, { method: "POST" }),
        disable: (name, project = DEFAULT_PROJECT) => request(`/agents/${encodeURIComponent(name)}/disable?project=${project}`, { method: "POST" }),
    },
    servers: {
        list: (project = DEFAULT_PROJECT) => request(`/servers?project=${project}`),
        create: (name, command, project = DEFAULT_PROJECT) => request(`/servers?project=${project}`, { method: "POST", body: JSON.stringify({ name, command }) }),
    },
    observations: {
        list: (project = DEFAULT_PROJECT, status, type) => {
            const params = new URLSearchParams({ project });
            if (status)
                params.set("status", status);
            if (type)
                params.set("type", type);
            return request(`/observations?${params}`);
        },
        get: (id, project = DEFAULT_PROJECT) => request(`/observations/${id}?project=${project}`),
        create: (observationType, content, importance, source, project = DEFAULT_PROJECT) => request(`/observations?project=${project}`, { method: "POST", body: JSON.stringify({ observation_type: observationType, content, importance, source }) }),
        stats: (project = DEFAULT_PROJECT) => request(`/observations/stats?project=${project}`),
    },
    personality: {
        list: (project = DEFAULT_PROJECT, traitType) => {
            const params = new URLSearchParams({ project });
            if (traitType)
                params.set("trait_type", traitType);
            return request(`/personality?${params}`);
        },
        profile: (project = DEFAULT_PROJECT) => request(`/personality/profile?project=${project}`),
        dismiss: (id, project = DEFAULT_PROJECT) => request(`/personality/${id}/dismiss?project=${project}`, { method: "POST" }),
    },
    synthesis: {
        run: (project = DEFAULT_PROJECT) => request(`/synthesis/run?project=${project}`, { method: "POST" }),
        status: (project = DEFAULT_PROJECT) => request(`/synthesis/status?project=${project}`),
    },
    pipeline: {
        events: (project = DEFAULT_PROJECT, options) => {
            const params = new URLSearchParams({ project });
            if (options?.source)
                params.set("source", options.source);
            if (options?.type)
                params.set("type", options.type);
            if (options?.limit)
                params.set("limit", String(options.limit));
            return request(`/pipeline/events?${params}`);
        },
        timeline: (project = DEFAULT_PROJECT, options) => {
            const params = new URLSearchParams({ project });
            if (options?.source)
                params.set("source", options.source);
            if (options?.limit)
                params.set("limit", String(options.limit));
            return request(`/pipeline/timeline?${params}`);
        },
    },
    emails: {
        accounts: {
            list: (project = DEFAULT_PROJECT) => request(`/emails/accounts?project=${project}`),
            create: (data, project = DEFAULT_PROJECT) => request(`/emails/accounts?project=${project}`, {
                method: "POST", body: JSON.stringify(data),
            }),
            delete: (id, project = DEFAULT_PROJECT) => request(`/emails/accounts/${id}?project=${project}`, { method: "DELETE" }),
            test: (data, project = DEFAULT_PROJECT) => request(`/emails/accounts/test?project=${project}`, {
                method: "POST", body: JSON.stringify(data),
            }),
            oauthUrl: (provider, project = DEFAULT_PROJECT) => request(`/emails/accounts/oauth/url?project=${project}&provider=${provider}`),
            oauthCallback: (provider, code, redirectUri, project = DEFAULT_PROJECT) => request(`/emails/accounts/oauth?project=${project}`, {
                method: "POST", body: JSON.stringify({ provider, code, redirectUri }),
            }),
        },
        list: (folder, accountId, page = 1, limit = 50, project = DEFAULT_PROJECT) => {
            const params = new URLSearchParams({ project, page: String(page), limit: String(limit) });
            if (folder)
                params.set("folder", folder);
            if (accountId)
                params.set("account_id", accountId);
            return request(`/emails?${params}`);
        },
        search: (query, folder, accountId, project = DEFAULT_PROJECT) => {
            const params = new URLSearchParams({ project, query });
            if (folder)
                params.set("folder", folder);
            if (accountId)
                params.set("account_id", accountId);
            return request(`/emails/search?${params}`);
        },
        get: (uid, accountId, project = DEFAULT_PROJECT) => {
            const params = new URLSearchParams({ project, uid: String(uid) });
            if (accountId)
                params.set("account_id", accountId);
            return request(`/emails/${uid}?${params}`);
        },
        send: (data, project = DEFAULT_PROJECT) => request(`/emails/send?project=${project}`, {
            method: "POST", body: JSON.stringify(data),
        }),
        draft: (data, project = DEFAULT_PROJECT) => request(`/emails/draft?project=${project}`, {
            method: "POST", body: JSON.stringify(data),
        }),
        move: (uid, folder, accountId, project = DEFAULT_PROJECT) => request(`/emails/${uid}/move?project=${project}`, {
            method: "POST", body: JSON.stringify({ folder, account_id: accountId }),
        }),
        setFlags: (uid, flags, accountId, project = DEFAULT_PROJECT) => request(`/emails/${uid}/flags?project=${project}`, {
            method: "PATCH", body: JSON.stringify({ flags, account_id: accountId }),
        }),
        delete: (uid, accountId, project = DEFAULT_PROJECT) => request(`/emails/${uid}?project=${project}`, {
            method: "DELETE", body: JSON.stringify({ account_id: accountId }),
        }),
        folders: (accountId, project = DEFAULT_PROJECT) => {
            const params = new URLSearchParams({ project });
            if (accountId)
                params.set("account_id", accountId);
            return request(`/emails/folders?${params}`);
        },
        triage: (uid, accountId, project = DEFAULT_PROJECT) => {
            const params = new URLSearchParams({ project, uid: String(uid) });
            if (accountId)
                params.set("account_id", accountId);
            return request(`/emails/triage?${params}`);
        },
        suggest: (uid, accountId, project = DEFAULT_PROJECT) => {
            const params = new URLSearchParams({ project });
            if (uid)
                params.set("uid", String(uid));
            if (accountId)
                params.set("account_id", accountId);
            return request(`/emails/suggest?${params}`);
        },
    },
    settings: {
        get: (key, project = DEFAULT_PROJECT) => request(`/settings?project=${project}&key=${key}`),
        set: (key, value, project = DEFAULT_PROJECT) => request(`/settings?project=${project}`, { method: "POST", body: JSON.stringify({ key, value }) }),
        /** Fetch the full LLM synthesis config (model, API key, endpoint) in parallel. */
        getConfig: (project = DEFAULT_PROJECT) => Promise.all([
            request(`/settings?project=${project}&key=synthesis_model`),
            request(`/settings?project=${project}&key=synthesis_api_key`),
            request(`/settings?project=${project}&key=synthesis_endpoint`),
        ]).then(([model, key, endpoint]) => ({
            model: model.data?.value || "",
            apiKey: key.data?.value || "",
            endpoint: endpoint.data?.value || "",
        })),
        testLlm: (endpoint, model, apiKey, project = DEFAULT_PROJECT) => request(`/settings/test-llm?project=${project}`, {
            method: "POST", body: JSON.stringify({ endpoint, model, apiKey }),
        }).then((r) => r.data),
    },
    configs: {
        get: (type = "project", project = DEFAULT_PROJECT) => request(`/config?project=${encodeURIComponent(project)}&type=${encodeURIComponent(type)}`),
        set: (type, content, project = DEFAULT_PROJECT) => request(`/config?project=${encodeURIComponent(project)}&type=${encodeURIComponent(type)}`, { method: "PUT", body: JSON.stringify({ content }) }),
        sync: (type = "project", project = DEFAULT_PROJECT) => request(`/config/sync?project=${encodeURIComponent(project)}&type=${encodeURIComponent(type)}`, { method: "POST" }),
    },
    logs: {
        list: (project = DEFAULT_PROJECT, since, limit = 200) => {
            const params = new URLSearchParams({ project, limit: String(limit) });
            if (since)
                params.set("since", since);
            return request(`/logs?${params}`);
        },
    },
    mcpTools: {
        list: (project = DEFAULT_PROJECT, includeCategories = false) => request(`/mcp-tools?project=${encodeURIComponent(project)}&include_categories=${includeCategories}`),
        toggle: (name, enabled, project = DEFAULT_PROJECT) => request(`/mcp-tools/${encodeURIComponent(name)}?project=${encodeURIComponent(project)}`, {
            method: "PUT", body: JSON.stringify({ enabled }),
        }),
        toggleCategory: (category, enabled, project = DEFAULT_PROJECT) => request(`/mcp-tools/category/${encodeURIComponent(category)}?project=${encodeURIComponent(project)}`, {
            method: "PUT", body: JSON.stringify({ enabled }),
        }),
    },
    jobs: {
        list: (project = DEFAULT_PROJECT) => request(`/jobs?project=${encodeURIComponent(project)}`),
        get: (jobId, project = DEFAULT_PROJECT) => request(`/jobs/${encodeURIComponent(jobId)}?project=${encodeURIComponent(project)}`),
        create: (data, project = DEFAULT_PROJECT) => request(`/jobs?project=${encodeURIComponent(project)}`, {
            method: "POST", body: JSON.stringify(data),
        }),
        update: (jobId, data, project = DEFAULT_PROJECT) => request(`/jobs/${encodeURIComponent(jobId)}?project=${encodeURIComponent(project)}`, {
            method: "PATCH", body: JSON.stringify(data),
        }),
        delete: (jobId, project = DEFAULT_PROJECT) => request(`/jobs/${encodeURIComponent(jobId)}?project=${encodeURIComponent(project)}`, {
            method: "DELETE",
        }),
        run: (jobId, project = DEFAULT_PROJECT) => request(`/jobs/${encodeURIComponent(jobId)}/run?project=${encodeURIComponent(project)}`, {
            method: "POST",
        }),
        runs: (jobId, project = DEFAULT_PROJECT, limit = 50) => request(`/jobs/${encodeURIComponent(jobId)}/runs?project=${encodeURIComponent(project)}&limit=${limit}`),
        runLogs: (runId, afterSeq, project = DEFAULT_PROJECT) => {
            const params = new URLSearchParams({ project: encodeURIComponent(project) });
            if (afterSeq !== undefined)
                params.set("after", String(afterSeq));
            return request(`/jobs/runs/${encodeURIComponent(runId)}/logs?${params}`);
        },
        cancelRun: (runId, project = DEFAULT_PROJECT) => request(`/jobs/runs/${encodeURIComponent(runId)}/cancel?project=${encodeURIComponent(project)}`, {
            method: "POST",
        }),
    },
};
