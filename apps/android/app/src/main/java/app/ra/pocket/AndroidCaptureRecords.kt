package app.ra.pocket

import android.util.AtomicFile
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import org.json.JSONObject

class JsonCaptureMetadata : CaptureMetadataCodec {
    override fun decode(plain:ByteArray):NativeCaptureMetadata {
        require(plain.size in 1..4096)
        val value=JSONObject(String(plain,Charsets.UTF_8))
        val bytes=value.get("bytes")
        require((bytes is Int || bytes is Long) && (bytes as Number).toLong() in 1..1_024_000)
        require(listOf("id","sha256","mime","language").all{value.get(it) is String})
        return NativeCaptureMetadata(value.getString("id"),bytes.toInt(),value.getString("sha256"),value.getString("mime"),value.getString("language"))
    }
}
class AtomicCaptureRecords : CaptureRecords {
    companion object {private val guard=Any();private const val MAGIC=0x52414331}
    override fun read(file:File,maxCipherBytes:Int):CaptureEnvelope?=synchronized(guard){
        val input=try{AtomicFile(file).openRead()}catch(_:java.io.FileNotFoundException){return@synchronized null}
        DataInputStream(input).use {source->
            require(source.readInt()==MAGIC)
            val iv=ByteArray(12);source.readFully(iv);val size=source.readInt()
            require(size in 16..maxCipherBytes)
            val data=ByteArray(size);source.readFully(data);require(source.read()==-1)
            CaptureEnvelope(iv,data)
        }
    }
    override fun write(file:File,envelope:CaptureEnvelope)=synchronized(guard){
        require(envelope.iv.size==12 && envelope.data.size in 16..32784)
        file.parentFile!!.mkdirs();val record=AtomicFile(file);val output=record.startWrite()
        try {val data=DataOutputStream(output);data.writeInt(MAGIC);data.write(envelope.iv);data.writeInt(envelope.data.size);data.write(envelope.data);data.flush();record.finishWrite(output)}catch(error:Throwable){record.failWrite(output);throw error}
    }
}
