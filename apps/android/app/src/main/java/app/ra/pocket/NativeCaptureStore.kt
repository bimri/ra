package app.ra.pocket

import java.io.File
import java.security.MessageDigest
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

data class NativeCaptureMetadata(val id:String,val bytes:Int,val sha256:String,val mime:String,val language:String)
data class NativeCaptureStatus(val state:String,val nextChunk:Int)
interface CaptureMetadataCodec {fun decode(plain:ByteArray):NativeCaptureMetadata}
interface CaptureRecords {
    fun read(file:File,maxCipherBytes:Int):CaptureEnvelope?
    fun write(file:File,envelope:CaptureEnvelope)
}

/** Native media, metadata and cached results are ciphertext only. No upload/network adapter exists. */
class NativeCaptureStore(private val root:File,private val session:CaptureSession,private val keys:CaptureAccountKeys,private val records:CaptureRecords,private val metadata:CaptureMetadataCodec) {
    companion object {
        const val CHUNK_BYTES=16*1024
        private val gates=java.util.concurrent.ConcurrentHashMap<String,ReentrantLock>()
    }
    private val gate=gates.computeIfAbsent(root.canonicalPath){ReentrantLock()}
    private fun digest(data:ByteArray)=MessageDigest.getInstance("SHA-256").digest(data).joinToString(""){"%02x".format(it)}
    private fun valid(value:String){require(Regex("[A-Za-z0-9_-]{1,128}").matches(value)){"invalid-capture-identity"}}
    private fun directory(account:String,id:String):File {
        valid(account);valid(id)
        val ownerName=digest(account.toByteArray());val idName=digest(id.toByteArray())
        val owner=File(root,ownerName).canonicalFile
        require(owner.parentFile==root.canonicalFile && owner.name==ownerName){"invalid-capture-path"}
        return File(owner,idName).canonicalFile.also{require(it.parentFile==owner && it.name==idName){"invalid-capture-path"}}
    }
    private fun file(directory:File,name:String)=File(directory,name).also{require(it.canonicalFile.parentFile==directory.canonicalFile){"invalid-capture-path"}}
    private fun aad(account:String,id:String,part:String)="$account:native-capture:$id:$part"
    private fun corrupt():Nothing=throw PocketError("capture-corrupt","This local capture could not be checked. Its original stays on this phone; try processing it again.")
    private fun opened(account:String,record:CaptureEnvelope,context:String):ByteArray = try{keys.open(account,record,context)}catch(_:Exception){corrupt()}
    private fun readRecord(directory:File,name:String,max:Int):CaptureEnvelope?=try{records.read(file(directory,name),max)}catch(_:java.io.IOException){corrupt()}catch(_:IllegalArgumentException){corrupt()}
    private fun deleted(account:String,id:String,directory:File):Boolean {
        val record=readRecord(directory,"deleted",64) ?: return false
        val plain=opened(account,record,aad(account,id,"deleted"))
        try{if(!plain.contentEquals(byteArrayOf(1)))corrupt();return true}finally{plain.fill(0)}
    }
    private fun readMetadata(account:String,id:String,directory:File):NativeCaptureMetadata {
        if(deleted(account,id,directory))throw PocketError("capture-deleted","This local capture was removed.")
        val record=readRecord(directory,"metadata",4112) ?: throw PocketError("capture-missing","Keep this capture locally and try processing it again.")
        val plain=opened(account,record,aad(account,id,"metadata"))
        return try{metadata.decode(plain).also{validate(id,it)}}finally{plain.fill(0)}
    }
    private fun validate(id:String,value:NativeCaptureMetadata) {
        require(value.id==id && value.bytes in 1..1_024_000 && Regex("[a-f0-9]{64}").matches(value.sha256)) {"capture-size-needs-review"}
        require((Regex("audio/[A-Za-z0-9.+-]{1,40}").matches(value.mime)||value.mime in listOf("image/jpeg","image/png")) && Regex("[a-zA-Z-]{2,16}").matches(value.language)) {"unsupported-capture-type"}
    }
    private fun count(value:NativeCaptureMetadata)=(value.bytes+CHUNK_BYTES-1)/CHUNK_BYTES
    private fun next(directory:File,value:NativeCaptureMetadata):Int {var n=0;while(n<count(value)&&file(directory,"chunk-$n").isFile)n++;return n}
    private fun sealed(account:String,id:String,directory:File):Boolean {
        val record=readRecord(directory,"complete",64) ?: return false
        val plain=opened(account,record,aad(account,id,"complete"))
        try{if(!plain.contentEquals(byteArrayOf(1)))corrupt();return true}finally{plain.fill(0)}
    }
    private fun <T> access(account:String,id:String,cancel:AudioCancellation,action:(CaptureSession.Lease,File)->T):T = session.lease(account,cancel).use{lease->
        gate.withLock{lease.check();val result=action(lease,directory(account,id));lease.check();result}
    }
    fun begin(account:String,id:String,envelope:CaptureEnvelope,cancel:AudioCancellation):NativeCaptureStatus=access(account,id,cancel){lease,directory->
        require(envelope.iv.size==12 && envelope.data.size in 16..4112)
        val plain=opened(account,envelope,aad(account,id,"metadata"))
        val incoming=try{metadata.decode(plain).also{validate(id,it)}}finally{plain.fill(0)}
        if(deleted(account,id,directory))throw PocketError("capture-deleted","This local capture was removed.")
        if(file(directory,"metadata").isFile) {
            if(readMetadata(account,id,directory)!=incoming)throw PocketError("capture-conflict","That capture reference belongs to different contents.")
        } else {
            val parent=directory.parentFile!!
            if((parent.listFiles()?.count{it.isDirectory&&File(it,"metadata").isFile} ?: 0)>=256)throw PocketError("capture-limit","Review or remove some waiting captures before processing more.")
            directory.mkdirs();lease.check();records.write(file(directory,"metadata"),envelope)
        }
        NativeCaptureStatus(if(sealed(account,id,directory))"sealed" else "partial",next(directory,incoming))
    }
    fun status(account:String,id:String,cancel:AudioCancellation):NativeCaptureStatus=access(account,id,cancel){_,directory->
        if(deleted(account,id,directory))NativeCaptureStatus("deleted",0)
        else if(!file(directory,"metadata").isFile)NativeCaptureStatus("absent",0)
        else {val value=readMetadata(account,id,directory);NativeCaptureStatus(if(sealed(account,id,directory))"sealed" else "partial",next(directory,value))}
    }
    fun chunk(account:String,id:String,index:Int,envelope:CaptureEnvelope,cancel:AudioCancellation):Int=access(account,id,cancel){lease,directory->
        val value=readMetadata(account,id,directory)
        require(index in 0 until count(value) && envelope.iv.size==12 && envelope.data.size in 16..CHUNK_BYTES+16){"invalid-capture-chunk"}
        val expected=minOf(CHUNK_BYTES,value.bytes-index*CHUNK_BYTES)
        val context=aad(account,id,"chunk:$index")
        val plain=opened(account,envelope,context)
        try {
            require(plain.size==expected){"invalid-capture-chunk"}
            val old=readRecord(directory,"chunk-$index",CHUNK_BYTES+16)
            if(old!=null) {
                val previous=opened(account,old,context)
                try{if(!MessageDigest.isEqual(previous,plain))throw PocketError("capture-conflict","This capture chunk changed. Keep the original and try again.")}finally{previous.fill(0)}
            } else {
                require(index==next(directory,value)){"capture-chunks-out-of-order"}
                lease.check();records.write(file(directory,"chunk-$index"),envelope)
            }
            next(directory,value)
        } finally {plain.fill(0)}
    }
    private fun readAll(account:String,id:String,directory:File,lease:CaptureSession.Lease):ByteArray {
        val value=readMetadata(account,id,directory)
        val result=ByteArray(value.bytes);var used=0
        try {
            for(index in 0 until count(value)) {
                lease.check();val record=readRecord(directory,"chunk-$index",CHUNK_BYTES+16) ?: corrupt()
                val part=opened(account,record,aad(account,id,"chunk:$index"))
                try{val expected=minOf(CHUNK_BYTES,value.bytes-used);if(part.size!=expected)corrupt();part.copyInto(result,used);used+=part.size}finally{part.fill(0)}
            }
            if(used!=value.bytes || digest(result)!=value.sha256)corrupt()
            lease.check();return result
        }catch(error:Throwable){result.fill(0);throw error}
    }
    fun finish(account:String,id:String,cancel:AudioCancellation):NativeCaptureStatus=access(account,id,cancel){lease,directory->
        val bytes=readAll(account,id,directory,lease);bytes.fill(0)
        lease.check();records.write(file(directory,"complete"),keys.seal(account,byteArrayOf(1),aad(account,id,"complete")))
        NativeCaptureStatus("sealed",count(readMetadata(account,id,directory)))
    }
    fun read(account:String,id:String,cancel:AudioCancellation):ByteArray=access(account,id,cancel){lease,directory->
        if(!sealed(account,id,directory))throw PocketError("capture-incomplete","This capture is still waiting for local processing.")
        readAll(account,id,directory,lease)
    }
    fun metadata(account:String,id:String,cancel:AudioCancellation):NativeCaptureMetadata=access(account,id,cancel){_,directory->readMetadata(account,id,directory)}
    fun cachedResult(account:String,id:String,cancel:AudioCancellation):ByteArray?=access(account,id,cancel){_,directory->
        readMetadata(account,id,directory)
        val record=readRecord(directory,"result",32784)
        record?.let{opened(account,it,aad(account,id,"result"))}
    }
    fun cacheResult(account:String,id:String,result:ByteArray,cancel:AudioCancellation)=access(account,id,cancel){lease,directory->
        require(result.size in 1..32768);readMetadata(account,id,directory)
        if(!sealed(account,id,directory))throw PocketError("capture-incomplete","This capture is still waiting for local processing.")
        lease.check();records.write(file(directory,"result"),keys.seal(account,result,aad(account,id,"result")))
    }
    fun drop(account:String,id:String,cancel:AudioCancellation)=access(account,id,cancel){lease,directory->
        directory.mkdirs();lease.check()
        records.write(file(directory,"deleted"),keys.seal(account,byteArrayOf(1),aad(account,id,"deleted")))
        for(child in directory.listFiles().orEmpty()) {
            require(child.canonicalFile.parentFile==directory.canonicalFile && !child.isDirectory)
            if(child.name!="deleted" && child.name!="deleted.bak" && !child.delete())throw PocketError("native-error","The local capture could not be removed. Try again.")
        }
    }
    /** Retry-safe erasure keeps only an opaque revocation marker outside the account directory. */
    fun eraseAccount(account:String,cancel:AudioCancellation) {
        valid(account)
        if(!keys.erased(account))session.lease(account,cancel).use{it.check()}
        val name=digest(account.toByteArray());val owner=File(root,name).canonicalFile
        require(owner.parentFile==root.canonicalFile && owner.name==name){"invalid-capture-path"}
        session.lock()
        gate.withLock {
            keys.erase(account)
            if(owner.exists()) {
                val visited=mutableSetOf<String>();val allowed=root.canonicalPath+File.separator
                val files=owner.walkTopDown().onEnter{require(it.canonicalPath.startsWith(allowed)&&visited.add(it.canonicalPath));true}.toList()
                require(files.all{it.canonicalPath.startsWith(allowed)})
                for(file in files.asReversed())if(!file.delete())throw PocketError("native-error","The local capture copy could not be erased. Try again.")
            }
        }
    }
}
