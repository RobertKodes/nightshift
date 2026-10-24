/** Ability icons: one hand-drawn line set, gold on dark, 24 by 24. */
const P: Record<string, React.ReactNode> = {
  thrust: <><path d="M4 20 15.5 8.5" /><path d="M15.5 8.5 20 4l-1 5.2z" /><path d="M7 14.5l2.5 2.5" /></>,
  sweep: <><path d="M4 15a8 8 0 0 1 16 0" /><path d="M20 15l-2.6-1.2M20 15l.6-2.8" /><path d="M8 18.5h8" /></>,
  shell_wall: <><path d="M12 3l7 3v6c0 4.6-3.2 7.8-7 9-3.8-1.2-7-4.4-7-9V6z" /><path d="M12 8.5l2.6 1.5v3L12 14.5 9.4 13v-3z" /></>,
  challenge_croak: <><circle cx="7" cy="12" r="2.4" /><path d="M11.5 8.5a5 5 0 0 1 0 7" /><path d="M14.5 6a8.5 8.5 0 0 1 0 12" /><path d="M17.5 3.5a12 12 0 0 1 0 17" /></>,
  leap_slam: <><path d="M12 3v9" /><path d="M8.5 9 12 12.5 15.5 9" /><path d="M4 19h16" /><path d="M6.5 16l-1.5-2M17.5 16l1.5-2M12 16v-1.5" /></>,
  dart: <><path d="M4 20 16 8" /><path d="M16 8l4-4-1.5 5z" /><path d="M5 16l3 3M3.5 17.5l3 3" /></>,
  venom_dart: <><path d="M12 3c3.5 5 5.5 8 5.5 11a5.5 5.5 0 0 1-11 0C6.5 11 8.5 8 12 3z" /><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5" /></>,
  pinning_dart: <><path d="M12 3v12" /><path d="M9 6l3-3 3 3" /><path d="M5 19c2.5-2 11.5-2 14 0" /><path d="M8.5 21c2-1 5-1 7 0" /></>,
  reedfade: <><path d="M7 21c0-6 .5-11 2-16" /><path d="M12 21c0-7 0-11 0-17" /><path d="M17 21c0-6-.5-11-2-15" /><path d="M9 5c-1.2.6-2 1.8-2 3M15 6c1.2.6 2 1.8 2 3" /></>,
  toxic_bloom: <><path d="M7 16a3.5 3.5 0 1 1 1.8-6.5A4.5 4.5 0 0 1 17 9a3.5 3.5 0 0 1 .5 7z" /><path d="M9 19.5h.01M13 20.5h.01M16 19h.01" /></>,
  kindle: <><path d="M12 3c1.5 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 1.5 1 2.5 2 3 .5-3-.5-5.5.5-8z" /></>,
  mending_glow: <><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" /><path d="M12 9.5v5M9.5 12h5" /></>,
  spark_swarm: <><path d="M7 7l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" /><path d="M16 4.5l.7 1.4 1.4.7-1.4.7L16 8.7l-.7-1.4-1.4-.7 1.4-.7z" /><path d="M15 14l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" /></>,
  lantern_ward: <><path d="M10 4h4M12 4V2.5" /><path d="M8.5 6.5h7l1 3v6l-1 2.5h-7l-1-2.5v-6z" /><circle cx="12" cy="12.5" r="2" /><path d="M3.5 12a8.5 8.5 0 0 0 17 0" strokeDasharray="1.5 2.2" /></>,
  tongue: <><path d="M4 13c4 0 6-5 10-5 3.3 0 5 2.4 4.4 4.6-.6 2-3 2.6-4.4 1.4" /><circle cx="13.7" cy="13.2" r="1.4" /><path d="M4 10.5v5" /></>,
  leap: <><path d="M4 18c2-8 10-12 16-10" /><path d="M20 8l-3.2-1.6M20 8l-1.4 3" /><path d="M3 20h5" /></>,
};

/** Item icons, by what the thing is: the same hand-drawn line set as the abilities. */
const ITEM: Record<string, React.ReactNode> = {
  glaive: P.thrust, blowgun: P.dart, shield: P.shell_wall, lantern: P.lantern_ward,
  head: <><path d="M5 15c0-5 3-10 7-10s7 5 7 10" /><path d="M5 15c2 2 4 3 7 3s5-1 7-3" /><path d="M9 11h.01M15 11h.01" /></>,
  shoulders: <><path d="M4 13c1-4 4-6 8-6s7 2 8 6" /><path d="M4 13l2 5M20 13l-2 5" /><path d="M9 9v3M15 9v3" /></>,
  chest: <><path d="M7 4l-3 4 2 3v9h12v-9l2-3-3-4" /><path d="M9 4c1 2 5 2 6 0" /><path d="M12 10v7" /></>,
  hands: <><path d="M8 4h8v8l-1 8H9l-1-8z" /><path d="M8 8h8M8 12h8" /></>,
  waist: <><path d="M3 11h18v4H3z" /><circle cx="12" cy="13" r="1.8" /></>,
  feet: <><path d="M8 3v11l-4 3v3h11l5-3-3-3h-4V3" /><path d="M8 8h5" /></>,
  consumable: <><path d="M12 20c-5 0-8-3-8-7 3 0 6 1 8 4 2-5 5-9 8-11 0 7-3 14-8 14z" /><path d="M12 17v-4" /></>,
  junk: <><path d="M6 18l6-13 6 13z" /><path d="M10 14h4" /></>,
  quest: <><path d="M12 4c4 0 7 4 7 8s-3 8-7 8-7-4-7-8 3-8 7-8z" /><circle cx="10" cy="10" r="1.6" /><circle cx="14.5" cy="13.5" r="1.1" /></>,
};
export function ItemIcon({ kind, size = 28 }: { kind: string; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ITEM[kind] ?? ITEM.junk}</svg>;
}

export function AbilityIcon({ id }: { id: string }) {
  return <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[id] ?? <circle cx="12" cy="12" r="6" />}</svg>;
}
