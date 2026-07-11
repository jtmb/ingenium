"use client";

import React from "react";

type EmptyStateProps = {
  message: string;
  subtitle?: string;
  action?: { label: string; onClick: () => void };
  variant?: "default" | "error" | "loading";
};

export default function EmptyState({
  message,
  subtitle,
  action,
  variant = "default",
}: EmptyStateProps) {
  if (variant === "error") {
    return (
      <div className="bg-red-50 border border-red-200 rounded p-6 text-center text-red-600 text-sm">
        <p>{message}</p>
        {action && (
          <button
            onClick={action.onClick}
            className="mt-2 text-red-700 underline hover:text-red-800 text-xs"
          >
            {action.label}
          </button>
        )}
      </div>
    );
  }

  if (variant === "loading") {
    return (
      <div className="bg-gray-50 border rounded p-12 text-center text-gray-400">
        <p>{message}</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 border rounded p-12 text-center text-gray-400">
      <p className="text-lg font-medium mb-1">{message}</p>
      {subtitle && <p className="text-sm">{subtitle}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 bg-blue-600 text-white py-2 px-4 rounded text-sm font-medium hover:bg-blue-700"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
