import { test } from "node:test";
import assert from "node:assert/strict";
import { planDue } from "../lib/dot-v2/schedule.ts";
const daily = (hour, minute, fold="earlier", timeZone="America/Toronto") => ({kind:"calendar",timeZone,hour,minute,fold});
test("Toronto spring gap is skipped and next day retains local time", () => {
  const p = planDue(daily(2,30),"2026-03-08T00:00:00.000Z","2026-03-10T00:00:00.000Z","all");
  assert.deepEqual(p.due,["2026-03-09T06:30:00.000Z"]);
});
test("fold chooses earlier, later, or both without duplicate wall-time execution", () => {
  const window = ["2026-11-01T00:00:00.000Z","2026-11-02T00:00:00.000Z","all"];
  assert.deepEqual(planDue(daily(1,30),...window).due,["2026-11-01T05:30:00.000Z"]);
  assert.deepEqual(planDue(daily(1,30,"later"),...window).due,["2026-11-01T06:30:00.000Z"]);
  assert.equal(planDue(daily(1,30,"both"),...window).due.length,2);
  assert.deepEqual(planDue(daily(1,30),"2026-11-01T05:45:00.000Z",window[1],"all").due,[]);
});
test("non-hour fold and weekdays", () => {
  assert.deepEqual(planDue(daily(1,45,"later","Australia/Lord_Howe"),"2026-04-04T00:00:00.000Z","2026-04-05T00:00:00.000Z","all").due,["2026-04-04T15:15:00.000Z"]);
  assert.deepEqual(planDue({...daily(9,0,"earlier","UTC"),weekdays:[1]},"2026-10-25T00:00:00.000Z","2026-10-28T00:00:00.000Z","all").due,["2026-10-26T09:00:00.000Z"]);
});
test("missed runs skip, coalesce latest, or bounded catch-up; cursor is exclusive", () => {
  const s={kind:"interval",anchor:"2026-10-29T00:00:00.000Z",minutes:60};
  const args=["2026-10-29T00:00:00.000Z","2026-10-29T03:10:00.000Z"];
  assert.deepEqual(planDue(s,...args,"skip"),{due:[],skipped:3,through:args[1]});
  assert.deepEqual(planDue(s,...args,"latest").due,["2026-10-29T03:00:00.000Z"]);
  assert.equal(planDue(s,...args,"all").due.length,3);
  assert.deepEqual(planDue(s,args[1],args[1],"all").due,[]);
});
test("once, invalid inputs, clock reversal, excessive backlog fail without silent loss", () => {
  assert.deepEqual(planDue({kind:"once",at:"2026-10-29T03:00:00.000Z"},"2026-10-29T00:00:00.000Z","2026-10-29T04:00:00.000Z","latest").due,["2026-10-29T03:00:00.000Z"]);
  for (const s of [daily(25,0),daily(1,0,"bad"),daily(1,0,"earlier","Mars/City"),{kind:"interval",anchor:"bad",minutes:0}]) assert.throws(()=>planDue(s,"2026-10-29T00:00:00.000Z","2026-10-29T04:00:00.000Z","all"));
  assert.throws(()=>planDue(daily(9,0),"2026-10-29T00:00:00.000Z","2026-10-28T00:00:00.000Z","all"));
  assert.throws(()=>planDue(daily(9,0),"2026-10-01T00:00:00.000Z","2026-10-29T00:00:00.000Z","all"));
  assert.throws(()=>planDue({kind:"interval",anchor:"2026-10-29T00:00:00.000Z",minutes:1},"2026-10-29T00:00:00.000Z","2026-10-29T04:00:00.000Z","all"));
});
