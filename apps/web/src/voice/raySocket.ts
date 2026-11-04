import { FRAME_MIC, FRAME_RA, decodeWireAudio, encodeWireAudio,AUDIO_CODEC, type MindMessage, type PhoneMessage } from "@ra/core";
import type { MicFrame } from "./mic";
import { devPerson } from "../store/device";
import { vaultAccount } from "../auth/vault";

/** "refused": the Mind can't open this session as asked (close code 4400); it said why, and the phone doesn't rejoin. */
export type SocketStatus = "idle" | "connecting" | "open" | "closed" | "error" | "refused";

export const REFUSED = 4400;

/** Above this much unsent audio the network is behind; drop frames rather than queue forever. */
const MAX_BUFFERED = 64 * 1024;

/** The phone's end of the live Ray socket. */
export class RaySocket {
  private ws: WebSocket | null = null;
  private compressed=false;

  constructor(
    private readonly url: string,
    private readonly on: { message(m: MindMessage): void; status(s: SocketStatus): void; raAudio(pcm: Int16Array): void },
  ) {}

  open(hello: Extract<PhoneMessage, { t: "hello" }>): void {
    this.close();
    this.compressed=false;
    this.on.status("connecting");
    const ws = new WebSocket(this.url);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      if(this.ws!==ws)return;
      this.on.status("open");
      ws.send(JSON.stringify({...hello,audio:[AUDIO_CODEC]}));
    };
    ws.onmessage = (e) => {
      if(this.ws!==ws)return;
      if (typeof e.data !== "string") {
        const frame = decodeWireAudio(e.data as ArrayBuffer,this.compressed);
        if (frame?.kind === FRAME_RA) this.on.raAudio(frame.pcm);
        return;
      }
      try {
        const message=JSON.parse(e.data) as MindMessage;
        if(message.t==="ready")this.compressed=message.audio===AUDIO_CODEC;
        this.on.message(message);
      } catch {
        // ignore malformed frames
      }
    };
    ws.onerror = () => {if(this.ws===ws)this.on.status("error")};
    ws.onclose = (e) => {
      if(this.ws!==ws)return;
      this.ws = null;
      this.on.status(e.code === REFUSED ? "refused" : "closed");
    };
    this.ws = ws;
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: PhoneMessage): void {
    if (this.isOpen) this.ws!.send(JSON.stringify(msg));
  }

  sendAudio(f: MicFrame): number {
    if (!this.isOpen || this.ws!.bufferedAmount > MAX_BUFFERED) return 0;
    const bytes=encodeWireAudio({ kind: FRAME_MIC, speaking: f.speaking, loudness: f.level, pcm: f.pcm },this.compressed);
    try{this.ws!.send(bytes);return bytes.byteLength}finally{new Uint8Array(bytes).fill(0)}
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    this.compressed=false;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000);
  }
}

export function rayUrl(person = devPerson()): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const account = vaultAccount();
  return `${proto}//${location.host}/ray?person=${encodeURIComponent(person)}${account ? "&account=" + encodeURIComponent(account) : ""}`;
}
