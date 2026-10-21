/**
 * NIGHT POKER's cards, drawn here as vector art: a standard face (corner indices, the pips of
 * the number cards in their usual places, framed court cards, a big ace) and a NIGHTSHIFT back.
 * The suits and the back's lattice are defined once per page (CardDefs) and reused by every card.
 * Card numbers follow the server: rank = card >> 2 (2 … A), suit = card & 3 (clubs, diamonds, hearts, spades).
 */
const RANKS = "23456789TJQKA";
const SUITS = ["c", "d", "h", "s"] as const;
export const SUIT_NAME = { c: "clubs", d: "diamonds", h: "hearts", s: "spades" } as const;
const RANK_NAME = ["two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "jack", "queen", "king", "ace"];
export const rankText = (c: number) => (RANKS[c >> 2] === "T" ? "10" : RANKS[c >> 2]!);
export const cardName = (c: number) => `${RANK_NAME[c >> 2]} of ${SUIT_NAME[SUITS[c & 3]!]}`;
const red = (c: number) => (c & 3) === 1 || (c & 3) === 2;

/** The suit shapes (100 × 100) and the back's pattern: put once on a page that shows cards. */
export function CardDefs() {
  return <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
    <defs>
      <symbol id="pk-h" viewBox="0 0 100 100"><path d="M50 90C24 70 4 52 4 31 4 16 15 6 28 6c9 0 17 5 22 14 5-9 13-14 22-14 13 0 24 10 24 25 0 21-20 39-46 59Z" /></symbol>
      <symbol id="pk-d" viewBox="0 0 100 100"><path d="M50 3Q68 30 88 50 68 70 50 97 32 70 12 50 32 30 50 3Z" /></symbol>
      <symbol id="pk-s" viewBox="0 0 100 100"><path d="M50 4C62 24 95 41 95 62c0 13-10 22-22 22-9 0-16-5-19-12 1 10 5 17 12 23H34c7-6 11-13 12-23-3 7-10 12-19 12C15 84 5 75 5 62 5 41 38 24 50 4Z" /></symbol>
      <symbol id="pk-c" viewBox="0 0 100 100"><circle cx="50" cy="29" r="20" /><circle cx="27" cy="60" r="20" /><circle cx="73" cy="60" r="20" /><circle cx="50" cy="55" r="11" /><path d="M46 58c-1 17-5 28-13 37h34c-8-9-12-20-13-37Z" /></symbol>
      {/* the back: a fine diamond lattice on night violet; wide enough to stay crisp on a 26 px card */}
      <pattern id="pk-lattice" width="30" height="30" patternUnits="userSpaceOnUse" patternTransform="rotate(45 125 175)">
        <rect width="30" height="30" fill="#1a1040" />
        <path d="M0 0h30v30H0Z" fill="none" stroke="#8f74ff" strokeOpacity=".38" strokeWidth="2" />
        <path d="M15 9l6 6-6 6-6-6Z" fill="#8f74ff" fillOpacity=".22" />
      </pattern>
    </defs>
  </svg>;
}

// pip centres on a 250 × 350 face: three columns, rows from the top; a pip below the middle is turned
const L = 80, C = 125, R = 170;
const PIPS: Record<number, [number, number][]> = {
  0: [[C, 82], [C, 268]], 1: [[C, 82], [C, 175], [C, 268]], 2: [[L, 82], [R, 82], [L, 268], [R, 268]], 3: [[L, 82], [R, 82], [C, 175], [L, 268], [R, 268]],
  4: [[L, 82], [R, 82], [L, 175], [R, 175], [L, 268], [R, 268]], 5: [[L, 82], [R, 82], [C, 128], [L, 175], [R, 175], [L, 268], [R, 268]],
  6: [[L, 82], [R, 82], [C, 128], [L, 175], [R, 175], [C, 222], [L, 268], [R, 268]],
  7: [[L, 82], [R, 82], [L, 144], [R, 144], [C, 175], [L, 206], [R, 206], [L, 268], [R, 268]],
  8: [[L, 82], [R, 82], [C, 113], [L, 144], [R, 144], [L, 206], [R, 206], [C, 237], [L, 268], [R, 268]],
};
const COURT = ["J", "Q", "K"];

/** One card face up (a number 0..51), or its back (null). `size` is the width in px. */
export function PlayingCard({ card, size = 64, className = "", glow = false, dim = false }: { card: number | null; size?: number; className?: string; glow?: boolean; dim?: boolean }) {
  const h = Math.round(size * 1.4);
  if (card === null) return <svg className={`pk-card back ${className}`} width={size} height={h} viewBox="0 0 250 350" role="img" aria-label="A face-down card">
    <rect x="2" y="2" width="246" height="346" rx="20" fill="#f4f0e6" />
    <rect x="12" y="12" width="226" height="326" rx="12" fill="url(#pk-lattice)" />
    <rect x="22" y="22" width="206" height="306" rx="7" fill="none" stroke="#f4f0e6" strokeOpacity=".55" strokeWidth="3" />
    {/* NIGHTSHIFT's crescent in a medallion */}
    <ellipse cx="125" cy="175" rx="54" ry="62" fill="#1a1040" stroke="#f4f0e6" strokeOpacity=".7" strokeWidth="3" />
    <path transform="translate(66 116) scale(4.9)" d="M16.5 3a9.2 9.2 0 1 0 4.7 14.7A8 8 0 0 1 16.5 3Z" fill="#e9e2ff" />
    <circle cx="148" cy="150" r="6" fill="#b8ff4a" />
  </svg>;
  const r = card >> 2, s = SUITS[card & 3]!, ink = red(card) ? "#c8203f" : "#17132a", sym = `#pk-${s}`, rank = rankText(card);
  const compact = size < 46;
  return <svg className={`pk-card face ${glow ? "glow" : ""} ${dim ? "dim" : ""} ${className}`} width={size} height={h} viewBox="0 0 250 350" role="img" aria-label={cardName(card)}>
    <rect x="2" y="2" width="246" height="346" rx="20" fill="#fbf8f1" stroke={glow ? "#b8ff4a" : "#d9d2c3"} strokeWidth={glow ? 8 : 3} />
    <g fill={ink}>
      {compact ? <>
        <text x="20" y="122" fontFamily="Inter, Arial, sans-serif" fontWeight="800" fontSize={rank === "10" ? 112 : 128} letterSpacing={rank === "10" ? -10 : 0}>{rank}</text>
        <use href={sym} x="104" y="178" width="132" height="132" />
      </> : <>
        <text x={rank === "10" ? 12 : 22} y="64" fontFamily="Inter, Arial, sans-serif" fontWeight="800" fontSize="58" letterSpacing={rank === "10" ? -6 : 0}>{rank}</text>
        <use href={sym} x="20" y="74" width="40" height="40" />
        <g transform="rotate(180 125 175)">
          <text x={rank === "10" ? 12 : 22} y="64" fontFamily="Inter, Arial, sans-serif" fontWeight="800" fontSize="58" letterSpacing={rank === "10" ? -6 : 0}>{rank}</text>
          <use href={sym} x="20" y="74" width="40" height="40" />
        </g>
        {r <= 8 && PIPS[r]!.map(([x, y], i) => <use key={i} href={sym} x={x - 24} y={y - 24} width="48" height="48" transform={y > 175 ? `rotate(180 ${x} ${y})` : undefined} />)}
        {r >= 9 && r <= 11 && <>
          <rect x="66" y="66" width="118" height="218" rx="10" fill="none" stroke={ink} strokeWidth="3" strokeOpacity=".55" />
          <rect x="74" y="74" width="102" height="202" rx="6" fill={red(card) ? "#c8203f12" : "#17132a10"} />
          <text x="125" y="196" textAnchor="middle" fontFamily="'Instrument Serif', Georgia, serif" fontSize="120">{COURT[r - 9]}</text>
          <use href={sym} x="105" y="86" width="40" height="40" /><use href={sym} x="105" y="224" width="40" height="40" transform="rotate(180 125 244)" />
        </>}
        {r === 12 && <use href={sym} x="65" y="115" width="120" height="120" />}
      </>}
    </g>
  </svg>;
}
