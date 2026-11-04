/** Keep exact citation URLs; labels, local paths and embedded credentials are not sources. */
export function sourceUrls(values:readonly string[]):string[] {
  return [...new Set(values.filter(value=>{try{const url=new URL(value);return ["https:","http:"].includes(url.protocol)&&!url.username&&!url.password}catch{return false}}))].sort();
}
