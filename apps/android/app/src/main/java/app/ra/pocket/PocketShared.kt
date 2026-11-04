package app.ra.pocket

import android.util.AtomicFile
import java.io.File
import java.util.concurrent.CancellationException

/** Cancels native work cooperatively; listeners run once, in any thread. */
class AudioCancellation {
    private val listeners = mutableSetOf<() -> Unit>()
    @Volatile var cancelled = false
        private set
    fun cancel() {
        val callbacks = synchronized(this) { cancelled = true; listeners.toList() }
        callbacks.forEach { try {it()} catch (_:Exception) { /* notify remaining cancellation hooks */ } }
    }
    fun check() { if (cancelled || Thread.currentThread().isInterrupted) throw CancellationException("cancelled") }
    fun subscribe(callback: () -> Unit): () -> Unit {
        synchronized(this) { if (cancelled) callback() else listeners.add(callback) }
        return { synchronized(this) { listeners.remove(callback) } }
    }
}

/** A Pocket failure the screens can show: a stable code and a plain message. */
class PocketError(val code: String, override val message: String) : IllegalStateException(message)

interface PocketRecords {
    fun read(file: File): String?
    fun write(file: File, value: String)
}

class AtomicPocketRecords : PocketRecords {
    companion object {private val guard=Any()}
    override fun read(file: File): String? = synchronized(guard) {try { AtomicFile(file).openRead().bufferedReader().use { it.readText() } } catch (_: java.io.FileNotFoundException) { null }}
    override fun write(file: File, value: String) = synchronized(guard) {
        file.parentFile!!.mkdirs()
        val record=AtomicFile(file);val output=record.startWrite()
        try {output.write(value.toByteArray());record.finishWrite(output)}catch(error:Throwable){record.failWrite(output);throw error}
    }
}
