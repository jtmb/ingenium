import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import CreateItemModal from "../src/app/secrets/components/CreateItemModal";

afterEach(cleanup);

describe("CreateItemModal select accessibility", () => {
  it("gives Type and Folder their visible-label accessible names", () => {
    render(
      <CreateItemModal
        isOpen
        onClose={() => undefined}
        onCreated={() => undefined}
        project="vault-ui-test"
        folders={[{ id: "folder-1", name: "Personal", item_count: 0, created_at: "2026-01-01T00:00:00.000Z" }]}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Type" }).getAttribute("id")).toBe("vault-item-type");
    expect(screen.getByRole("combobox", { name: "Folder" }).getAttribute("id")).toBe("vault-item-folder");
  });
});
