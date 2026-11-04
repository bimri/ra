package app.ra.pocket

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

/** Extra device-bound protection for the passphrase-wrapped local data key. */
class LocalVault {
    private val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private fun alias(account: String): String = "ra.local." + MessageDigest.getInstance("SHA-256")
        .digest(account.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    private fun key(account: String): SecretKey {
        val alias = alias(account)
        if (!store.containsAlias(alias)) {
            KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
                init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256).build())
                generateKey()
            }
        }
        return store.getKey(alias, null) as SecretKey
    }
    @Synchronized fun seal(account: String, text: String): String {
        require(account.length in 1..128 && text.length <= 16384)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(account))
        cipher.updateAAD(account.toByteArray(Charsets.UTF_8))
        return JSONObject().put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .put("data", Base64.encodeToString(cipher.doFinal(text.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)).toString()
    }
    @Synchronized fun open(account: String, text: String): String {
        require(account.length in 1..128 && text.length <= 32768 && store.containsAlias(alias(account)))
        val data = JSONObject(text)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(account), GCMParameterSpec(128, Base64.decode(data.getString("iv"), Base64.NO_WRAP)))
        cipher.updateAAD(account.toByteArray(Charsets.UTF_8))
        return String(cipher.doFinal(Base64.decode(data.getString("data"), Base64.NO_WRAP)), Charsets.UTF_8)
    }
    @Synchronized fun erase(account: String) { store.deleteEntry(alias(account)) }
}
