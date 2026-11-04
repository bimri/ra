package app.ra.pocket

import java.net.URI
import java.util.Locale

/** No wildcard, opaque URL, alternate port or lookalike hostname can receive a port. */
class TrustedOrigin(url: String) {
    private val root = URI(url)
    init { require(root.scheme in listOf("http","https") && root.host != null && root.userInfo == null) }
    private fun port(uri: URI): Int = if (uri.port != -1) uri.port else if (uri.scheme == "https") 443 else 80
    fun allows(url: String): Boolean = try {
        val uri = URI(url)
        uri.userInfo == null && uri.scheme?.lowercase(Locale.ROOT) == root.scheme &&
            uri.host?.lowercase(Locale.ROOT) == root.host.lowercase(Locale.ROOT) && port(uri) == port(root)
    } catch (_: Exception) { false }
}
