// Turntable: integrate rotation angles over time. Pure, no DOM.
export type SpinAxis = "yaw" | "pitch" | "roll" | "tumble";
export const SPIN_AXES: SpinAxis[] = ["yaw", "pitch", "roll", "tumble"];
export const SPIN_SPEEDS = [0.25, 0.5, 1, 2, 4];
export const REV_SECONDS = 10; // one revolution at 1x
export const MAX_DT = 0.1; // a hidden tab or a stalled frame must not make the model jump
export interface Angles { yaw: number; pitch: number; roll: number }
export interface SpinSettings { speed: number; axis: SpinAxis; dir: 1 | -1 }

export const wrapAngle = (a: number): number => {
  if (!Number.isFinite(a)) return 0;
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  else if (x <= -Math.PI) x += 2 * Math.PI;
  return x;
};
/** Angular speed (rad/s) of one axis. Tumble turns about all three axes at unrelated rates, so the model keeps showing new sides. */
export function spinRates(s: SpinSettings): Angles {
  const w = (s.dir * (Number.isFinite(s.speed) ? s.speed : 1) * 2 * Math.PI) / REV_SECONDS;
  switch (s.axis) {
    case "yaw": return { yaw: w, pitch: 0, roll: 0 };
    case "pitch": return { yaw: 0, pitch: w, roll: 0 };
    case "roll": return { yaw: 0, pitch: 0, roll: w };
    case "tumble": return { yaw: w, pitch: w * 0.61, roll: w * 0.37 };
  }
}
/** Advance the angles by dt seconds (clamped to MAX_DT); results are wrapped to (-π, π]. */
export function spinStep(a: Angles, dt: number, s: SpinSettings): Angles {
  const d = Math.max(0, Math.min(MAX_DT, Number.isFinite(dt) ? dt : 0)), r = spinRates(s);
  return { yaw: wrapAngle(a.yaw + r.yaw * d), pitch: wrapAngle(a.pitch + r.pitch * d), roll: wrapAngle(a.roll + r.roll * d) };
}
