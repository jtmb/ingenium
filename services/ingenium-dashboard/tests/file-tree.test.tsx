import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import FileTree from "../src/app/components/FileTree";

const longFilePath = "references/nested/very-long-folder-name-that-must-not-widen-the-modal/wide-markdown.md";

describe("FileTree", () => {
  afterEach(cleanup);

  it("renders semantic folders and files with keyboard expansion and selection state", () => {
    const onSelectFile = vi.fn();
    render(
      <FileTree
        fileTreeJson={JSON.stringify({ [longFilePath]: "# Wide markdown" })}
        skillContent="# Skill"
        skillName="layout-skill"
        onSelectFile={onSelectFile}
        selectedFile="SKILL.md"
      />,
    );

    const folder = screen.getByRole("button", { name: "Collapse references" });
    expect(folder.tagName).toBe("BUTTON");
    expect(folder.getAttribute("aria-expanded")).toBe("true");
    expect(folder.getAttribute("aria-controls")).toBeTruthy();

    fireEvent.keyDown(folder, { key: "ArrowLeft" });
    expect(screen.getByRole("button", { name: "Expand references" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: `Open ${longFilePath}` })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand references" }));
    const file = screen.getByRole("button", { name: `Open ${longFilePath}` });
    expect(file.tagName).toBe("BUTTON");
    expect(file.getAttribute("title")).toBe(longFilePath);

    fireEvent.click(file);
    expect(onSelectFile).toHaveBeenCalledWith(longFilePath, "# Wide markdown");
  });

  it("marks the active file for assistive technology", () => {
    render(
      <FileTree
        fileTreeJson={JSON.stringify({ "references/guide.md": "# Guide" })}
        skillContent="# Skill"
        skillName="layout-skill"
        onSelectFile={vi.fn()}
        selectedFile="references/guide.md"
      />,
    );

    expect(screen.getByRole("button", { name: "Open references/guide.md" }).getAttribute("aria-current")).toBe("page");
  });
});
