import type { DeckActor, DeckCrew } from "./crew";
import { LAYOUTS, route, type Act, type Seat, type Spot, type XZ } from "./layout";

/** Whatever rolls a seat's chair in or out (each room builds its own chairs). */
export type Chairs = { chair(seat: Seat, out: number): void };

type Mode = "seated" | "rising" | "sitting" | "walking" | "turning" | "acting";
type Goal = { kind: "visit" | "home" | "seat"; spot: Spot | null };
export type Mind = {
  actor: DeckActor; bay: number; seat: Seat | null; home: Spot | null; mode: Mode; goal: Goal | null; path: XZ[];
  x: number; z: number; y: number; heading: number; transit: number; next: number; wait: number;
  working: boolean; cheering: boolean; restless: boolean; active: boolean; reserved: Spot | null;
};

const WALK = .8, TURN = 4.5;
const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (t: number) => t * t * (3 - 2 * t);
const pick = <T,>(items: T[]) => items[Math.random() * items.length | 0];
const between = (a: number, b: number) => a + Math.random() * (b - a);
const CLIPS: Record<Act, [string, string]> = { look: ["Idle", "Idle"], use: ["Interact", "Idle"], point: ["Interact", "Idle"], cheer: ["Cheer", "Idle"], talk: ["Interact", "Idle"] };

/** Each room's crew: who sits, who stands, who gets up and wanders, and where everyone walks. */
export function createBrains(crew: DeckCrew, interior: Chairs, actors: DeckActor[][]) {
  const minds = actors.map((room, bay) => room.map((actor, slot): Mind => {
    const layout = LAYOUTS[bay]!, seat = layout.seats[slot] ?? null, home = seat ? null : layout.homes[slot - layout.seats.length] ?? null;
    return { actor, bay, seat, home, mode: seat ? "seated" : "acting", goal: null, path: [], x: 0, z: 0, y: 0, heading: 0, transit: 0, next: 0, wait: 0, working: false, cheering: false, restless: !seat && slot === room.length - 1, active: false, reserved: null };
  }));
  const taken = new Set<Spot>();

  function settle(mind: Mind) {
    if (mind.reserved) { taken.delete(mind.reserved); mind.reserved = null; }
    mind.path = []; mind.goal = null; mind.transit = 0; mind.wait = 0;
    if (mind.seat) {
      Object.assign(mind, { mode: "seated", x: mind.seat.at[0], z: mind.seat.at[1], y: mind.seat.y, heading: mind.seat.face, next: between(2, 12) });
      interior.chair(mind.seat, 0); crew.play(mind.actor, seatedClip(mind), 0);
    } else if (mind.home) {
      Object.assign(mind, { mode: "acting", x: mind.home.at[0], z: mind.home.at[1], y: 0, heading: mind.home.face, next: mind.restless ? between(.4, 2.5) : between(3, 14) });
      crew.play(mind.actor, CLIPS[mind.home.act][0], 0);
    }
    place(mind);
  }
  function seatedClip(mind: Mind) { return mind.cheering && Math.random() < .5 ? "Seat_Cheer" : mind.working && Math.random() < .75 ? Math.random() < .6 ? "Seat_Work" : "Seat_Type" : "Sit_Chair_Idle"; }
  // actors live in their room's frame (the room group places and turns it on the deck)
  function place(mind: Mind) { mind.actor.root.position.set(mind.x, mind.y, mind.z); mind.actor.root.rotation.y = mind.heading; }
  const away = (bay: number) => minds[bay]!.filter((m) => m.active && (m.mode === "walking" || m.mode === "rising" || m.mode === "turning" || (m.mode === "acting" && m.goal?.kind === "visit"))).length;

  /** Sends a frog to a free place in its room, out of its chair first if it sits. */
  function wander(mind: Mind) {
    const layout = LAYOUTS[mind.bay]!, options = [...layout.visits, ...layout.homes].filter((s) => s !== mind.home && !taken.has(s) && !minds[mind.bay]!.some((m) => m.active && m.home === s && m.mode === "acting" && !m.goal));
    const spot = pick(options); if (!spot) return false;
    taken.add(spot); mind.reserved = spot; mind.goal = { kind: "visit", spot };
    if (mind.seat && mind.mode === "seated") { mind.mode = "rising"; mind.transit = 0; crew.play(mind.actor, "Idle", .45); }
    else walk(mind, route(layout, [mind.x, mind.z], spot.at));
    return true;
  }
  function walk(mind: Mind, path: XZ[]) { mind.path = path; mind.mode = "walking"; mind.wait = 0; crew.play(mind.actor, "Walking_A", .25); }
  function goHome(mind: Mind) {
    if (mind.reserved) { taken.delete(mind.reserved); mind.reserved = null; }
    const layout = LAYOUTS[mind.bay]!;
    if (mind.seat) { mind.goal = { kind: "seat", spot: null }; walk(mind, [...route(layout, [mind.x, mind.z], mind.seat.exit), mind.seat.stand]); }
    else if (mind.home) { mind.goal = { kind: "home", spot: mind.home }; walk(mind, route(layout, [mind.x, mind.z], mind.home.at)); }
  }

  function step(mind: Mind, dt: number) {
    const crewClip = (name: string, fade = .3, speed = 1) => crew.play(mind.actor, name, fade, speed);
    mind.next -= dt;
    switch (mind.mode) {
      case "seated":
        if (mind.next > 0) break;
        if (!mind.seat!.fixed && away(mind.bay) < 2 && Math.random() < .3 && wander(mind)) break;
        crewClip(seatedClip(mind), .5); mind.next = between(3, 9);
        break;
      case "rising": case "sitting": {
        const seat = mind.seat!; mind.transit = Math.min(1, mind.transit + dt / .8);
        const t = smooth(mind.mode === "rising" ? mind.transit : 1 - mind.transit);
        mind.x = seat.at[0] + (seat.stand[0] - seat.at[0]) * t; mind.z = seat.at[1] + (seat.stand[1] - seat.at[1]) * t; interior.chair(seat, t);
        if (mind.transit < 1) break;
        if (mind.mode === "rising") walk(mind, [seat.exit, ...route(LAYOUTS[mind.bay]!, seat.exit, mind.goal!.spot!.at)]);
        else { mind.mode = "seated"; mind.goal = null; mind.next = between(8, 22); }
        break;
      }
      case "walking": {
        const target = mind.path[0];
        if (!target) { mind.mode = "turning"; crewClip("Idle", .25); break; }
        const dx = target[0] - mind.x, dz = target[1] - mind.z, d = Math.hypot(dx, dz), last = mind.path.length === 1;
        if (d < (last ? .05 : .3)) { mind.path.shift(); break; }
        const diff = angle(Math.atan2(dx, dz) - mind.heading); mind.heading += Math.sign(diff) * Math.min(Math.abs(diff), TURN * dt);
        // give way to a frog standing right ahead, for a moment
        const blocked = mind.wait < 1.6 && minds[mind.bay]!.some((o) => o !== mind && o.active && Math.hypot(o.x - mind.x, o.z - mind.z) < .75 && (Math.sin(mind.heading) * (o.x - mind.x) + Math.cos(mind.heading) * (o.z - mind.z)) > .35 && !(o.mode === "walking" && o.wait > 0));
        mind.wait = blocked ? mind.wait + dt : 0;
        const speed = blocked ? 0 : WALK * Math.max(0, Math.cos(diff)) ** 2 * (last ? Math.min(1, d * 2.2 + .25) : 1);
        mind.x += Math.sin(mind.heading) * speed * dt; mind.z += Math.cos(mind.heading) * speed * dt;
        crewClip(speed < .05 ? "Idle" : "Walking_A", .25, speed < .05 ? 1 : Math.max(.55, speed / WALK));
        break;
      }
      case "turning": {
        const face = mind.goal?.kind === "seat" ? mind.seat!.face : mind.goal?.spot?.face ?? mind.heading, diff = angle(face - mind.heading);
        mind.heading += Math.sign(diff) * Math.min(Math.abs(diff), TURN * .7 * dt);
        if (Math.abs(diff) > .03) break;
        if (mind.goal?.kind === "seat") { mind.mode = "sitting"; mind.transit = 0; crewClip(seatedClip(mind), .7); }
        else { mind.mode = "acting"; mind.next = mind.goal?.kind === "home" ? between(6, 16) : between(4, 9); actClip(mind, true); }
        break;
      }
      case "acting":
        if (mind.next > 0) { if (Math.random() < dt * .35) actClip(mind, false); break; }
        if (mind.goal?.kind === "visit") { goHome(mind); break; }
        if (away(mind.bay) < 2 && Math.random() < (mind.restless ? .9 : .35) && wander(mind)) break;
        mind.next = between(5, 12);
        break;
    }
    place(mind);
  }
  function actClip(mind: Mind, first: boolean) {
    const act = (mind.goal?.spot ?? mind.home)?.act ?? "look", [busy, rest] = CLIPS[act];
    if (act === "cheer" && !mind.cheering) { crew.play(mind.actor, "Idle", .4); return; }
    crew.play(mind.actor, first || Math.random() < .6 ? busy : rest, .4);
  }

  return {
    minds,
    /** Who is on duty in each slot; empty slots stand down. */
    assign(bay: number, slot: number, active: boolean, working: boolean, cheering: boolean) {
      const mind = minds[bay]![slot]!; mind.working = working; mind.cheering = cheering;
      if (active === mind.active) return;
      mind.active = active; mind.actor.root.visible = active;
      settle(mind);
    },
    update(bay: number, dt: number) { for (const mind of minds[bay]!) if (mind.active) step(mind, dt); },
    reset() { for (const room of minds) for (const mind of room) if (mind.active) settle(mind); },
  };
}
export type Brains = ReturnType<typeof createBrains>;
