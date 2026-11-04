import { requireNativeModule } from 'expo';

// Android Keystore P-256 key that signs only behind a strong biometric check (modules/device-key/android).

export type DeviceKeyErrorCode = 'CANCELLED' | 'LOCKOUT' | 'NO_BIOMETRICS' | 'KEY_INVALIDATED' | 'NO_KEY' | 'FAILED';
export type SignReadiness = 'OK' | 'NO_BIOMETRICS' | 'NO_HARDWARE' | 'UNAVAILABLE';

interface DeviceKeyNative {
  canSign(): Promise<SignReadiness>;
  hasKey(alias: string): Promise<boolean>;
  deleteKey(alias: string): Promise<boolean>;
  getPublicKey(alias: string): Promise<string | null>;
  createKey(alias: string): Promise<{ publicKey: string; strongBox: boolean }>;
  sign(alias: string, payload: string, title: string, subtitle: string): Promise<{ signature: string }>;
}

const CODES: DeviceKeyErrorCode[] = ['CANCELLED', 'LOCKOUT', 'NO_BIOMETRICS', 'KEY_INVALIDATED', 'NO_KEY', 'FAILED'];

export class DeviceKeyError extends Error {
  constructor(readonly code: DeviceKeyErrorCode, message: string) {
    super(message);
    this.name = 'DeviceKeyError';
  }
}

let native: DeviceKeyNative | null = null;
function mod(): DeviceKeyNative {
  if (!native) native = requireNativeModule<DeviceKeyNative>('DeviceKey');
  return native;
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const code = CODES.includes(err.code as DeviceKeyErrorCode) ? (err.code as DeviceKeyErrorCode) : 'FAILED';
    throw new DeviceKeyError(code, err.message ?? 'Device key error');
  }
}

/** Base64 DER signatures (SHA256withECDSA) and base64 SPKI public keys. */
export const DeviceKey = {
  canSign: () => call(() => mod().canSign()),
  hasKey: (alias: string) => call(() => mod().hasKey(alias)),
  deleteKey: (alias: string) => call(() => mod().deleteKey(alias)),
  getPublicKey: (alias: string) => call(() => mod().getPublicKey(alias)),
  createKey: (alias: string) => call(() => mod().createKey(alias)),
  sign: (alias: string, payload: string, title: string, subtitle = '') => call(() => mod().sign(alias, payload, title, subtitle)),
};
