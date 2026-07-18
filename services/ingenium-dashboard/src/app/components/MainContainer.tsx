"use client";

import { usePathname } from "next/navigation";

/**
 * Page-level layout wrapper.
 *
 * Pages get full-bleed or constrained-width layouts:
 * - `/opencode`, `/docs`, `/chat` → zero padding (immersive, fills entire viewport)
 * - `/mail`, `/tasks`, `/mail/*` → full-width with padding (3-pane mail, kanban board)
 * - Everything else → responsive constrained `max-w-screen-2xl` centered layout
 */
export default function MainContainer({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isImmersive = pathname === "/opencode" || pathname === "/docs" || pathname === "/chat";
  const fullWidth =
    pathname === "/mail" ||
    pathname === "/tasks" ||
    pathname.startsWith("/mail/");
  if (isImmersive) {
    return <main className="p-0">{children}</main>;
  }
  return (
    <main className={fullWidth ? "p-6" : "p-6 xl:px-8 w-full min-w-0 mx-auto max-w-screen-2xl"}>
      {children}
    </main>
  );
}
