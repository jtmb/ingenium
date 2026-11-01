/** Data verification only; original Core readiness/material owner supplies the bound candidate admission. */
export function verifyCandidateAgentMaterial(material:unknown,admission:unknown,agentName:string,now?:number):unknown;
export function candidateAgentOverlay(material:unknown,admission:unknown,agentName:string,now?:number):Readonly<{agents:Record<string,unknown>}>;
