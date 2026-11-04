package app.ra.pocket

import android.app.ActivityManager
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Process
import android.os.StatFs
import org.json.JSONArray
import org.json.JSONObject

/** Reports the device and its resources; the controller marks the shell native. */
class StubPocket(private val context: Context) : Pocket {
    override fun status(): PocketStatus {
        val info = ActivityManager.MemoryInfo()
        (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(info)
        val network = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val capabilities = network.getNetworkCapabilities(network.activeNetwork)
        val device = JSONObject()
            .put("manufacturer",Build.MANUFACTURER).put("model",Build.MODEL)
            .put("android",Build.VERSION.RELEASE).put("api",Build.VERSION.SDK_INT)
            .put("abis",JSONArray(Build.SUPPORTED_ABIS.toList())).put("process64Bit",Process.is64Bit())
            .put("emulator",Build.FINGERPRINT.startsWith("generic") || Build.MODEL.contains("sdk_gphone") || Build.HARDWARE in listOf("goldfish","ranchu"))
            .put("totalRamMb",info.totalMem / (1024*1024)).put("freeStorageMb",StatFs(context.filesDir.absolutePath).availableBytes / (1024*1024))
            .put("wifi",capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true)
            .put("metered",network.isActiveNetworkMetered)
        return PocketStatus("unavailable",info.availMem / (1024*1024),device)
    }
}
