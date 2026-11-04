const phases=new Set(["trips","watch","interrupt","stage","moment","voice","plan","check","reading","season"]);
/** Diagnostic logs must never receive Mind content, provider errors or account references. */
export function operationalTrace(entry:Record<string,unknown>):{ra:"turn";at:string;failed?:true;pass?:boolean} {
  return {ra:"turn",at:typeof entry.at==="string"&&phases.has(entry.at)?entry.at:"operation",...(entry.error!==undefined?{failed:true as const}:{}),...(typeof entry.pass==="boolean"?{pass:entry.pass}:{})};
}
