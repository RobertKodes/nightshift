"""
LASTSPAWN class gear, made for frogs: a reed glaive and a turtle-shell shield (Reedguard), a reed
blowgun (Dartsinger), a firefly lantern (Lampwright). Each piece's grip is at its origin and it points
up its local +Z (glTF +Y), as the rig's hand slots expect. Blender 5.1:
  blender -b --factory-startup --python build_gear.py -- <out_dir> [render]
"""
import bpy, bmesh, sys, math, os
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index("--") + 1:]
OUT = args[0]; RENDER = "render" in args
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def mat(name, rgb, rough=0.6, emit=None):
    m = bpy.data.materials.new(name)
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*rgb, 1); b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1); b.inputs["Emission Strength"].default_value = 3.0
    return m
WOOD = mat("gear_reed", (0.42, 0.33, 0.17)); NODE = mat("gear_reed_node", (0.27, 0.2, 0.1)); CORD = mat("gear_cord", (0.5, 0.18, 0.1))
BONE = mat("gear_bone", (0.82, 0.77, 0.62), 0.35); SHELL = mat("gear_shell", (0.25, 0.22, 0.12), 0.45); SCUTE = mat("gear_scute", (0.45, 0.38, 0.2), 0.4)
IRON = mat("gear_iron", (0.2, 0.18, 0.17), 0.5); GLASS = mat("gear_glow", (0.85, 1.0, 0.55), 0.1, emit=(0.75, 1.0, 0.45))

def obj_from(bm, name, material):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); scene.collection.objects.link(o)
    o.data.materials.append(material)
    for p in me.polygons: p.use_smooth = True
    return o

def cyl(name, r, z0, z1, material, segs=12, r1=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r1 if r1 is not None else r, depth=z1 - z0)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, (z0 + z1) / 2))
    return obj_from(bm, name, material)

def ring(name, r, thick, z, material, segs=16):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r + thick, radius2=r + thick, depth=thick * 1.6)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, z))
    return obj_from(bm, name, material)

def join(name, parts):
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts: p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active; o.name = name
    return o

def blade(name, length, width, thick, z, material, curve=0.06):
    """A leaf blade: widest a third of the way up, curving a little to one side."""
    bm = bmesh.new()
    rows, cols = 14, 8
    grid = []
    for i in range(rows + 1):
        t = i / rows
        w = width * math.sin(math.pi * min(1, t * 1.15)) ** 0.8 * (1 - t * 0.25)
        row = []
        for j in range(cols + 1):
            s = -1 + 2 * j / cols
            x = s * w + curve * t * t
            y = thick * (1 - abs(s) ** 2) * (1 - t * 0.6)
            row.append((bm.verts.new((x, y, z + t * length)), bm.verts.new((x, -y, z + t * length))))
        grid.append(row)
    for i in range(rows):
        for j in range(cols):
            for side in (0, 1):
                a, b, c, d = grid[i][j][side], grid[i][j + 1][side], grid[i + 1][j + 1][side], grid[i + 1][j][side]
                bm.faces.new((a, b, c, d) if side == 0 else (d, c, b, a))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from(bm, name, material)

# ---------- the reed glaive: a long reed shaft with nodes, a bone blade bound on with red cord ----------
parts = [cyl("shaft", 0.03, -0.6, 1.6, WOOD)]
for k in range(7): parts.append(ring(f"node{k}", 0.03, 0.009, -0.45 + k * 0.33, NODE))
for k in range(4): parts.append(ring(f"cord{k}", 0.032, 0.012, 1.52 + k * 0.028, CORD))
parts.append(blade("blade", 0.62, 0.075, 0.016, 1.58, BONE))
parts.append(cyl("butt", 0.034, -0.68, -0.6, NODE, r1=0.02))
glaive = join("glaive", parts)

# ---------- the shell shield: a turtle's back, scutes and a rim, held facing out (glTF +Z = Blender -Y) ----------
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=1.0)
for v in [v for v in bm.verts if v.co.y > 0.05]: bm.verts.remove(v)
bmesh.ops.scale(bm, vec=(0.44, 0.17, 0.4), verts=bm.verts)
shell = obj_from(bm, "shell", SHELL)
# a real thickness: a dome with an inside, so it is never see-through from behind
mod = shell.modifiers.new("thick", "SOLIDIFY"); mod.thickness = 0.035; mod.offset = 1.0
bpy.context.view_layer.objects.active = shell; bpy.ops.object.modifier_apply(modifier=mod.name)
parts = [shell]
def scute(cx, cz, r):
    b = bmesh.new()
    bmesh.ops.create_cone(b, cap_ends=True, segments=6, radius1=r, radius2=r * 0.86, depth=0.03)
    bmesh.ops.rotate(b, verts=b.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, "X"))
    # sit on the dome
    x, z = cx * 0.44, cz * 0.4
    yy = -0.17 * math.sqrt(max(0.0, 1 - cx * cx - cz * cz)) - 0.008
    bmesh.ops.translate(b, verts=b.verts, vec=(x, yy, z))
    return obj_from(b, f"scute{len(parts)}", SCUTE)
parts.append(scute(0, 0, 0.11))
for k in range(6):
    a = k * math.pi / 3 + math.pi / 6
    parts.append(scute(math.cos(a) * 0.5, math.sin(a) * 0.5, 0.09))
b = bmesh.new(); bmesh.ops.create_cone(b, cap_ends=False, segments=32, radius1=1.0, radius2=1.0, depth=0.03)
bmesh.ops.rotate(b, verts=b.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, "X"))
bmesh.ops.scale(b, vec=(0.445, 1, 0.405), verts=b.verts)
rim = obj_from(b, "rim", NODE); mod = rim.modifiers.new("s", "SOLIDIFY"); mod.thickness = 0.03
bpy.context.view_layer.objects.active = rim; bpy.ops.object.modifier_apply(modifier=mod.name)
parts.append(rim)
shield = join("shield", parts)

# ---------- the blowgun: a long thin reed with cord wraps and a carved mouthpiece ----------
parts = [cyl("tube", 0.022, -0.4, 1.3, WOOD, segs=10)]
for z in (-0.05, 0.5, 1.15):
    for k in range(3): parts.append(ring(f"wrap{z}{k}", 0.022, 0.008, z + k * 0.02, CORD, segs=10))
parts.append(cyl("mouth", 0.03, -0.5, -0.4, BONE, r1=0.024))
for k in range(5): parts.append(ring(f"bn{k}", 0.022, 0.006, -0.3 + k * 0.33, NODE, segs=10))
blowgun = join("blowgun", parts)

# ---------- the lantern: an iron cage round a glass of fireflies, hung from its handle (origin) ----------
parts = []
parts.append(cyl("cap", 0.1, -0.16, -0.12, IRON, segs=10, r1=0.04))
parts.append(cyl("base", 0.11, -0.5, -0.46, IRON, segs=10))
for k in range(4):
    a = k * math.pi / 2 + math.pi / 4
    bar = cyl(f"bar{k}", 0.011, -0.47, -0.15, IRON, segs=6); bar.location = (math.cos(a) * 0.095, math.sin(a) * 0.095, 0)
    bpy.context.view_layer.objects.active = bar; bar.select_set(True); bpy.ops.object.transform_apply(location=True)
    parts.append(bar)
parts.append(cyl("glass", 0.082, -0.46, -0.16, GLASS, segs=14))
b = bmesh.new(); bmesh.ops.create_cone(b, cap_ends=True, segments=16, radius1=0.07, radius2=0.07, depth=0.012)
handle = obj_from(b, "handle", IRON); handle.scale = (1, 1, 1)
tor = bpy.data.objects.new("hoop", None)
bpy.ops.mesh.primitive_torus_add(major_radius=0.07, minor_radius=0.009, location=(0, 0, -0.06), rotation=(math.radians(90), 0, 0))
hoop = bpy.context.view_layer.objects.active; hoop.data.materials.append(IRON)
bpy.data.objects.remove(handle, do_unlink=True)
parts.append(hoop)
lantern = join("lantern", parts)

for o in (glaive, shield, blowgun, lantern):
    o.location = (0, 0, 0)
    bpy.context.view_layer.objects.active = o; o.select_set(True)
bpy.ops.object.select_all(action="DESELECT")
# spread out only for the preview render; exported at the origin
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "gear.glb"), export_format="GLB", export_yup=True, export_animations=False)
print("EXPORTED gear")

if RENDER:
    world = bpy.data.worlds.new("w"); scene.world = world
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.06, 0.09, 1)
    scene.render.engine = "BLENDER_EEVEE"; scene.render.resolution_x = 1200; scene.render.resolution_y = 700
    for o, x in ((glaive, -0.9), (shield, -0.1), (blowgun, 0.6), (lantern, 1.2)): o.location.x = x
    lantern.location.z = 1.0; shield.location.z = 0.6
    for at, e in (((2, -3, 3), 600), ((-3, -2, 2), 250), ((0, 3, 3), 300)):
        ld = bpy.data.lights.new("l", "AREA"); ld.energy = e; ld.size = 2
        lo = bpy.data.objects.new("l", ld); scene.collection.objects.link(lo); lo.location = at
        lo.rotation_euler = (Vector((0, 0, 0.6)) - Vector(at)).to_track_quat("-Z", "Y").to_euler()
    cd = bpy.data.cameras.new("c"); cd.lens = 40
    cam = bpy.data.objects.new("c", cd); scene.collection.objects.link(cam); scene.camera = cam
    cam.location = (0.2, -4.2, 0.9); cam.rotation_euler = (Vector((0.15, 0, 0.6)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(OUT, "gear.png"); bpy.ops.render.render(write_still=True)
print("DONE")
