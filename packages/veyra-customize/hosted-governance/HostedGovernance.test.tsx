import {afterEach,describe,expect,it,vi} from "vitest";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {HostedGovernance} from "./HostedGovernance";
import {fixture,baseSkill,baseProposal,originalBinding} from "./__tests__/fixture";
vi.mock("react-markdown",()=>({default:({children}:{children:string})=><pre>{children}</pre>}));
vi.mock("remark-gfm",()=>({default:()=>undefined}));
afterEach(cleanup);
async function ready(){await screen.findByRole("button",{name:/release.*Installed.*disabled/});}
async function edit(){fireEvent.click(await screen.findByRole("button",{name:/release.*Installed.*disabled/}));fireEvent.click(await screen.findByRole("button",{name:"Edit selected file"}));}
function markdown(){return "---\nname: new-skill\ndescription: New\n---\n# New";}
describe("portable original-bound hosted governance",()=>{
  it("is visibly unavailable without an original transport and never invents an endpoint",()=>{
    render(<HostedGovernance/>);expect(screen.getByText("Hosted governance unavailable")).toBeTruthy();
  });
  it("shows disabled installed metadata and preserves actual record IDs/revisions",async()=>{
    const {transport,state}=fixture();render(<HostedGovernance transport={transport}/>);await ready();
    fireEvent.click(screen.getByRole("button",{name:/release.*Installed.*disabled/}));
    expect(await screen.findByText(/ID skill-id · revision 3/)).toBeTruthy();
    expect(state.reads.some(c=>c.op==="catalog")).toBe(true);expect(state.sends.length).toBe(0);
  });
  it("retains the exact editor draft and source metadata after a proven owner refusal",async()=>{
    const {transport,state}=fixture();state.send=async original=>({original,outcome:"refused",error:{status:403,message:"Save denied by owner"}});
    render(<HostedGovernance transport={transport}/>);await ready();await edit();
    fireEvent.change(screen.getByRole("textbox",{name:"Edit SKILL.md"}),{target:{value:"# Exact draft  \n"}});
    fireEvent.click(screen.getByRole("button",{name:"Save exact draft"}));
    await screen.findByText(/Save refused: Save denied by owner/);
    expect((screen.getByRole("textbox",{name:"Edit SKILL.md"}) as HTMLTextAreaElement).value).toBe("# Exact draft  \n");
    expect(state.sends.length).toBe(1);expect(state.sends[0].command).toMatchObject({op:"save",target:{id:baseSkill.id,revision:3},extra:{files:baseSkill.file_tree,tags:baseSkill.tags}});
  });
  it("blocks uncertain upload replay and inspects the exact retained original read-only",async()=>{
    const {transport,state}=fixture();state.send=async original=>({original,outcome:"unknown",error:{message:"Network outcome unknown"}});
    render(<HostedGovernance transport={transport}/>);await ready();fireEvent.click(screen.getByText("Upload a skill"));
    fireEvent.change(screen.getByRole("textbox",{name:"Review Markdown"}),{target:{value:markdown()}});
    fireEvent.click(screen.getByRole("button",{name:"Upload reviewed Markdown"}));
    await screen.findByText(/Upload outcome is unknown/);
    expect((screen.getByRole("button",{name:"Upload reviewed Markdown"}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button",{name:"Inspect last original receipt"}));
    await waitFor(()=>expect(state.inspections.length).toBe(1));
    expect(state.sends.length).toBe(1);expect(state.originals.length).toBe(1);
  });
  it("refuses an existing-name upload before the legacy upsert can clear references",async()=>{
    const {transport,state}=fixture();render(<HostedGovernance transport={transport}/>);await ready();fireEvent.click(screen.getByText("Upload a skill"));
    fireEvent.change(screen.getByRole("textbox",{name:"Review Markdown"}),{target:{value:"---\nname: release\ndescription: Replacement\n---\n# Replacement"}});
    fireEvent.click(screen.getByRole("button",{name:"Upload reviewed Markdown"}));
    await screen.findByText(/This name already exists/);expect(state.reservations.length).toBe(0);expect(state.sends.length).toBe(0);
    expect(state.skills[0].file_tree).toBe(baseSkill.file_tree);
  });
  it("distinguishes acknowledged create from malformed response and does not offer another write",async()=>{
    const {transport,state}=fixture();state.send=async original=>({original,outcome:"succeeded",value:{broken:true}});
    render(<HostedGovernance transport={transport}/>);await ready();fireEvent.click(screen.getByText("Upload a skill"));
    fireEvent.change(screen.getByRole("textbox",{name:"Review Markdown"}),{target:{value:markdown()}});
    fireEvent.click(screen.getByRole("button",{name:"Upload reviewed Markdown"}));
    await screen.findByText(/acknowledged creation, but/);
    expect((screen.getByRole("button",{name:"Upload reviewed Markdown"}) as HTMLButtonElement).disabled).toBe(true);
    expect(state.sends.length).toBe(1);
  });
  it("requires explicit grounded approval and retains reviewed proposal metadata in the original",async()=>{
    const {transport,state}=fixture();render(<HostedGovernance transport={transport}/>);await ready();
    fireEvent.click(screen.getByRole("button",{name:"Proposals",exact:true}));
    fireEvent.click(await screen.findByRole("button",{name:/release.*update.*pending/}));
    await screen.findByText("Current target");expect(screen.getByText(/Grounded observation/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Approve & apply"}));
    expect(state.sends.length).toBe(0);
    fireEvent.click(screen.getByRole("button",{name:"Confirm exact change"}));
    await waitFor(()=>expect(state.sends.length).toBe(1));
    expect(state.sends[0].command).toMatchObject({op:"approve",id:baseProposal.id,reviewed:{status:"pending",expectedRevision:3,updatedAt:baseProposal.updatedAt}});
  });
  it("shows trigger acknowledgement without claiming batch completion or changing model defaults",async()=>{
    const {transport,state}=fixture();render(<HostedGovernance transport={transport}/>);await ready();
    fireEvent.click(screen.getByRole("button",{name:"Synthesis",exact:true}));
    const trigger=await screen.findByRole("button",{name:"Review synthesis trigger"});await waitFor(()=>expect((trigger as HTMLButtonElement).disabled).toBe(false));fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button",{name:"Confirm exact change"}));
    await screen.findByText(/Synthesis trigger acknowledged/);
    expect(state.sends[0].command).toEqual({op:"synthesis-run"});expect(screen.getByText("No completion recorded")).toBeTruthy();
    expect(state.sends.length).toBe(1);
  });
  it("keeps History selected across a new bound owner while discarding old proposal rows",async()=>{
    const first=fixture(),second=fixture({...originalBinding,actorId:"next-actor",hostedProjectId:"next-hosted-project",apiProject:"next-namespace",epoch:"reader-2"});
    first.state.proposals[0].status="rejected";second.state.proposals[0]={...second.state.proposals[0],status:"rejected",targetName:"New owner history"};
    const view=render(<HostedGovernance transport={first.transport}/>);await ready();
    fireEvent.click(screen.getByRole("button",{name:"Proposals",exact:true}));
    fireEvent.click(await screen.findByRole("button",{name:/History/}));
    await screen.findByRole("button",{name:/release.*update.*rejected/});
    view.rerender(<HostedGovernance transport={second.transport}/>);
    expect(await screen.findByRole("button",{name:/New owner history.*update.*rejected/})).toBeTruthy();
    expect(screen.queryByRole("button",{name:/release.*update.*rejected/})).toBeNull();
  });
  it("prevents dispatch when a prepared original outlives the current reader",async()=>{
    const {transport,state}=fixture();let finish!:()=>void;
    state.reserveHook=()=>new Promise<void>(resolve=>{finish=resolve;});
    const view=render(<HostedGovernance transport={transport}/>);await ready();await edit();
    fireEvent.change(screen.getByRole("textbox",{name:"Edit SKILL.md"}),{target:{value:"# Wanted"}});
    fireEvent.click(screen.getByRole("button",{name:"Save exact draft"}));
    await waitFor(()=>expect(state.reservations.length).toBe(1));view.unmount();
    await act(async()=>{finish();});expect(state.sends.length).toBe(0);expect(state.originals.length).toBe(1);
  });
});

it("cannot display a late previous-owner catalog after a transport rebind",async()=>{
  const first=fixture(),second=fixture({...originalBinding,actorId:"new-actor",hostedProjectId:"new-hosted",epoch:"new-reader"});
  first.state.skills[0].name="Old private resource";
  let complete!:(value:unknown)=>void;
  first.state.reply=command=>command.op==="catalog"?new Promise(resolve=>{complete=resolve;}):first.response(command);
  const view=render(<HostedGovernance transport={first.transport}/>);
  await waitFor(()=>expect(first.state.reads.some(c=>c.op==="catalog")).toBe(true));
  view.rerender(<HostedGovernance transport={second.transport}/>);
  await ready();
  await act(async()=>{complete(first.response({op:"catalog",kind:"skill",offset:0,limit:100}));});
  expect(screen.queryByRole("button",{name:/Old private resource/})).toBeNull();
  expect(screen.getByRole("button",{name:/release.*Installed.*disabled/})).toBeTruthy();
});
