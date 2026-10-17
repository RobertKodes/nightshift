/**
 * The hero emblem of a sub page: a 3D coin that turns, two orbit rings, a halo and a few sparks,
 * in the landing's colors. Faces show an image (the $SHIFT detective, a frog) or a glyph.
 */
export function Emblem({ img, glyph, label, tone = "uv" }: { img?: string; glyph?: string; label?: string; tone?: "uv" | "acid" | "amber" }) {
  const face = img ? <img src={img} alt="" draggable={false} /> : <span className="em-glyph">{glyph ?? "☾"}</span>;
  return (
    <div className={`emblem em-${tone}`} aria-hidden="true">
      <div className="em-halo" />
      <div className="em-ring r1"><i /></div>
      <div className="em-ring r2"><i /></div>
      <div className="em-coin">
        <div className="em-face front">{face}</div>
        <div className="em-face back">{face}</div>
        {Array.from({ length: 9 }, (_, i) => <span key={i} className="em-layer" style={{ transform: `translateZ(${(i - 4) * 2}px)` }} />)}
      </div>
      {Array.from({ length: 7 }, (_, i) => <b key={i} className="em-spark" style={{ ["--i" as string]: i }} />)}
      {label && <div className="em-label">{label}</div>}
    </div>
  );
}
