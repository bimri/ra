package app.ra.pocket

import android.os.Handler
import android.os.Looper
import android.webkit.WebMessage
import android.webkit.WebMessagePort
import android.webkit.WebView
import android.net.Uri
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/** A fresh channel is transferred only to the configured origin's main frame. */
class PocketBridge(private val pocket: Pocket) {
    private val vault by lazy { LocalVault() }
    private val control = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var port: WebMessagePort? = null
    private var generation = 0
    private data class PendingJob(val future:Future<*>,val cancel:AudioCancellation,val heartbeat:Runnable)
    private data class Progress(val phase:String,val loaded:Long,val total:Long)
    private val jobs = mutableMapOf<String, PendingJob>()
    private val seen = linkedSetOf<String>()
    private var paused = false

    fun attach(web: WebView, origin: Uri) {
        detach()
        val epoch = generation
        val channel = web.createWebMessageChannel()
        port = channel[0]
        channel[0].setWebMessageCallback(object : WebMessagePort.WebMessageCallback() {
            override fun onMessage(source: WebMessagePort, message: WebMessage) {
                if (epoch == generation) receive(message.data ?: "", epoch)
            }
        })
        web.postWebMessage(WebMessage("ra-pocket:2", arrayOf(channel[1])), origin)
        emit(JSONObject().put("t", "lifecycle").put("state", if (paused) "paused" else "resumed"))
    }

    private fun emit(event: JSONObject) {
        event.put("v", 2)
        try { port?.postMessage(WebMessage(event.toString())) } catch (_: Exception) { }
    }
    private fun error(id: String, code: String, message: String) = JSONObject().put("t", "result").put("id", id)
        .put("ok", false).put("error", JSONObject().put("code", code).put("message", message))
    private fun success(id: String, value: Any?) = JSONObject().put("t", "result").put("id", id).put("ok", true).put("value", value ?: JSONObject.NULL)
    private fun captureStatusJson(status:NativeCaptureStatus)=JSONObject().put("state",status.state).put("nextChunk",status.nextChunk)
    private fun exportJson(status:ExportStatus)=JSONObject().put("state",status.state).put("nextChunk",status.nextChunk).put("bytes",status.bytes).also{if(status.sha256!=null)it.put("sha256",status.sha256)}
    private fun captureEnvelope(payload:JSONObject,max:Int):CaptureEnvelope {
        val iv=payload.getString("iv");val data=payload.getString("data")
        require(iv.length<=32 && data.length<=((max+2)/3)*4)
        return CaptureEnvelope(android.util.Base64.decode(iv,android.util.Base64.NO_WRAP),android.util.Base64.decode(data,android.util.Base64.NO_WRAP))
    }

    private fun receive(raw: String, epoch: Int) {
        if (raw.length > 65536) return
        val request = try { JSONObject(raw) } catch (_: Exception) { return }
        val id = request.optString("id")
        if (!Regex("[a-zA-Z0-9_-]{1,64}").matches(id)) return
        if (request.optInt("v") != 2) { emit(error(id,"protocol-error","Unsupported Pocket protocol.")); return }
        if(request.optString("t")=="lock") {
            pocket.lockPrivate()
            for((pendingId,job) in jobs){main.removeCallbacks(job.heartbeat);job.cancel.cancel();job.future.cancel(true);emit(error(pendingId,"locked","Unlock the local copy first."))}
            jobs.clear();return
        }
        if (request.optString("t") == "cancel") {
            jobs.remove(id)?.let { main.removeCallbacks(it.heartbeat);it.cancel.cancel();it.future.cancel(true);emit(error(id,"cancelled","Operation cancelled.")) }
            return
        }
        if (request.optString("t") != "request") return
        // Duplicate IDs are never rerun, including after a response was lost.
        if (id in seen) return
        if (seen.size >= 4096) { emit(error(id,"busy","Reopen Ra to begin a fresh Pocket session.")); return }
        seen.add(id)
        val operation = request.optString("operation")
        val payload = request.optJSONObject("payload")
        if (payload == null) { emit(error(id,"invalid-request","A Pocket payload is required.")); return }
        if (paused) { emit(error(id,"cancelled","Pocket is paused while the app is away.")); return }
        if (jobs.size >= 16) { emit(error(id,"busy","Pocket is busy. Try again shortly.")); return }
        if(operation=="account.import")pocket.lockPrivate()
        emit(JSONObject().put("t","progress").put("id",id).put("phase","starting").put("loaded",0))
        val cancel=AudioCancellation()
        val progressState=AtomicReference(Progress("starting",0,1))
        val lastProgress=AtomicLong(0)
        fun emitProgress() {val p=progressState.get();emit(JSONObject().put("t","progress").put("id",id).put("phase",p.phase).put("loaded",p.loaded).put("total",p.total))}
        val heartbeat=object:Runnable {override fun run(){if(epoch==generation && jobs.containsKey(id)){emitProgress();main.postDelayed(this,3000)}}}
        val progress:(String,Long,Long)->Unit={phase,loaded,total ->
            val before=progressState.getAndSet(Progress(phase,loaded,total))
            val now=android.os.SystemClock.elapsedRealtime()
            if(before.phase!=phase || now-lastProgress.get()>250){lastProgress.set(now);main.post{if(epoch==generation && jobs.containsKey(id))emitProgress()}}
        }
        val future = control.submit {
            val result = try {
                cancel.check()
                when (operation) {
                    "status" -> success(id, statusJson(pocket.status()))
                    "runtime.info" -> success(id,JSONObject()
                        .put("revision","shell-2")
                        .put("exportSupported",pocket.exportSupported)
                        .put("accountSessionsSupported",pocket.accountSessionsSupported).put("captureStorageSupported",pocket.captureStorageSupported))
                    "account.import" -> {
                        val account=payload.getString("account");val encoded=payload.getString("key");require(encoded.length<=128)
                        val raw=android.util.Base64.decode(encoded,android.util.Base64.NO_WRAP)
                        try{pocket.importAccount(account,raw,cancel)}finally{raw.fill(0)}
                        success(id,JSONObject().put("account",account))
                    }
                    "account.challenge" -> success(id,JSONObject().put("challenge",pocket.accountChallenge(payload.getString("account"))))
                    "account.prove" -> {
                        val account=payload.getString("account");val challenge=payload.getString("challenge");val iv=payload.getString("iv");val data=payload.getString("data")
                        require(iv.length<=32 && data.length<=1024 && challenge.length==64)
                        pocket.proveAccount(account,challenge,CaptureEnvelope(android.util.Base64.decode(iv,android.util.Base64.NO_WRAP),android.util.Base64.decode(data,android.util.Base64.NO_WRAP)),cancel)
                        success(id,JSONObject().put("account",account))
                    }
                    "capture.begin" -> success(id,captureStatusJson(pocket.beginCapture(payload.getString("account"),payload.getString("captureId"),captureEnvelope(payload,4112),cancel)))
                    "export.choose" -> success(id,exportJson(pocket.chooseExport(payload.getString("account"),payload.getString("exportId"),cancel)))
                    "export.status" -> success(id,exportJson(pocket.exportStatus(payload.getString("account"),payload.getString("exportId"),cancel)))
                    "export.chunk" -> {val index=payload.get("index");require(index is Int&&index>=0);success(id,exportJson(pocket.exportChunk(payload.getString("account"),payload.getString("exportId"),index,captureEnvelope(payload,16400),cancel)))}
                    "export.finish" -> {val bytes=payload.get("bytes");require(bytes is Number&&bytes.toDouble()==bytes.toLong().toDouble()&&bytes.toLong()>=0);success(id,exportJson(pocket.finishExport(payload.getString("account"),payload.getString("exportId"),bytes.toLong(),cancel)))}
                    "export.cancel" -> {pocket.cancelExport(payload.getString("account"),payload.getString("exportId"),cancel);success(id,null)}
                    "capture.status" -> success(id,captureStatusJson(pocket.captureStatus(payload.getString("account"),payload.getString("captureId"),cancel)))
                    "capture.chunk" -> {
                        val index=payload.get("index");require(index is Int && index>=0)
                        success(id,JSONObject().put("nextChunk",pocket.captureChunk(payload.getString("account"),payload.getString("captureId"),index,captureEnvelope(payload,NativeCaptureStore.CHUNK_BYTES+16),cancel)))
                    }
                    "capture.finish" -> success(id,captureStatusJson(pocket.finishCapture(payload.getString("account"),payload.getString("captureId"),cancel)))
                    "capture.drop" -> {pocket.dropCapture(payload.getString("account"),payload.getString("captureId"),cancel);success(id,null)}
                    "capture.eraseAccount" -> {pocket.eraseCaptures(payload.getString("account"),cancel);success(id,null)}
                    "vault.seal" -> success(id,vault.seal(payload.getString("account"),payload.getString("text")))
                    "vault.open" -> success(id,vault.open(payload.getString("account"),payload.getString("text")))
                    "vault.erase" -> { vault.erase(payload.getString("account")); success(id,null) }
                    else -> error(id,"unsupported","This Pocket operation is not available in this build.")
                }
            } catch (e:PocketError) {error(id,e.code,e.message)}
              catch (_:java.util.concurrent.CancellationException) {error(id,"cancelled","Operation cancelled.")}
              catch (_:java.io.IOException) {if(cancel.cancelled||Thread.currentThread().isInterrupted)error(id,"cancelled","Operation cancelled.") else error(id,"native-error","Pocket could not finish this operation. Try again.")}
              catch (_: IllegalArgumentException) { error(id,"invalid-request","This Pocket request is invalid.") }
              catch (_: org.json.JSONException) { error(id,"invalid-request","This Pocket request is incomplete.") }
              catch (_: Exception) { error(id,"native-error","Pocket could not complete this operation.") }
            main.post {
                main.removeCallbacks(heartbeat)
                if (epoch == generation && jobs.remove(id) != null) emit(result)
            }
        }
        jobs[id]=PendingJob(future,cancel,heartbeat)
    }

    fun pause() {
        paused = true
        pocket.lockPrivate()
        for ((id,job) in jobs) { main.removeCallbacks(job.heartbeat);job.cancel.cancel();job.future.cancel(true);emit(error(id,"cancelled","Pocket paused while the app is away.")) }
        jobs.clear()
        emit(JSONObject().put("t","lifecycle").put("state","paused"))
    }
    fun resume() { paused = false; emit(JSONObject().put("t","lifecycle").put("state","resumed")) }
    fun detach() {
        generation++
        pocket.lockPrivate()
        jobs.values.forEach {main.removeCallbacks(it.heartbeat);it.cancel.cancel();it.future.cancel(true)}
        jobs.clear(); seen.clear()
        try { port?.close() } catch (_: Exception) { }
        port = null
    }
    fun close() { detach();pocket.closePrivateResources(); control.shutdownNow() }

    private fun statusJson(s: PocketStatus): JSONObject =
        JSONObject().put("runtime",s.runtime).put("freeRamMb",s.freeRamMb ?: JSONObject.NULL).put("device",s.device)
}
