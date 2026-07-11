"use client";
import { jsx as _jsx } from "react/jsx-runtime";
import { usePathname } from "next/navigation";
export default function MainContainer({ children }) {
    const pathname = usePathname();
    const fullWidth = pathname === "/mail" ||
        pathname === "/tasks" ||
        pathname === "/opencode" ||
        pathname.startsWith("/mail/");
    return (_jsx("main", { className: fullWidth ? "p-6" : "p-6 max-w-6xl mx-auto", children: children }));
}
