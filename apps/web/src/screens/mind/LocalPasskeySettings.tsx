import {useEffect,useRef,useState} from "preact/hooks";
import {passkeysAvailable} from "../../auth/passkey";
import {enableVaultPasskey,removeVaultPasskey,hasVaultPasskey,vaultAccount} from "../../auth/vault";

export function LocalPasskeySettings() {
  const owner=vaultAccount();const [enabled,setEnabled]=useState(owner?hasVaultPasskey(owner):false);const [phrase,setPhrase]=useState("");const [busy,setBusy]=useState(false);const [problem,setProblem]=useState("");const pending=useRef<AbortController|null>(null);
  useEffect(()=>()=>pending.current?.abort(),[]);
  if(!owner||!passkeysAvailable())return null;
  async function enable() {
    pending.current?.abort();const controller=new AbortController();pending.current=controller;setBusy(true);setProblem("");
    try{await enableVaultPasskey(phrase,controller.signal);if(!controller.signal.aborted){setEnabled(true);setPhrase("");setProblem("Your passkey can now open this local copy. Your local passphrase still works.")}}
    catch(error){if(!controller.signal.aborted)setProblem(error instanceof Error?error.message:"Use your local passphrase for now.")}
    finally{if(!controller.signal.aborted)setBusy(false)}
  }
  // I1 lists settings as rows; this one opens in place.
  return <details class="hair" style={{padding:"14px 0"}}><summary class="spread" style={{cursor:"pointer",listStyle:"none"}}><span style={{fontSize:"15px"}}>Unlock with a passkey</span><span class="meta">{enabled?"On":"Set up"}</span></summary><div class="stack" style={{gap:"10px",marginTop:"10px"}}>
    <p class="meta" style={{margin:0}}>Adds passkey unlock to this copy. Your passphrase still works.</p>
    {enabled?<button class="btn btn-line" onClick={()=>{try{removeVaultPasskey();setEnabled(false);setProblem("This local copy now opens with its passphrase. Your Ra account passkey is unchanged.")}catch(error){setProblem(error instanceof Error?error.message:"Try again.")}}}>Use only my local passphrase here</button>:<>
      <input class="field" type="password" aria-label="Current local passphrase" autocomplete="current-password" value={phrase} disabled={busy} onInput={e=>setPhrase(e.currentTarget.value)}/>
      <button class="btn btn-line" disabled={busy||!phrase} onClick={()=>void enable()}>{busy?"Checking your passkey…":"Enable local passkey unlock"}</button>
      {busy&&<button class="btn btn-line" onClick={()=>{pending.current?.abort();setBusy(false);setPhrase("")}}>Cancel</button>}
    </>}{problem&&<p class="meta" role="status">{problem}</p>}
  </div></details>;
}
