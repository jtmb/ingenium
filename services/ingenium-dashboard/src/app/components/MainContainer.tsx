"use client";

import { usePathname } from "next/navigation";

export default function MainContainer({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fullWidth =
    pathname === "/mail" ||
    pathname === "/tasks" ||
    pathname === "/opencode" ||
    pathname.startsWith("/mail/");
  return (
    <main className={fullWidth ? "p-6" : "p-6 max-w-6xl mx-auto"}>
      {children}
    </main>
  );
}
