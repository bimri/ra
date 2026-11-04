package app.ra.pocket

import android.app.Activity
import android.app.Instrumentation
import android.net.Uri
import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import app.ra.BuildConfig
import java.io.ByteArrayOutputStream
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Real WebView port + Keystore + export writer, with a public synthetic memory destination. */
class PocketExportProbe:Instrumentation() {
    override fun onCreate(arguments:Bundle?){super.onCreate(arguments);start()}
    override fun onStart() {
        val result=Bundle();val done=CountDownLatch(1);val account="synthetic-export-"+UUID.randomUUID();val output=ByteArrayOutputStream();var passed=false
        var web:WebView?=null;var bridge:PocketBridge?=null;var controller:PocketController?=null
        try {
            check(BuildConfig.DEBUG)
            val html="""<!doctype html><meta charset="utf-8"><title>waiting</title><script>
            const owner='$account',exportId='public-export';let port,serial=0;const jobs=new Map();
            const b64=a=>btoa(String.fromCharCode(...a));
            const call=(operation,payload)=>new Promise((resolve,reject)=>{const id='job'+(++serial);jobs.set(id,{resolve,reject});port.postMessage(JSON.stringify({v:2,t:'request',id,operation,payload}))});
            window.addEventListener('message',async event=>{if(event.data!=='ra-pocket:2'||event.ports.length!==1)return;port=event.ports[0];port.onmessage=event=>{const r=JSON.parse(event.data);if(r.t!=='result')return;const job=jobs.get(r.id);if(!job)return;jobs.delete(r.id);r.ok?job.resolve(r.value):job.reject(r.error)};port.start();
              try {
                const raw=new Uint8Array(32).fill(5);const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);await call('account.import',{account:owner,key:b64(raw)});raw.fill(0);
                const info=await call('runtime.info',{});if(!info.exportSupported)throw Error();
                const chosen=await call('export.choose',{account:owner,exportId});if(chosen.state!=='selected')throw Error();
                const source=new TextEncoder().encode(JSON.stringify({synthetic:'public original voice and photo bytes',complete:true}));const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(owner+':native-export:'+exportId+':chunk:0')},key,source);
                const packet={account:owner,exportId,index:0,iv:b64(iv),data:b64(new Uint8Array(encrypted))};const first=await call('export.chunk',packet);const retry=await call('export.chunk',packet);if(first.nextChunk!==1||retry.bytes!==source.length)throw Error();
                const finished=await call('export.finish',{account:owner,exportId,bytes:source.length});const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',source)),n=>n.toString(16).padStart(2,'0')).join('');source.fill(0);if(finished.state!=='done'||finished.sha256!==digest)throw Error();
                document.title='passed';
              }catch(error){document.title='failed:'+String(error.code||error.name||'fixture')}
            });</script>""".trimIndent()
            runOnMainSync {
                val pocket=PocketController(targetContext,ExportChooser{_,selected->selected(output)});controller=pocket
                val channel=PocketBridge(pocket);bridge=channel
                web=WebView(targetContext).apply {
                    settings.javaScriptEnabled=true;settings.domStorageEnabled=true
                    webViewClient=object:WebViewClient(){override fun onPageFinished(view:WebView,url:String){channel.attach(view,Uri.parse(BuildConfig.RA_URL).buildUpon().path("").query(null).fragment(null).build())}}
                    webChromeClient=object:WebChromeClient(){override fun onReceivedTitle(view:WebView,title:String){if(title=="passed"||title.startsWith("failed:")){passed=title=="passed";done.countDown()}}}
                    loadDataWithBaseURL(BuildConfig.RA_URL,html,"text/html","utf-8",null)
                }
            }
            check(done.await(45,TimeUnit.SECONDS)&&passed)
            check(output.toString()=="{\"synthetic\":\"public original voice and photo bytes\",\"complete\":true}")
            result.putString("status","passed");result.putBoolean("realPortAndKeystore",true);result.putBoolean("encryptedChunksAndDuplicateReceipt",true);result.putBoolean("systemFilePickerValidated",false);finish(Activity.RESULT_OK,result)
        }catch(error:Throwable){result.putString("status","failed");result.putString("code",error.javaClass.simpleName);finish(Activity.RESULT_CANCELED,result)}
        finally {
            runOnMainSync{bridge?.close();web?.destroy()}
            try{controller?.importAccount(account,ByteArray(32){5},AudioCancellation());controller?.eraseCaptures(account,AudioCancellation())}catch(_:Exception){}
            output.reset()
        }
    }
}
