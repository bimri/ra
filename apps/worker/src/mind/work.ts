import {isSealed,type Cipher} from "../crypto/seal";
/** Durable workflow history carries only account-encrypted, operation-bound payloads. */
export function sealWork<T>(cipher:Cipher,purpose:string,value:T):string {
  return cipher.seal(JSON.stringify({version:1,purpose,value}));
}
export function openWork<T>(cipher:Cipher,purpose:string,sealed:string):T {
  if(!isSealed(sealed))throw new Error("Private work must be sealed.");
  const result=JSON.parse(cipher.open(sealed)) as {version?:unknown;purpose?:unknown;value?:T};
  if(result.version!==1||result.purpose!==purpose||result.value===undefined)throw new Error("This private work belongs to another operation.");
  return result.value;
}
export interface WatchDay {
  /** First snapshot time; optional for already-sealed legacy workflow history. */
  at?:number;
  throughSeq:number;
  said:{utteranceId:string;text:string}[];
  exchanges:{said:string;line:string}[];
  raysWithoutTrips:string[];
  memories:string[];
  tz:number;
}
