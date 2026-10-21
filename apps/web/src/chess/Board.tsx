import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";
import { Icon } from "../Icon";
import { Pieces, type PieceState, type PieceVisual } from "./Pieces";
import { BoardBranding } from "./BoardBranding";
import { LITE, pixelRatio } from "../lite";

type Props = { fen: string; color?: Color; selectableColor?: Color | null; selected?: Square | null; targets?: { square: Square; capture: boolean }[]; lastMove?: Move | null; onSquare?: (square: Square) => void; demo?: boolean };
type Piece = PieceVisual & { type: PieceSymbol; color: Color; square: Square; from: THREE.Vector3; to: THREE.Vector3; start: number; dying?: boolean };
const PIECE_Y = .045;
const point = (square: string) => new THREE.Vector3(square.charCodeAt(0) - 97 - 3.5, PIECE_Y, 3.5 - (Number(square[1]) - 1));

/**
 * A light scene: shared piece geometry, a single shadow map and additive light instead of post-processing.
 * In lite (a wallet app's browser, a weak phone) it renders at 1× without antialiasing or the shadow
 * map (the pieces keep their contact shadows), with plain glass and fewer stars.
 */
class NightBoard {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, .1, 90);
  private board = new THREE.Group();
  private pieces = new Map<Square, Piece>();
  private dying: Piece[] = [];
  private models = new Pieces();
  private branding: BoardBranding;
  private disposed = false;
  private bursts: { sprite: THREE.Sprite; ring: THREE.Mesh; start: number }[] = [];
  private edge = new THREE.MeshBasicMaterial({ color: 0x7c5cff, transparent: true, opacity: .8 });
  private edgePulse: THREE.Sprite | null = null;
  private checked: Color | null = null;
  private winner: Color | null = null;
  private mateAt = 0;
  private glow: THREE.Texture | null = null;
  private markers = new THREE.Group();
  private check: THREE.Mesh;
  private ray = new THREE.Raycaster();
  private resources = new Set<{ dispose(): void }>();
  private raf = 0;
  private statsAt = 0;
  private observer: ResizeObserver;
  private props: Props;
  private azimuth = .14;
  private elevation = .85;
  private distance = 15.8;
  private orientation: Color = "w";
  private pointers = new Map<number, { x: number; y: number }>();
  private down = { x: 0, y: 0, moved: false };
  private lastTap = 0;
  private lastTapPoint = { x: 0, y: 0 };
  private fen = "";
  private motion = matchMedia("(prefers-reduced-motion: reduce)");
  private reduced = this.motion.matches;
  private visible = true;
  private intersection: IntersectionObserver;
  constructor(private host: HTMLDivElement, props: Props, onPieceState: (state: PieceState) => void) {
    this.props = props;
    this.renderer = new THREE.WebGLRenderer({ antialias: !LITE && devicePixelRatio < 1.8, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(pixelRatio(1.75)); this.renderer.setClearColor(0x03020a, 0);
    this.renderer.shadowMap.enabled = !LITE; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute("aria-hidden", "true"); host.appendChild(this.renderer.domElement);
    this.scene.add(this.board, this.markers);
    const ambient = new THREE.HemisphereLight(0xe9e2ff, 0x21123d, 1.7); this.scene.add(ambient);
    const key = new THREE.DirectionalLight(0xeee8ff, 3.3); key.position.set(-3, 9, 5); key.castShadow = !LITE;
    key.shadow.mapSize.set(2048,2048); key.shadow.camera.left = -6; key.shadow.camera.right = 6; key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
    key.shadow.camera.near = .5; key.shadow.camera.far = 24; key.shadow.bias = -.00015; key.shadow.normalBias = .012; key.shadow.radius = 3; this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7c5cff, 3); rim.position.set(5, 4, -5); this.scene.add(rim);
    this.environment(); this.branding = new BoardBranding(this.renderer); this.board.add(this.branding.group); this.space();
    this.keep(this.edge);
    for(const side of [-1,1]) {
      const a=this.mesh(new THREE.BoxGeometry(9.24,.02,.02),this.edge);a.position.set(0,-.18,side*4.62);
      const b=this.mesh(new THREE.BoxGeometry(.02,.02,9.24),this.edge);b.position.set(side*4.62,-.18,0);this.board.add(a,b);
    }
    this.check = this.mesh(new THREE.RingGeometry(.28, .49, 40), new THREE.MeshBasicMaterial({ color: 0xff478a, transparent: true, opacity: .65, side: THREE.DoubleSide, depthWrite: false }));
    this.check.rotation.x = -Math.PI / 2; this.check.visible = false; this.scene.add(this.check);
    this.observer = new ResizeObserver(this.resize); this.observer.observe(host);
    const c = this.renderer.domElement; c.addEventListener("pointerdown", this.pointerDown); c.addEventListener("pointermove", this.pointerMove); c.addEventListener("pointerup", this.pointerUp); c.addEventListener("pointercancel", this.pointerCancel); c.addEventListener("wheel", this.wheel, { passive: false }); c.addEventListener("contextmenu", this.contextMenu); c.addEventListener("webglcontextlost", this.contextLost);
    document.addEventListener("visibilitychange", this.visibility);
    this.motion.addEventListener("change",this.motionChange);
    this.intersection=new IntersectionObserver(([entry])=>{this.visible=entry?.isIntersecting ?? true;this.visibility();});this.intersection.observe(host);
    this.update(props); this.resize(); this.visibility();
    void this.models.load().then(state => {
      if (this.disposed) return;
      this.host.dataset.pieces = state;
      this.fen = ""; this.update(this.props); onPieceState(state);
    });
  }
  private keep<T extends { dispose(): void }>(resource: T): T { this.resources.add(resource); return resource; }
  private mesh(g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh { return new THREE.Mesh(this.keep(g), this.keep(m)); }
  private environment() {
    const c = document.createElement("canvas"); c.width = 512; c.height = 256;
    const g = c.getContext("2d")!; g.fillStyle = "#100b24"; g.fillRect(0,0,512,256);
    const gradient = g.createLinearGradient(0,0,0,256); gradient.addColorStop(0,"#6c568c"); gradient.addColorStop(.5,"#100b24"); gradient.addColorStop(1,"#03020a"); g.fillStyle = gradient; g.fillRect(0,0,512,256);
    g.fillStyle = "#e9e2ff"; g.fillRect(75,35,65,90); g.fillStyle = "#7c5cff"; g.fillRect(330,30,100,120);
    const t = this.keep(new THREE.CanvasTexture(c)); t.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(this.renderer), target = this.keep(pmrem.fromEquirectangular(t)); this.scene.environment = target.texture; pmrem.dispose();
  }
  private glowTexture() {
    const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d")!;
    const r = g.createRadialGradient(32,32,0,32,32,32); r.addColorStop(0,"#ffffff"); r.addColorStop(.15,"#ffffff"); r.addColorStop(.45,"#ffffff55"); r.addColorStop(1,"#ffffff00"); g.fillStyle=r; g.fillRect(0,0,64,64);
    return this.keep(new THREE.CanvasTexture(c));
  }
  private space() {
    const texture = this.glowTexture(); this.glow = texture;
    for (const [x,y,z,size,opacity] of [[-5,-1,-5,18,.13],[6,-2,1,14,.1],[0,-.5,0,14,.17]]) {
      const s = new THREE.Sprite(this.keep(new THREE.SpriteMaterial({ map: texture, color: 0x7c5cff, blending: THREE.AdditiveBlending, transparent: true, opacity, depthWrite: false }))); s.position.set(x!,y!,z!); s.scale.set(size!,size!,1); this.scene.add(s);
    }
    this.edgePulse=new THREE.Sprite(this.keep(new THREE.SpriteMaterial({map:texture,color:0xff285c,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,opacity:.7})));this.edgePulse.scale.setScalar(.8);this.edgePulse.visible=false;this.scene.add(this.edgePulse);
    const stars=LITE ? 180 : 550, positions = new Float32Array(stars*3);
    let seed=47; const random=() => { seed=(seed*16807)%2147483647; return seed/2147483647; };
    for(let i=0;i<stars;i++) { positions[i*3]=(random()-.5)*48; positions[i*3+1]=-4-random()*9; positions[i*3+2]=(random()-.5)*48; }
    const g=this.keep(new THREE.BufferGeometry()); g.setAttribute("position",new THREE.BufferAttribute(positions,3));
    this.scene.add(new THREE.Points(g,this.keep(new THREE.PointsMaterial({ color: 0xa48bff, size: .035, transparent: true, opacity: .7, sizeAttenuation: true }))));
  }
  private makePiece(type: PieceSymbol, color: Color, square: Square): Piece | null {
    const visual=this.models.make(type,color);
    if(!visual)return null;
    visual.group.position.copy(point(square));this.scene.add(visual.group);
    return {...visual,type,color,square,from:visual.group.position.clone(),to:visual.group.position.clone(),start:0};
  }
  update(props: Props) {
    this.props=props;
    const color=props.color ?? "w";
    if(this.orientation!==color) { this.orientation=color; this.azimuth=color === "w" ? .14 : Math.PI+.14;this.renderer.shadowMap.needsUpdate=true; }
    if(this.fen!==props.fen) {
      const game=new Chess(props.fen), next=new Map<Square,Piece>(), now=performance.now();
      const moving=props.lastMove, animate=!!this.fen && !!moving && !this.reduced;
      const relocations = new Map<string,string>();
      if(animate) {
        relocations.set(moving!.to,moving!.from);
        if(moving!.flags.includes("k")) relocations.set(`f${moving!.from[1]}`,`h${moving!.from[1]}`);
        if(moving!.flags.includes("q")) relocations.set(`d${moving!.from[1]}`,`a${moving!.from[1]}`);
      }
      for(const row of game.board()) for(const piece of row) if(piece) {
        const square=piece.square, source=(relocations.get(square) ?? square) as Square;
        let old=this.pieces.get(source);
        if(old && old.color===piece.color && old.type===piece.type) {
          this.pieces.delete(source); old.square=square;
          if(source!==square) { old.from.copy(old.group.position); old.to.copy(point(square)); old.start=now; }
        } else { old=this.makePiece(piece.type,piece.color,square) ?? undefined; }
        if(!old)continue;
        next.set(square,old);
      }
      for(const p of this.pieces.values()) {
        if(animate) {
          p.dying=true;p.start=now;this.dying.push(p);
          const sprite=new THREE.Sprite(this.keep(new THREE.SpriteMaterial({map:this.glow,color:0x7c5cff,blending:THREE.AdditiveBlending,transparent:true,opacity:.8,depthWrite:false})));
          sprite.position.copy(p.group.position).setY(.3);sprite.scale.setScalar(.4);
          const ring=this.mesh(new THREE.RingGeometry(.42,.47,32),new THREE.MeshBasicMaterial({color:0xa48bff,transparent:true,opacity:.85,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.position.copy(p.group.position).setY(.085);
          this.scene.add(sprite,ring);this.bursts.push({sprite,ring,start:now});
        } else this.removePiece(p);
      }
      this.pieces=next; this.fen=props.fen;
      const king=game.board().flat().find((p)=>p?.type==="k" && p.color===game.turn());
      this.check.visible=game.isCheck(); if(king) this.check.position.copy(point(king.square)).setY(.07);
      this.checked=game.isCheck() ? game.turn() : null;
      this.winner=game.isCheckmate() ? (game.turn()==="w" ? "b" : "w") : null;
      this.mateAt=this.winner ? now : 0;
      this.renderer.shadowMap.needsUpdate=true;
    }
    for(const child of [...this.markers.children]) { this.markers.remove(child); if(child instanceof THREE.Mesh) { child.geometry.dispose(); this.resources.delete(child.geometry); const m=child.material as THREE.Material; m.dispose();this.resources.delete(m); } }
    const marker=(square: Square,capture: boolean,color: number,opacity=.55,squareGlow=false) => { const m=this.mesh(squareGlow ? new THREE.PlaneGeometry(.96,.96) : capture ? new THREE.RingGeometry(.33,.43,24) : new THREE.CircleGeometry(.23,24), new THREE.MeshBasicMaterial({ color, map:!capture && !squareGlow ? this.glow : null, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,blending:THREE.AdditiveBlending })); m.rotation.x=-Math.PI/2;m.position.copy(point(square)).setY(.064);this.markers.add(m); };
    if(props.lastMove) { marker(props.lastMove.from,false,0x7c5cff,.18,true); marker(props.lastMove.to,false,0xa48bff,.3,true); }
    if(props.selected) marker(props.selected,true,0xe9e2ff,.85);
    for(const target of props.targets ?? []) marker(target.square,target.capture,0xb8ff4a,.8);
    for(const p of this.pieces.values()) this.models.highlight(p,props.selectableColor===p.color,props.selected===p.square);
  }
  private removePiece(p: Piece) {
    this.scene.remove(p.group);
    // All piece geometry and materials are shared by the set.
    this.renderer.shadowMap.needsUpdate=true;
  }
  private resize=() => { const w=this.host.clientWidth,h=this.host.clientHeight; if(!w||!h)return;this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix(); };
  private render=() => {
    const now=performance.now();
    let moving=this.dying.length>0;
    for(const p of this.pieces.values()) {
      this.models.idle(p,now,this.reduced);
      if(p.contactShadow)p.contactShadow.visible=!p.start;
      if(p.start) {
        moving=true;const t=this.reduced ? 1 : Math.min(1,(now-p.start)/440),ease=t*t*(3-2*t);
        p.group.position.lerpVectors(p.from,p.to,ease);p.group.position.y+=Math.sin(t*Math.PI)*.65;if(t===1)p.start=0;
      } else p.group.position.y=PIECE_Y;
      if(this.winner===p.color && !this.reduced) {
        const t=(now-this.mateAt)/1200-p.phase*.025;
        if(t>0 && t<1){p.group.position.y+=Math.abs(Math.sin(t*Math.PI*2))*.22;moving=true;}
      }
      if(p.fallback?.lasers){p.fallback.lasers.visible=this.checked===p.color;p.fallback.lasers.scale.z=this.reduced ? 1 : 1+Math.sin(now*.009)*.16;}
    }
    this.dying=this.dying.filter(p=>{
      if(p.contactShadow)p.contactShadow.visible=false;
      const t=this.reduced ? 1 : Math.min(1,(now-p.start)/780);
      if(p.fallback){p.fallback.lids.rotation.x=.12+Math.sin(t*Math.PI)*1.25;p.fallback.mouth.scale.y=.008+Math.sin(t*Math.PI)*.13;}
      p.group.position.y=PIECE_Y-Math.max(0,t-.18)*2.2;p.group.scale.setScalar((p.fallback ? .87 : 1)*(1-t*.3));
      if(t===1){this.removePiece(p);return false;}return true;
    });
    this.bursts=this.bursts.filter(b=>{
      const t=this.reduced ? 1 : Math.min(1,(now-b.start)/780);b.sprite.scale.setScalar(.4+t*2.1);b.sprite.material.opacity=(1-t)*.55;
      b.ring.scale.setScalar(.5+t*2.8);(b.ring.material as THREE.MeshBasicMaterial).opacity=(1-t)*.85;
      if(t===1){this.scene.remove(b.sprite,b.ring);for(const r of [b.sprite.material,b.ring.geometry,b.ring.material as THREE.Material]){r.dispose();this.resources.delete(r);}return false;}return true;
    });
    (this.check.material as THREE.MeshBasicMaterial).opacity=.45+(this.reduced ? .15 : Math.sin(now*.006)*.2);
    this.edge.color.setHex(this.winner ? 0xb8ff4a : this.checked ? 0xed387b : 0x7c5cff);
    this.edge.opacity=this.reduced ? .8 : this.winner && now-this.mateAt<1800 ? .55+Math.sin(now*.014)*.4 : this.checked ? .6+Math.sin(now*.006)*.3 : .8;
    if(this.edgePulse) {
      this.edgePulse.visible=!!this.checked && !this.winner && !this.reduced;
      const t=(now*.0011)%4,side=Math.floor(t),v=(t-side)*9.34-4.67;
      this.edgePulse.position.set(side===0 ? v : side===1 ? 4.67 : side===2 ? -v : -4.67,.02,side===0 ? -4.67 : side===1 ? v : side===2 ? 4.67 : -v);
    }
    if(moving)this.renderer.shadowMap.needsUpdate=true;
    // Fit the whole set before the user's zoom.
    const sa=Math.sin(this.azimuth),ca=Math.cos(this.azimuth),se=Math.sin(this.elevation),ce=Math.cos(this.elevation),tan=Math.tan(THREE.MathUtils.degToRad(19));
    let fit=0;
    for(const {x,y,z} of this.branding.fitPoints) {
      const depth=x*sa*ce+y*se+z*ca*ce,horizontal=x*ca-z*sa,vertical=-x*sa*se+y*ce-z*ca*se;
      fit=Math.max(fit,depth+Math.abs(horizontal)/(tan*this.camera.aspect*.95),depth+Math.abs(vertical)/(tan*.95));
    }
    const radius=fit*this.distance/15.8;
    this.camera.position.set(Math.sin(this.azimuth)*Math.cos(this.elevation)*radius,Math.sin(this.elevation)*radius,Math.cos(this.azimuth)*Math.cos(this.elevation)*radius); this.camera.lookAt(0,0,0);
    this.renderer.render(this.scene,this.camera);
    // Useful for visual/performance review without retaining renderer or scene globals.
    if(now-this.statsAt>1000){this.statsAt=now;this.host.dataset.triangles=String(this.renderer.info.render.triangles);this.host.dataset.drawCalls=String(this.renderer.info.render.calls);this.host.dataset.pieceCount=String(this.pieces.size);}
    this.raf=requestAnimationFrame(this.render);
  };
  private visibility=() => { cancelAnimationFrame(this.raf); if(!document.hidden && this.visible && !this.host.dataset.lost)this.raf=requestAnimationFrame(this.render); };
  private motionChange=() => {this.reduced=this.motion.matches;this.renderer.shadowMap.needsUpdate=true;};
  private pointerDown=(e: PointerEvent) => { this.renderer.domElement.setPointerCapture(e.pointerId);this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(this.pointers.size===1)this.down={x:e.clientX,y:e.clientY,moved:false};else this.down.moved=true; };
  private pointerMove=(e: PointerEvent) => {
    const p=this.pointers.get(e.pointerId);if(!p)return;
    if(this.pointers.size>1) {const other=[...this.pointers.entries()].find(([id])=>id!==e.pointerId)?.[1];if(other) {const before=Math.hypot(p.x-other.x,p.y-other.y),after=Math.hypot(e.clientX-other.x,e.clientY-other.y);if(after>0)this.distance=THREE.MathUtils.clamp(this.distance*before/after,12.5,20);} }
    else {if(Math.hypot(e.clientX-this.down.x,e.clientY-this.down.y)>6)this.down.moved=true;if(this.down.moved){this.azimuth-=(e.clientX-p.x)*.007;this.elevation=THREE.MathUtils.clamp(this.elevation+(e.clientY-p.y)*.005,.6,1.35);}}
    this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  };
  private pointerUp=(e: PointerEvent) => {
    this.pointers.delete(e.pointerId);if(this.down.moved)return;
    const now=performance.now();if(now-this.lastTap<280 && Math.hypot(e.clientX-this.lastTapPoint.x,e.clientY-this.lastTapPoint.y)<18){this.reset();this.lastTap=0;return;}this.lastTap=now;this.lastTapPoint={x:e.clientX,y:e.clientY};
    if(this.props.demo)return;
    const box=this.renderer.domElement.getBoundingClientRect();this.ray.setFromCamera(new THREE.Vector2((e.clientX-box.left)/box.width*2-1,-(e.clientY-box.top)/box.height*2+1),this.camera);
    const hits=this.ray.intersectObjects([...this.pieces.values()].map(p=>p.group),true);
    if(hits[0]) {let group: THREE.Object3D | null=hits[0].object;while(group && group.parent!==this.scene)group=group.parent;const p=[...this.pieces.values()].find(p=>p.group===group);if(p){this.props.onSquare?.(p.square);return;}}
    const hit=this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-.06),new THREE.Vector3());
    if(hit && hit.x>=-4 && hit.x<4 && hit.z>=-4 && hit.z<4)this.props.onSquare?.(`${"abcdefgh"[Math.floor(hit.x+4)]}${8-Math.floor(hit.z+4)}` as Square);
  };
  private pointerCancel=(e: PointerEvent) => {this.pointers.delete(e.pointerId);this.down.moved=true;};
  private wheel=(e: WheelEvent) => {e.preventDefault();this.distance=THREE.MathUtils.clamp(this.distance+e.deltaY*.008,12.5,20);};
  private contextMenu=(e: Event) => e.preventDefault();
  private contextLost=(e: Event) => {e.preventDefault();cancelAnimationFrame(this.raf);this.host.dataset.lost="true";};
  reset=() => {this.azimuth=this.orientation === "w" ? .14 : Math.PI+.14;this.elevation=.85;this.distance=15.8;};
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);this.observer.disconnect();this.intersection.disconnect();this.motion.removeEventListener("change",this.motionChange);document.removeEventListener("visibilitychange",this.visibility);
    const c=this.renderer.domElement;c.removeEventListener("pointerdown",this.pointerDown);c.removeEventListener("pointermove",this.pointerMove);c.removeEventListener("pointerup",this.pointerUp);c.removeEventListener("pointercancel",this.pointerCancel);c.removeEventListener("wheel",this.wheel);c.removeEventListener("contextmenu",this.contextMenu);c.removeEventListener("webglcontextlost",this.contextLost);
    this.models.dispose();this.branding.dispose();for(const resource of this.resources)resource.dispose();this.renderer.dispose();c.remove();
  }
}

export function Board(props: Props) {
  const host=useRef<HTMLDivElement>(null),scene=useRef<NightBoard | null>(null),latest=useRef(props);
  const [failed,setFailed]=useState(false),[pieceState,setPieceState]=useState<PieceState>("loading");latest.current=props;
  useEffect(()=>{try {scene.current=new NightBoard(host.current!,latest.current,setPieceState);}catch {setFailed(true);}return()=>{scene.current?.dispose();scene.current=null;};},[]);
  useEffect(()=>{scene.current?.update(props);},[props.fen,props.color,props.selectableColor,props.selected,props.targets,props.lastMove?.lan,props.onSquare]);
  return <div className={`nc-board ${props.demo ? "nc-demo" : ""}`}>
    <div className="nc-scene" ref={host} />
    {!failed && pieceState==="loading" && <div className="nc-piece-loading" role="status"><span/>SETTING UP THE PIECES</div>}
    {failed && <div className="nc-webgl"><Icon name="alert" size={28}/><p>3D needs WebGL. Enable hardware acceleration, then reload.</p></div>}
    <div className="nc-context-lost">Graphics paused. Reload to restore the board.</div>
    {!props.demo && <button type="button" className="nc-camera" title="Reset camera · double-tap the board" aria-label="Reset board camera" onClick={()=>scene.current?.reset()}><Icon name="orbit" size={18}/></button>}
  </div>;
}
