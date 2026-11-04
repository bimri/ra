import {OPENINGS,developerMessage,spokenInstructions} from "@ra/prompts";
import {AUDIO_RATE,AUDIO_CODEC,FRAME_RA,RA_AUDIO_RATE,decodeWireAudio,encodeWireAudio} from "@ra/core";
import {RA_FRAME_SAMPLES} from "../mind/turns";
import {createVoice} from "../voice";
import {readSecret,secretOf,type Env} from "../env";
import {HttpMuse} from "./http";
import {createChecker} from "../mind/check";
import {decisions} from "../mind/decide";
import {MUSE_MODELS} from "./index";
import {ASR_MODEL} from "../transcribe/muse";
import {transcribeClip} from "../transcribe";
import {base64,wav} from "../transcribe/wav";

/**
 * Live Muse acceptance, one synthetic request per model. Off unless RA_PROBE_TOKEN is set,
 * and then only for that bearer token. Never reads a Mind or echoes provider bodies.
 */
interface Result{model:string;ok:boolean;ms:number;detail:string}

async function timed(model:string,run:()=>Promise<string>):Promise<Result>{
  const start=Date.now();
  try{const detail=await run();return {model,ok:true,ms:Date.now()-start,detail}}
  catch(error){return {model,ok:false,ms:Date.now()-start,detail:error instanceof Error?error.message.slice(0,800):"failed"}}
}

/** Muse Transcribe: authorize, stream two seconds of tone, end the stream and expect a clean close. */
async function transcribe(key:string):Promise<string>{
  const response=await fetch("https://api.meta.ai/v1/asr/realtime",{headers:{Upgrade:"websocket"},signal:AbortSignal.timeout(10_000)});
  if(response.status!==101||!response.webSocket)throw new Error(`ASR upgrade failed (${response.status})`);
  const ws=response.webSocket;ws.accept();
  return new Promise<string>((resolve,reject)=>{
    let session="",progress=0;
    const timer=setTimeout(()=>{try{ws.close(1000)}catch{};reject(new Error(session?"ASR did not close after endStream":"ASR never acknowledged the session"))},20_000);
    ws.addEventListener("message",event=>{
      if(typeof event.data!=="string")return;
      let value:Record<string,unknown>;try{value=JSON.parse(event.data) as Record<string,unknown>}catch{return}
      if(value.type==="error"){clearTimeout(timer);try{ws.close(1000)}catch{};reject(new Error("ASR reported an error"));return}
      if(!session&&typeof value.sessionId==="string"){
        session=value.sessionId;
        const pcm=Int16Array.from({length:AUDIO_RATE*2},(_,i)=>Math.round(Math.sin(i*.13)*4000));
        for(let at=0;at<pcm.length;at+=AUDIO_RATE/10)ws.send(new Int16Array(pcm.subarray(at,at+AUDIO_RATE/10)).buffer);
        ws.send(JSON.stringify({type:"endStream"}));return;
      }
      if(typeof value.audioProcessedMs==="number")progress=Math.max(progress,value.audioProcessedMs);
    });
    ws.addEventListener("close",event=>{clearTimeout(timer);session?resolve(`session acknowledged, ${progress}ms processed, closed ${event.code}`):reject(new Error(`ASR closed before acknowledging (${event.code})`))});
    ws.send(JSON.stringify({authorization:{accessToken:"Bearer "+key},audioEncoding:"PCM_16KHZ",model:ASR_MODEL,mode:"ENDPOINTING",partialMode:"CUMULATIVE",emitAudioProgress:true}));
  });
}

async function authorised(request:Request,token:string):Promise<boolean>{
  const given=new TextEncoder().encode(request.headers.get("authorization")??""),wanted=new TextEncoder().encode("Bearer "+token);
  return given.byteLength===wanted.byteLength&&crypto.subtle.timingSafeEqual(given,wanted);
}

export async function museProbe(request:Request,env:Env):Promise<Response>{
  if(!env.RA_PROBE_TOKEN||request.method!=="POST")return new Response("not found",{status:404});
  if(!await authorised(request,env.RA_PROBE_TOKEN))return new Response("not found",{status:404});
  // ?minds=1: each account's Mind reports its providers and recent turn diagnostics, nothing it was told.
  if(new URL(request.url).searchParams.get("minds")==="1"){
    const ids=(await env.DB.prepare("SELECT id FROM accounts ORDER BY created_at DESC LIMIT 5").all<{id:string}>()).results.map(r=>r.id);
    const minds=await Promise.all(ids.map(async(id,i)=>({mind:i,...await (env.MIND.getByName(id) as unknown as {diagnostics():Promise<object>}).diagnostics()})));
    return Response.json({minds});
  }
  // ?judge=1: Spark standing in for d1, on real check and decision cases, with timings.
  if(new URL(request.url).searchParams.get("judge")==="1"){
    const sparkJudge=async()=>{const k=await secretOf(env.MUSE_KEY);if(!k)throw new Error("no Muse key");return new HttpMuse(k)};
    const checker=createChecker(sparkJudge),decide=decisions(sparkJudge);
    const cases:[string,()=>Promise<unknown>][]=[
      ["hurting: in pain",()=>checker.hurting("I can't keep going like this. I don't see the point of anything anymore.",[])],
      ["hurting: annoyed",()=>checker.hurting("My landlord raised the rent again and it really annoyed me.",[])],
      ["line: praise+advice",()=>checker.check("What should I do with my life?","You're clearly brilliant, so you should become a data scientist and start with Python tutorials.",false)],
      ["line: good listening",()=>checker.check("What should I do with my life?","That's a big question to carry. What's pulling at you most right now?",false)],
      ["choose: mirror",()=>decide.choose("The person said: \"That one about the crews leading it, that's really mine.\"","Which phrase did the person keep as theirs?",{a:"the phrase 'local crews leading it'",b:"the phrase 'nobody teaches young people'",none:"they did not pick any phrase"})],
      ["ask: kept question",()=>decide.ask("Ra offered the question 'How do young people get into local solar crews?'. The person said: \"Yes, that's exactly my question.\"","Did the person accept the question as their own?")],
    ];
    const out=[];for(const [name,run] of cases){const start=Date.now();let result:unknown;try{result=await run()}catch(e){result="ERROR "+(e instanceof Error?e.message:"failed")}out.push({name,ms:Date.now()-start,result})}
    return Response.json({cases:out});
  }
  // ?judge=lines: the promise check over lines you post ({cases:[{said,line}]}), with every question's score and timing.
  if(new URL(request.url).searchParams.get("judge")==="lines"){
    const body=await request.json().catch(()=>null) as {cases?:{said?:string;line?:string}[]}|null;
    const cases=(body?.cases??[]).filter(c=>typeof c.said==="string"&&typeof c.line==="string").slice(0,12);
    const checker=createChecker(async()=>{const k=await secretOf(env.MUSE_KEY);if(!k)throw new Error("no Muse key");return new HttpMuse(k)});
    const out=await Promise.all(cases.map(async c=>{const start=Date.now();try{const v=await checker.check(c.said!,c.line!,false);return {line:c.line,ms:Date.now()-start,pass:v.pass,broke:v.broke,scores:v.scores}}catch(e){return {line:c.line,error:e instanceof Error?e.message:"failed"}}}));
    return Response.json({cases:out});
  }
  // ?image=1: does Spark read an image? The body is {dataUrl, model?}; only Spark's reply and timing return.
  if(new URL(request.url).searchParams.get("image")==="1"){
    const body=await request.json().catch(()=>null) as {dataUrl?:string;model?:string}|null;
    if(!body?.dataUrl?.startsWith("data:image/")||body.dataUrl.length>4_000_000)return Response.json({error:"a data:image URL is needed"},{status:400});
    const k=await secretOf(env.MUSE_KEY);if(!k)return Response.json({error:"no Muse key"},{status:503});
    const model=body.model==="muse-wonder-1.0"?"muse-wonder-1.0":"muse-spark-1.3",start=Date.now();
    const res=await fetch("https://api.meta.ai/v1/responses",{method:"POST",headers:{authorization:"Bearer "+k,"content-type":"application/json"},body:JSON.stringify({model,store:false,max_output_tokens:2500,input:[{role:"user",content:[{type:"input_text",text:"Read this image: write out its main visible text, then one sentence on what it shows."},{type:"input_image",image_url:body.dataUrl}]}]})});
    const out=await res.json().catch(()=>null) as {status?:string;output?:{type:string;content?:{type:string;text?:string}[]}[];error?:{code?:string;type?:string}}|null;
    const text=(out?.output??[]).flatMap(o=>o.type==="message"?o.content??[]:[]).filter(c=>c.type==="output_text").map(c=>c.text).join("").slice(0,600);
    return Response.json({model,status:res.status,ms:Date.now()-start,state:out?.status??null,error:out?.error?.code??out?.error?.type??null,text});
  }
  // ?clip=1: Ra's spoken opening, as a 24 kHz WAV, back through the one-clip transcription path.
  if(new URL(request.url).searchParams.get("clip")==="1"){
    const voice=await createVoice(env);const parts:Uint8Array[]=[];for await(const c of await voice.speak({lineId:"probe",text:OPENINGS.open!}) as unknown as AsyncIterable<Uint8Array>)parts.push(c);
    const bytes=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){bytes.set(p,o);o+=p.length}
    const pcm=new Int16Array(bytes.buffer,0,Math.floor(bytes.length/2)),file=wav(pcm,RA_AUDIO_RATE),start=Date.now();
    try{const text=await transcribeClip(env,base64(file),"en");return Response.json({ok:!!text,ms:Date.now()-start,seconds:+(pcm.length/RA_AUDIO_RATE).toFixed(1),text:text.slice(0,400)})}
    catch(error){return Response.json({ok:false,ms:Date.now()-start,error:error instanceof Error?error.message:"failed"})}
  }
  // ?audio=wav: Ra's voice for the opening line as a WAV file, for listening outside the app.
  if(new URL(request.url).searchParams.get("audio")==="wav"){
    const voice=await createVoice(env);const parts:Uint8Array[]=[];for await(const c of await voice.speak({lineId:"probe",text:OPENINGS.open!}) as unknown as AsyncIterable<Uint8Array>)parts.push(c);
    const size=parts.reduce((n,p)=>n+p.length,0),out=new Uint8Array(44+size),v=new DataView(out.buffer);const tag=(at:number,t:string)=>{for(let i=0;i<4;i++)out[at+i]=t.charCodeAt(i)};
    tag(0,"RIFF");v.setUint32(4,36+size,true);tag(8,"WAVE");tag(12,"fmt ");v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,RA_AUDIO_RATE,true);v.setUint32(28,RA_AUDIO_RATE*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);tag(36,"data");v.setUint32(40,size,true);
    let o=44;for(const p of parts){out.set(p,o);o+=p.length}
    return new Response(out,{headers:{"content-type":"audio/wav"}});
  }
  // ?audio=1: one ElevenLabs line, measured raw and after Ra's framing and wire codec. Numbers only.
  if(new URL(request.url).searchParams.get("audio")==="1"){
    const xi=await readSecret(env.ELEVENLABS_KEY);if(!xi)return Response.json({error:"no ElevenLabs key"});
    const voiceId=env.RA_ELEVENLABS_VOICE||"EXAVITQu4vr4xnSDxMaL";
    const res=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=pcm_${RA_AUDIO_RATE}`,{method:"POST",headers:{"xi-api-key":xi,"content-type":"application/json",accept:"audio/pcm"},body:JSON.stringify({text:OPENINGS.open,model_id:"eleven_flash_v2_5"})});
    const chunks:number[]=[];const parts:Uint8Array[]=[];const start=Date.now();let first=0;
    for await(const c of res.body as unknown as AsyncIterable<Uint8Array>){if(!first)first=Date.now()-start;chunks.push(c.length);parts.push(c)}
    const total=chunks.reduce((a,b)=>a+b,0),all=new Uint8Array(total);let o=0;for(const p of parts){all.set(p,o);o+=p.length}
    const stats=(bytes:Uint8Array,shift=0)=>{const n=Math.floor((bytes.length-shift)/2),v=new DataView(bytes.buffer,bytes.byteOffset+shift,n*2);let sumSq=0,diff=0,clip=0,peak=0,prev=0;
      for(let i=0;i<n;i++){const x=v.getInt16(i*2,true);sumSq+=x*x;if(i)diff+=Math.abs(x-prev);if(Math.abs(x)>=32700)clip++;peak=Math.max(peak,Math.abs(x));prev=x}
      const rms=Math.sqrt(sumSq/n);return {samples:n,seconds:+(n/RA_AUDIO_RATE).toFixed(2),rms:Math.round(rms),peak,clipped:clip,roughness:+((diff/(n-1))/(rms||1)).toFixed(3)}};
    // Ra's path: 40 ms frames, wire-encoded the way the Mind sends them, decoded the way the phone does.
    const pcm=new Int16Array(Math.floor(total/2));const dv=new DataView(all.buffer);for(let i=0;i<pcm.length;i++)pcm[i]=dv.getInt16(i*2,true);
    let mismatch=0,rejected=0,frames=0;
    for(let at=0;at+RA_FRAME_SAMPLES<=pcm.length;at+=RA_FRAME_SAMPLES){frames++;const frame=pcm.slice(at,at+RA_FRAME_SAMPLES);
      const wire=encodeWireAudio({kind:FRAME_RA,speaking:true,loudness:0.5,pcm:frame},true);const back=decodeWireAudio(wire,true);
      if(!back){rejected++;continue}for(let i=0;i<frame.length;i++)if(back.pcm[i]!==pcm[at+i]){mismatch++;break}}
    // The same line through Ra's voice client, which re-aligns odd-length chunks.
    const voice=await createVoice(env);const vparts:Uint8Array[]=[];for await(const c of await voice.speak({lineId:"probe",text:OPENINGS.open!}) as unknown as AsyncIterable<Uint8Array>)vparts.push(c);
    const vtotal=vparts.reduce((n,p)=>n+p.length,0),vall=new Uint8Array(vtotal);let vo=0;for(const p of vparts){vall.set(p,vo);vo+=p.length}
    const viaVoice={label:voice.label,oddChunks:vparts.filter(p=>p.length%2).length,...stats(vall)};
    return Response.json({viaVoice,status:res.status,contentType:res.headers.get("content-type"),firstChunkMs:first,totalMs:Date.now()-start,chunks:chunks.length,oddChunks:chunks.filter(c=>c%2).length,totalBytes:total,
      asSent:stats(all),ifShiftedOneByte:stats(all,1),wire:{codec:AUDIO_CODEC,frames,rejected,mismatched:mismatch}});
  }
  const key=await secretOf(env.MUSE_KEY);
  if(!key)return Response.json({ok:false,error:"MUSE_KEY is unavailable"},{status:503});
  const muse=new HttpMuse(key);
  // ?compare=1: the same synthetic Ray turns through Spark and Wonder, three rounds each, with timings.
  if(new URL(request.url).searchParams.get("compare")==="1"){
    const opening=OPENINGS.open!;
    const cases=[
      {name:"hello",stage:"open" as const,turns:[{speaker:"ra" as const,text:opening},{speaker:"you" as const,text:"Hello."}]},
      {name:"matter",stage:"story" as const,turns:[{speaker:"ra" as const,text:OPENINGS.open!},{speaker:"you" as const,text:"Honestly the deal I signed with a client felt unfair."},{speaker:"ra" as const,text:"Unfair how?"},{speaker:"you" as const,text:"Does that even matter? Why are you asking me this?"}]},
      {name:"research",stage:"story" as const,turns:[{speaker:"ra" as const,text:OPENINGS.open!},{speaker:"you" as const,text:"The unfairness of the deal. You know what, stop wasting my time and go research before we continue, otherwise this session is over."}]},
      {name:"crews",stage:"story" as const,turns:[{speaker:"ra" as const,text:OPENINGS.open!},{speaker:"you" as const,text:"What annoys me is that the solar projects in my town are being led by local crews, and nobody is teaching young people how to join them."}]},
      {name:"pushback",stage:"story" as const,turns:[{speaker:"ra" as const,text:OPENINGS.open!},{speaker:"you" as const,text:"The solar projects in my town are being led by local crews, and nobody is teaching young people how to join them."},{speaker:"ra" as const,text:"Got it, local crews leading it. Was there a moment when that felt possible to you, somewhere you were?"},{speaker:"you" as const,text:"You have started again with those nonsensical things, right? Why does it matter where I was?"}]},
      {name:"lookup",stage:"story" as const,turns:[{speaker:"ra" as const,text:OPENINGS.open!},{speaker:"you" as const,text:"I keep hearing junior developer jobs are disappearing because of AI agents. Look it up: what's actually happening this year?"}]},
      {name:"what",stage:"open" as const,turns:[{speaker:"ra" as const,text:opening},{speaker:"you" as const,text:"Wait, what is this? What are you actually for?"}]},
      {name:"rent",stage:"story" as const,turns:[{speaker:"ra" as const,text:opening},{speaker:"you" as const,text:"My landlord raised the rent again, so I had to move my repair workshop."},{speaker:"ra" as const,text:"That's a lot to carry. What happened with the move?"},{speaker:"you" as const,text:"The new place has no power for my soldering station, so I'm stuck doing small jobs at home."}]},
    ];
    const runs:Record<string,string|number>[]=[];
    const only=new URL(request.url).searchParams.get("talk");
    for(const talk of (only==="spark"?["muse-spark-1.3"]:only==="wonder"?["muse-wonder-1.0"]:["muse-spark-1.3","muse-wonder-1.0"]) as ("muse-spark-1.3"|"muse-wonder-1.0")[])for(const c of cases)for(let round=0;round<2;round++){
      const model=new HttpMuse(key,undefined,talk),start=Date.now();
      try{const text=(await model.spark({developer:developerMessage(),dossier:"Synthetic dossier. Nothing is known about this person beyond this conversation.",stage:c.stage,instructions:spokenInstructions(c.stage,false),turns:c.turns,webSearch:true})).text;runs.push({talk,case:c.name,round,ms:Date.now()-start,text:text.slice(0,300)})}
      catch(error){runs.push({talk,case:c.name,round,ms:Date.now()-start,error:error instanceof Error?error.message.slice(0,200):"failed"})}
    }
    return Response.json({runs});
  }
  const results=await Promise.all([
    timed(MUSE_MODELS.spark,async()=>(await muse.spark({developer:"This is a connection test. Reply in one short sentence.",turns:[{speaker:"you",text:"Say hello."}]})).text.slice(0,120)),
    // A real first turn: Ra's standing promises, the spoken stage instructions, the opening and a reply.
    timed(MUSE_MODELS.spark+" (ray turn)",async()=>(await muse.spark({developer:developerMessage(),dossier:"Synthetic dossier for a connection test. Nothing is known about this person yet.",stage:"open",instructions:spokenInstructions("open",false),turns:[{speaker:"ra",text:OPENINGS.open!},{speaker:"you",text:"Hello."}]})).text.slice(0,160)),
    // A second turn: the history carries Ra's own earlier line, as every turn after the first does.
    timed(MUSE_MODELS.spark+" (multi-turn)",async()=>(await muse.spark({developer:"This is a connection test. Reply in one short sentence.",turns:[{speaker:"you",text:"Say hello."},{speaker:"ra",text:"Hello!"},{speaker:"you",text:"Now say goodbye."}]})).text.slice(0,120)),
    timed(MUSE_MODELS.spark+" (json_schema)",async()=>(await muse.spark({developer:"This is a connection test.",turns:[{speaker:"you",text:"Is two greater than one?"}],schema:{type:"object",properties:{answer:{type:"boolean"}},required:["answer"],additionalProperties:false}})).text.slice(0,120)),
    timed("muse-wonder-1.0 (web_search)",async()=>{
      // Records the final response's shape (types only) so a missing citation can be told apart from a missing search.
      let shape="";
      const traced=new HttpMuse(key,async(input,init)=>{const response=await fetch(input,init),copy=response.clone();void copy.text().then(text=>{
        const done=text.split("\n").filter(line=>line.startsWith("data: ")&&line.includes('"response.completed"')).at(-1);if(!done)return;
        const output=(JSON.parse(done.slice(6)) as {response?:{output?:{type:string;content?:{type:string;annotations?:{type:string}[]}[]}[]}}).response?.output??[];
        const keys=(value:unknown,depth=0):string=>!value||typeof value!=="object"||depth>3?typeof value:Array.isArray(value)?`[${value.length}×${keys(value[0],depth+1)}]`:"{"+Object.entries(value).map(([k,v])=>k+":"+keys(v,depth+1)).join(",")+"}";
        shape=output.map(o=>o.type==="web_search_call"?"web_search_call"+keys(o):o.type+(o.content?"["+o.content.map(c=>c.type+(c.annotations?"{"+c.annotations.map(a=>a.type).join(",")+"}":"")).join(",")+"]":"")).join(" ");
      },()=>{});return response});
      try{const out=await traced.wonder({task:"Which city is the capital of Kenya? Answer in one sentence and cite one source.",webSearch:true});return `${out.text.slice(0,120)} | ${out.sources.length} source(s)`}
      catch(error){await new Promise(r=>setTimeout(r,50));throw new Error(`${error instanceof Error?error.message:"failed"} | output: ${shape||"unavailable"}`)}
    }),
    timed(ASR_MODEL,()=>transcribe(key)),
    // ElevenLabs account facts a failing voice depends on: plan, credits left, and the voices it can use.
    timed("elevenlabs account",async()=>{
      const xi=await readSecret(env.ELEVENLABS_KEY);if(!xi)throw new Error("no key");
      const get=async(path:string)=>{const r=await fetch("https://api.elevenlabs.io"+path,{headers:{"xi-api-key":xi}});const body=await r.json().catch(()=>null) as Record<string,unknown>|null;if(!r.ok){const s=(body?.detail as {status?:unknown}|undefined)?.status;throw new Error(`${path} ${r.status}${typeof s==="string"&&/^[a-z_]{1,64}$/.test(s)?" "+s:""}`)}return body!};
      // A restricted key may lack user_read or voices_read; those just show as unavailable.
      const sub=await get("/v1/user/subscription").catch(()=>({})) as {tier?:string;character_count?:number;character_limit?:number};
      const voices=await get("/v1/voices").then(b=>b.voices as {voice_id:string;name:string;category:string}[],e=>{throw e}).catch((e:Error)=>[{voice_id:"",name:"unavailable: "+e.message,category:"-"}]);
      // The voice named in RA_PROBE_VOICE (default Osiris): on this account, then in the shared library.
      const wanted=new RegExp((new URL(request.url).searchParams.get("voice")??"osiris").replace(/[^a-z0-9 ]/gi,""),"i");
      const mine=voices.filter(v=>wanted.test(v.name)).map(v=>`${v.name}(${v.category}) ${v.voice_id}`);
      const shared=await get("/v1/shared-voices?page_size=8&search="+encodeURIComponent(wanted.source)).then(b=>(b.voices as {voice_id:string;name:string;public_owner_id:string;category:string}[]).map(v=>`${v.name}(${v.category}) ${v.voice_id} owner ${v.public_owner_id}`),(e:Error)=>["unavailable: "+e.message]);
      // ?voice_id=… tries that voice on each TTS model, reporting only status codes.
      const voiceId=new URL(request.url).searchParams.get("voice_id")?.replace(/[^A-Za-z0-9]/g,"").slice(0,40);
      const tries=voiceId?await Promise.all(["eleven_flash_v2_5","eleven_turbo_v2_5","eleven_multilingual_v2","eleven_v3"].map(async model=>{
        const r=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=pcm_${RA_AUDIO_RATE}`,{method:"POST",headers:{"xi-api-key":xi,"content-type":"application/json"},body:JSON.stringify({text:"Hi.",model_id:model})});
        const s=r.ok?"ok":((await r.json().catch(()=>null)) as {detail?:{status?:unknown}}|null)?.detail?.status;if(r.ok)void r.body?.cancel().catch(()=>{});
        return `${model} ${r.status}${typeof s==="string"&&/^[a-z_]{1,64}$/.test(s)?" "+s:""}`;
      })):[];
      const about=voiceId?await get("/v1/voices/"+voiceId).then(v=>`${String(v.name).split(" - ")[0]}(${v.category})`,(e:Error)=>"lookup "+e.message):"";
      return `${voiceId?`voice ${voiceId} ${about}: ${tries.join(", ")} | `:""}tier ${sub.tier??"unreadable"}; ${voices.length} account voices; "${wanted.source}" on account: ${mine.join("; ")||"none"} | in library: ${shared.join("; ")||"none"}`;
    }),
    // Ra's voice in production, so one probe covers what a spoken turn needs.
    timed("voice: elevenlabs",async()=>{const voice=await createVoice(env);let size=0;for await(const chunk of await voice.speak({lineId:"probe",text:"Hello, this is a voice check."}) as unknown as AsyncIterable<Uint8Array>)size+=chunk.length;return `${voice.label}: ${size} bytes, ${(size/2/RA_AUDIO_RATE).toFixed(2)}s of audio`}),
  ]);
  return Response.json({ok:results.every(r=>r.ok),results});
}
