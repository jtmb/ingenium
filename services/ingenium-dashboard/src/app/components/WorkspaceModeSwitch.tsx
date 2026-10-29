"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Work uses Veyra; its explicit Web toggle retains the selected conversation. */
export default function WorkspaceModeSwitch() {
  const pathname = usePathname();
  const chat = pathname === "/chat" || pathname.startsWith("/chat/");
  return <nav aria-label="Workspace mode" className="veyra-mode-switch">
    <Link href="/chat" aria-current={chat ? "page" : undefined}>Chat</Link>
    <Link href="/work" aria-current={pathname === "/work" ? "page" : undefined}>Work</Link>
  </nav>;
}
