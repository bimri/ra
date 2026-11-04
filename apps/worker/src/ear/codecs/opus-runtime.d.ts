export class OpusDecoder{
  static module:WebAssembly.Module;
  constructor(options:{sampleRate:number;channels:number;preSkip:number});
  ready:Promise<void>;
  decodeFrame(packet:Uint8Array):{channelData:Float32Array[];samplesDecoded:number;sampleRate:number;errors:unknown[]};
  free():void;
}
