package app.ra.pocket

import org.json.JSONObject

/**
 * Pocket: what the phone keeps for you, natively. The screens reach it over a
 * message port (see apps/web/src/pocket): the Keystore vault, the native
 * account session, encrypted captures waiting to be sent, and file export.
 * No model runs on the phone; Muse reads everything on the server.
 */
interface Pocket {
    fun closePrivateResources(){}
    val exportSupported:Boolean get()=false
    fun chooseExport(account:String,id:String,cancel:AudioCancellation):ExportStatus=throw PocketError("unsupported","File export is unavailable.")
    fun exportStatus(account:String,id:String,cancel:AudioCancellation):ExportStatus=throw PocketError("unsupported","File export is unavailable.")
    fun exportChunk(account:String,id:String,index:Int,envelope:CaptureEnvelope,cancel:AudioCancellation):ExportStatus=throw PocketError("unsupported","File export is unavailable.")
    fun finishExport(account:String,id:String,bytes:Long,cancel:AudioCancellation):ExportStatus=throw PocketError("unsupported","File export is unavailable.")
    fun cancelExport(account:String,id:String,cancel:AudioCancellation){throw PocketError("unsupported","File export is unavailable.")}
    fun status(): PocketStatus
    val accountSessionsSupported:Boolean get()=false
    fun importAccount(account:String,key:ByteArray,cancel:AudioCancellation){key.fill(0);throw PocketError("unsupported","Native account sessions are unavailable.")}
    fun accountChallenge(account:String):String = throw PocketError("unsupported","Native account sessions are unavailable.")
    fun proveAccount(account:String,challenge:String,envelope:CaptureEnvelope,cancel:AudioCancellation){throw PocketError("unsupported","Native account sessions are unavailable.")}
    fun lockPrivate(){}
    val captureStorageSupported:Boolean get()=false
    fun beginCapture(account:String,id:String,envelope:CaptureEnvelope,cancel:AudioCancellation):NativeCaptureStatus=throw PocketError("unsupported","Encrypted native captures are unavailable.")
    fun captureStatus(account:String,id:String,cancel:AudioCancellation):NativeCaptureStatus=throw PocketError("unsupported","Encrypted native captures are unavailable.")
    fun captureChunk(account:String,id:String,index:Int,envelope:CaptureEnvelope,cancel:AudioCancellation):Int=throw PocketError("unsupported","Encrypted native captures are unavailable.")
    fun finishCapture(account:String,id:String,cancel:AudioCancellation):NativeCaptureStatus=throw PocketError("unsupported","Encrypted native captures are unavailable.")
    fun dropCapture(account:String,id:String,cancel:AudioCancellation){throw PocketError("unsupported","Encrypted native captures are unavailable.")}
    fun eraseCaptures(account:String,cancel:AudioCancellation){throw PocketError("unsupported","Encrypted native captures are unavailable.")}
}

data class PocketStatus(
    /** "native" when the shell's storage and vault are present; no model runtime exists. */
    val runtime: String,
    val freeRamMb: Long?,
    val device: JSONObject,
)
