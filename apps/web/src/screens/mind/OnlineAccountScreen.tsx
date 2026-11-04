import {useEffect,useRef,useState} from "preact/hooks";
import {passkeysAvailable,signIn,signInWithPassphrase} from "../../auth/passkey";
import {vaultAccount,vaultEpoch,closeVault} from "../../auth/vault";
import {BackHeader} from "../../ui/BackHeader";
import {go} from "../../ui/nav";
import {flushClips} from "../../store/clips";

/** Reauthenticate network work without replacing the unlocked local key or queued captures. */
export function OnlineAccountScreen() {
  const [phrase,setPhrase]=useState("");const [busy,setBusy]=useState(false);const [done,setDone]=useState(false);const [problem,setProblem]=useState("");
  const pending=useRef<AbortController|null>(null);
  useEffect(()=>()=>pending.current?.abort(),[]);
  async function open(passkey=false) {
    const account=vaultAccount();const epoch=vaultEpoch();if(!account)return;
    pending.current?.abort();const controller=new AbortController();pending.current=controller;setBusy(true);setProblem("");
    try {
      const identity=passkey?await signIn(controller.signal):await signInWithPassphrase(account,phrase,controller.signal);
      if(controller.signal.aborted||vaultAccount()!==account||vaultEpoch()!==epoch)return;
      if(identity.accountId!==account){closeVault();throw new Error("That sign-in belongs to a different Mind. The local copy has been locked.")}
      setPhrase("");setDone(true);void flushClips();
      localStorage.setItem("ra.account-session",JSON.stringify({account,nonce:crypto.randomUUID()}));
      window.dispatchEvent(new Event("ra-local-ready"));
    }catch(error){if(!controller.signal.aborted)setProblem(error instanceof Error?error.message:"Sign-in could not finish. Your queued words stay here.")}
    finally{if(!controller.signal.aborted)setBusy(false)}
  }
  return <div class="ui"><div class="pg" style={{position:"absolute",inset:0,padding:"22px 20px 28px",overflowY:"auto"}}>
    <BackHeader to="/mind" title="Your online Mind" purpose="Sign in again so this phone and your online Mind stay in step." />
    <h1 class="h1" style={{marginTop:"20px"}}>{done?"Signed in.":"Open your online Mind."}</h1>
    <p class="meta">{done?"You're signed in again. Thoughts waiting on this phone are sent now.":"Sign in again when the online session expires. This may differ from this phone's passphrase."}</p>
    {!done&&<div class="stack" style={{gap:"12px",marginTop:"20px"}}>
      <input class="field" type="password" aria-label="Ra account passphrase" autocomplete="current-password" disabled={busy} value={phrase} onInput={e=>setPhrase(e.currentTarget.value)}/>
      <button class="btn btn-ink" disabled={busy||!phrase} onClick={()=>void open()}>{busy?"Signing in…":"Sign in with Ra passphrase"}</button>
      {passkeysAvailable()&&<button class="btn btn-line" disabled={busy} onClick={()=>void open(true)}>Use my Ra passkey</button>}
    </div>}
    {problem&&<p class="meta" role="alert">{problem}</p>}
    <a href="/mind" onClick={go("/mind")} class="btn btn-line" style={{marginTop:"20px"}}>Back to your mind</a>
  </div></div>;
}
