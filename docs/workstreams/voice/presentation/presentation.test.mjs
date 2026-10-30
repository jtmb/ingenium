import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callPresentation } from './call-presentation.mjs';

const idle = Object.freeze({ connected: true, disabled: false, busy: false, monitoring: false,
  recording: false, playing: false, paused: false, retainedCapture: false, sessionState: '', utteranceState: '' });
const cases = [
  [{},'idle','Microphone off'],
  [{sessionState:'listening'},'idle','Microphone off'],
  [{connected:false,playing:true,monitoring:true},'offline','Service disconnected'],
  [{paused:true,playing:true},'attention','Check the original voice session'],
  [{sessionState:'uncertain',monitoring:true},'attention','Check the original voice session'],
  [{utteranceState:'uncertain',playing:true},'attention','Check the original voice session'],
  [{retainedCapture:true},'attention','Recording retained'],
  [{sessionState:'stopping',playing:true},'stopping','Stopping voice activity'],
  [{sessionState:'interruption_pending',recording:true,monitoring:true},'stopping','Stopping voice activity'],
  [{disabled:true,monitoring:true},'paused','Voice admission paused'],
  [{busy:true},'starting','Starting voice'],
  [{monitoring:true},'listening','Listening'],
  [{monitoring:true,recording:true},'listening','Listening to you'],
  [{recording:true},'idle','Microphone off'],
  [{playing:true},'speaking','Speaking'],
  [{playing:true,monitoring:true},'speaking','Speaking'],
  [{utteranceState:'transcribing'},'transcribing','Transcribing'],
  [{utteranceState:'admitting'},'thinking','Thinking'],
  [{utteranceState:'awaiting_reply',monitoring:true},'thinking','Thinking'],
  [{sessionState:'awaiting_reply'},'thinking','Thinking'],
  [{utteranceState:'synthesizing'},'preparing','Preparing voice reply'],
  [{utteranceState:'awaiting_playback',sessionState:'speaking'},'playback-pending','Playback waiting'],
  [{sessionState:'processing'},'processing','Processing voice turn'],
  [{sessionState:'stopped'},'ended','Voice ended'],
  [{sessionState:'unexpected-new-state'},'idle','Microphone off'],
];
for (const [observed,phase,label] of cases) test(`actual observation ${JSON.stringify(observed)} → ${phase}`,()=>{
  const input=Object.freeze({...idle,...observed});const before=JSON.stringify(input);
  const result=callPresentation(input); assert.equal(result.phase,phase); assert.equal(result.label,label);
  assert.equal(JSON.stringify(input),before); assert.ok(result.detail.length>0);
  assert.deepEqual(Object.keys(result).sort(),['detail','label','phase']);
});
test('pending audio is never reported as speaking without the local playback observation',()=>{
  for (const utteranceState of ['synthesizing','awaiting_playback','completed']) {
    assert.notEqual(callPresentation({...idle,utteranceState,sessionState:'speaking'}).phase,'speaking');
  }
});
test('disconnect or admission pause does not claim the observed microphone already stopped',()=>{
  for (const overrides of [{connected:false},{disabled:true}]) {
    assert.equal(callPresentation({...idle,...overrides,monitoring:true}).detail,'Microphone release pending');
    assert.equal(callPresentation({...idle,...overrides}).detail,'Microphone off');
  }
});
