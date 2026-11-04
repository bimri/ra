import {useEffect,useRef,useState} from "preact/hooks";
import {makeId,ROUTE_PROBLEMS,canRetryRoute,isPhoneEditKind,type RouteJob} from "@ra/core";
import {store,localSession,checkLocalSession} from "../../store/db";
import {routeRequest} from "../../store/routeWork";
import {api} from "../../store/device";
import {mind,useMind} from "../../store/mind";
import {BackHeader} from "../../ui/BackHeader";
import {go,navigate} from "../../ui/nav";
type Saved={operationId:string;circumstances:string};
const KEY="route.request";
export function RouteScreen(){
  const {views}=useMind();const [words,setWords]=useState(""),[saved,setSaved]=useState<Saved|null>(null),[job,setJob]=useState<RouteJob|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[problem,setProblem]=useState("");
  const [session]=useState(()=>localSession());const action=useRef<AbortController|null>(null),latest=useRef<{saved:Saved|null;job:RouteJob|null}>({saved:null,job:null});
  latest.current={saved,job};
  useEffect(()=>{
    const controller=new AbortController(),scope=session;
    const cancelUrl=api("/route/cancel");
    void (async()=>{try{const previous=await store.get<Saved>(KEY);checkLocalSession(scope);if(controller.signal.aborted)return;if(previous){setSaved(previous);setWords(previous.circumstances);setJob(await routeRequest(scope,"status",previous.operationId,{},controller.signal))}}catch(error){if(!controller.signal.aborted)setProblem(error instanceof Error?error.message:"The saved request could not load.")}finally{if(!controller.signal.aborted)setLoading(false)}})();
    return ()=>{controller.abort();action.current?.abort();const current=latest.current;if(current.saved&&(!current.job||current.job.state==="running"))void fetch(cancelUrl,{method:"POST",credentials:"include",keepalive:true,headers:{"content-type":"application/json","x-ra-account":scope.owner},body:JSON.stringify({operationId:current.saved.operationId})}).catch(()=>{})};
  },[]);
  useEffect(()=>{
    if(job?.state!=="running")return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const value=await routeRequest(session,"status",job.operationId,{},controller.signal);if(!controller.signal.aborted){setJob(value);if(value.state==="running")timer=setTimeout(()=>void poll(),750)}}catch(error){if(!controller.signal.aborted)setProblem(error instanceof Error?error.message:"The request could not be checked.")}};
    timer=setTimeout(()=>void poll(),500);return()=>{controller.abort();clearTimeout(timer)};
  },[job?.operationId,job?.state]);
  async function run(kind:"new"|"retry"|"cancel"|"accept"){
    if(action.current)return;const controller=new AbortController();action.current=controller;setBusy(true);setProblem("");
    try{
      const scope=session;checkLocalSession(scope);const copy=mind();let request=saved;
      if(kind==="accept"&&words.trim()!==saved?.circumstances)throw new Error("Your circumstances changed. Request a fresh proposal using these words.");
      if(kind!=="cancel"){
        await copy.sync();checkLocalSession(scope);
        if(copy.current.pending.some(edit=>isPhoneEditKind(edit.kind)))throw new Error("Your confirmed edits are still waiting to sync. Send them before considering or confirming a route.");
      }
      if(kind==="new"){
        if(!words.trim()||words.length>1000)throw new Error("Describe the time, tools and access you have in up to 1,000 characters.");
        request={operationId:makeId(),circumstances:words.trim()};await store.set(KEY,request);checkLocalSession(scope);setSaved(request);setJob(null);latest.current={saved:request,job:null};
      }
      if(!request)throw new Error("Start a route request first.");
      const value=await routeRequest(scope,kind==="new"||kind==="retry"?"propose":kind,request.operationId,kind==="new"||kind==="retry"?{circumstances:request.circumstances,retry:kind==="retry"}:{},controller.signal);
      checkLocalSession(scope);
      setJob(value);latest.current={saved:request,job:value};
      if(kind==="accept"&&value.state==="accepted"){
        await copy.sync();checkLocalSession(scope);navigate("/chart/island?island="+encodeURIComponent(value.acceptedIsland!));
      }
    }catch(error){if(!controller.signal.aborted)setProblem(error instanceof Error?error.message:"The route request could not complete.")}
    finally{if(action.current===controller)action.current=null;if(!controller.signal.aborted)setBusy(false)}
  }
  const proposal=job?.result?.kind==="proposal"?job.result.proposal:null;
  return <div class="ui"><div class="pg" style={{position:"absolute",inset:0,padding:"22px 20px 0",display:"flex",flexDirection:"column",overflowY:"auto"}}>
    <BackHeader to="/chart" title="Your next island" purpose="One capability on the way to your star, from what you’ve said and where the world is going." />
    <div class="h1" style={{marginTop:"20px",fontSize:"30px"}}>What can you reach?</div>
    {views.star.current?<p class="meta">{views.star.current}</p>:<p class="meta">Your star comes first, in your own words. <a href="/ray" onClick={go("/ray")} style={{textDecoration:"underline"}}>Find it in a Ray</a>.</p>}
    <textarea id="route-circumstances" class="field" rows={4} maxlength={1000} value={words} disabled={busy||job?.state==="running"} placeholder="Your available time, tools, connection and access. Mention limits too." onInput={event=>setWords(event.currentTarget.value)} />
    <p class="meta">Nothing is added to your Chart until you choose it. Leaving stops an unfinished request.</p>
    {loading&&<p class="meta" role="status">Checking the saved request…</p>}
    {job?.state==="running"&&<p class="meta" role="status">Considering your evidence and cited Horizon…</p>}
    {job?.problem&&<p class="meta" role="status">{ROUTE_PROBLEMS[job.problem]}</p>}
    {job?.state==="cancelled"&&<p class="meta">Request stopped. Your Chart is unchanged.</p>}
    {job?.result?.kind==="clarify"&&<p class="serif" style={{fontSize:"24px"}}>{job.result.question}</p>}
    {proposal&&<div class="card" style={{marginTop:"16px"}}>
      <div class="h2">{proposal.island}</div>
      <p class="meta">Limits: {proposal.circumstances}</p>
      {[["Inevitable",proposal.inevitable],["Adjacent",proposal.adjacent],["Yours",proposal.yours],["First step",proposal.firstStep]].map(([label,text])=><div class="row" key={label} style={{alignItems:"flex-start",gap:"12px"}}><span class="label" style={{width:"78px",flex:"none"}}>{label}</span><span>{text}</span></div>)}
      <details style={{marginTop:"12px"}}><summary>Your words and sources</summary>
        {proposal.evidence.map((evidence,index)=><blockquote key={index} class="serif">{evidence.quote}</blockquote>)}
        {proposal.horizon.map(source=><div key={source.id} style={{marginTop:"12px"}}><p>{source.text}</p><span class="label">Read {new Date(source.at).toLocaleDateString("en-GB")}</span>{source.sources.map(url=><a class="row" key={url} href={url} target="_blank" rel="noopener noreferrer" style={{overflowWrap:"anywhere"}}>{url}</a>)}</div>)}
      </details>
      <button class="btn btn-accent" disabled={busy||job?.state!=="ready"||words.trim()!==saved?.circumstances} onClick={()=>void run("accept")}>Put this island on my Chart</button>
    </div>}
    {problem&&<p class="meta" role="alert">{problem}</p>}
    <div style={{display:"flex",gap:"10px",flexWrap:"wrap",margin:"20px 0 30px"}}>
      <button class="btn btn-ink" disabled={loading||busy||job?.state==="running"||!words.trim()||!views.star.current} onClick={()=>void run("new")}>{proposal?"Consider another island":"Consider an island"}</button>
      {saved&&(!job||canRetryRoute(job))&&<button class="btn btn-line" disabled={busy||loading} onClick={()=>void run("retry")}>Retry saved request</button>}
      {saved&&job?.state!=="accepted"&&job?.state!=="cancelled"&&<button class="btn btn-line" disabled={busy||loading} onClick={()=>void run("cancel")}>Stop request</button>}
    </div>
  </div></div>;
}
