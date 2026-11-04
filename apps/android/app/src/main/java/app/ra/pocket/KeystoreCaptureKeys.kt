package app.ra.pocket

import android.security.keystore.KeyProperties
import android.security.keystore.KeyProtection
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** The same random account data key, protected by Android Keystore, never an on-disk raw key. */
interface CaptureErasureRecords {fun erased(account:String):Boolean;fun mark(account:String)}
class KeystoreCaptureKeys(private val erasures:CaptureErasureRecords?=null) : CaptureAccountKeys {
    private val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
    private fun alias(account:String)="ra.capture."+MessageDigest.getInstance("SHA-256").digest(account.toByteArray()).joinToString(""){"%02x".format(it)}
    private fun available(account:String){if(erased(account))throw PocketError("account-erased","This account's local copy has been erased.")}
    private fun key(account:String):SecretKey {available(account);return store.getKey(alias(account),null) as? SecretKey ?: throw PocketError("locked","Unlock the local copy first.")}
    @Synchronized override fun install(account:String,raw:ByteArray) {
        require(raw.size==32)
        available(account)
        if(store.containsAlias(alias(account))) {
            // Verifies an interrupted earlier import too; no separate plaintext verifier is needed.
            val probe=ByteArray(32).also{SecureRandom().nextBytes(it)}
            var decoded:ByteArray?=null
            try {
                val sealed=seal(account,probe,"ra-capture-key-check:$account")
                val cipher=Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE,SecretKeySpec(raw,"AES"),GCMParameterSpec(128,sealed.iv));cipher.updateAAD("ra-capture-key-check:$account".toByteArray())
                decoded=cipher.doFinal(sealed.data)
                if(!MessageDigest.isEqual(probe,decoded))throw PocketError("locked","That key does not open this local copy.")
            }catch(_:Exception){throw PocketError("locked","That key does not open this local copy.")}
            finally{probe.fill(0);decoded?.fill(0)}
        } else {
            val protection=KeyProtection.Builder(KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build()
            store.setEntry(alias(account),KeyStore.SecretKeyEntry(SecretKeySpec(raw,"AES")),protection)
        }
    }
    @Synchronized override fun seal(account:String,plain:ByteArray,aad:String):CaptureEnvelope {
        val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key(account));cipher.updateAAD(aad.toByteArray())
        return CaptureEnvelope(cipher.iv,cipher.doFinal(plain))
    }
    @Synchronized override fun open(account:String,envelope:CaptureEnvelope,aad:String):ByteArray {
        require(envelope.iv.size==12)
        val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(account),GCMParameterSpec(128,envelope.iv));cipher.updateAAD(aad.toByteArray())
        return cipher.doFinal(envelope.data)
    }
    @Synchronized override fun erase(account:String){erasures?.mark(account);store.deleteEntry(alias(account))}
    override fun erased(account:String)=erasures?.erased(account)==true
}
