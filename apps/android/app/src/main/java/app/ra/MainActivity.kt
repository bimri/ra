package app.ra

import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.ValueCallback
import java.io.ByteArrayInputStream
import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.graphics.Bitmap
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.view.WindowInsets
import android.os.Build
import app.ra.pocket.PocketBridge
import app.ra.pocket.PocketController
import app.ra.pocket.TrustedOrigin
import app.ra.pocket.AndroidExportChooser

/**
 * The shell: one WebView hosting Ra's screens, plus Pocket, the native side
 * that keeps the Keystore vault, encrypted captures and export. Everything else is web code.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var pocket: PocketBridge
    private lateinit var exportChooser:AndroidExportChooser
    private var photoResult: ValueCallback<Array<Uri>>? = null
    private val origin = TrustedOrigin(BuildConfig.RA_URL)
    private fun trusted(uri: Uri): Boolean = origin.allows(uri.toString())
    private fun fontHost(request: WebResourceRequest): Boolean =
        request.method == "GET" && request.url.scheme == "https" && request.url.host in setOf("fonts.googleapis.com", "fonts.gstatic.com")
    private var pendingMic: PermissionRequest? = null
    /** The status and navigation bars, in CSS px: the page keeps its content clear of them. */
    private var safeTop = 0f
    private var safeBottom = 0f

    /** Edge to edge (Android 15+), the WebView runs under the system bars; tell the page how tall they are. */
    private fun shareInsets(view: WebView) {
        view.evaluateJavascript("document.documentElement.style.setProperty('--sat','${safeTop}px');document.documentElement.style.setProperty('--sab','${safeBottom}px')", null)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        exportChooser=AndroidExportChooser(this)
        pocket = PocketBridge(PocketController(this,exportChooser,exportChooser::closeOutput))

        web = WebView(this).apply {
            setBackgroundColor(0xFFECEBE7.toInt())
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.userAgentString = settings.userAgentString + " RaAndroid/2"
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webViewClient = object : WebViewClient() {
                override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) { pocket.detach() }
                override fun onPageFinished(view: WebView, url: String) {
                    if (trusted(Uri.parse(url)) && trusted(Uri.parse(view.url ?: ""))) {
                        shareInsets(view)
                        val root = Uri.parse(BuildConfig.RA_URL)
                        pocket.attach(view,root.buildUpon().path("").clearQuery().fragment(null).build())
                    }
                }
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (trusted(request.url)) return false
                    if (request.isForMainFrame && request.url.scheme in listOf("https", "http", "mailto", "tel")) {
                        try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (_: Exception) { }
                    }
                    return true
                }
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                    if (trusted(request.url)) return null
                    // The boards' typefaces (Inter Tight, Instrument Serif, JetBrains Mono, Doto), as the web app loads them.
                    if (fontHost(request)) return null
                    return WebResourceResponse("text/plain", "utf-8", 403, "Blocked origin", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                    if (!trusted(Uri.parse(view.url ?: ""))) return false
                    photoResult?.onReceiveValue(null)
                    photoResult = callback
                    return try {
                        startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "image/*"
                        }, REQUEST_PHOTO)
                        true
                    } catch (_: Exception) { photoResult = null; callback.onReceiveValue(null); true }
                }
                override fun onPermissionRequest(request: PermissionRequest) {
                    runOnUiThread { onMicRequest(request) }
                }
            }
        }
        setContentView(web)
        web.setOnApplyWindowInsetsListener { view, insets ->
            val density = resources.displayMetrics.density
            val (top, bottom) = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars())
                bars.top to bars.bottom
            } else {
                @Suppress("DEPRECATION")
                insets.systemWindowInsetTop to insets.systemWindowInsetBottom
            }
            safeTop = top / density
            safeBottom = bottom / density
            shareInsets(view as WebView)
            insets
        }

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(BuildConfig.RA_URL)
    }

    /** The page asked for the mic: grant it once Android has granted RECORD_AUDIO to the app. */
    private fun onMicRequest(request: PermissionRequest) {
        val wantsAudio = request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
        if (!wantsAudio || !trusted(request.origin)) {
            request.deny()
            return
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
        } else {
            pendingMic = request
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_MIC)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_MIC) return
        val request = pendingMic ?: return
        pendingMic = null
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
        } else {
            request.deny()
        }
    }

    @Deprecated("Activity result API retained for API 24")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_PHOTO) {
            photoResult?.onReceiveValue(if (resultCode == RESULT_OK) data?.data?.let { arrayOf(it) } else null)
            photoResult = null
        }
        if(requestCode==AndroidExportChooser.REQUEST_EXPORT)exportChooser.result(resultCode,data)
    }

    override fun onDestroy() {
        photoResult?.onReceiveValue(null)
        pendingMic?.deny()
        pocket.close()
        exportChooser.close()
        web.destroy()
        super.onDestroy()
    }

    override fun onPause() { pocket.pause(); super.onPause() }
    override fun onResume() { super.onResume(); if (::pocket.isInitialized) pocket.resume() }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    @Deprecated("Activity.onBackPressed is deprecated on newer APIs but is the only hook on API 24")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else @Suppress("DEPRECATION") super.onBackPressed()
    }

    companion object {
        private const val REQUEST_MIC = 1
        private const val REQUEST_PHOTO = 2
    }
}
