// WebAuthn3 PRF supplies 32 bytes. HKDF domain-separates this local AES-GCM wrapper.
export interface PrfWrapper {v:1;credentialId:string;rpId:string;salt:string;hkdfSalt:string;iv:string;data:string}
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
export const prfBytes=(text:string)=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
export function validPrf(value:unknown):value is PrfWrapper {
  if(!value||typeof value!=="object")return false;const p=value as PrfWrapper;
  return p.v===1&&typeof p.credentialId==="string"&&/^[A-Za-z0-9_-]{1,2048}$/.test(p.credentialId)&&typeof p.rpId==="string"&&p.rpId.length<=253&&/^[a-z0-9.-]+$/i.test(p.rpId)&&[p.salt,p.hkdfSalt].every(s=>typeof s==="string"&&/^[A-Za-z0-9+/]{43}=$/.test(s))&&typeof p.iv==="string"&&/^[A-Za-z0-9+/]{16}$/.test(p.iv)&&typeof p.data==="string"&&/^[A-Za-z0-9+/]{64}$/.test(p.data);
}
const context=(owner:string,credentialId:string,rpId:string)=>new TextEncoder().encode(`ra.local.prf.v1:${owner}:${rpId}:${credentialId}`);
async function key(secret:Uint8Array<ArrayBuffer>,salt:Uint8Array<ArrayBuffer>,info:Uint8Array<ArrayBuffer>) {
  if(secret.length!==32)throw new Error("This passkey did not provide a local encryption key.");
  const material=await crypto.subtle.importKey("raw",secret,"HKDF",false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"HKDF",hash:"SHA-256",salt,info},material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
export async function wrapWithPrf(owner:string,raw:Uint8Array<ArrayBuffer>,proof:{credentialId:string;rpId:string;prf:Uint8Array<ArrayBuffer>},salt:Uint8Array<ArrayBuffer>):Promise<PrfWrapper> {
  try {
    if(raw.length!==32||salt.length!==32)throw new Error("Invalid local key material.");
    const hkdfSalt=crypto.getRandomValues(new Uint8Array(32));const iv=crypto.getRandomValues(new Uint8Array(12));const aad=context(owner,proof.credentialId,proof.rpId);
    const wrapping=await key(proof.prf,hkdfSalt,aad);const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:aad},wrapping,raw);
    const result:PrfWrapper={v:1,credentialId:proof.credentialId,rpId:proof.rpId,salt:encode(salt),hkdfSalt:encode(hkdfSalt),iv:encode(iv),data:encode(new Uint8Array(encrypted))};
    if(!validPrf(result))throw new Error("Invalid passkey wrapping metadata.");
    const verified=new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv,additionalData:aad},wrapping,encrypted));
    try{if(verified.length!==32||!verified.every((v,i)=>v===raw[i]))throw new Error("The local key could not be verified.")}finally{verified.fill(0)}
    return result;
  }finally{proof.prf.fill(0)}
}
export async function unwrapWithPrf(owner:string,wrapped:PrfWrapper,secret:Uint8Array<ArrayBuffer>):Promise<Uint8Array<ArrayBuffer>> {
  try {
    if(!validPrf(wrapped))throw new Error("Invalid passkey wrapping metadata.");
    const aad=context(owner,wrapped.credentialId,wrapped.rpId);const wrapping=await key(secret,prfBytes(wrapped.hkdfSalt),aad);
    const raw=new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv:prfBytes(wrapped.iv),additionalData:aad},wrapping,prfBytes(wrapped.data)));
    if(raw.length!==32){raw.fill(0);throw new Error("The local key could not be verified.")}return raw;
  }finally{secret.fill(0)}
}
