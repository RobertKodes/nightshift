# Makes the Play upload key once, outside the repository, and never prints its password.
# The key signs the AAB you upload; Google re-signs the app with its own key (Play App Signing).
# Back up the folder it writes: without it, updates need Google to reset the upload key.
$ErrorActionPreference = "Stop"
$dir = Join-Path $env:USERPROFILE ".nightshift-android"
$jks = Join-Path $dir "upload.jks"
$props = Join-Path $dir "upload.properties"
if (Test-Path $jks) { Write-Host "An upload key already exists at $jks. Nothing changed."; exit 0 }

$keytool = Join-Path $env:JAVA_HOME "bin\keytool.exe"
if (-not (Test-Path $keytool)) { throw "keytool not found: set JAVA_HOME to a JDK (17 or newer)." }
New-Item -ItemType Directory -Force $dir | Out-Null

# 32 random characters from a cryptographic source
$bytes = New-Object byte[] 24
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$pass = [Convert]::ToBase64String($bytes) -replace '[+/=]', 'x'

& $keytool -genkeypair -v -storetype PKCS12 -keystore $jks -alias upload -keyalg RSA -keysize 4096 -validity 10000 `
  -storepass $pass -keypass $pass -dname "CN=NIGHTSHIFT, O=NIGHTSHIFT, C=RO" 2>&1 | Out-Null
if (-not (Test-Path $jks)) { throw "keytool did not make the key." }

@"
storeFile=$($jks -replace '\\', '/')
storePassword=$pass
keyAlias=upload
keyPassword=$pass
"@ | Set-Content -Encoding ascii $props

# only the public fingerprint is shown: it is safe to share and goes into /setup next to Google's
$fp = (& $keytool -list -v -keystore $jks -alias upload -storepass $pass) | Select-String "SHA256:" | Select-Object -First 1
Write-Host "Upload key made in $dir (back this folder up)."
Write-Host "Upload certificate $($fp.ToString().Trim())"
