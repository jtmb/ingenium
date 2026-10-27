import React, { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import EmailList from "../src/app/mail/components/EmailList";

afterEach(cleanup);
const messages = ["First test", "Second test"].map((subject, index) => ({ uid: String(index), subject, date: "2026-10-26T12:00:00Z" }));
function Mailbox() {
  const [query, setQuery] = useState("");
  const emails = messages.filter(m => m.subject.toLowerCase().includes(query.toLowerCase()));
  return <><button onClick={() => setQuery("")}>Switch mailbox</button><EmailList emails={emails} total={emails.length} page={1} loading={false} onSelect={() => {}} onPageChange={() => {}} onSearch={setQuery} searchQuery={query} /></>;
}
describe("visible mail search state", () => {
  it("clears the active filter and restores the inbox rows", () => {
    render(<Mailbox />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search emails" }), { target: { value: "First" } });
    expect(screen.getAllByTestId("email-row")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain("search results across all folders");
    fireEvent.click(screen.getByRole("button", { name: "Clear email search" }));
    expect((screen.getByRole("textbox", { name: "Search emails" }) as HTMLInputElement).value).toBe("");
    expect(screen.getAllByTestId("email-row")).toHaveLength(2);
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("clears the displayed search when the parent changes mailboxes", () => {
    render(<Mailbox />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search emails" }), { target: { value: "First" } });
    fireEvent.click(screen.getByRole("button", { name: "Switch mailbox" }));
    expect((screen.getByRole("textbox", { name: "Search emails" }) as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Clear email search" })).toBeNull();
    expect(screen.getAllByTestId("email-row")).toHaveLength(2);
  });
});
