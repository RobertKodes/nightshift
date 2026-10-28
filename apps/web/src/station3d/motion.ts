export type Spring = { value: number; velocity: number };
export const spring = (value: number): Spring => ({ value, velocity: 0 });

/** Exact critically damped response; frame rate does not change the settling time. */
export function damp(state: Spring, target: number, seconds: number, dt: number) {
  const omega = 2 / seconds, offset = state.value - target, impulse = state.velocity + omega * offset;
  const decay = Math.exp(-omega * dt);
  state.value = target + (offset + impulse * dt) * decay;
  state.velocity = (state.velocity - omega * impulse * dt) * decay;
  return state.value;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** A brief visual hold near each stop, without moving or capturing the document scroll. */
export function settle(progress: number, speed: number) {
  const stop = Math.round(progress), distance = Math.abs(progress - stop);
  const slow = 1 - smooth(.45, 1.5, speed);
  const weight = (1 - smooth(.025, .115, distance)) * slow;
  return progress + (stop - progress) * weight;
}
