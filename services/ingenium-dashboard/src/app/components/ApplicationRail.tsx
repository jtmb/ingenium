"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { SettingsLauncher } from "./settings";
import UserMenu from "./UserMenu";

/** Shared application rail for immersive feature pages that own their sidebar. */
export default function ApplicationRail() {
  const pathname = usePathname();
  const links = [{ href: "/work", label: "Work", path: "M3 5h18v14H3zM7 5V3h10v2" },
    { href: "/chat", label: "Chat", path: "M4 4h16v12H8l-4 4z" },
    { href: "/tasks", label: "Tasks", path: "M4 5h16v15H4zM8 11l3 3 5-6" },
    { href: "/customize/plugins", label: "Customize", path: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" },
    { href: "/", label: "All features", path: "M5 12h.01M12 12h.01M19 12h.01" }];
  return <nav aria-label="Applications" className="flex w-[52px] shrink-0 flex-col items-center gap-3 border-r border-white/5 bg-[#202020] py-3 text-neutral-300">
    <Link href="/" aria-label="Veyra home" className="rounded-lg p-2 focus-visible:outline-blue-400"><Image src="/veyra-blue.png" alt="" width={24} height={24} /></Link>
    {links.map(item => <Link key={item.href} href={item.href} aria-label={item.label} title={item.label}
      aria-current={item.href === "/customize/plugins" ? pathname.startsWith("/customize") ? "page" : undefined : pathname === item.href ? "page" : undefined}
      className="rounded-lg p-2 hover:bg-white/10 focus-visible:outline-blue-400">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={item.path} /></svg>
    </Link>)}
    <div className="mt-auto flex flex-col items-center gap-3"><SettingsLauncher /><UserMenu /></div>
  </nav>;
}
