package tech.getnightshift.devicekey

import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

// A P-256 key in the Android Keystore that signs only after a strong biometric check.
// The private key never leaves the secure hardware; the app sends the public key to the engine once.
class DeviceKeyModule : Module() {
  private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun b64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

  private fun spec(alias: String, strongBox: Boolean): KeyGenParameterSpec {
    val b = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      .setDigests(KeyProperties.DIGEST_SHA256)
      .setUserAuthenticationRequired(true)
      .setInvalidatedByBiometricEnrollment(true)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
    } else {
      @Suppress("DEPRECATION")
      b.setUserAuthenticationValidityDurationSeconds(-1)
    }
    if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) b.setIsStrongBoxBacked(true)
    return b.build()
  }

  private fun generate(alias: String, strongBox: Boolean) {
    val gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
    gen.initialize(spec(alias, strongBox))
    gen.generateKeyPair()
  }

  override fun definition() = ModuleDefinition {
    Name("DeviceKey")

    // OK when a strong biometric is enrolled; otherwise why signing cannot work yet.
    AsyncFunction("canSign") {
      val ctx = appContext.reactContext ?: return@AsyncFunction "UNAVAILABLE"
      when (BiometricManager.from(ctx).canAuthenticate(BIOMETRIC_STRONG)) {
        BiometricManager.BIOMETRIC_SUCCESS -> "OK"
        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "NO_BIOMETRICS"
        BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE, BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> "NO_HARDWARE"
        else -> "UNAVAILABLE"
      }
    }

    AsyncFunction("hasKey") { alias: String ->
      keyStore().containsAlias(alias)
    }

    AsyncFunction("deleteKey") { alias: String ->
      val ks = keyStore()
      if (ks.containsAlias(alias)) ks.deleteEntry(alias)
      true
    }

    AsyncFunction("getPublicKey") { alias: String ->
      val cert = keyStore().getCertificate(alias) ?: return@AsyncFunction null
      b64(cert.publicKey.encoded)
    }

    // Replaces any key under the alias. StrongBox when the phone has it, else the TEE.
    AsyncFunction("createKey") { alias: String, promise: Promise ->
      try {
        val ks = keyStore()
        if (ks.containsAlias(alias)) ks.deleteEntry(alias)
        val ctx = appContext.reactContext
        val hasStrongBox = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
          ctx?.packageManager?.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE) == true
        var strongBox = hasStrongBox
        try {
          generate(alias, strongBox)
        } catch (e: Exception) {
          if (!strongBox) throw e
          strongBox = false
          generate(alias, false)
        }
        val pub = keyStore().getCertificate(alias).publicKey.encoded
        promise.resolve(mapOf("publicKey" to b64(pub), "strongBox" to strongBox))
      } catch (e: IllegalStateException) {
        // Thrown when no secure lock screen or no enrolled biometric exists.
        promise.reject("NO_BIOMETRICS", e.message ?: "Set up a fingerprint first", e)
      } catch (e: Exception) {
        promise.reject("FAILED", e.message ?: "Could not create the device key", e)
      }
    }

    // Shows the system biometric sheet; the signature exists only if the check passes.
    AsyncFunction("sign") { alias: String, payload: String, title: String, subtitle: String, promise: Promise ->
      val activity = appContext.currentActivity as? FragmentActivity
      if (activity == null) {
        promise.reject("FAILED", "The app is not in the foreground", null)
        return@AsyncFunction
      }
      val key = try {
        keyStore().getKey(alias, null) as? PrivateKey
      } catch (e: Exception) {
        null
      }
      if (key == null) {
        promise.reject("NO_KEY", "This phone has no approval key yet", null)
        return@AsyncFunction
      }
      val sig = Signature.getInstance("SHA256withECDSA")
      try {
        sig.initSign(key)
      } catch (e: KeyPermanentlyInvalidatedException) {
        promise.reject("KEY_INVALIDATED", "Fingerprints changed; register this phone again", e)
        return@AsyncFunction
      } catch (e: Exception) {
        promise.reject("FAILED", e.message ?: "Could not open the device key", e)
        return@AsyncFunction
      }
      var settled = false
      val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
          if (settled) return
          settled = true
          try {
            val s = result.cryptoObject?.signature ?: sig
            s.update(payload.toByteArray(Charsets.UTF_8))
            promise.resolve(mapOf("signature" to b64(s.sign())))
          } catch (e: Exception) {
            promise.reject("FAILED", e.message ?: "Signing failed", e)
          }
        }

        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
          if (settled) return
          settled = true
          val code = when (errorCode) {
            BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_NEGATIVE_BUTTON, BiometricPrompt.ERROR_CANCELED -> "CANCELLED"
            BiometricPrompt.ERROR_LOCKOUT, BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> "LOCKOUT"
            BiometricPrompt.ERROR_NO_BIOMETRICS, BiometricPrompt.ERROR_HW_NOT_PRESENT, BiometricPrompt.ERROR_HW_UNAVAILABLE -> "NO_BIOMETRICS"
            else -> "FAILED"
          }
          promise.reject(code, errString.toString(), null)
        }
      })
      val info = BiometricPrompt.PromptInfo.Builder()
        .setTitle(title)
        .setSubtitle(subtitle)
        .setNegativeButtonText("Cancel")
        .setAllowedAuthenticators(BIOMETRIC_STRONG)
        .build()
      prompt.authenticate(info, BiometricPrompt.CryptoObject(sig))
    }.runOnQueue(Queues.MAIN)
  }
}
