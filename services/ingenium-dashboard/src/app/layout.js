import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Suspense } from "react";
import "./globals.css";
import "highlight.js/styles/github.css";
import "./hljs-dark.css";
import MainContainer from "./components/MainContainer";
import OpenCodeFrame from "./components/OpenCodeFrame";
import ProjectSelector from "./components/ProjectSelector";
/** Global metadata for the Ingenium Dashboard app. */
export const metadata = {
    title: "Ingenium Dashboard",
    description: "Manage your AI agent skill system",
};
/** Root layout — includes the top navigation bar and wraps all page content. */
export default function RootLayout({ children }) {
    return (_jsx("html", { lang: "en", children: _jsxs("body", { className: "min-h-screen bg-gray-50 text-gray-900 overflow-x-hidden", children: [_jsxs("nav", { className: "bg-white border-b border-gray-200 px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2", children: [_jsx("a", { href: "/", className: "font-bold text-lg", children: "Ingenium" }), _jsx("a", { href: "/opencode", className: "text-sm text-gray-600 hover:text-gray-900", children: "OpenCode" }), _jsx("span", { className: "text-gray-300", children: "|" }), _jsx("a", { href: "/projects", className: "text-sm text-gray-600 hover:text-gray-900", children: "Projects" }), _jsx("a", { href: "/skills", className: "text-sm text-gray-600 hover:text-gray-900", children: "Skills" }), _jsx("a", { href: "/tasks", className: "text-sm text-gray-600 hover:text-gray-900", children: "Tasks" }), _jsx("a", { href: "/jobs", className: "text-sm text-gray-600 hover:text-gray-900", children: "Jobs" }), _jsx("a", { href: "/plugins", className: "text-sm text-gray-600 hover:text-gray-900", children: "Plugins" }), _jsx("a", { href: "/mail", className: "text-sm text-gray-600 hover:text-gray-900", children: "Mail" }), _jsx("a", { href: "/agents", className: "text-sm text-gray-600 hover:text-gray-900", children: "Agents" }), _jsx("a", { href: "/mcp-servers", className: "text-sm text-gray-600 hover:text-gray-900", children: "MCP" }), _jsx("a", { href: "/config", className: "text-sm text-gray-600 hover:text-gray-900", children: "Config" }), _jsx("a", { href: "/observations", className: "text-sm text-gray-600 hover:text-gray-900", children: "Observations" }), _jsx("a", { href: "/personality", className: "text-sm text-gray-600 hover:text-gray-900", children: "Personality" }), _jsx("a", { href: "/pipeline", className: "text-sm text-gray-600 hover:text-gray-900", children: "Pipeline" }), _jsx("a", { href: "/logs", className: "text-sm text-gray-600 hover:text-gray-900", children: "Logs" }), _jsx("a", { href: "/settings", className: "text-sm text-gray-600 hover:text-gray-900", children: "Settings" }), _jsx("div", { className: "ml-auto", children: _jsx(Suspense, { children: _jsx(ProjectSelector, {}) }) })] }), _jsx(MainContainer, { children: _jsx(Suspense, { children: children }) }), _jsx(OpenCodeFrame, {})] }) }));
}
