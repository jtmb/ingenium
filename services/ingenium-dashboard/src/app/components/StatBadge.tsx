import React from "react";

type StatBadgeProps = {
  label: string;
  value: string | number;
  color?: string;
};

export default function StatBadge({ label, value, color = "gray" }: StatBadgeProps) {
  return (
    <span className="text-sm text-gray-600">
      {label}: <strong className={`text-${color}-600`}>{value}</strong>
    </span>
  );
}
