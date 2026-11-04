package app.ra.pocket

import android.app.Activity
import android.content.Intent
import android.os.Handler
import android.os.Looper
import java.io.Closeable
import java.io.OutputStream
import java.util.concurrent.Executors

/** Scoped document access only. Never writes a plaintext temporary file in Ra's storage. */
class AndroidExportChooser(private val activity:Activity):ExportChooser,Closeable {
    companion object {const val REQUEST_EXPORT=3}
    private val main=Handler(Looper.getMainLooper());private val io=Executors.newSingleThreadExecutor()
    private var pending:((OutputStream?)->Unit)?=null;@Volatile private var closed=false
    override fun choose(id:String,selected:(OutputStream?)->Unit) {
        main.post {
            if(closed||pending!=null){selected(null);return@post};pending=selected
            try{activity.startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply{addCategory(Intent.CATEGORY_OPENABLE);type="application/json";putExtra(Intent.EXTRA_TITLE,"ra-export.json")},REQUEST_EXPORT)}
            catch(_:Exception){pending=null;selected(null)}
        }
    }
    fun result(resultCode:Int,data:Intent?) {
        val selected=pending?:return;pending=null;val uri=data?.data
        if(resultCode!=Activity.RESULT_OK||uri?.scheme!="content"){selected(null);return}
        io.execute {
            val output=try{activity.contentResolver.openOutputStream(uri,"wt")}catch(_:Exception){null}
            if(closed){try{output?.close()}catch(_:Exception){}}else selected(output)
        }
    }
    fun closeOutput(output:OutputStream) {
        try{io.execute{try{output.close()}catch(_:Exception){}}}catch(_:java.util.concurrent.RejectedExecutionException){try{output.close()}catch(_:Exception){}}
    }
    override fun close(){closed=true;pending?.invoke(null);pending=null;io.shutdown()}
}
