import type {SparkRequest,WonderRequest,Turn} from "./index";
export const schemaInstruction=(schema:Record<string,unknown>)=>"Output schema (all fields are required): "+JSON.stringify(schema).replace(/</g,"\\u003c").replace(/>/g,"\\u003e");
export function sparkSystem(request:SparkRequest):string {return [request.developer,request.dossier,request.instructions,request.schema?schemaInstruction(request.schema):""].filter(Boolean).join("\n\n")}
/** Same whole history and task cue for both adapters; only the wire roles differ. */
export function sparkTurns(request:SparkRequest):Turn[] {
  const turns:Turn[]=[];
  for(const turn of request.turns){const last=turns.at(-1);if(last?.speaker===turn.speaker)last.text+=" "+turn.text;else turns.push({...turn})}
  if(request.json||request.schema||turns.at(-1)?.speaker!=="you"){
    const text=request.json||request.schema?"Write it now, as JSON.":"Go on.";
    const last=turns.at(-1);if(last?.speaker==="you")last.text+=" "+text;else turns.push({speaker:"you",text});
  }
  return turns;
}
export function wonderTask(request:WonderRequest):string{return [request.task,request.schema?schemaInstruction(request.schema):""].filter(Boolean).join("\n\n")}
export function outputLimit(request:Pick<SparkRequest,"maxOutputTokens"|"json"|"schema">):number {
  const value=request.maxOutputTokens??(request.json||request.schema?400:120);
  if(!Number.isInteger(value)||value<16||value>2048)throw new Error("Invalid model output limit.");return value;
}
