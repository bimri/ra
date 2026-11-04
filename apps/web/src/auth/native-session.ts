import { pocket,type PocketClient } from "../pocket";

const b64=(value:Uint8Array)=>{let s="";for(const b of value)s+=String.fromCharCode(b);return btoa(s)};
const text=(s:string)=>new TextEncoder().encode(s);
const current=(check:()=>boolean)=>{if(!check())throw new Error("The local copy was locked.")};

/** No account key is retained here. Old APKs keep their existing browser-only copy. */
export class NativeSessionClient {
  private support:Promise<boolean> | null=null;
  constructor(private readonly client:PocketClient){}
  supports():Promise<boolean> {
    return this.support ??= this.client.request("runtime.info",{}).then(result=>{
      if(!result.ok){if(result.error.code==="unsupported")return false;this.support=null;throw new Error(result.error.message)}
      return result.value.accountSessionsSupported===true;
    });
  }
  async importKey(account:string,raw:Uint8Array,isCurrent:()=>boolean):Promise<boolean> {
    if(!await this.supports())return false;
    current(isCurrent);if(raw.byteLength!==32)throw new Error("Unsupported local key size.");
    const result=await this.client.request("account.import",{account,key:b64(raw)});
    current(isCurrent);
    if(!result.ok)throw new Error(result.error.message);
    if(result.value?.account!==account)throw new Error("Android returned a different account.");
    return true;
  }
  async prove(account:string,key:CryptoKey,isCurrent:()=>boolean):Promise<boolean> {
    if(!await this.supports())return false;
    current(isCurrent);
    const challenge=await this.client.request("account.challenge",{account});
    current(isCurrent);
    if(!challenge.ok)throw new Error(challenge.error.message);
    const nonce=challenge.value?.challenge;
    if(typeof nonce!=="string"||!/^[a-f0-9]{64}$/.test(nonce))throw new Error("Android returned an invalid unlock challenge.");
    const iv=crypto.getRandomValues(new Uint8Array(12));const plain=text(nonce);
    let data:ArrayBuffer;
    try{data=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:text(`ra-pocket-session:${account}:${nonce}`)},key,plain)}finally{plain.fill(0)}
    current(isCurrent);
    const result=await this.client.request("account.prove",{account,challenge:nonce,iv:b64(iv),data:b64(new Uint8Array(data))});
    current(isCurrent);
    if(!result.ok)throw new Error(result.error.message);
    if(result.value?.account!==account)throw new Error("Android returned a different account.");
    return true;
  }
}
const links=new WeakMap<PocketClient,NativeSessionClient>();
export async function nativeAccountLink():Promise<NativeSessionClient|null> {
  const client=await pocket();if(!client)return null;
  let link=links.get(client);if(!link){link=new NativeSessionClient(client);links.set(client,link)}
  return link;
}
