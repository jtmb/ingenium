"use client";

import { VaultItem } from "../../../lib/api";
import { badgeTones, BADGE_BASE } from "../../../lib/badgeTones";

interface ItemListProps {
  items: VaultItem[];
  selectedItem: VaultItem | null;
  onSelectItem: (item: VaultItem) => void;
  onCreateItem: () => void;
}

/** Map item types to badge hues for consistent colour coding. */
const TYPE_HUE: Record<string, string> = {
  login: "blue",
  api_key: "red",
  note: "slate",
  oauth: "purple",
};

const TYPE_LABEL: Record<string, string> = {
  login: "Login",
  api_key: "API Key",
  note: "Note",
  oauth: "OAuth",
};

/**
 * ItemList — center pane of the Secrets page.
 *
 * Displays vault items filtered by the selected folder.
 * Each item shows name, type badge, and tags.
 * Includes a "+ New Item" button at the top.
 */
export default function ItemList({
  items,
  selectedItem,
  onSelectItem,
  onCreateItem,
}: ItemListProps) {
  return (
    <>
      {/* Header with create button */}
      <div className="px-3 py-3 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          Items
        </h3>
        <button
          onClick={onCreateItem}
          className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
        >
          + New Item
        </button>
      </div>

      {/* Item list */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)] px-3 py-4 text-center">
            No items in this folder.
          </p>
        ) : (
          items.map((item) => {
            const isSelected = selectedItem?.id === item.id;
            const tags = item.tags
              ? item.tags.split(",").map((t) => t.trim()).filter(Boolean)
              : [];

            return (
              <button
                key={item.id}
                onClick={() => onSelectItem(item)}
                className={`w-full text-left px-3 py-2.5 border-b border-[var(--color-border-muted)] transition-colors ${
                  isSelected
                    ? "bg-[var(--color-selection-bg)]"
                    : "hover:bg-[var(--color-surface-hover)]"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`text-xs font-medium truncate ${
                      isSelected
                        ? "text-[var(--color-selection-text)]"
                        : "text-[var(--color-text-primary)]"
                    }`}
                  >
                    {item.name}
                  </span>
                  <span
                    className={`${BADGE_BASE} ${badgeTones(
                      TYPE_HUE[item.type] ?? "gray"
                    )} shrink-0`}
                  >
                    {TYPE_LABEL[item.type] ?? item.type}
                  </span>
                </div>
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {tags.map((tag, i) => (
                      <span
                        key={i}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            );
          })
        )}
      </div>
    </>
  );
}
