import React from "react";

type BadgeColor =
  | "blue"
  | "green"
  | "red"
  | "yellow"
  | "purple"
  | "gray"
  | "amber"
  | "emerald"
  | "cyan"
  | "pink"
  | "orange"
  | "teal"
  | "slate"
  | "indigo";

type BadgeProps = {
  children: React.ReactNode;
  color?: BadgeColor;
  variant?: "outline" | "solid";
  size?: "xs" | "sm";
  className?: string;
};

const OUTLINE_CLASSES: Record<BadgeColor, string> = {
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  green: "bg-green-50 text-green-700 border-green-200",
  red: "bg-red-50 text-red-700 border-red-200",
  yellow: "bg-yellow-50 text-yellow-700 border-yellow-200",
  purple: "bg-purple-50 text-purple-700 border-purple-200",
  gray: "bg-gray-50 text-gray-600 border-gray-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cyan: "bg-cyan-50 text-cyan-700 border-cyan-200",
  pink: "bg-pink-50 text-pink-700 border-pink-200",
  orange: "bg-orange-50 text-orange-700 border-orange-200",
  teal: "bg-teal-50 text-teal-700 border-teal-200",
  slate: "bg-slate-50 text-slate-700 border-slate-200",
  indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
};

const SOLID_CLASSES: Record<BadgeColor, string> = {
  blue: "bg-blue-100 text-blue-700",
  green: "bg-green-100 text-green-700",
  red: "bg-red-100 text-red-700",
  yellow: "bg-yellow-100 text-yellow-700",
  purple: "bg-purple-100 text-purple-700",
  gray: "bg-gray-100 text-gray-700",
  amber: "bg-amber-100 text-amber-700",
  emerald: "bg-emerald-100 text-emerald-700",
  cyan: "bg-cyan-100 text-cyan-700",
  pink: "bg-pink-100 text-pink-700",
  orange: "bg-orange-100 text-orange-700",
  teal: "bg-teal-100 text-teal-700",
  slate: "bg-slate-100 text-slate-700",
  indigo: "bg-indigo-100 text-indigo-700",
};

export default function Badge({
  children,
  color = "gray",
  variant = "outline",
  size = "xs",
  className = "",
}: BadgeProps) {
  const sizeClass = size === "sm" ? "text-sm px-2.5 py-1" : "text-xs px-2 py-0.5";
  const variantClass =
    variant === "solid" ? SOLID_CLASSES[color] : `${OUTLINE_CLASSES[color]} border`;

  return (
    <span className={`rounded inline-block ${sizeClass} ${variantClass} ${className}`}>
      {children}
    </span>
  );
}
