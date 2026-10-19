import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Color, PieceSymbol } from "chess.js";
import { glossy } from "./glossy";

export type Frog = {
  group: THREE.Group;
  lids: THREE.Mesh;
  mouth: THREE.Mesh;
  lasers: THREE.Group | null;
  phase: number;
  nextBlink: number;
  blinkAt: number;
};

type Model = { body: THREE.BufferGeometry; outline: THREE.BufferGeometry; lids: THREE.BufferGeometry; mouth: THREE.Vector3; eyes: THREE.Vector3[] };
const INK = 0x090613, GOLD = 0xffc46b, UV = 0x7c5cff, ACID = 0xb8ff4a, CYAN = 0x3ce5f5;

/** Four shared-material draws per frog. Rigid details are merged once per role/side,
 * including their vertex colours; no textures, per-piece lights or subdivision. */
export class FrogPieces {
  private models = new Map<string, Model>();
  private geometries: THREE.BufferGeometry[] = [];
  private glossy = glossy({ vertexColors: true, roughness: .3, metalness: .12, clearcoat: 1, clearcoatRoughness: .19, emissive: 0x35205f, emissiveIntensity: .09 });
  private ink = new THREE.MeshBasicMaterial({ color: INK });
  private hull = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
  private laser = new THREE.MeshBasicMaterial({ color: 0xff285c, transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false });
  private sphere = new THREE.SphereGeometry(1, 10, 6);
  private compact = new THREE.SphereGeometry(1, 8, 5);
  private detail = new THREE.SphereGeometry(1, 6, 4);
  private tiny = new THREE.SphereGeometry(1, 6, 3);
  private beam = new THREE.CylinderGeometry(.012, .028, .65, 5);

  private model(type: PieceSymbol, color: Color): Model {
    const key = type + color, cached = this.models.get(key);
    if (cached) return cached;
    const rigid: THREE.BufferGeometry[] = [], outlines: THREE.BufferGeometry[] = [], lids: THREE.BufferGeometry[] = [];
    const skin = color === "w" ? 0xd9d2ef : 0x8a6fd6;
    const base = color === "w" ? 0xb4a6d0 : 0x302044;
    const accent = color === "w" ? GOLD : CYAN;
    const add = (g: THREE.BufferGeometry, tint: number, pos: number[] = [0,0,0], scale: number[] = [1,1,1], rotation: number[] = [0,0,0], into = rigid) => {
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale)));
      const c = new THREE.Color(tint), a = new Float32Array(g.getAttribute("position").count * 3);
      for (let i=0; i<a.length; i+=3) { a[i]=c.r; a[i+1]=c.g; a[i+2]=c.b; }
      g.setAttribute("color", new THREE.BufferAttribute(a,3)); into.push(g);
    };
    const ball = (tint: number, pos: number[], scale: number[], outline = false) => {
      const size=Math.max(...scale), primitive=size<=.025 ? this.tiny : size<=.08 ? this.detail : size<=.16 ? this.compact : this.sphere;
      add(primitive.clone(), tint, pos, scale);
      if (outline) add(primitive.clone(), INK, pos, scale.map(v=>v+.014), [0,0,0], outlines);
    };
    const box = (tint: number, pos: number[], scale: number[], rotation = [0,0,0]) => add(new THREE.BoxGeometry(1,1,1),tint,pos,scale,rotation);
    const tube = (points: number[][], radius: number, tint: number) => add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),8,radius,4,false),tint);
    const lathe = (profile: number[][], tint: number) => add(new THREE.LatheGeometry(profile.map(p=>new THREE.Vector2(p[0]!,p[1]!)),12),tint);
    // All roles retain the familiar turned foot, waist and upper collar.
    const height = { p:.4, n:.3, b:.72, r:.92, q:1.02, k:1.17 }[type];
    const radius = type === "p" ? .285 : .33;
    lathe([[0,0],[radius,0],[radius+.015,.055],[radius,.12],[radius-.07,.17],[.14,height-.08],[.21,height-.035],[.21,height],[0,height]],base);
    lathe([[radius,.06],[radius+.009,.075],[radius,.095]],accent);
    const headY = { p:.55, n:.92, b:.91, r:1.12, q:1.23, k:1.39 }[type];
    const headZ = type === "n" ? .2 : 0;
    const headW = type === "p" ? .265 : .315;
    if (type === "n") {
      // Keep the existing horse-like S neck and forward muzzle, with frog domes in place of ears.
      const s = new THREE.Shape(); s.moveTo(-.18,.24); s.lineTo(.16,.24);
      s.bezierCurveTo(.17,.48,.02,.58,.08,.74); s.lineTo(.33,.83);
      s.quadraticCurveTo(.4,.93,.27,1.03); s.lineTo(.02,1.13);
      s.bezierCurveTo(-.27,1.16,-.36,.65,-.18,.24);
      const neck = new THREE.ExtrudeGeometry(s,{depth:.23,bevelEnabled:true,bevelSize:.035,bevelThickness:.035,bevelSegments:1,curveSegments:4,steps:1});
      neck.translate(0,0,-.115); neck.rotateY(-Math.PI/2);
      add(neck.clone(),skin);
      const hull=neck.clone(); hull.scale(1.07,1.015,1.04); add(hull,INK,[0,0,0],[1,1,1],[0,0,0],outlines); neck.dispose();
      tube([[-.13,.32,-.21],[-.16,.65,-.22],[-.13,.93,-.12]],.035,accent);
    }
    ball(skin,[0,headY,headZ],[headW,.2,type === "n" ? .34 : .25],true);
    ball(color === "w" ? 0xeee8ff : 0xa48bdf,[0,headY-.075,headZ+.07],[headW*.89,.11,.21]);
    const eyeY = headY+.16, eyeZ = headZ+.055;
    const eyeRadius = type === "p" ? .122 : .145;
    const eyeX = headW*.51;
    for (const x of [-eyeX,eyeX]) {
      ball(0xf6f1db,[x,eyeY,eyeZ],[eyeRadius,eyeRadius,eyeRadius*.9],true);
      ball(type === "k" ? 0xff285c : INK,[x+.018,eyeY-.037,eyeZ+eyeRadius*.86],[.042,.055,.017]);
      ball(0xffffff,[x+.03,eyeY-.023,eyeZ+eyeRadius*.96],[.014,.014,.01]);
      add(new THREE.SphereGeometry(1,10,4,0,Math.PI*2,0,Math.PI/2),skin,[x,0,0],[eyeRadius+.007,eyeRadius+.01,eyeRadius*.9+.008],[0,0,0],lids);
      add(new THREE.TorusGeometry(eyeRadius+.005,.009,2,10),INK,[x,0,0],[1,eyeRadius*.9/eyeRadius,1],[Math.PI/2,0,0],lids);
    }
    tube([[-headW*.75,headY-.035,headZ+.19],[-.1,headY-.078,headZ+.245],[.1,headY-.078,headZ+.245],[headW*.75,headY-.035,headZ+.19]],.016,INK);
    for (const x of [-.065,.065]) ball(INK,[x,headY+.018,headZ+.244],[.016,.011,.009]);

    if (type === "p") {
      // Backwards crew cap: a low dome, rear-facing peak, and acid adjustment strap.
      add(new THREE.SphereGeometry(1,10,4,0,Math.PI*2,0,Math.PI/2),color === "w" ? 0x7154ad : 0x241637,[0,headY+.22,-.035],[.225,.115,.2]);
      ball(accent,[0,headY+.24,-.22],[.22,.025,.15]);
      box(ACID,[0,headY+.235,.153],[.08,.027,.018]);
    }
    if (type === "b" || type === "q") {
      const hy=headY+.17;
      tube([[-.33,hy,headZ],[-.27,hy+.23,headZ-.02],[0,hy+.29,headZ-.05],[.27,hy+.23,headZ-.02],[.33,hy,headZ]],.027,INK);
      for (const x of [-.335,.335]) {
        ball(INK,[x,hy,headZ],[.07,.135,.09]);
        ball(UV,[x*1.13,hy,headZ+.01],[.027,.095,.065]);
      }
      tube([[.35,hy-.05,headZ],[.36,headY-.06,headZ+.2],[.2,headY-.09,headZ+.28]],.014,INK);
      ball(CYAN,[.19,headY-.09,headZ+.28],[.047,.026,.025]);
      if (type === "b") {
        // The pointed dispatcher crest preserves the bishop's mitre silhouette and slit.
        add(new THREE.ConeGeometry(.13,.31,8),skin,[0,headY+.33,-.065]);
        box(INK,[.018,headY+.39,.015],[.022,.14,.02],[0,0,-.35]);
      }
    }
    if (type === "r") {
      lathe([[.29,headY-.14],[.36,headY-.14],[.36,headY+.015],[.3,headY+.015]],base);
      for(let i=0;i<6;i++) { const a=i*Math.PI/3; box(base,[Math.sin(a)*.32,headY+.1,Math.cos(a)*.32],[.145,.19,.12],[0,a,0]); }
      // The small plate is a single two-triangle decal shared by both rooks.
      box(GOLD,[0,headY-.06,.365],[.22,.095,.014]);
    }
    if (type === "q" || type === "k") {
      const king=type === "k", cy=headY+.32, radius=king ? .255 : .23;
      lathe([[radius-.035,cy-.045],[radius,cy-.045],[radius+.018,cy+.025],[radius-.035,cy+.025]],GOLD);
      const crown=new THREE.Shape(); crown.moveTo(-radius,0); crown.lineTo(-radius-.02,.17);
      crown.lineTo(-radius*.5,.08); crown.lineTo(0,king ? .26 : .16);
      crown.lineTo(radius*.5,.08); crown.lineTo(radius+.02,.17); crown.lineTo(radius,0); crown.closePath();
      const g=new THREE.ExtrudeGeometry(crown,{depth:.055,bevelEnabled:false,curveSegments:1,steps:1});
      add(g,GOLD,[0,cy,0]);
      for (const [i,tint] of [0xff68b5,CYAN,ACID].entries()) ball(tint,[(i-1)*radius*.65,cy+.055,.062],[.035,.045,.025]);
      if (king) { box(GOLD,[0,cy+.31,0],[.035,.13,.035]); box(GOLD,[0,cy+.33,0],[.11,.032,.035]); }
    }
    const join=(parts: THREE.BufferGeometry[])=>{
      // Extrudes are non-indexed; normalise primitives before merging either layout.
      const ready=parts.map(p=>p.index ? p.toNonIndexed() : p);
      const g=mergeGeometries(ready,false)!;
      new Set([...parts,...ready]).forEach(p=>p.dispose());this.geometries.push(g);return g;
    };
    const model={ body:join(rigid), outline:join(outlines), lids:join(lids), mouth:new THREE.Vector3(0,headY-.065,headZ+.246), eyes:[new THREE.Vector3(-eyeX,eyeY,eyeZ),new THREE.Vector3(eyeX,eyeY,eyeZ)] };
    this.models.set(key,model);return model;
  }

  make(type: PieceSymbol, color: Color): Frog {
    const model=this.model(type,color),group=new THREE.Group();
    const body=new THREE.Mesh(model.body,this.glossy);body.castShadow=true;body.receiveShadow=true;group.add(body,new THREE.Mesh(model.outline,this.hull));
    const lids=new THREE.Mesh(model.lids,this.glossy);lids.position.set(0,model.eyes[0]!.y,model.eyes[0]!.z);lids.rotation.x=.12;group.add(lids);
    const mouth=new THREE.Mesh(this.compact,this.ink);mouth.position.copy(model.mouth);mouth.scale.set(.13,.008,.012);group.add(mouth);
    let lasers: THREE.Group | null=null;
    if(type === "k") {
      lasers=new THREE.Group();lasers.visible=false;
      for(const eye of model.eyes) {const beam=new THREE.Mesh(this.beam,this.laser);beam.rotation.x=Math.PI/2;beam.position.copy(eye).add(new THREE.Vector3(.018,-.035,.43));lasers.add(beam);}
      group.add(lasers);
    }
    // Present both crews to the default camera; knights keep a three-quarter profile.
    group.rotation.y=type === "n" ? (color === "w" ? -.65 : .65) : (color === "w" ? -.08 : .08);
    group.scale.setScalar(.87);
    return {group,lids,mouth,lasers,phase:Math.random()*Math.PI*2,nextBlink:performance.now()+1800+Math.random()*4500,blinkAt:0};
  }

  idle(frog: Frog, now: number, reduced: boolean) {
    if(reduced) {frog.lids.rotation.x=.12;frog.group.scale.setScalar(.87);return;}
    if(now>frog.nextBlink) {frog.blinkAt=now;frog.nextBlink=now+3000+Math.random()*5500;}
    const t=(now-frog.blinkAt)/220;
    frog.lids.rotation.x=.12+(t<1 ? Math.sin(t*Math.PI)*1.3 : 0);
    frog.group.scale.set(.87,.87*(1+Math.sin(now*.0018+frog.phase)*.009),.87);
  }

  dispose() {this.geometries.forEach(g=>g.dispose());this.sphere.dispose();this.compact.dispose();this.detail.dispose();this.tiny.dispose();this.beam.dispose();this.glossy.dispose();this.ink.dispose();this.hull.dispose();this.laser.dispose();}
}
