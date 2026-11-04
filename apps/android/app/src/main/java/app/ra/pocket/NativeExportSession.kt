package app.ra.pocket

import java.io.Closeable
import java.io.OutputStream
import java.security.MessageDigest
import java.util.Timer
import java.util.TimerTask

fun interface ExportChooser {fun choose(id:String,selected:(OutputStream?)->Unit)}
data class ExportStatus(val state:String,val nextChunk:Int=0,val bytes:Long=0,val sha256:String?=null)

/** Only a user-chosen stream is writable. Bridge payloads are account-bound ciphertext. */
class NativeExportSession(private val session:CaptureSession,private val keys:CaptureAccountKeys,private val clock:()->Long,private val chooser:ExportChooser,private val closeOutput:(OutputStream)->Unit={try{it.close()}catch(_:Exception){}}):Closeable {
    private class Entry(val owner:String,val id:String,var deadline:Long) {
        var state="choosing";var output:OutputStream?=null;var next=0;var bytes=0L;var lastHash:ByteArray?=null;var digest=MessageDigest.getInstance("SHA-256");var sha:String?=null;var busy=false
        fun status()=ExportStatus(state,next,bytes,sha)
    }
    private val gate=Any();private var current:Entry?=null;private var closed=false;private val timer=Timer("ra-export-expiry",true)
    private fun valid(id:String){require(Regex("[A-Za-z0-9_-]{1,64}").matches(id))}
    private fun stop(entry:Entry,state:String) {
        val output=synchronized(gate){if(entry.state in listOf("done","cancelled","failed"))return;entry.state=state;entry.lastHash?.fill(0);entry.lastHash=null;entry.digest.reset();entry.output.also{entry.output=null}}
        if(output!=null)closeOutput(output)
    }
    private fun active(owner:String,id:String):Entry=synchronized(gate){
        current?.takeIf{it.owner==owner&&it.id==id}?:throw PocketError("invalid-request","Choose an export file first.")
    }
    private fun expire(entry:Entry){if(clock()>=synchronized(gate){entry.deadline})stop(entry,"failed")}
    private fun schedule(entry:Entry) {
        val delay=synchronized(gate){if(closed||current!==entry||entry.state in listOf("done","cancelled","failed"))return;(entry.deadline-clock()).coerceAtLeast(1)}
        try{timer.schedule(object:TimerTask(){override fun run(){expire(entry);schedule(entry)}},delay)}catch(_:IllegalStateException){/* session closed */}
    }
    fun choose(owner:String,id:String,cancel:AudioCancellation):ExportStatus=session.lease(owner,cancel).use{lease->
        valid(id);lease.check()
        val entry=synchronized(gate){
            check(!closed)
            current?.let{old->if(old.state in listOf("choosing","selected","writing")){if(old.owner==owner&&old.id==id)return@use old.status();throw PocketError("busy","Finish or cancel the current export first.")}}
            Entry(owner,id,clock()+120_000).also{current=it}
        }
        schedule(entry)
        try{chooser.choose(id){output->
            val accepted=synchronized(gate){
                if(current!==entry||closed||entry.state!="choosing"||clock()>=entry.deadline)false
                else {entry.output=output;entry.state=if(output==null)"cancelled" else "selected";true}
            }
            if(!accepted&&output!=null)closeOutput(output)
        }}catch(_:Exception){stop(entry,"failed")}
        synchronized(gate){entry.status()}
    }
    fun status(owner:String,id:String,cancel:AudioCancellation):ExportStatus=session.lease(owner,cancel).use{lease->
        valid(id);lease.check();val entry=synchronized(gate){current?.takeIf{it.owner==owner&&it.id==id}}?:return@use ExportStatus("absent")
        expire(entry);synchronized(gate){entry.status()}
    }
    fun chunk(owner:String,id:String,index:Int,envelope:CaptureEnvelope,cancel:AudioCancellation):ExportStatus=session.lease(owner,cancel).use{lease->
        valid(id);require(index in 0 until 67108864&&envelope.iv.size==12&&envelope.data.size in 17..16400);val entry=active(owner,id);expire(entry)
        val plain=try{keys.open(owner,envelope,"$owner:native-export:$id:chunk:$index")}catch(_:Exception){throw PocketError("capture-corrupt","This export chunk could not be verified.")}
        var unsubscribe:()->Unit={};var acquired=false
        try {
            require(plain.size in 1..16384);val hash=MessageDigest.getInstance("SHA-256").digest(plain)
            val output=synchronized(gate){
                if(entry.state !in listOf("selected","writing")||current!==entry)throw PocketError("invalid-request","This export stopped. Discard the incomplete file and start again.")
                if(entry.busy)throw PocketError("busy","An export chunk is still being written.")
                if(index==entry.next-1){if(!MessageDigest.isEqual(entry.lastHash,hash))throw PocketError("capture-conflict","This export chunk changed.");return@use entry.status()}
                require(index==entry.next)
                if(entry.bytes+plain.size>1024L*1024*1024*1024)throw PocketError("unsupported","This export exceeds the supported file size. Nothing was shortened.")
                entry.busy=true;acquired=true;entry.state="writing";entry.output?:throw PocketError("native-error","The export file is closed.")
            }
            unsubscribe=cancel.subscribe{stop(entry,"failed")};lease.check();output.write(plain);lease.check()
            synchronized(gate){
                if(current!==entry||entry.state!="writing")throw PocketError("cancelled","Export stopped.")
                entry.digest.update(plain);entry.lastHash?.fill(0);entry.lastHash=hash;entry.next++;entry.bytes+=plain.size;entry.deadline=clock()+120_000
                entry.status()
            }
        }catch(error:Throwable){if(acquired)stop(entry,"failed");throw error}
        finally{unsubscribe();plain.fill(0);if(acquired)synchronized(gate){entry.busy=false}}
    }
    fun finish(owner:String,id:String,bytes:Long,cancel:AudioCancellation):ExportStatus=session.lease(owner,cancel).use{lease->
        val entry=active(owner,id);expire(entry)
        val output=synchronized(gate){
            if(entry.state=="done"){require(entry.bytes==bytes);return@use entry.status()}
            require(entry.state=="writing"&&!entry.busy&&entry.bytes==bytes);entry.busy=true;entry.output?:error("export-closed")
        }
        val unsubscribe=cancel.subscribe{stop(entry,"failed")}
        try{
            lease.check();output.flush();output.close();lease.check()
            synchronized(gate){
                if(entry.state!="writing")throw PocketError("cancelled","Export stopped.")
                entry.output=null;entry.state="done";entry.lastHash?.fill(0);entry.lastHash=null;entry.sha=entry.digest.digest().joinToString(""){"%02x".format(it)};entry.status()
            }
        }catch(error:Throwable){stop(entry,"failed");throw error}
        finally{unsubscribe();synchronized(gate){entry.busy=false}}
    }
    fun cancel(owner:String,id:String,cancel:AudioCancellation){session.lease(owner,cancel).use{it.check();val entry=active(owner,id);stop(entry,"cancelled")}}
    fun pause(){val entry=synchronized(gate){current};if(entry!=null&&entry.state!="choosing")stop(entry,"failed")}
    fun account(owner:String){val entry=synchronized(gate){current};if(entry!=null&&entry.owner!=owner)stop(entry,"cancelled")}
    fun erase(owner:String){val entry=synchronized(gate){current};if(entry?.owner==owner)stop(entry,"cancelled")}
    override fun close(){synchronized(gate){closed=true};current?.let{stop(it,"cancelled")};timer.cancel()}
}
