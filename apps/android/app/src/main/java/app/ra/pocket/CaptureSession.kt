package app.ra.pocket

import java.io.Closeable
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.CancellationException

data class CaptureEnvelope(val iv:ByteArray,val data:ByteArray)
interface CaptureAccountKeys {
    /** Must verify an existing key rather than replacing it. The caller wipes raw afterwards. */
    fun install(account:String,raw:ByteArray)
    fun seal(account:String,plain:ByteArray,aad:String):CaptureEnvelope
    fun open(account:String,envelope:CaptureEnvelope,aad:String):ByteArray
    fun erase(account:String)
    fun erased(account:String):Boolean=false
}

/** Native account authority is transient. Persisted Keystore keys alone never unlock captures. */
class CaptureSession(private val keys:CaptureAccountKeys,private val clock:()->Long,private val random:()->ByteArray={ByteArray(32).also{SecureRandom().nextBytes(it)}}) {
    data class Snapshot(val account:String,val generation:Long)
    private data class Challenge(val account:String,val value:String,val generation:Long,val expires:Long)
    private var generation=0L
    private var account:String?=null
    private var challenge:Challenge?=null
    private val operations=mutableMapOf<AudioCancellation,Int>()
    private fun valid(account:String){require(Regex("[A-Za-z0-9_-]{1,128}").matches(account)){"invalid-account"}}
    fun lock(){
        val pending=synchronized(this){generation++;account=null;challenge=null;val all=operations.keys.toList();operations.clear();all}
        pending.forEach {it.cancel()}
    }
    /** Ownership of the received raw key is transferred here and zeroed on every exit. */
    fun importAndUnlock(owner:String,raw:ByteArray,cancel:AudioCancellation) {
        try {
            valid(owner);require(raw.size==32){"invalid-account-key"};lock()
            val epoch=synchronized(this){generation}
            cancel.check();keys.install(owner,raw);cancel.check()
            synchronized(this){if(epoch!=generation)throw CancellationException("locked");account=owner}
        } finally {raw.fill(0)}
    }
    fun challenge(owner:String):String {
        valid(owner)
        if(synchronized(this){account!=null&&account!=owner})lock()
        return synchronized(this){
            val nonce=random().let {data->try{data.joinToString(""){"%02x".format(it)}}finally{data.fill(0)}}
            require(nonce.length==64)
            challenge=Challenge(owner,nonce,generation,clock()+60_000);nonce
        }
    }
    fun prove(owner:String,nonce:String,envelope:CaptureEnvelope,cancel:AudioCancellation) {
        valid(owner)
        val pending=synchronized(this){val c=challenge;challenge=null;c}
        if(pending==null||pending.account!=owner||pending.value!=nonce||pending.expires<=clock())throw PocketError("locked","Unlock the local copy first.")
        require(envelope.iv.size==12 && envelope.data.size in 16..512)
        cancel.check()
        val plain=try{keys.open(owner,envelope,"ra-pocket-session:$owner:$nonce")}catch(_:Exception){throw PocketError("locked","That proof did not open this local copy.")}
        try {
            if(!MessageDigest.isEqual(plain,nonce.toByteArray()))throw PocketError("locked","That proof did not open this local copy.")
            cancel.check()
            synchronized(this){if(pending.generation!=generation||pending.expires<=clock())throw PocketError("locked","The local copy was locked.");account=owner}
        } finally {plain.fill(0)}
    }
    fun lease(owner:String,cancel:AudioCancellation):Lease {
        valid(owner);cancel.check()
        val snapshot=synchronized(this){if(account!=owner)throw PocketError("locked","Unlock this account's local copy first.");operations[cancel]=(operations[cancel] ?: 0)+1;Snapshot(owner,generation)}
        val lease=Lease(snapshot,cancel)
        try{lease.check()}catch(error:Throwable){lease.close();throw error}
        return lease
    }
    fun check(snapshot:Snapshot) {synchronized(this){if(account!=snapshot.account || generation!=snapshot.generation)throw PocketError("locked","The local copy was locked.")}}
    inner class Lease internal constructor(val snapshot:Snapshot,private val cancel:AudioCancellation):Closeable {
        private var closed=false
        fun check(){cancel.check();check(snapshot)}
        override fun close(){synchronized(this@CaptureSession){if(!closed){val count=operations[cancel] ?: 0;if(count<=1)operations.remove(cancel)else operations[cancel]=count-1;closed=true}}}
    }
}
