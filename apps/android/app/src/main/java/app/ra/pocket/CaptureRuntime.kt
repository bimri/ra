package app.ra.pocket

import android.content.Context
import android.os.SystemClock
import java.io.File
import java.security.MessageDigest

/** One private account authority across app controllers; a new process always starts locked. */
class CaptureRuntime private constructor(context:Context) {
    companion object {
        private val runtimes=java.util.concurrent.ConcurrentHashMap<String,CaptureRuntime>()
        fun get(context:Context):CaptureRuntime=runtimes.computeIfAbsent(context.filesDir.canonicalPath){CaptureRuntime(context.applicationContext)}
    }
    private val revocations=object:CaptureErasureRecords {
        val records=AtomicPocketRecords()
        fun file(account:String)=File(File(context.filesDir,"pocket/erased"),MessageDigest.getInstance("SHA-256").digest(account.toByteArray()).joinToString(""){"%02x".format(it)})
        override fun erased(account:String)=records.read(file(account))=="erased-v1"
        override fun mark(account:String)=records.write(file(account),"erased-v1")
    }
    val keys=KeystoreCaptureKeys(revocations)
    val session=CaptureSession(keys,{SystemClock.elapsedRealtime()})
    val store=NativeCaptureStore(File(context.filesDir,"pocket/captures"),session,keys,AtomicCaptureRecords(),JsonCaptureMetadata())
    
}
