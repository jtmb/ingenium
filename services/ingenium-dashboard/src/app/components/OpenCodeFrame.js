"use client";
import { jsx as _jsx } from "react/jsx-runtime";
import { usePathname } from "next/navigation";
export default function OpenCodeFrame() {
    const pathname = usePathname();
    const isOpenCode = pathname === "/opencode";
    return (_jsx("div", { className: `fixed inset-0 top-[57px] ${isOpenCode ? "" : "hidden"}`, children: _jsx("iframe", { src: "http://localhost:4098/", className: "w-full h-full border-0", title: "OpenCode", allow: "clipboard-write" }) }));
}
