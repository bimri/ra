import {useEffect,useRef,useState} from "preact/hooks";
import {exportMind,type ExportSink} from "../../store/export";
import {localSession,checkLocalSession} from "../../store/db";
import {chooseExportSink} from "../../pocket/export";
import {BackHeader} from "../../ui/BackHeader";
import {go} from "../../ui/nav";

export function ExportScreen() {
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const [progress,setProgress]=useState<{records:number;total:number;bytes:number}|null>(null);const action=useRef<AbortController|null>(null);
  useEffect(()=>()=>action.current?.abort(),[]);
  async function save(mode:"all"|"phone") {
    const controller=new AbortController();action.current=controller;setBusy(true);setMessage("");setProgress(null);
    let sink:ExportSink|undefined;
    try {
      const scope=localSession();sink=await chooseExportSink(controller.signal);checkLocalSession(scope);
      const result=await exportMind(sink,{mode,signal:controller.signal,progress:setProgress});
      if(!controller.signal.aborted)setMessage(`${mode==="all"?"Your online Mind and this phone’s copy":"This phone’s copy"} exported. ${result.records} local records included, with the original media held here.`);
    }catch(error){await sink?.abort().catch(()=>{});if(!controller.signal.aborted)setMessage((error instanceof Error?error.message:"Export could not finish.")+" Discard an incomplete export file before trying again. Your original work stays here.")}
    finally{if(action.current===controller&&!controller.signal.aborted)setBusy(false)}
  }
  return <div class="ui"><div class="pg" style={{position:"absolute",inset:0,padding:"22px 20px 28px",overflowY:"auto"}}>
    <BackHeader to="/mind" title="Take it all with you" purpose="Everything Ra holds about you, in one file you keep." />
    <p class="meta" style={{marginTop:"20px"}}>Full export adds your online Mind, voice clips and evidence media.</p>
    <p class="meta">This file contains private words and original media outside Ra’s lock. Choose where to save it and keep it private. Exporting does not upload the recordings or photos held here.</p>
    {!busy?<div class="stack" style={{gap:"12px",marginTop:"20px"}}><button class="btn btn-ink" onClick={()=>void save("all")}>Export online Mind and this phone</button><button class="btn btn-line" onClick={()=>void save("phone")}>Export only this phone · works offline</button></div>:<div class="stack" style={{gap:"12px",marginTop:"20px"}}><p class="meta" role="status">{progress?`${progress.records} / ${progress.total} local records · ${(progress.bytes/1_000_000).toFixed(1)} MB written`:"Choose where to save the export…"}</p><button class="btn btn-line" onClick={()=>{action.current?.abort();setBusy(false);setMessage("Export stopped. Discard any incomplete export file. Your original work stays here.")}}>Stop export</button></div>}
    {message&&<p class="meta" role="status" style={{marginTop:"20px"}}>{message}</p>}
    <a href="/mind/sign-in" onClick={go("/mind/sign-in")} class="btn btn-line" style={{marginTop:"20px"}}>Sign in to my online Mind</a>
  </div></div>;
}
