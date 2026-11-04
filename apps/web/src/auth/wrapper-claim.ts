/** Serialize only the localStorage compare-and-create. No key/account records
 * are written to this coordination database, and no async crypto runs in its lock. */
export async function claimWrappedKey(name:string,candidate:string,current:()=>void):Promise<string>{
  const claim=()=>{current();const existing=localStorage.getItem(name);if(existing!==null)return existing;localStorage.setItem(name,candidate);return candidate};
  if(typeof indexedDB==="undefined"){
    if(typeof navigator!=="undefined"&&navigator.locks)return navigator.locks.request("ra-local-key-creation",claim);
    throw new Error("Browser storage is unavailable for safe local key setup.");
  }
  return new Promise((resolve,reject)=>{
    let database:IDBDatabase|null=null,transaction:IDBTransaction|null=null,settled=false;
    const finish=(error?:unknown,value?:string)=>{if(settled)return;settled=true;clearTimeout(timer);database?.close();if(error)reject(error);else resolve(value!)};
    const timer=setTimeout(()=>{try{transaction?.abort()}catch{}finish(new Error("Local key setup timed out. Close other Ra tabs and try again."))},10_000);
    const request=indexedDB.open("ra-key-coordination",1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains("creation"))request.result.createObjectStore("creation")};
    request.onerror=()=>finish(request.error??new Error("Local key storage is unavailable."));request.onblocked=()=>finish(new Error("Close other Ra tabs before setting up the local key."));
    request.onsuccess=()=>{
      database=request.result;if(settled){database.close();return}let winner:string|undefined;
      try{current();transaction=database.transaction("creation","readwrite");const query=transaction.objectStore("creation").get("compare-and-create");
        query.onsuccess=()=>{try{winner=claim()}catch(error){transaction!.abort();finish(error)}};
        transaction.oncomplete=()=>{try{current();finish(undefined,winner)}catch(error){finish(error)}};
        transaction.onabort=transaction.onerror=()=>finish(transaction!.error??new Error("Local key setup was interrupted."));
      }catch(error){finish(error)}
    };
  });
}
