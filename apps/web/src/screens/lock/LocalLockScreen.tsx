import { useState,useRef,useEffect } from "preact/hooks";
import { hasVault, openVault, closeVault,hasVaultPasskey,openVaultWithPasskey } from "../../auth/vault";
import { rememberedAccount, unlock } from "../../auth/lock";
import { devPerson } from "../../store/device";
import { migrateLocal } from "../../store/db";
import { passkeysAvailable, signIn, signInWithPassphrase } from "../../auth/passkey";

export function LocalLockScreen() {
  const account = rememberedAccount() ?? devPerson();
  const setup = !hasVault(account);
  const [phrase, setPhrase] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [passkey, setPasskey] = useState(false);
  const [problem, setProblem] = useState("");
  const pending=useRef<AbortController|null>(null);
  useEffect(()=>()=>{if(pending.current){pending.current.abort();pending.current=null;closeVault()}},[]);
  async function open(localPasskey=false) {
    if(pending.current){pending.current.abort();closeVault()}const controller=new AbortController();pending.current=controller;
    setBusy(true); setProblem("");
    try {
      if (!localPasskey&&setup && phrase !== again) throw new Error("The passphrases don't match.");
      if (setup && rememberedAccount()) {
        const identity = passkey ? await signIn(controller.signal) : await signInWithPassphrase(account, phrase,controller.signal);
        if (identity.accountId !== account) throw new Error("That is a different Ra account.");
      }
      if(controller.signal.aborted)return;
      if(localPasskey)await openVaultWithPasskey(account,controller.signal);else await openVault(account, phrase);
      if(controller.signal.aborted)return;
      await migrateLocal();
      if(controller.signal.aborted)return;
      setPhrase("");setAgain("");
      pending.current=null;
      unlock();
      window.dispatchEvent(new Event("ra-local-ready"));
    } catch (error) {
      if(!controller.signal.aborted){closeVault();setProblem(error instanceof Error ? error.message : "The local copy could not open.")}
    } finally {if(pending.current===controller)pending.current=null;if(!controller.signal.aborted)setBusy(false)}
  }
  return <div class="ui"><div class="pg" style={{ padding: "32px 20px", display: "flex", flexDirection: "column", gap: "16px", overflowY: "auto" }}>
    <h1 class="h1">{setup ? "Lock this copy." : "Ra is locked."}</h1>
    <p class="meta">{setup ? (passkeysAvailable() ? "Use your Ra passphrase for this encrypted copy, or verify with a passkey and choose a local passphrase. Keep it safe: it cannot be recovered. You can use it offline." : "Use your Ra passphrase for this encrypted copy. Keep it safe: it cannot be recovered. You can use it offline. If you created your account with a passkey, open Ra in that browser.") : "Your passphrase opens the copy on this phone, even offline."}</p>
    {setup && rememberedAccount() && passkeysAvailable() && <label class="meta"><input type="checkbox" checked={passkey} onChange={(e) => setPasskey(e.currentTarget.checked)} /> Verify my account with a passkey</label>}
    <input class="field" type="password" aria-label="Local passphrase" autocomplete={setup ? "new-password" : "current-password"} value={phrase} onInput={(e) => setPhrase(e.currentTarget.value)} />
    {setup && <input class="field" type="password" aria-label="Local passphrase again" autocomplete="new-password" value={again} onInput={(e) => setAgain(e.currentTarget.value)} />}
    {problem && <p class="meta" role="alert">{problem}</p>}
    {!setup&&hasVaultPasskey(account)&&passkeysAvailable()&&<button class="btn btn-line" disabled={busy} onClick={()=>void open(true)}>Unlock this copy with my passkey</button>}
    <button class="btn btn-ink" disabled={busy || !phrase || (setup && phrase.trim().length < 10)} onClick={() => void open()}>{busy ? "Opening…" : setup ? "Encrypt this copy" : "Unlock"}</button>
  </div></div>;
}
