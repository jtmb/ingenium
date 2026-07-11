import React from "react";

type ToolbarProps = {
  children: React.ReactNode;
  className?: string;
};

export default function Toolbar({ children, className = "" }: ToolbarProps) {
  return (
    <div
      className={`bg-white border rounded p-3 hover:shadow-md transition-shadow space-y-3 ${className}`}
    >
      {children}
    </div>
  );
}
