"use client";

import { usePathname } from "next/navigation";

export default function MainContainer({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isOpenCode = pathname === "/opencode";
  const fullWidth =
    pathname === "/mail" ||
    pathname === "/tasks" ||
    pathname.startsWith("/mail/");
  if (isOpenCode) {
    return <main className="p-0">{children}</main>;
  }
  return (
    <main className={fullWidth ? "p-6" : "p-6 max-w-6xl mx-auto"}>
      {children}
    </main>
  );
}
