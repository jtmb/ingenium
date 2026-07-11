"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { api } from "../../lib/api";
import { useProject, persistProject } from "../../lib/ProjectContext";
export default function ProjectSelector() {
    const [projects, setProjects] = useState([]);
    const [open, setOpen] = useState(false);
    const searchParams = useSearchParams();
    const pathname = usePathname();
    const router = useRouter();
    const activeProject = useProject();
    useEffect(() => {
        api.projects.list().then((r) => {
            setProjects(r.data.map((p) => ({ id: p.id, name: p.name })));
        }).catch(() => { });
    }, []);
    const selectProject = (name) => {
        setOpen(false);
        persistProject(name);
        const params = new URLSearchParams(searchParams.toString());
        params.set("project", name);
        router.push(`${pathname}?${params.toString()}`);
    };
    return (_jsxs("div", { className: "relative", children: [_jsxs("button", { onClick: () => setOpen(!open), className: "text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded px-3 py-1.5 bg-white flex items-center gap-2 min-w-[180px]", children: [_jsx("span", { className: "truncate flex-1 text-left", children: activeProject }), _jsx("span", { className: "text-xs opacity-50", children: open ? "▲" : "▼" })] }), open && (_jsxs("div", { className: "absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded shadow-lg z-50 min-w-[200px] max-h-[300px] overflow-y-auto", children: [projects.map((p) => (_jsx("button", { onClick: () => selectProject(p.name), className: `block w-full text-left px-3 py-2 text-sm hover:bg-gray-100 ${p.name === activeProject ? "bg-blue-50 text-blue-800 font-medium" : "text-gray-700"}`, children: p.name }, p.id))), projects.length === 0 && (_jsx("div", { className: "px-3 py-2 text-sm text-gray-400", children: "No projects" }))] }))] }));
}
