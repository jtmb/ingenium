"use client";

export type EditorMode = "view" | "edit" | "source" | "split";

interface EditorToolbarProps {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  /** Called with a markdown syntax template string when a formatting button is clicked */
  onInsertMarkdown: (syntax: string) => void;
  showModeToggles?: boolean;
}

/** Reusable toolbar button — applies hover/active styling and aria-pressed for toggle states. */

function ToolButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="shrink-0 p-1 min-w-[28px] min-h-[28px] flex items-center justify-center rounded text-sm transition-colors
        text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
    >
      {children}
    </button>
  );
}

// ── Mode toggle ────────────────────────────────────────────────────────────────

function ModeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 px-2 py-0.5 text-xs rounded transition-colors
        ${active
          ? "bg-[var(--color-selection-bg)] text-[var(--color-accent)] font-medium"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
        }`}
    >
      {label}
    </button>
  );
}

/** SVG icon components for each formatting action — local inline SVGs avoid external deps. */

const Icons = {
  Heading1: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <text x="4" y="18" fontSize="15" fontWeight="bold" fontFamily="sans-serif">H1</text>
    </svg>
  ),
  Heading2: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <text x="4" y="18" fontSize="15" fontWeight="bold" fontFamily="sans-serif">H2</text>
    </svg>
  ),
  Heading3: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <text x="4" y="18" fontSize="15" fontWeight="bold" fontFamily="sans-serif">H3</text>
    </svg>
  ),
  Bold: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" /><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
    </svg>
  ),
  Italic: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="4" x2="10" y2="4" /><line x1="14" y1="20" x2="5" y2="20" /><line x1="15" y1="4" x2="9" y2="20" />
    </svg>
  ),
  BulletList: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  OrderedList: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="10" y1="6" x2="21" y2="6" /><line x1="10" y1="12" x2="21" y2="12" /><line x1="10" y1="18" x2="21" y2="18" /><path d="M4 6h1v4" /><path d="M4 10h2" /><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
    </svg>
  ),
  TaskList: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  ),
  Blockquote: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <text x="4" y="18" fontSize="16" fontWeight="bold" fontFamily="serif">&ldquo;</text>
    </svg>
  ),
  Code: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  Link: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  ),
  Image: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
    </svg>
  ),
  Table: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  ),
  HorizontalRule: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="12" x2="20" y2="12" />
    </svg>
  ),
};

/** Formatting buttons — each has a syntax template string that is passed to onInsertMarkdown. */

interface FormatButton {
  label: string;
  title: string;
  icon: React.ReactNode;
  syntax: string;
}

const FORMAT_BUTTONS: FormatButton[] = [
  { label: "H1", title: "Heading 1", icon: <Icons.Heading1 />, syntax: "# " },
  { label: "H2", title: "Heading 2", icon: <Icons.Heading2 />, syntax: "## " },
  { label: "H3", title: "Heading 3", icon: <Icons.Heading3 />, syntax: "### " },
  { label: "B", title: "Bold", icon: <Icons.Bold />, syntax: "**text**" },
  { label: "I", title: "Italic", icon: <Icons.Italic />, syntax: "*text*" },
  { label: "•", title: "Bullet List", icon: <Icons.BulletList />, syntax: "- " },
  { label: "1.", title: "Numbered List", icon: <Icons.OrderedList />, syntax: "1. " },
  { label: "☐", title: "Task List", icon: <Icons.TaskList />, syntax: "- [ ] " },
  { label: "\u201C", title: "Blockquote", icon: <Icons.Blockquote />, syntax: "> " },
  { label: "</>", title: "Code Block", icon: <Icons.Code />, syntax: "```\ncode\n```" },
  { label: "🔗", title: "Link", icon: <Icons.Link />, syntax: "[text](url)" },
  { label: "🖼️", title: "Image", icon: <Icons.Image />, syntax: "![alt](url)" },
  { label: "📊", title: "Table", icon: <Icons.Table />, syntax: "| Col 1 | Col 2 |\n|-------|-------|\n|       |       |" },
  { label: "—", title: "Horizontal Rule", icon: <Icons.HorizontalRule />, syntax: "\n---\n" },
];

const MODE_OPTIONS: { mode: EditorMode; label: string }[] = [
  { mode: "view", label: "View" },
  { mode: "edit", label: "Edit" },
  { mode: "source", label: "Source" },
  { mode: "split", label: "Split" },
];

/**
 * EditorToolbar — formatting buttons (left) + mode toggle buttons (right).
 * Formatting buttons are only visible in edit/source/split modes.
 * Mode toggles can be hidden via showModeToggles for embedded use cases.
 */
const EditorToolbar: React.FC<EditorToolbarProps> = ({
  mode,
  onModeChange,
  onInsertMarkdown,
  showModeToggles = true,
}) => {
  return (
    <div
      className="flex items-center gap-0.5 px-2 py-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] overflow-x-auto"
      role="toolbar"
      aria-label="Editor toolbar"
      style={{ height: "36px" }}
    >
      {/* Formatting buttons — only shown in edit/source/split modes */}
      {(mode === "edit" || mode === "source" || mode === "split") && (
        <>
          {FORMAT_BUTTONS.map((btn) => (
            <ToolButton
              key={btn.label}
              onClick={() => onInsertMarkdown(btn.syntax)}
              title={btn.title}
            >
              {btn.icon}
            </ToolButton>
          ))}
          <div className="w-px h-5 bg-[var(--color-border)] mx-1 shrink-0" />
        </>
      )}

      {/* Spacer pushes mode toggles to the right */}
      <div className="flex-1" />

      {/* Mode toggles */}
      {showModeToggles && (
        <div className="flex items-center gap-1 shrink-0">
          {MODE_OPTIONS.map((opt) => (
            <ModeButton
              key={opt.mode}
              active={mode === opt.mode}
              onClick={() => onModeChange(opt.mode)}
              label={opt.label}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default EditorToolbar;
