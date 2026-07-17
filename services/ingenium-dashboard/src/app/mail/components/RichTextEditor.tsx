"use client";

import { useEditor, EditorContent, Mark } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import { forwardRef, useImperativeHandle, useRef, useEffect } from "react";

// Augment ChainedCommands with custom command names
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontFamily: {
      setFontFamily: (family: string) => ReturnType;
      unsetFontFamily: () => ReturnType;
    };
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
    textColor: {
      setTextColor: (color: string) => ReturnType;
      unsetTextColor: () => ReturnType;
    };
    indent: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
  }
}

/**
 * Custom TipTap Mark extensions for email-safe formatting:
 * - FontFamily, FontSize: rendered as inline `style` attributes on <span>.
 * - TextColor: uses <span style="color: ..."> instead of legacy <font color>.
 * - Indent: tracked as data-indent attribute + padding-left, increments by 20px.
 *
 * NOTE: These use Mark.create (inline styling) rather to Node.create because
 * the formatting should be applied character-level, not block-level.
 * The TypeScript `commands` return `any` because TipTap's ChainedCommands is
 * not typed for custom commands — this is expected upstream behavior.
 */

const FontFamily = Mark.create({
  name: "fontFamily",
  addAttributes() {
    return { fontFamily: { default: "" } };
  },
  parseHTML() {
    return [{ style: "font-family" }];
  },
  renderHTML({ mark }) {
    const family = mark.attrs.fontFamily;
    if (!family) return ["span", 0];
    return ["span", { style: `font-family: ${family}` }, 0];
  },
  addCommands(): any {
    return {
      setFontFamily:
        (family: string) =>
        ({ commands }: any) => {
          if (!family) return commands.unsetMark(this.name);
          return commands.setMark(this.name, { fontFamily: family });
        },
      unsetFontFamily:
        () =>
        ({ commands }: any) =>
          commands.unsetMark(this.name),
    };
  },
});

const FontSize = Mark.create({
  name: "fontSize",
  addAttributes() {
    return { fontSize: { default: "" } };
  },
  parseHTML() {
    return [{ style: "font-size" }];
  },
  renderHTML({ mark }) {
    const size = mark.attrs.fontSize;
    if (!size) return ["span", 0];
    return ["span", { style: `font-size: ${size}` }, 0];
  },
  addCommands(): any {
    return {
      setFontSize:
        (size: string) =>
        ({ commands }: any) => {
          if (!size) return commands.unsetMark(this.name);
          return commands.setMark(this.name, { fontSize: size });
        },
      unsetFontSize:
        () =>
        ({ commands }: any) =>
          commands.unsetMark(this.name),
    };
  },
});

const TextColor = Mark.create({
  name: "textColor",
  addAttributes() {
    return { color: { default: "" } };
  },
  parseHTML() {
    return [{ style: "color" }];
  },
  renderHTML({ mark }) {
    const c = mark.attrs.color;
    if (!c) return ["span", 0];
    return ["span", { style: `color: ${c}` }, 0];
  },
  addCommands(): any {
    return {
      setTextColor:
        (color: string) =>
        ({ commands }: any) => {
          if (!color) return commands.unsetMark(this.name);
          return commands.setMark(this.name, { color });
        },
      unsetTextColor:
        () =>
        ({ commands }: any) =>
          commands.unsetMark(this.name),
    };
  },
});

const Indent = Mark.create({
  name: "indent",
  addAttributes() {
    return { level: { default: 0 } };
  },
  parseHTML() {
    return [{ tag: "span[data-indent]" }];
  },
  renderHTML({ mark }) {
    const level = Number(mark.attrs.level) || 0;
    if (level <= 0) return ["span", 0];
    return [
      "span",
      {
        "data-indent": String(level),
        style: `padding-left: ${level * 20}px; display: inline-block;`,
      },
      0,
    ];
  },
  addCommands(): any {
    return {
      indent:
        () =>
        ({ chain, editor }: any) => {
          const current = editor.getAttributes("indent").level || 0;
          return chain()
            .setMark("indent", { level: current + 1 })
            .run();
        },
      outdent:
        () =>
        ({ chain, editor }: any) => {
          const current = editor.getAttributes("indent").level || 0;
          if (current <= 1) return chain().unsetMark("indent").run();
          return chain()
            .setMark("indent", { level: current - 1 })
            .run();
        },
    };
  },
});

// ---------------------------------------------------------------------------
// Font family options (email-safe)
// ---------------------------------------------------------------------------
const FONT_OPTIONS = [
  { label: "Default", value: "" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Helvetica", value: "Helvetica, sans-serif" },
  { label: "Times New Roman", value: '"Times New Roman", serif' },
  { label: "Courier New", value: '"Courier New", monospace' },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Verdana", value: "Verdana, sans-serif" },
];

const FONT_SIZE_OPTIONS = [
  { label: "Default", value: "" },
  { label: "12px", value: "12px" },
  { label: "14px", value: "14px" },
  { label: "16px", value: "16px" },
  { label: "18px", value: "18px" },
  { label: "20px", value: "20px" },
  { label: "24px", value: "24px" },
  { label: "32px", value: "32px" },
];

const PRESET_COLORS = [
  { label: "Black", value: "#000000" },
  { label: "Red", value: "#e53e3e" },
  { label: "Blue", value: "#3182ce" },
  { label: "Green", value: "#38a169" },
  { label: "Gray", value: "#718096" },
];

// ---------------------------------------------------------------------------
// Toolbar button component
// ---------------------------------------------------------------------------
function ToolbarButton({
  onClick,
  isActive = false,
  title,
  children,
  disabled = false,
}: {
  onClick: () => void;
  isActive?: boolean;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={isActive}
      title={title}
      className={`shrink-0 p-1 min-w-[32px] min-h-[32px] flex items-center justify-center rounded text-sm transition-colors
        ${isActive ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"}
        ${disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// SVG icon components
// ---------------------------------------------------------------------------
const Icons = {
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
  Underline: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3" /><line x1="4" y1="21" x2="20" y2="21" />
    </svg>
  ),
  Strike: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.3 4.8a5 5 0 0 0-10.6 0C5.3 8.3 8.6 11 12 11h0" /><line x1="4" y1="12" x2="20" y2="12" />
      <path d="M6.7 19.2a5 5 0 0 0 10.6 0c1.4-3.5-1.9-6.2-5.3-6.2h0" />
    </svg>
  ),
  AlignLeft: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="17" y1="10" x2="3" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="17" y1="14" x2="3" y2="14" /><line x1="21" y1="18" x2="3" y2="18" />
    </svg>
  ),
  AlignCenter: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="10" x2="6" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="18" y1="14" x2="6" y2="14" /><line x1="21" y1="18" x2="3" y2="18" />
    </svg>
  ),
  AlignRight: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="21" y1="10" x2="7" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="7" y2="14" /><line x1="21" y1="18" x2="3" y2="18" />
    </svg>
  ),
  AlignJustify: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="21" y1="10" x2="3" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="21" y1="18" x2="3" y2="18" />
    </svg>
  ),
  Indent: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="7 8 3 12 7 16" /><line x1="21" y1="12" x2="11" y2="12" /><line x1="21" y1="6" x2="11" y2="6" /><line x1="21" y1="18" x2="11" y2="18" />
    </svg>
  ),
  Outdent: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 8 21 12 17 16" /><line x1="3" y1="12" x2="13" y2="12" /><line x1="3" y1="6" x2="13" y2="6" /><line x1="3" y1="18" x2="13" y2="18" />
    </svg>
  ),
  Undo: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  ),
  Redo: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  ),
  ClearFormat: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" />
    </svg>
  ),
  TextColor: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 7 12 7 20 7" /><polyline points="7 21 12 10 17 21" /><line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  ),
};

// ---------------------------------------------------------------------------
// RichTextEditor component (forwardRef to expose editor API)
// ---------------------------------------------------------------------------
export interface RichTextEditorHandle {
  getHTML: () => string;
  getText: () => string;
}

/**
 * RichTextEditor — TipTap-based WYSIWYG editor for email composition.
 * Exposes getHTML/getText via forwardRef for imperative access (used by EmailComposer).
 *
 * isInternalChange ref prevents cursor-jump when an external change (SmartSuggest
 * draft, AI review apply) sets `value` while the editor is the source of truth.
 * Without this guard, the `useEffect` below would reset cursor position on every keystroke.
 *
 * Color picker uses a hidden <input type="color"> triggered by a visible swatch button.
 */
const RichTextEditor = forwardRef<RichTextEditorHandle, {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
}>(({ value, onChange, placeholder = "Write your message...", minHeight = "120px" }, ref) => {
  const isInternalChange = useRef(false);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      TextStyle,
      TextAlign.configure({
        types: ["heading", "paragraph"],
        alignments: ["left", "center", "right", "justify"],
      }),
      FontFamily,
      FontSize,
      TextColor,
      Indent,
    ],
    content: value,
    onUpdate: ({ editor }) => {
      isInternalChange.current = true;
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: `prose prose-sm max-w-none focus:outline-none min-h-[${minHeight}]`,
        style: `min-height: ${minHeight}; padding: 12px;`,
      },
    },
  });

  /**
   * Sync external value changes (SmartSuggest draft selection, AI review apply)
   * into TipTap without resetting cursor. Uses isInternalChange ref to distinguish
   * user-typed changes (already reflected in editor content) from programmatic ones.
   * PERF: No debounce needed — setContent is cheap for reasonable email body sizes.
   */
  useEffect(() => {
    if (editor && !isInternalChange.current) {
      const current = editor.getHTML();
      if (value !== current) {
      editor.commands.setContent(value);
      }
    }
    isInternalChange.current = false;
  }, [value, editor]);

  // Expose editor API to parent via ref
  useImperativeHandle(ref, () => ({
    getHTML: () => editor?.getHTML() ?? "",
    getText: () => editor?.getText() ?? "",
  }), [editor]);

  /** TipTap is async (dynamic import of prosemirror). The editor is null during mount
   *  — show a placeholder that matches the editor's visual height to avoid layout shift. */
  if (!editor) {
    return (
      <div
        className="border border-[var(--color-border)] rounded"
        style={{ minHeight }}
      >
        <div className="flex items-center justify-center" style={{ minHeight }}>
          <span className="text-sm text-[var(--color-text-muted)]">Loading editor...</span>
        </div>
      </div>
    );
  }

  // Active state helpers
  const isActive = (name: string, attrs?: Record<string, any>) =>
    editor.isActive(name, attrs);

  const getActiveFontFamily = () => {
    const attrs = editor.getAttributes("fontFamily");
    return (attrs.fontFamily as string) || "";
  };

  const getActiveFontSize = () => {
    const attrs = editor.getAttributes("fontSize");
    return (attrs.fontSize as string) || "";
  };

  const getActiveTextColor = () => {
    const attrs = editor.getAttributes("textColor");
    return (attrs.color as string) || "";
  };

  const getActiveIndent = () => {
    const attrs = editor.getAttributes("indent");
    return (attrs.level as number) || 0;
  };

  const getActiveTextAlign = () => {
    if (editor.isActive({ textAlign: "left" })) return "left";
    if (editor.isActive({ textAlign: "center" })) return "center";
    if (editor.isActive({ textAlign: "right" })) return "right";
    if (editor.isActive({ textAlign: "justify" })) return "justify";
    return "";
  };

  return (
    <div className="border border-[var(--color-border)] rounded overflow-hidden">
      {/* Toolbar — single row, horizontal scroll, never wraps */}
      <div
        className="flex items-center gap-0.5 px-2 py-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] overflow-x-auto"
        role="toolbar"
        aria-label="Formatting toolbar"
      >
        {/* Undo */}
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Undo"
        >
          <Icons.Undo />
        </ToolbarButton>

        {/* Redo */}
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Redo"
        >
          <Icons.Redo />
        </ToolbarButton>

        {/* Separator */}
        <div className="w-px h-5 bg-[var(--color-border)] mx-1 shrink-0" />

        {/* Font Family */}
        <select
          value={getActiveFontFamily()}
          onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
          className="shrink-0 text-xs border border-[var(--color-border)] rounded px-1 py-0.5 min-h-[32px] bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] cursor-pointer min-w-[80px]"
          title="Font family"
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        {/* Font Size */}
        <select
          value={getActiveFontSize()}
          onChange={(e) => editor.chain().focus().setFontSize(e.target.value).run()}
          className="shrink-0 text-xs border border-[var(--color-border)] rounded px-1 py-0.5 min-h-[32px] bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] cursor-pointer min-w-[60px]"
          title="Font size"
        >
          {FONT_SIZE_OPTIONS.map((s) => (
            <option key={s.label} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        {/* Separator */}
        <div className="w-px h-5 bg-[var(--color-border)] mx-1 shrink-0" />

        {/* Bold */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={isActive("bold")}
          title="Bold"
        >
          <Icons.Bold />
        </ToolbarButton>

        {/* Italic */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={isActive("italic")}
          title="Italic"
        >
          <Icons.Italic />
        </ToolbarButton>

        {/* Underline */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          isActive={isActive("underline")}
          title="Underline"
        >
          <Icons.Underline />
        </ToolbarButton>

        {/* Strike */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={isActive("strike")}
          title="Strikethrough"
        >
          <Icons.Strike />
        </ToolbarButton>

        {/* Text Color */}
        <div className="flex items-center gap-0.5 shrink-0">
          {PRESET_COLORS.map((c) => (
            <ToolbarButton
              key={c.value}
              onClick={() => editor.chain().focus().setTextColor(c.value).run()}
              isActive={getActiveTextColor() === c.value}
              title={`Text color: ${c.label}`}
            >
              <span
                className="w-4 h-4 rounded-full border border-[var(--color-border)]"
                style={{ backgroundColor: c.value }}
              />
            </ToolbarButton>
          ))}
          {/* Color picker fallback */}
          <span className="relative inline-flex items-center">
            <button
              type="button"
              onClick={() => colorInputRef.current?.click()}
              title="Custom color"
              className="shrink-0 w-6 h-6 rounded-full border border-[var(--color-border)] hover:ring-2 hover:ring-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none cursor-pointer"
              style={{ backgroundColor: getActiveTextColor() || "#000000" }}
              aria-label="Custom color"
            />
            <input
              ref={colorInputRef}
              type="color"
              className="sr-only"
              value={getActiveTextColor() || "#000000"}
              onChange={(e) =>
                editor.chain().focus().setTextColor(e.target.value).run()
              }
              tabIndex={-1}
            />
          </span>
        </div>

        {/* Separator */}
        <div className="w-px h-5 bg-[var(--color-border)] mx-1 shrink-0" />

        {/* Text Align */}
        {(["left", "center", "right", "justify"] as const).map((align) => {
          const icons: Record<string, React.ReactNode> = {
            left: <Icons.AlignLeft />,
            center: <Icons.AlignCenter />,
            right: <Icons.AlignRight />,
            justify: <Icons.AlignJustify />,
          };
          return (
            <ToolbarButton
              key={align}
              onClick={() => editor.chain().focus().setTextAlign(align).run()}
              isActive={getActiveTextAlign() === align}
              title={`Align ${align}`}
            >
              {icons[align]}
            </ToolbarButton>
          );
        })}

        {/* Separator */}
        <div className="w-px h-5 bg-[var(--color-border)] mx-1 shrink-0" />

        {/* Indent / Outdent */}
        <ToolbarButton
          onClick={() => editor.chain().focus().indent().run()}
          isActive={getActiveIndent() > 0}
          title="Increase indent"
        >
          <Icons.Indent />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().outdent().run()}
          disabled={getActiveIndent() <= 0}
          title="Decrease indent"
        >
          <Icons.Outdent />
        </ToolbarButton>

        {/* Separator */}
        <div className="w-px h-5 bg-[var(--color-border)] mx-1 shrink-0" />

        {/* Clear formatting */}
        <ToolbarButton
          onClick={() =>
            editor.chain().focus().clearNodes().unsetAllMarks().run()
          }
          title="Clear formatting"
        >
          <Icons.ClearFormat />
        </ToolbarButton>
      </div>

      {/* Editor content area */}
      <EditorContent editor={editor} />
    </div>
  );
});

RichTextEditor.displayName = "RichTextEditor";

export default RichTextEditor;
