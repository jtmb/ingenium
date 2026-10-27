import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
vi.mock("../src/lib/api", () => ({ dashboardFetch: (...args: Parameters<typeof fetch>) => fetch(...args), getApiBase: () => "/api/v1" }));
import AccountSetup from "../src/app/mail/components/AccountSetup";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function setup() {
  const requests: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
    const url = String(input);
    if (url.includes("/accounts/oauth/url?")) { requests.push(url); return new Response(JSON.stringify({error:{message:"Stop before test navigation"}}), {status:503,headers:{"Content-Type":"application/json"}}); }
    return new Response(JSON.stringify({data:{value:"configured-client-id"}}), {status:200,headers:{"Content-Type":"application/json"}});
  });
  render(<AccountSetup project="server-global" onComplete={() => {}} onCancel={() => {}} />);
  return requests;
}
describe("explicit OAuth mail ownership", () => {
  it("shows private ownership before the Gmail redirect", async () => {
    const requests = setup();
    expect((screen.getByRole("combobox", {name:"Owner"}) as HTMLSelectElement).value).toBe("user");
    fireEvent.click(screen.getByRole("button", {name:"Gmail Connect with Google"}));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(new URL(requests[0]!, "http://test").searchParams.get("owner_kind")).toBe("user");
  });
  it("uses organization ownership only after the user explicitly selects it", async () => {
    const requests = setup();
    fireEvent.change(screen.getByRole("combobox", {name:"Owner"}), {target:{value:"organization"}});
    fireEvent.click(screen.getByRole("button", {name:"Outlook Connect with Microsoft"}));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(new URL(requests[0]!, "http://test").searchParams.get("owner_kind")).toBe("organization");
  });
});
