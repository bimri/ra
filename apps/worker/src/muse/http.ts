import type { Muse, SparkRequest, WonderRequest } from "./index";
import {sparkTurns,sparkSystem,outputLimit,wonderTask} from "./messages";
import {readMuseResponse} from "./response";

type Output = { type: string; content?: { type: string; text?: string; annotations?: { type: string; url?: string }[] }[]; results?: { url?: unknown }[] };
function requireJson(text:string):void {try{JSON.parse(text)}catch{throw new SyntaxError("Muse returned invalid JSON")}}

/**
 * The JSON a schema asked for. Wonder sometimes says what it will do first ("I will search…"),
 * which used to make a whole answer unreadable; the one object it then returns is kept.
 */
export function schemaJson(text:string):string {
  try{JSON.parse(text);return text}catch{/* look for the object inside */}
  const start=text.indexOf("{"),end=text.lastIndexOf("}");
  if(start>=0&&end>start){const inner=text.slice(start,end+1);try{JSON.parse(inner);return inner}catch{/* not an object either */}}
  throw new SyntaxError("Muse returned invalid JSON");
}

/**
 * Spark and Wonder reason before they answer, and max_output_tokens counts that reasoning too.
 * Ra's limits are for what is said, so each request adds headroom for thinking on top.
 */
const REASONING_HEADROOM = { minimal: 2048, low: 4096, medium: 8192, high: 16384 } as const;
const MAX_BUDGET = 32_768;

/** Server-only client. History stays in the Mind; foreground requests are abortable. */
export class HttpMuse implements Muse {
  readonly stub = false;
  // The default wraps fetch: workerd throws "Illegal invocation" when fetch is called as this.send(...).
  // `talk` is the model behind spark(): Ra's conversation and structured tasks. Wonder takes no reasoning setting.
  constructor(
    private readonly key: string,
    private readonly send: typeof fetch = (input, init) => fetch(input, init),
    private readonly talk: "muse-spark-1.3" | "muse-wonder-1.0" = "muse-spark-1.3",
  ) {}

  get label(): string {
    return this.talk === "muse-wonder-1.0" ? "Muse (Standard, Wonder talking)" : "Muse (Standard)";
  }

  /** One retry with twice the budget when Muse stops at max_output_tokens; any other failure stands. */
  private async response(model: string, body: Record<string, unknown> & { max_output_tokens: number }, signal?: AbortSignal) {
    try { return await this.once(model, body, signal); }
    catch (error) {
      if (signal?.aborted || !(error instanceof Error) || !error.message.includes("max_output_tokens") || body.max_output_tokens >= MAX_BUDGET) throw error;
      return this.once(model, { ...body, max_output_tokens: Math.min(MAX_BUDGET, body.max_output_tokens * 2) }, signal);
    }
  }

  private async once(model: string, body: Record<string, unknown>, signal?: AbortSignal) {
    const deadline=signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000);deadline.throwIfAborted();
    let abort:(()=>void)|undefined;
    const cancellation=new Promise<never>((_,reject)=>{abort=()=>reject(deadline.reason);deadline.addEventListener("abort",abort,{once:true});if(deadline.aborted)abort()});
    const pending = this.send("https://api.meta.ai/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${this.key}`, "content-type": "application/json",accept:"text/event-stream" },
      body: JSON.stringify({ model, store: false, stream:true,...body }),
      signal:deadline,
      redirect:"manual",
    });
    void pending.then(response=>{if(deadline.aborted)void response.body?.cancel().catch(()=>{})},()=>{});
    let res:Response;try{res=await Promise.race([pending,cancellation])}catch(error){void pending.then(response=>{void response.body?.cancel().catch(()=>{})},()=>{});throw error}finally{if(abort)deadline.removeEventListener("abort",abort)}
    if(deadline.aborted){void res.body?.cancel().catch(()=>{});deadline.throwIfAborted()}
    if (!res.ok){void res.body?.cancel().catch(()=>{});throw new Error(`Muse request failed (${res.status})`)}
    const data = await readMuseResponse(res,deadline);
    deadline.throwIfAborted();
    if (data.status !== "completed" || !Array.isArray(data.output)) throw new Error("Muse response did not complete");
    const output=data.output as Output[];
    if(output.length>128||output.some(o=>!o||typeof o!=="object"||typeof o.type!=="string"||o.content!==undefined&&(!Array.isArray(o.content)||o.content.length>128)))throw new Error("Muse returned invalid output");
    const content = output.flatMap((o) => o.type === "message" ? o.content ?? [] : []);
    if(content.some(c=>!c||typeof c!=="object"||typeof c.type!=="string"||c.type==="output_text"&&typeof c.text!=="string"||c.annotations!==undefined&&(!Array.isArray(c.annotations)||c.annotations.length>128||c.annotations.some(a=>!a||typeof a!=="object"||typeof a.type!=="string"))))throw new Error("Muse returned invalid content");
    // A reply that searched arrives as a preface ("I'll look that up"), the search, then the answer: keep only the last message.
    const messages = output.filter((o) => o.type === "message" && (o.content ?? []).some((c) => c.type === "output_text" && c.text?.trim()));
    const text = (messages.at(-1)?.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("");
    if (!text.trim()||new TextEncoder().encode(text).length>64_000) throw new Error("Muse returned missing or oversized text");
    const link = (value: unknown): string[] => {
      if (typeof value!=="string"||!value||value.length>2048) return [];
      try { const url = new URL(value); return (url.protocol === "https:" || url.protocol === "http:")&&!url.username&&!url.password ? [url.href] : []; } catch { return []; }
    };
    const cited = content.flatMap((c) => c.annotations ?? []).flatMap((a) => a.type === "url_citation" ? link(a.url) : []);
    // Wonder searches without annotating its answer, so the pages its search returned count when nothing is cited.
    const searchedPages = output.flatMap((o) => o.type === "web_search_call" && Array.isArray(o.results) ? o.results.slice(0, 32).flatMap((r) => r && typeof r === "object" ? link(r.url) : []) : []);
    const sources = [...new Set(cited.length ? cited : searchedPages)];
    return { text, sources, searched: output.some((o) => o.type === "web_search_call") };
  }

  async spark(req: SparkRequest & { signal?: AbortSignal }): Promise<{ text: string }> {
    const spark = this.talk === "muse-spark-1.3";
    const out = await this.response(this.talk, {
      instructions: sparkSystem(req),
      input: sparkTurns(req).map((t) => ({ role: t.speaker === "you" ? "user" : "assistant", content: [{type:t.speaker==="you"?"input_text":"output_text",text:t.text}] })),
      ...(spark ? { reasoning: { effort: req.effort ?? "minimal" } } : {}),
      max_output_tokens:outputLimit(req)+(spark ? REASONING_HEADROOM[req.effort ?? "minimal"] : REASONING_HEADROOM.low),
      ...(req.schema ? { text: { format: { type: "json_schema", name: "ra_result", strict: true, schema: req.schema } } } : req.json ? { text: { format: { type: "json_object" } } } : {}),
      ...(req.webSearch ? { tools: [{ type: "web_search" }] } : {}),
    }, req.signal);
    if (req.json || req.schema) requireJson(out.text);
    return { text: out.text };
  }

  async see(req: { image: { bytes: Uint8Array; type: string }; task: string; signal?: AbortSignal }): Promise<string> {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(req.image.type) || req.image.bytes.length > 3_000_000) throw new Error("This photo can't be read");
    let binary = "";
    for (let i = 0; i < req.image.bytes.length; i += 0x8000) binary += String.fromCharCode(...req.image.bytes.subarray(i, i + 0x8000));
    const out = await this.response("muse-spark-1.3", {
      input: [{ role: "user", content: [{ type: "input_text", text: req.task }, { type: "input_image", image_url: `data:${req.image.type};base64,${btoa(binary)}` }] }],
      reasoning: { effort: "minimal" },
      max_output_tokens: 400 + REASONING_HEADROOM.minimal,
    }, req.signal);
    return out.text;
  }

  async wonder(req: WonderRequest & { signal?: AbortSignal }): Promise<{ text: string; sources: string[] }> {
    const out = await this.response("muse-wonder-1.0", {
      input: wonderTask(req),
      max_output_tokens:outputLimit({maxOutputTokens:req.maxOutputTokens??900})+REASONING_HEADROOM.low,
      ...(req.schema?{text:{format:{type:"json_schema",name:"ra_result",strict:true,schema:req.schema}}}:{}),
      ...(req.webSearch ? { tools: [{ type: "web_search" }], include: ["web_search_call.results"] } : {}),
    }, req.signal);
    if (req.webSearch && (!out.searched || !out.sources.length)) throw new Error("Wonder returned no grounded search citations");
    return { text: req.schema ? schemaJson(out.text) : out.text, sources: out.sources };
  }
}
