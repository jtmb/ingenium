"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Work opens the existing upstream OpenCode page; it creates no new session. */
export default function WorkspaceModeSwitch() {
  const pathname = usePathname();
  const chat = pathname === "/chat" || pathname.startsWith("/chat/");
  return <nav aria-label="Workspace mode" className="veyra-mode-switch">
    <Link href="/chat" aria-current={chat ? "page" : undefined}>Chat</Link>
    <Link href="/opencode" aria-current={pathname === "/opencode" ? "page" : undefined}>Work</Link>
  </nav>;
}
