import { useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalWebController, type LocalWebPort, type WebState } from "./local-web-controller.mjs";
import { LocalWebPresentation } from "./LocalWebPresentation";
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(100,100,600,400));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fixture() {
  const actualOwner={installation_id:"actual-library",custodian_key:"actual-custodian",workspace_id:"11111111-1111-4111-8111-111111111111",revision:1,service_instance_id:"actual-instance",environment:{kind:"windows" as const}};
  const session_id="ses_"+"a".repeat(32), binding={kind:"qualified" as const,owner:actualOwner,session_id,binding_id:"native-binding",invalidation_epoch:"native-epoch"};
  const state=(visibility:WebState["visibility"]):WebState=>({binding_id:binding.binding_id,invalidation_epoch:binding.invalidation_epoch,visibility});
  const port:LocalWebPort={readBinding:vi.fn(async()=>binding),show:vi.fn(async()=>state("visible")),hide:vi.fn(async()=>state("hidden")),bounds:vi.fn(async()=>state("visible")),readState:vi.fn(async()=>state("hidden")),release:vi.fn(async()=>state("closed"))};
  const cleanupFailure=vi.fn(), refreshWork=vi.fn(async()=>{});
  const controller=new LocalWebController({actualOwner,sessionID:session_id,port,current:()=>true,refreshWork,cleanupFailure});
  return{port,controller,cleanupFailure,refreshWork};
}
describe("native child Web presentation adapter proposal",()=>{
  it("keeps the Work draft owner mounted while native show/hide retain one binding",async()=>{
    const f=fixture(),mounted=vi.fn(),disposed=vi.fn();
    function WorkOwner(){useEffect(()=>{mounted();return disposed;},[]);return <input aria-label="Retained Work draft" defaultValue="original"/>;}
    const view=render(<LocalWebPresentation controller={f.controller} scope="actual-owner/session" projectName="No project"><WorkOwner/></LocalWebPresentation>);
    const input=screen.getByLabelText("Retained Work draft");fireEvent.change(input,{target:{value:"Preserve exact draft"}});
    fireEvent.click(screen.getByRole("button",{name:"Web",exact:true}));
    await waitFor(()=>expect(f.port.show).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(screen.getByRole("button",{name:"Work",exact:true}).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button",{name:"Work",exact:true}));
    await waitFor(()=>expect(f.refreshWork).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("Retained Work draft")).toBe(input);expect((input as HTMLInputElement).value).toBe("Preserve exact draft");
    expect(mounted).toHaveBeenCalledTimes(1);expect(disposed).not.toHaveBeenCalled();
    expect(f.port.readBinding).toHaveBeenCalledTimes(1);expect(f.port.hide).toHaveBeenCalledTimes(1);expect(document.querySelector("iframe")).toBeNull();
    view.unmount();await waitFor(()=>expect(f.port.release).toHaveBeenCalledTimes(1));
  });
  it("shows a truthful unavailable host and never fabricates Web content",async()=>{
    const f=fixture();vi.mocked(f.port.readBinding).mockResolvedValue({kind:"unavailable",reason:"Original native host not qualified"});
    render(<LocalWebPresentation controller={f.controller} scope="actual-owner/session" projectName="No project"><input aria-label="Original draft" defaultValue="kept"/></LocalWebPresentation>);
    fireEvent.click(screen.getByRole("button",{name:"Web",exact:true}));await screen.findByText("Original native host not qualified");
    expect(f.port.show).not.toHaveBeenCalled();expect(document.querySelector("iframe")).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Return to Work"}));
    await waitFor(()=>expect((screen.getByLabelText("Original draft") as HTMLInputElement).value).toBe("kept"));
  });
  it("reports the retained native handle when unmount cleanup is not confirmed",async()=>{
    const f=fixture();vi.mocked(f.port.release).mockRejectedValue(Error("native close not confirmed"));
    const view=render(<LocalWebPresentation controller={f.controller} scope="actual-owner/session" projectName="No project"><p>Work owner</p></LocalWebPresentation>);
    fireEvent.click(screen.getByRole("button",{name:"Web",exact:true}));
    await waitFor(()=>expect(f.port.show).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(f.controller.getSnapshot().busy).toBe(false));view.unmount();
    await waitFor(()=>expect(f.cleanupFailure).toHaveBeenCalledWith("native-binding",expect.any(Error)));
  });
});
