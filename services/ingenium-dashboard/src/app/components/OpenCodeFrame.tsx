"use client";

import { usePathname } from "next/navigation";

export default function OpenCodeFrame() {
  const pathname = usePathname();
  const isOpenCode = pathname === "/opencode";

  return (
    <div className={`fixed inset-0 top-[57px] ${isOpenCode ? "" : "hidden"}`}>
      <iframe
        src="http://localhost:4098/"
        className="w-full h-full border-0"
        title="OpenCode"
        allow="clipboard-write"
      />
    </div>
  );
}
