package app.ra.pocket

import android.content.Context
import android.os.SystemClock

/** The shell's native side: account session, encrypted captures and export. */
class PocketController(context:Context,exportChooser:ExportChooser?=null,closeOutput:(java.io.OutputStream)->Unit={try{it.close()}catch(_:Exception){}}) : Pocket {
    private val captures=CaptureRuntime.get(context)
    internal val captureSession=captures.session
    private val exports=exportChooser?.let{NativeExportSession(captureSession,captures.keys,{SystemClock.elapsedRealtime()},it,closeOutput)}
    override val exportSupported get()=exports!=null
    private fun exporter()=exports?:throw PocketError("unsupported","File export is unavailable.")
    override fun chooseExport(account:String,id:String,cancel:AudioCancellation)=exporter().choose(account,id,cancel)
    override fun exportStatus(account:String,id:String,cancel:AudioCancellation)=exporter().status(account,id,cancel)
    override fun exportChunk(account:String,id:String,index:Int,envelope:CaptureEnvelope,cancel:AudioCancellation)=exporter().chunk(account,id,index,envelope,cancel)
    override fun finishExport(account:String,id:String,bytes:Long,cancel:AudioCancellation)=exporter().finish(account,id,bytes,cancel)
    override fun cancelExport(account:String,id:String,cancel:AudioCancellation)=exporter().cancel(account,id,cancel)
    override fun closePrivateResources(){exports?.close()}
    private val base=StubPocket(context)
    override fun status():PocketStatus=base.status().copy(runtime="native")
    override val accountSessionsSupported=true
    override fun importAccount(account:String,key:ByteArray,cancel:AudioCancellation){captureSession.importAndUnlock(account,key,cancel);exports?.account(account)}
    override fun accountChallenge(account:String)=captureSession.challenge(account)
    override fun proveAccount(account:String,challenge:String,envelope:CaptureEnvelope,cancel:AudioCancellation){captureSession.prove(account,challenge,envelope,cancel);exports?.account(account)}
    override fun lockPrivate(){exports?.pause();captureSession.lock()}
    override val captureStorageSupported=true
    override fun beginCapture(account:String,id:String,envelope:CaptureEnvelope,cancel:AudioCancellation)=captures.store.begin(account,id,envelope,cancel)
    override fun captureStatus(account:String,id:String,cancel:AudioCancellation)=captures.store.status(account,id,cancel)
    override fun captureChunk(account:String,id:String,index:Int,envelope:CaptureEnvelope,cancel:AudioCancellation)=captures.store.chunk(account,id,index,envelope,cancel)
    override fun finishCapture(account:String,id:String,cancel:AudioCancellation)=captures.store.finish(account,id,cancel)
    override fun dropCapture(account:String,id:String,cancel:AudioCancellation){captures.store.drop(account,id,cancel)}
    override fun eraseCaptures(account:String,cancel:AudioCancellation){captures.store.eraseAccount(account,cancel);exports?.erase(account)}
}
