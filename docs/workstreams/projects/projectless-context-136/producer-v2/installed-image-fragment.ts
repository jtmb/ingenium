/** Additive export in the EXISTING root-owned Core126 policy loader. No new approval source. */
export function loadInstalledWorkspaceRuntimeV2ImageDefinition(imageId:string):unknown {
 const policy=readProtected(POLICY_FILE,64*1024),raw=parseStrictJobJson(policy,64*1024) as {schemaVersion?:unknown;approvedImages?:Array<Core126ImageApproval>};
 if(raw.schemaVersion!==1||!Array.isArray(raw.approvedImages)||raw.approvedImages.length<1||raw.approvedImages.length>32)return deny();
 const rows=raw.approvedImages.filter(row=>row.imageId===imageId);if(rows.length!==1)return deny();const approval=rows[0]!;
 if(!/^sha256:[a-f0-9]{64}$/.test(imageId)||!/^[a-f0-9]{64}$/.test(approval.manifestSha256)||approval.validUntil<=Date.now())return deny();
 const bytes=readProtected(POLICY_DIRECTORY+'/'+approval.manifestSha256+'.json',2*1024*1024);
 if(digest(bytes)!==approval.manifestSha256)return deny();
 const definition=workspaceV2ImageDefinition(parseStrictJobJson(bytes,2*1024*1024),approval);
 if(digest(readProtected(POLICY_FILE,64*1024))!==digest(policy))return deny();return definition;
}
