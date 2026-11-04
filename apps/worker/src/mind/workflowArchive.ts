import {isSealed,type Cipher} from "../crypto/seal";

export interface WorkflowArchive {id:string;archive:Record<string,unknown>}
/** Maintenance copies are unconfirmed historical work, never new events or
 * model context. Their owner can take the original JSON/V8 bytes in an export. */
export function exportWorkflowArchives(rows:Iterable<{key:string;value:string}>,cipher:Cipher,owner:string):WorkflowArchive[]{
  const out:WorkflowArchive[]=[];
  for(const row of rows){
    const id=row.key.slice("legacy-workflow/".length);
    if(!row.key.startsWith("legacy-workflow/")||!/^([a-f0-9]{16})$/.test(id)||!isSealed(row.value))throw new Error("A workflow recovery copy could not be verified.");
    const archive=JSON.parse(cipher.open(row.value)) as Record<string,unknown>;
    if(archive.version!==1||archive.purpose!=="legacy-workflow:"+id||archive.owner!==owner||!archive.records||typeof archive.records!=="object")throw new Error("A workflow recovery copy could not be verified.");
    out.push({id,archive});
  }
  return out;
}
