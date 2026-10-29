import React from "react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {ProjectExecutionPicker} from "../src/app/components/projects-v2/ProjectExecutionPicker";
import {TerminalPanel} from "../src/app/components/projects-v2/TerminalPanel";
import {ProjectActions} from "../src/app/components/projects-v2/ProjectActions";
import type {ProjectRef,ExecutionChoice,TerminalView} from "../../../packages/veyra-projects/contracts";

const project:ProjectRef={version:1,id:"project",scope:{instanceId:"install",organizationId:"org",ownerUserId:"alice"},
  label:"Alpha",revision:1,archived:false,archivedAt:null,pinned:false,roots:[],
  source:{system:"ingenium",instanceId:"install",revision:1}};
const choice:ExecutionChoice={projectId:"project",label:"Windows",available:true,binding:{
  version:1,id:"native",kind:"windows",hostId:"pc",environmentId:"native",workspaceBindingId:"mapped",
  canonicalRootId:"inode",directory:"C:/work",shellId:"pwsh",securityEpoch:1,workspaceIdentity:"workspace",
  mappingHash:"a".repeat(64),ownerInstanceId:"service",ownerRevision:1}};
afterEach(cleanup);
describe("project/execution controls",()=>{
  it("requires an explicit target after projectless selection and retains unavailable project state",()=>{
    const onChange=vi.fn();
    const view=render(<ProjectExecutionPicker projects={[project]} choices={[choice]}
      value={{projectId:"project",bindingId:"native"}} onChange={onChange}/>);
    fireEvent.change(screen.getByLabelText("Project"),{target:{value:""}});
    expect(onChange).toHaveBeenCalledWith({projectId:null,bindingId:null});
    view.rerender(<ProjectExecutionPicker projects={[]} choices={[]}
      value={{projectId:"project",bindingId:"native"}} onChange={onChange}/>);
    expect(screen.getByRole("option",{name:"Selected project unavailable"})).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("unavailable");
    expect(onChange).toHaveBeenCalledTimes(1);
  });
  it("does not move an offline selected host to an available target",()=>{
    const onChange=vi.fn();
    render(<ProjectExecutionPicker projects={[project]} choices={[{...choice,available:false,reason:"Host offline"},
      {...choice,binding:{...choice.binding,id:"another"},label:"Another host"}]}
      value={{projectId:"project",bindingId:"native"}} onChange={onChange}/>);
    expect((screen.getByLabelText("Execution target") as HTMLSelectElement).value).toBe("native");
    expect(screen.getByRole("status").textContent).toBe("Host offline");
    expect(onChange).not.toHaveBeenCalled();
  });
});
describe("terminal original input",()=>{
  const terminal:TerminalView={id:"term",revision:3,title:"PowerShell",state:"running",
    output:"ready",gap:false,inputState:"idle"};
  it("retains draft and blocks replay after unknown acknowledgement",async()=>{
    const onInput=vi.fn().mockResolvedValue("unknown");
    render(<TerminalPanel bindingKey="native" available terminals={[terminal]} activeId="term"
      pending={false} error={null} onSelect={vi.fn()} onOpen={vi.fn()} onInput={onInput}
      onResize={vi.fn()} onClose={vi.fn()}/>);
    fireEvent.change(screen.getByLabelText("Terminal input"),{target:{value:"git status"}});
    fireEvent.click(screen.getByRole("button",{name:"Send"}));
    await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("outcome unknown"));
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onInput).toHaveBeenCalledWith("term","git status\r");
    expect((screen.getByLabelText("Terminal input") as HTMLInputElement).value).toBe("git status");
    expect((screen.getByRole("button",{name:"Send"}) as HTMLButtonElement).disabled).toBe(true);
  });
  it("shows durable unknown state after remount and disables creation when unavailable",()=>{
    render(<TerminalPanel bindingKey="native" available={false} terminals={[{...terminal,inputState:"unknown"}]}
      activeId="term" pending={false} error={null} onSelect={vi.fn()} onOpen={vi.fn()} onInput={vi.fn()}
      onResize={vi.fn()} onClose={vi.fn()}/>);
    expect((screen.getByRole("button",{name:"Send"}) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button",{name:"New terminal"}) as HTMLButtonElement).disabled).toBe(true);
  });
});
describe("reviewed project actions",()=>{
  it("uses saved action IDs and owner capabilities for worktree controls",()=>{
    const onRun=vi.fn();
    render(<ProjectActions actions={[{id:"reviewed-test",label:"Run tests",kind:"test",enabled:true}]}
      worktrees={[{id:"tree",label:"Isolated checkout",state:"unknown",revision:2,canArchive:false,
        canRestore:false,reason:"Original operation unresolved"}]} pending={false} error={null}
      canCreateWorktree={false} canAttachWorktree={false} onRun={onRun} onCreateWorktree={vi.fn()}
      onAttachWorktree={vi.fn()} onArchiveWorktree={vi.fn()} onRestoreWorktree={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button",{name:"Run tests"}));
    expect(onRun).toHaveBeenCalledWith("reviewed-test");
    expect((screen.getByRole("button",{name:"New worktree"}) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button",{name:"Archive"}) as HTMLButtonElement).disabled).toBe(true);
  });
});
