import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import { Color, Uniform } from "three";

/*
 * Ink outlines from the depth buffer: the Laplacian of 1/z is zero across any flat surface, so it only
 * fires at silhouettes and hard creases. That draws the near-black contour lines of the NIGHTSHIFT art
 * around walls, props, the hull and the frogs in one full-screen pass, with no extra scene render.
 */
const fragment = /* glsl */ `
uniform vec3 ink;
uniform float strength;
uniform float reach;
float inv(const in float d) { return (cameraFar - d * (cameraFar - cameraNear)) / (cameraNear * cameraFar); }
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec2 t = texelSize * 1.5;
  float c = inv(depth);
  float l = inv(readDepth(uv - vec2(t.x, 0.0))), r = inv(readDepth(uv + vec2(t.x, 0.0)));
  float u = inv(readDepth(uv + vec2(0.0, t.y))), d = inv(readDepth(uv - vec2(0.0, t.y)));
  float lap = abs(l + r + u + d - 4.0 * c) / max(c, 1e-6);
  float near = step(1.0 / max(c, 1e-6), reach);
  float e = smoothstep(.014, .05, lap) * near;
  outputColor = vec4(mix(inputColor.rgb, ink, e * strength), inputColor.a);
}`;

export class InkEffect extends Effect {
  constructor({ color = "#05030b", strength = .9, reach = 160 } = {}) {
    super("InkEffect", fragment, {
      attributes: EffectAttribute.DEPTH, blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([["ink", new Uniform(new Color(color))], ["strength", new Uniform(strength)], ["reach", new Uniform(reach)]]),
    });
  }
}
