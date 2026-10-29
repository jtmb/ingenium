import type { DotSnapshot, Schedule, MissedPolicy, Followup } from "../../../../../../packages/veyra-automation/contracts.js";
export type DotUICommand =
 | {type:"approve";id:string;revision:number;input:{jobId:string;schedule:Schedule;missedPolicy:MissedPolicy;notificationPolicy:Followup["notificationPolicy"]}}
 | {type:"dismiss"|"cancel"|"read";id:string;revision:number}
 | {type:"pause";id:string;revision:number;paused:boolean};
export type DotActionResult = {ok:true;snapshot:DotSnapshot} | {ok:false;code:string;message:string;outcome:"known"|"unknown"};
export function operationLabel(state: string): string {
 const labels:Record<string,string>={claimed:"Queued by the job runner",running:"Running",success:"Completed",failed:"Failed",cancel_requested:"Cancellation requested",cancelled:"Cancelled",unknown:"Outcome unknown — inspect before retrying",skipped:"Missed run skipped",blocked:"Needs authorization or capacity"};
 return labels[state] ?? "Status unavailable";
}
export function scheduleLabel(schedule: Schedule): string {
 if(schedule.kind==="once")return `Once at ${schedule.at}`;
 if(schedule.kind==="interval")return `Every ${schedule.minutes} minutes from ${schedule.anchor}`;
 return `${String(schedule.hour).padStart(2,"0")}:${String(schedule.minute).padStart(2,"0")} · ${schedule.timeZone} · DST ${schedule.fold}`;
}
export function approvalSchedule(form: {kind:string;at:string;timeZone:string;hour:string;minute:string;fold:string}): Schedule {
 if(form.kind==="once"){
  if(!form.at.endsWith("Z") || !Number.isFinite(Date.parse(form.at)))throw Error("Enter a UTC timestamp ending in Z.");
  return {kind:"once",at:new Date(form.at).toISOString()};
 }
 if(form.kind!=="calendar")throw Error("Choose a supported schedule.");
 const hour=Number(form.hour),minute=Number(form.minute);
 if(!form.hour.length || !form.minute.length || !Number.isInteger(hour)||hour<0||hour>23||!Number.isInteger(minute)||minute<0||minute>59||!["earlier","later","both"].includes(form.fold)||!form.timeZone.trim())throw Error("Enter a valid local time, timezone and DST policy.");
 new Intl.DateTimeFormat("en-US",{timeZone:form.timeZone}).format(0);
 return {kind:"calendar",timeZone:form.timeZone,hour,minute,fold:form.fold as "earlier"|"later"|"both"};
}
