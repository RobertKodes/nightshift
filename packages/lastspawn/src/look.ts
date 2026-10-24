/**
 * A frog's appearance, as the character creator sets it: every slider is one byte (0-255), so a whole
 * look travels as a short base64url string and is checked the same way on both sides.
 */
export const LOOK_KEYS = [
  // body shape (morph targets on the base frog)
  "headWide", "headFlat", "snout", "cheeks", "belly", "slim", "throat",
  // face
  "lipsFull", "smug", "frown", "lidDroop", "lidAngry",
  // bones
  "height", "build", "eyeSize",
  // colours: hue, saturation, value for skin, belly, lips, pads; iris hue
  "skinH", "skinS", "skinV", "bellyH", "bellyS", "bellyV", "lipH", "lipS", "lipV", "padH", "padS", "padV", "irisH",
  // pattern: 0 none, 1 spots, 2 stripes, 3 dart-frog bands; then its scale, contrast and hue
  "pattern", "patScale", "patMix", "patH",
] as const;
export type LookKey = (typeof LOOK_KEYS)[number];
export type Look = Record<LookKey, number>;

/** The base frog: moss-green, pale belly, dark red-brown lips, heavy lids, amber eyes. */
export const BASE_LOOK: Look = {
  headWide: 0, headFlat: 0, snout: 0, cheeks: 0, belly: 60, slim: 0, throat: 0,
  lipsFull: 40, smug: 70, frown: 0, lidDroop: 115, lidAngry: 0,
  height: 128, build: 128, eyeSize: 128,
  skinH: 72, skinS: 140, skinV: 120, bellyH: 46, bellyS: 60, bellyV: 205, lipH: 6, lipS: 150, lipV: 105, padH: 72, padS: 130, padV: 90, irisH: 24,
  pattern: 0, patScale: 128, patMix: 90, patH: 60,
};

/** The pattern names, in the order the `pattern` byte counts them. */
export const PATTERNS = ["none", "spots", "stripes", "bands"] as const;

const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(Number.isFinite(n) ? n : 0)));

export function encodeLook(l: Partial<Look>): string {
  const b = new Uint8Array(LOOK_KEYS.length);
  LOOK_KEYS.forEach((k, i) => { b[i] = clampByte(l[k] ?? BASE_LOOK[k]); });
  b[LOOK_KEYS.indexOf("pattern")] = Math.min(b[LOOK_KEYS.indexOf("pattern")]!, PATTERNS.length - 1);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A look from its code; anything malformed falls back to the base frog. */
export function decodeLook(code: string | null | undefined): Look {
  const out: Look = { ...BASE_LOOK };
  if (!code || code.length > 64 || !/^[A-Za-z0-9_-]+$/.test(code)) return out;
  let raw: string;
  try { raw = atob(code.replace(/-/g, "+").replace(/_/g, "/")); } catch { return out; }
  LOOK_KEYS.forEach((k, i) => { if (i < raw.length) out[k] = raw.charCodeAt(i); });
  out.pattern = Math.min(out.pattern, PATTERNS.length - 1);
  return out;
}

export const validLook = (code: string): boolean => code === encodeLook(decodeLook(code));

/** A byte as 0..1 (sliders), or -1..1 around the middle (height, build, eye size). */
export const unit = (b: number) => b / 255;
export const signed = (b: number) => (b - 128) / 127;
