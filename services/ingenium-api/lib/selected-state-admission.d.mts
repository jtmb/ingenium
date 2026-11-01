export interface SelectedStateAdmission {
 run<T>(engineId:string,sessionId:string,effect:()=>T|Promise<T>):Promise<T>;
 write<T>(engineId:string,sessionId:string,effect:()=>T|Promise<T>):Promise<T>;
}
export function createSelectedStateAdmission(options?:{maxSlots?:number}):SelectedStateAdmission;
export function selectedSessionMutation(path:string,method?:string):string|null;
export const selectedStateAdmission:SelectedStateAdmission;
