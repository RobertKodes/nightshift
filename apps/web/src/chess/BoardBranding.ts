import * as THREE from "three";

type Disposable = { dispose(): void };
type Card = { group: THREE.Group; heading: number; phase: number };

/** All decoration belongs to the physical set. The playing surface uses one 2048px map. */
export class BoardBranding {
  readonly group = new THREE.Group();
  readonly fitPoints: THREE.Vector3[] = [];
  private resources = new Set<Disposable>();
  private cards: Card[] = [];
  private disposed = false;
  private anisotropy: number;

  constructor(renderer: THREE.WebGLRenderer) {
    this.anisotropy = renderer.capabilities.getMaxAnisotropy();
    this.group.name = "NIGHTSHIFT signature chess set";
    this.table();
    for (const side of [-1, 1]) this.card(side);
    for (const x of [-4.68, 4.68]) for (const z of [-4.68, 4.68]) {
      for (const y of [-.42, 1.05]) this.fitPoints.push(new THREE.Vector3(x, y, z));
    }
  }

  private keep<T extends Disposable>(resource: T): T { this.resources.add(resource); return resource; }
  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material) {
    return new THREE.Mesh(this.keep(geometry), this.keep(material));
  }
  private canvas(width: number, height = width) {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; return canvas;
  }
  private texture(canvas: HTMLCanvasElement) {
    const texture = this.keep(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = this.anisotropy;
    return texture;
  }
  private image(path: string, draw: (image: HTMLImageElement) => void) {
    const image = new Image();
    image.onload = () => { if (!this.disposed) draw(image); };
    image.src = `${import.meta.env.BASE_URL}${path}`;
  }

  private table() {
    const metal = this.keep(new THREE.MeshPhysicalMaterial({ color: 0x0d0a1f, metalness: .72, roughness: .3, clearcoat: 1, envMapIntensity: .65 }));
    const slab = this.mesh(new THREE.BoxGeometry(9.24, .27, 9.24), metal);
    slab.position.y = -.245; slab.receiveShadow = true; this.group.add(slab);

    // A real bevel surrounds the glass; the hole leaves its single surface map unobstructed.
    const frame = new THREE.Shape();
    frame.moveTo(-4.55, -4.55); frame.lineTo(4.55, -4.55); frame.lineTo(4.55, 4.55); frame.lineTo(-4.55, 4.55); frame.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-4.08, -4.08); hole.lineTo(-4.08, 4.08); hole.lineTo(4.08, 4.08); hole.lineTo(4.08, -4.08); hole.closePath(); frame.holes.push(hole);
    const geometry = new THREE.ExtrudeGeometry(frame, { depth: .24, bevelEnabled: true, bevelSize: .07, bevelThickness: .055, bevelSegments: 3, steps: 1 });
    geometry.rotateX(-Math.PI / 2);
    const bevel = this.mesh(geometry, metal); bevel.position.y = -.24; bevel.receiveShadow = true; this.group.add(bevel);

    const edge = this.keep(new THREE.MeshStandardMaterial({ color: 0x7c5cff, emissive: 0x7c5cff, emissiveIntensity: 1.6, toneMapped: false }));
    for (const side of [-1, 1]) {
      const a = this.mesh(new THREE.BoxGeometry(8.08, .025, .018), edge); a.position.set(0, .043, side * 4.035);
      const b = this.mesh(new THREE.BoxGeometry(.018, .025, 8.08), edge); b.position.set(side * 4.035, .043, 0); this.group.add(a, b);
    }

    const surface = this.canvas(2048), ctx = surface.getContext("2d")!;
    const texture = this.texture(surface);
    let mark: HTMLImageElement | undefined, wordmark: HTMLImageElement | undefined;
    const paint = () => {
      ctx.clearRect(0, 0, 2048, 2048);
      for (let rank = 0; rank < 8; rank++) for (let file = 0; file < 8; file++) {
        const x = file * 256, y = rank * 256, light = (rank + file) % 2 === 0;
        if (light) {
          const gradient = ctx.createLinearGradient(x, y, x + 256, y + 256);
          gradient.addColorStop(0, "#4a3a8f"); gradient.addColorStop(1, "#5b48ad"); ctx.fillStyle = gradient;
        } else ctx.fillStyle = "#0f0b22";
        ctx.fillRect(x, y, 256, 256);
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, 256, 256); ctx.clip();
        if (light) {
          const streak = ctx.createLinearGradient(x, y, x + 256, y + 256);
          streak.addColorStop(0, "#e9e2ff00"); streak.addColorStop(.43, "#e9e2ff00");
          streak.addColorStop(.5, "#e9e2ff13"); streak.addColorStop(.56, "#e9e2ff00"); streak.addColorStop(1, "#e9e2ff00");
          ctx.fillStyle = streak; ctx.fillRect(x, y, 256, 256);
        } else {
          ctx.strokeStyle = "#7c5cff"; ctx.globalAlpha = .12; ctx.lineWidth = 1.5;
          for (let trace = 0; trace < 3; trace++) {
            const offset = trace * 58;
            ctx.beginPath(); ctx.moveTo(x + 20 + offset, y); ctx.lineTo(x + 20 + offset, y + 68);
            ctx.lineTo(x + 53 + offset, y + 101); ctx.lineTo(x + 53 + offset, y + 189); ctx.lineTo(x + 92 + offset, y + 228); ctx.stroke();
            ctx.beginPath(); ctx.arc(x + 53 + offset, y + 189, 4, 0, Math.PI * 2); ctx.stroke();
          }
        }
        ctx.restore();
      }
      // The actual brand SVGs are printed into the map, beneath the material's clearcoat.
      ctx.save(); ctx.globalAlpha = .105;
      if (mark) ctx.drawImage(mark, 564, 564, 920, 920);
      if (wordmark) {
        ctx.drawImage(wordmark, 699, 1504, 650, 165);
        ctx.translate(2048, 2048); ctx.rotate(Math.PI); ctx.drawImage(wordmark, 699, 1504, 650, 165);
      }
      ctx.restore();
      ctx.strokeStyle = "#7c5cff70"; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let i = 0; i <= 8; i++) { const p = Math.min(2047, Math.max(1, i * 256)); ctx.moveTo(p, 0); ctx.lineTo(p, 2048); ctx.moveTo(0, p); ctx.lineTo(2048, p); }
      ctx.stroke(); texture.needsUpdate = true;
    };
    paint();
    void this.image("brand/nightshift-mark.svg", image => { mark = image; paint(); });
    void this.image("brand/nightshift-wordmark.svg", image => { wordmark = image; paint(); });
    const glass = this.mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshPhysicalMaterial({
      map: texture, color: 0xffffff, roughness: .27, metalness: .12, clearcoat: 1, clearcoatRoughness: .16, envMapIntensity: .55,
    }));
    glass.name = "2048px ultraviolet glass / crescent underprint"; glass.rotation.x = -Math.PI / 2; glass.position.y = .04; glass.receiveShadow = true; this.group.add(glass);
    this.framePrint();
  }

  private spaced(ctx: CanvasRenderingContext2D, text: string, y: number, spacing: number) {
    const widths = [...text].map(letter => ctx.measureText(letter).width);
    let x = -(widths.reduce((a, b) => a + b, 0) + (text.length - 1) * spacing) / 2;
    ctx.textAlign = "left";
    [...text].forEach((letter, i) => { ctx.fillText(letter, x, y); x += widths[i]! + spacing; });
    ctx.textAlign = "center";
  }

  private framePrint() {
    const canvas = this.canvas(2048), ctx = canvas.getContext("2d")!, texture = this.texture(canvas);
    const unit = 2048 / 9.24, rail = 4.33 * unit;
    let mark: HTMLImageElement | undefined;
    const paint = () => {
      ctx.clearRect(0, 0, 2048, 2048); ctx.textBaseline = "middle"; ctx.textAlign = "center";
      for (const side of [0, 1]) {
        ctx.save(); ctx.translate(1024, 1024); ctx.rotate(side * Math.PI);
        ctx.fillStyle = "#a48bff"; ctx.shadowColor = "#7c5cff"; ctx.shadowBlur = 12;
        ctx.font = '700 66px "JetBrains Mono", monospace'; this.spaced(ctx, "NIGHTSHIFT", rail + 6, 40);
        ctx.shadowBlur = 0;
        // Each player reads, on the rail nearest them, NIGHTSHIFT and under it the IMD hallmark, both facing them.
        ctx.fillStyle = "#d4c5ff"; ctx.font = '700 26px "JetBrains Mono", monospace';
        ctx.fillText("BUILT ON IMD", -12, rail + 54);
        ctx.strokeStyle = "#a48bff"; ctx.lineWidth = 2.5;
        const dx = 118, dy = rail + 54;
        ctx.beginPath(); ctx.moveTo(dx - 11, dy); ctx.lineTo(dx, dy - 11); ctx.lineTo(dx + 11, dy); ctx.lineTo(dx, dy + 11); ctx.closePath(); ctx.stroke();
        ctx.font = '500 30px "JetBrains Mono", monospace';
        for (let i = 0; i < 8; i++) {
          const p = (i - 3.5) * unit;
          ctx.fillText("abcdefgh"[side ? 7 - i : i]!, p, 4.115 * unit);
          ctx.save(); ctx.translate(-rail, p); ctx.rotate(-Math.PI / 2); ctx.fillText(String(side ? i + 1 : 8 - i), 0, 0); ctx.restore();
        }
        ctx.restore();
      }
      for (const x of [-1, 1]) for (const y of [-1, 1]) {
        const cx = 1024 + x * rail, cy = 1024 + y * rail;
        ctx.fillStyle = "#17102f"; ctx.strokeStyle = "#a48bff"; ctx.lineWidth = 2;
        ctx.shadowColor = "#7c5cff"; ctx.shadowBlur = 18;
        ctx.beginPath(); ctx.arc(cx, cy, 41, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
        if (mark) ctx.drawImage(mark, cx - 29, cy - 29, 58, 58);
      }
      texture.needsUpdate = true;
    };
    paint(); void this.image("brand/nightshift-mark.svg", image => { mark = image; paint(); });
    const print = this.mesh(new THREE.PlaneGeometry(9.24, 9.24), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
    print.rotation.x = -Math.PI / 2; print.position.y = .059; print.name = "Player-facing NIGHTSHIFT signatures and moon medallions"; this.group.add(print);
  }

  private rounded(width: number, height: number, radius: number) {
    const shape = new THREE.Shape(), x = -width / 2, y = -height / 2;
    shape.moveTo(x + radius, y); shape.lineTo(x + width - radius, y); shape.quadraticCurveTo(x + width, y, x + width, y + radius);
    shape.lineTo(x + width, y + height - radius); shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    shape.lineTo(x + radius, y + height); shape.quadraticCurveTo(x, y + height, x, y + height - radius);
    shape.lineTo(x, y + radius); shape.quadraticCurveTo(x, y, x + radius, y); return shape;
  }

  private card(side: number) {
    const group = new THREE.Group(), heading = side === -1 ? 0 : Math.PI, number = side === -1 ? 1 : 7;
    group.name = `NIGHT FROG #${number} glass collectible`; group.position.set(side * 5.38, 1.23, -side * 2.1); group.rotation.y = heading;
    this.cards.push({ group, heading, phase: number }); this.group.add(group);
    const frame = this.mesh(new THREE.ExtrudeGeometry(this.rounded(1.46, 2.05, .12), { depth: .045, bevelEnabled: true, bevelSize: .018, bevelThickness: .018, bevelSegments: 3, steps: 1 }),
      new THREE.MeshPhysicalMaterial({ color: 0x21133b, metalness: .3, roughness: .16, clearcoat: 1, transparent: true, opacity: .86, emissive: 0x7c5cff, emissiveIntensity: .75 }));
    frame.position.z = -.023; group.add(frame);
    const outline = new THREE.EdgesGeometry(frame.geometry, 35);
    group.add(new THREE.LineSegments(this.keep(outline), this.keep(new THREE.LineBasicMaterial({ color: 0xa48bff, transparent: true, opacity: .8, toneMapped: false }))));
    const canvas = this.canvas(768, 1088), ctx = canvas.getContext("2d")!, texture = this.texture(canvas);
    let art: HTMLImageElement | undefined;
    const paint = () => {
      ctx.clearRect(0, 0, 768, 1088); ctx.save(); ctx.beginPath(); ctx.roundRect(0, 0, 768, 1088, 42); ctx.clip();
      ctx.fillStyle = "#0d0a1f"; ctx.fillRect(0, 0, 768, 1088);
      if (art) {
        // Contain the originals: the crown and laser eyes stay inside the card.
        const scale = Math.min(736 / art.width, 804 / art.height), w = art.width * scale, h = art.height * scale;
        ctx.drawImage(art, (768 - w) / 2, 24 + (804 - h) / 2, w, h);
      }
      ctx.textAlign = "center"; ctx.fillStyle = "#e9e2ff"; ctx.font = '700 55px "JetBrains Mono", monospace'; ctx.fillText(`NIGHT FROG #${number}`, 384, 918);
      ctx.fillStyle = "#a48bff"; ctx.font = '500 27px "JetBrains Mono", monospace'; ctx.fillText("NIGHTSHIFT / NIGHT CREW", 384, 982);
      ctx.fillStyle = number === 1 ? "#ffc46b" : "#b8ff4a"; ctx.fillRect(288, 1030, 192, 3); ctx.restore(); texture.needsUpdate = true;
    };
    paint(); void this.image(`chess/frog-${String(number).padStart(3, "0")}.webp`, image => { art = image; paint(); });
    const material = this.keep(new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }));
    const faceGeometry = this.keep(new THREE.PlaneGeometry(1.36, 1.93));
    // Printing both faces keeps the art and label readable from either default camera.
    for (const face of [-1, 1]) {
      const image = new THREE.Mesh(faceGeometry, material); image.position.z = face * .048; image.rotation.y = face === 1 ? 0 : Math.PI; group.add(image);
    }
    const stand = this.mesh(new THREE.CylinderGeometry(.48, .55, .07, 48), new THREE.MeshStandardMaterial({ color: 0x0d0a1f, metalness: .65, roughness: .25, emissive: 0x7c5cff, emissiveIntensity: .2 }));
    stand.position.set(side * 5.38, .01, -side * 2.1); this.group.add(stand);
    for (const x of [side * 5.38 - .8, side * 5.38 + .8]) for (const z of [-side * 2.1 - .12, -side * 2.1 + .12]) {
      for (const y of [-.1, 2.35]) this.fitPoints.push(new THREE.Vector3(x, y, z));
    }
  }

  update(now: number, reduced: boolean) {
    for (const card of this.cards) {
      card.group.position.y = 1.23 + (reduced ? 0 : Math.sin(now * .001 + card.phase) * .035);
      card.group.rotation.y = card.heading + (reduced ? 0 : Math.sin(now * .0007 + card.phase) * THREE.MathUtils.degToRad(2));
    }
  }

  dispose() { this.disposed = true; this.resources.forEach(resource => resource.dispose()); this.resources.clear(); }
}
