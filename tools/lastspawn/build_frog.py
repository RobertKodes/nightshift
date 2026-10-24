"""
LASTSPAWN base frog, v2. The body is metaballs (head, torso, limbs) joined with modeled hands and feet
(separate fingers and toes with pads, webbed feet), remeshed fine, the mouth and face carved into the
skin, decimated to a game budget, skinned to the KayKit Rig_Medium (CC0) with creator shape keys and a
colour-region mask. Blender 5.1:
  blender -b --factory-startup --python build_frog2.py -- <Knight.glb> <out_dir> [render]
Blender is Z-up and the rig faces -Y.
"""
import bpy, bmesh, sys, math, os
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

args = sys.argv[sys.argv.index("--") + 1:]
KNIGHT, OUT = args[0], args[1]
RENDER = "render" in args
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=KNIGHT)
rig = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
for o in list(bpy.data.objects):
    if o.type == "MESH": bpy.data.objects.remove(o, do_unlink=True)
rig.name = "FrogRig"
for b in rig.data.bones:
    b.use_deform = not any(k in b.name for k in ("IK", "control", "slot")) and b.name != "root"

def deselect():
    for o in bpy.context.selected_objects: o.select_set(False)

def apply_mod(o, kind, **kw):
    m = o.modifiers.new(kind.lower(), kind)
    for k, v in kw.items(): setattr(m, k, v)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=m.name)

ss = lambda e0, e1, x: (lambda t: t * t * (3 - 2 * t))(max(0.0, min(1.0, (x - e0) / (e1 - e0))))
g = lambda x: math.exp(-x * x)

# ---------- 1. the core: head, torso and limbs as one metaball ----------
mb = bpy.data.metaballs.new("FrogMB"); mb.resolution = 0.014; mb.render_resolution = 0.014; mb.threshold = 0.6
mbo = bpy.data.objects.new("FrogMB", mb); scene.collection.objects.link(mbo)

def calib():
    t = bpy.data.metaballs.new("cal"); t.resolution = 0.01; e = t.elements.new(type="BALL"); e.radius = 1.0; e.stiffness = 2.0
    o = bpy.data.objects.new("cal", t); scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o; deselect(); o.select_set(True)
    bpy.ops.object.convert(target="MESH")
    m = bpy.context.view_layer.objects.active; r = max(v.co.x for v in m.data.vertices)
    bpy.data.objects.remove(m, do_unlink=True); return r
K = calib()

def ellipsoid(co, size, stiff=2.0):
    e = mb.elements.new(type="ELLIPSOID"); e.co = Vector(co); e.radius = 1.0 / K
    e.size_x, e.size_y, e.size_z = size; e.stiffness = stiff

def capsule(a, b, r, stiff=2.0):
    a, b = Vector(a), Vector(b); d = b - a
    e = mb.elements.new(type="CAPSULE"); e.co = (a + b) / 2; e.radius = r / K; e.stiffness = stiff
    e.size_x = d.length / 2; e.rotation = Vector((1, 0, 0)).rotation_difference(d.normalized())

ellipsoid((0, -0.03, 1.47), (0.50, 0.40, 0.30))          # head: broad and low
ellipsoid((0, -0.07, 1.31), (0.44, 0.36, 0.17))          # jaw and throat
ellipsoid((0, -0.02, 1.62), (0.36, 0.30, 0.16))          # dome
for s in (1, -1):
    ellipsoid((s * 0.23, -0.17, 1.66), (0.17, 0.15, 0.13))   # eye sockets
ellipsoid((0, 0.0, 1.02), (0.33, 0.27, 0.26))             # chest
ellipsoid((0, -0.03, 0.74), (0.36, 0.30, 0.30))           # belly
ellipsoid((0, 0.02, 0.52), (0.31, 0.26, 0.17))            # hips
for s in (1, -1):
    capsule((s * 0.20, 0, 1.10), (s * 0.455, 0.01, 1.105), 0.086)     # upper arm
    capsule((s * 0.455, 0.01, 1.105), (s * 0.77, 0, 1.105), 0.072)    # forearm, into the wrist
    capsule((s * 0.17, 0.0, 0.52), (s * 0.172, -0.006, 0.29), 0.115)  # thigh
    capsule((s * 0.172, -0.006, 0.29), (s * 0.171, 0.018, 0.13), 0.075)  # shin
    ellipsoid((s * 0.171, -0.03, 0.06), (0.08, 0.1, 0.05))           # heel
bpy.context.view_layer.objects.active = mbo; deselect(); mbo.select_set(True)
bpy.ops.object.convert(target="MESH")
core = bpy.context.view_layer.objects.active; core.name = "Frog_Body"
for o in list(bpy.data.objects):
    if o.type == "META": bpy.data.objects.remove(o, do_unlink=True)

# ---------- 2. hands and feet, modeled: separate fingers and toes, round pads ----------
digits = bmesh.new()
PADS = []
def blob(c, r, along=None, length=None):
    """A sphere, or an ellipsoid stretched along a direction: the pieces fingers are made of."""
    m = bmesh.new(); bmesh.ops.create_uvsphere(m, u_segments=20, v_segments=14, radius=1.0)
    if along is None: S = Matrix.Diagonal((r[0], r[1], r[2], 1)) if isinstance(r, tuple) else Matrix.Scale(r, 4)
    else:
        q = Vector((1, 0, 0)).rotation_difference(along.normalized()).to_matrix().to_4x4()
        S = q @ Matrix.Diagonal((length / 2, r, r, 1))
    bmesh.ops.transform(m, matrix=Matrix.Translation(c) @ S, verts=m.verts)
    me = bpy.data.meshes.new("t"); m.to_mesh(me); m.free(); digits.from_mesh(me); bpy.data.meshes.remove(me)

def finger(base, direction, curl, segs, r, pad, flat=0.62):
    p, d = Vector(base), Vector(direction).normalized()
    side = d.cross(Vector((0, 0, 1))).normalized()
    for i, L in enumerate(segs):
        # each knuckle bends the finger down toward the palm a little more
        d = (Matrix.Rotation(math.radians(curl[i]), 3, side) @ d).normalized()
        blob(p + d * L / 2, r * (1 - 0.1 * i), along=d, length=L * 1.55)
        p = p + d * L
    tip = p + d * pad * 0.3
    blob(tip, (pad, pad, pad * flat)); PADS.append(tip.copy())

for s in (1, -1):
    # palm (T-pose, palm down), slightly cupped
    blob(Vector((s * 0.84, 0, 1.103)), (0.078, 0.088, 0.043))
    blob(Vector((s * 0.80, 0, 1.105)), (0.05, 0.062, 0.05))           # wrist heel, blends into the forearm
    for ang, segs, base_y in ((-62, (0.05, 0.045), -0.07), (-20, (0.072, 0.06), -0.045), (6, (0.08, 0.064), -0.005), (30, (0.07, 0.058), 0.04)):
        a = math.radians(ang)
        d = Vector((s * math.cos(a), math.sin(a), -0.08))
        finger(Vector((s * 0.885, base_y, 1.1)), d, (-6, -16), segs, 0.026, 0.032)
    # foot: three long toes with pads, webbed between them, and a short inner toe
    blob(Vector((s * 0.171, -0.1, 0.04)), (0.075, 0.075, 0.035))
    for ang, segs in ((-30, (0.09, 0.075)), (-6, (0.11, 0.085)), (20, (0.1, 0.08)), (46, (0.06, 0.05))):
        a = math.radians(ang)
        d = Vector((s * math.sin(a), -math.cos(a), -0.02))
        finger(Vector((s * 0.171, -0.14, 0.03)), d, (2, 2), segs, 0.022, 0.03, flat=0.55)
    blob(Vector((s * 0.171, -0.235, 0.02)), (0.13, 0.095, 0.012))   # webbing
dme = bpy.data.meshes.new("digits"); digits.to_mesh(dme); digits.free()
dob = bpy.data.objects.new("digits", dme); scene.collection.objects.link(dob)
deselect(); core.select_set(True); dob.select_set(True); bpy.context.view_layer.objects.active = core
bpy.ops.object.join()

# ---------- 3. fine remesh: one watertight skin ----------
apply_mod(core, "REMESH", mode="VOXEL", voxel_size=0.0058)
apply_mod(core, "CORRECTIVE_SMOOTH", factor=0.5, iterations=4, smooth_type="SIMPLE")
me = core.data; me.update()
print("dense verts", len(me.vertices))

# ---------- 4. carve the face into the skin: mouth line, lips, nostrils, ear discs ----------
bvh = BVHTree.FromObject(core, bpy.context.evaluated_depsgraph_get())
def on_head(a, z):
    o = Vector((math.sin(a) * 2.0, -0.03 - math.cos(a) * 2.0, z)); t = Vector((0, -0.03, z))
    hit, nrm, _, _ = bvh.ray_cast(o, (t - o).normalized()); return hit, nrm

SPREAD, Z0, DROP = math.radians(80), 1.33, 0.045
mouth = []
for i in range(241):
    t = -1.15 + 2.3 * i / 240
    hit, nrm = on_head(t * SPREAD, Z0 - DROP * abs(t) ** 2.2)
    if hit: mouth.append([t, hit, nrm])
for k, m in enumerate(mouth):
    T = (mouth[min(k + 1, len(mouth) - 1)][1] - mouth[max(k - 1, 0)][1]).normalized()
    N = (m[2] - T * m[2].dot(T)).normalized()
    m.extend([T, N, T.cross(N).normalized()])      # tangent, outward normal, up along the face
kd = KDTree(len(mouth))
for i, m in enumerate(mouth): kd.insert(m[1], i)
kd.balance()
CORNERS = [mouth[min(range(len(mouth)), key=lambda i: abs(mouth[i][0] - c))][1] for c in (-1.0, 1.0)]

ears = []
for s in (1, -1):
    hit, nrm, _, _ = bvh.ray_cast(Vector((s * 2.0, 0.04, 1.5)), Vector((-s, 0, 0)))
    if hit: ears.append((hit, nrm))
nostrils = [on_head(s * 0.11, 1.43) for s in (1, -1)]

lipmask = [0.0] * len(me.vertices); earmask = [0.0] * len(me.vertices)
for v in me.vertices:
    p = v.co
    if p.y < -0.12 and 1.12 < p.z < 1.5:
        _, i, dist = kd.find(p)
        if dist < 0.12:
            t, c, nrm, T, N, B = mouth[i]
            d = p - c; dz = d.dot(B); along = d.dot(T)
            at = abs(t)
            lips = 1.0 - 0.62 * ss(0.45, 1.0, at)        # full in the middle, thinner to the corners
            lips *= 1.0 - ss(0.98, 1.1, at)
            end = 1.0 - ss(1.06, 1.14, at)
            upper = 0.03 * g((dz - 0.026) / 0.021)
            lower = 0.036 * g((dz + 0.031) / 0.025)
            crease = 0.03 * g(dz / 0.0068) * end
            dimple = sum(0.014 * g((p - cc).length / 0.024) for cc in CORNERS)
            v.co = p + N * (lips * (upper + lower) - crease - dimple)
            lipmask[v.index] = min(1.0, lips * max(g((dz - 0.026) / 0.026), g((dz + 0.031) / 0.03)) * 1.4)
    for (hit, nrm) in nostrils:
        if hit and (p - hit).length < 0.05:
            v.co = v.co - nrm * 0.011 * g((p - hit).length / 0.016)
    for (hit, nrm) in ears:
        r = (p - hit).length
        if r < 0.11:
            # the eardrum: a flat disc, a little sunk, with a raised rim
            v.co = v.co + nrm * (0.009 * g((r - 0.062) / 0.012) - 0.004 * (1 - ss(0.04, 0.06, r)))
            earmask[v.index] = 1 - ss(0.055, 0.07, r)
me.update()

# colour regions as vertex colour COLOR_0: R belly, G lips, B pads and eardrums
ca = me.color_attributes.new("mask", "FLOAT_COLOR", "POINT")
for v in me.vertices:
    p = v.co
    belly = ss(0.08, 0.24, -p.y) * ss(0.36, 0.5, p.z) * (1 - ss(1.08, 1.2, p.z)) * (1 - ss(0.22, 0.32, abs(p.x)))
    pads = max([1 - ss(0.03, 0.045, (p - c).length) for c in PADS] + [0.0])
    ca.data[v.index].color = (belly, lipmask[v.index], max(pads, earmask[v.index]), 1.0)

# ---------- 5. down to a game budget ----------
tris = sum(len(p.vertices) - 2 for p in me.polygons)
apply_mod(core, "DECIMATE", decimate_type="COLLAPSE", ratio=min(1.0, 26000 / tris))
body = core
bpy.context.view_layer.objects.active = body; deselect(); body.select_set(True)
bpy.ops.object.shade_smooth()
print("body tris", sum(len(p.vertices) - 2 for p in body.data.polygons))

# ---------- 6. eyes and lids on the head bone ----------
EYE_R = 0.135
EYES = [Vector((s * 0.235, -0.215, 1.71)) for s in (1, -1)]
LOOK = [Vector((s * 0.26, -1.0, 0.02)).normalized() for s in (1, -1)]
def uv_sphere(name, r, at, segs=24, rings=16):
    m = bpy.data.meshes.new(name); b = bmesh.new()
    bmesh.ops.create_uvsphere(b, u_segments=segs, v_segments=rings, radius=r); b.to_mesh(m); b.free()
    o = bpy.data.objects.new(name, m); scene.collection.objects.link(o); o.location = at
    for p in m.polygons: p.use_smooth = True
    return o
parts = []
for c, look in zip(EYES, LOOK):
    side = "L" if c.x > 0 else "R"
    parts.append(uv_sphere(f"Frog_Eye_{side}", EYE_R, c))
    q = Vector((0, 0, 1)).rotation_difference(look)
    iris = uv_sphere(f"Frog_Iris_{side}", EYE_R * 0.62, c + look * (EYE_R * 0.83), 20, 12)
    iris.scale = (1, 1, 0.32); iris.rotation_mode = "QUATERNION"; iris.rotation_quaternion = q; parts.append(iris)
    pupil = uv_sphere(f"Frog_Pupil_{side}", EYE_R * 0.34, c + look * (EYE_R * 0.97), 16, 10)
    pupil.scale = (1.35, 1, 0.3); pupil.rotation_mode = "QUATERNION"; pupil.rotation_quaternion = q; parts.append(pupil)
    # the upper lid, a thick shell over the eye: LidDroop closes it halfway, LidAngry slants it
    m = bpy.data.meshes.new(f"Frog_Lid_{side}"); b = bmesh.new()
    bmesh.ops.create_uvsphere(b, u_segments=28, v_segments=18, radius=EYE_R * 1.08)
    for vv in [vv for vv in b.verts if vv.co.z < -EYE_R * 0.05]: b.verts.remove(vv)
    edge = [e for e in b.edges if e.is_boundary]
    ext = bmesh.ops.extrude_edge_only(b, edges=edge)
    for vv in [x for x in ext["geom"] if isinstance(x, bmesh.types.BMVert)]: vv.co = vv.co * 0.9
    b.to_mesh(m); b.free()
    lid = bpy.data.objects.new(f"Frog_Lid_{side}", m); scene.collection.objects.link(lid)
    for p in m.polygons: p.use_smooth = True
    m.transform(Matrix.Rotation(math.radians(-18), 4, "X")); lid.location = c
    lid.shape_key_add(name="Basis")
    k = lid.shape_key_add(name="LidDroop"); rot = Matrix.Rotation(math.radians(24), 3, "X")
    for vv, kv in zip(m.vertices, k.data): kv.co = rot @ vv.co
    k2 = lid.shape_key_add(name="LidAngry")
    rot2 = Matrix.Rotation(math.radians(16), 3, "X") @ Matrix.Rotation(math.radians(-20 if side == "L" else 20), 3, "Y")
    for vv, kv in zip(m.vertices, k2.data): kv.co = rot2 @ vv.co
    parts.append(lid)

# ---------- 7. creator shape keys on the body ----------
def falloff(p, c, r):
    d = (p - c).length / r; return max(0.0, 1 - d * d) ** 2
body.shape_key_add(name="Basis")
cmask = body.data.color_attributes["mask"]
def key(name, fn):
    k = body.shape_key_add(name=name)
    for v, kv in zip(body.data.vertices, k.data): kv.co = v.co + fn(v.co, v.index)
HEAD = Vector((0, -0.04, 1.47))
lipw = lambda i: cmask.data[i].color[1]
key("HeadWide", lambda p, i: Vector((p.x * 0.22, 0, 0)) * falloff(p, HEAD, 0.75))
key("HeadFlat", lambda p, i: Vector((0, 0, -(p.z - 1.45) * 0.35)) * falloff(p, HEAD, 0.7))
key("Snout", lambda p, i: Vector((0, -0.07, -0.01)) * falloff(p, Vector((0, -0.4, 1.36)), 0.32))
key("Cheeks", lambda p, i: Vector((math.copysign(0.07, p.x), -0.02, 0)) * falloff(p, Vector((math.copysign(0.36, p.x), -0.2, 1.3)), 0.25))
key("Belly", lambda p, i: Vector((p.x * 0.18, -0.09, 0)) * falloff(p, Vector((0, -0.2, 0.72)), 0.42))
key("Slim", lambda p, i: Vector((-p.x * 0.14, -(p.y + 0.02) * 0.12, 0)) * falloff(p, Vector((0, 0, 0.85)), 0.55))
key("Throat", lambda p, i: Vector((0, -0.05, -0.04)) * falloff(p, Vector((0, -0.3, 1.2)), 0.25))
key("LipsFull", lambda p, i: (p - Vector((0, -0.03, p.z))).normalized() * 0.02 * lipw(i))
key("Smug", lambda p, i: Vector((0, 0.01, 0.04)) * sum(falloff(p, c, 0.13) for c in CORNERS))
key("Frown", lambda p, i: Vector((0, 0.0, -0.045)) * sum(falloff(p, c, 0.14) for c in CORNERS))

# ---------- 8. materials, skin, parenting ----------
def mat(name, rgb, rough=0.55):
    m = bpy.data.materials.new(name)
    try: m.use_nodes = True
    except Exception: pass
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1); bsdf.inputs["Roughness"].default_value = rough
    return m
M = {"skin": mat("frog_skin", (0.16, 0.36, 0.11)), "eye": mat("frog_eye", (0.92, 0.9, 0.84), 0.15),
     "iris": mat("frog_iris", (0.55, 0.32, 0.05), 0.2), "pupil": mat("frog_pupil", (0.01, 0.01, 0.01), 0.1)}
# the preview shows the regions: belly, lips, pads (the game's shader does this its own way)
sk = M["skin"].node_tree; bsdf = sk.nodes.get("Principled BSDF")
attr = sk.nodes.new("ShaderNodeVertexColor"); attr.layer_name = "mask"
sep = sk.nodes.new("ShaderNodeSeparateColor"); sk.links.new(attr.outputs["Color"], sep.inputs["Color"])
def mix(a, b, fac):
    n = sk.nodes.new("ShaderNodeMix"); n.data_type = "RGBA"
    for slot, val in (("A", a), ("B", b)):
        if isinstance(val, tuple): n.inputs[slot].default_value = val
        else: sk.links.new(val, n.inputs[slot])
    sk.links.new(fac, n.inputs["Factor"]); return n.outputs["Result"]
c1 = mix((0.16, 0.36, 0.11, 1), (0.72, 0.74, 0.5, 1), sep.outputs["Red"])
c2 = mix(c1, (0.33, 0.1, 0.07, 1), sep.outputs["Green"])
c3 = mix(c2, (0.1, 0.22, 0.07, 1), sep.outputs["Blue"])
sk.links.new(c3, bsdf.inputs["Base Color"])
body.data.materials.append(M["skin"])
for o in parts:
    n = o.name
    o.data.materials.append(M["skin"] if "Lid" in n else M["iris"] if "Iris" in n else M["pupil"] if "Pupil" in n else M["eye"])

deselect(); body.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
vg = {g.name: g for g in body.vertex_groups}
def own(i, bone, w):
    """Give a vertex to one bone by w, the rest of its weights scaled down."""
    v = body.data.vertices[i]
    for gg in v.groups:
        nm = body.vertex_groups[gg.group].name
        if nm != bone: vg[nm].add([i], gg.weight * (1 - w), "REPLACE")
    cur = next((gg.weight for gg in v.groups if body.vertex_groups[gg.group].name == bone), 0.0)
    vg[bone].add([i], cur * (1 - w) + w, "REPLACE")
for v in body.data.vertices:
    p = v.co
    # the head rides the head bone whole, so the eyes and lids never slide on it
    w = ss(1.15, 1.26, p.z) if abs(p.x) < 0.6 else 0.0
    if w > 0: own(v.index, "head", w)
    # hands and feet: rigid on their bones past the wrist and the ball of the foot
    for s, side in ((1, "l"), (-1, "r")):
        if s * p.x > 0.76 and abs(p.z - 1.1) < 0.2: own(v.index, f"hand.{side}", ss(0.77, 0.81, s * p.x))
        if abs(p.x - s * 0.171) < 0.2 and p.z < 0.1 and p.y < -0.09: own(v.index, f"toes.{side}", ss(-0.1, -0.14, p.y))
for o in parts:
    deselect(); o.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
    rig.data.bones.active = rig.data.bones["head"]
    bpy.ops.object.parent_set(type="BONE", keep_transform=True)
for o in parts:
    if o.data.shape_keys:
        for kb in o.data.shape_keys.key_blocks:
            if kb.name == "LidDroop": kb.value = 0.45
for kb in body.data.shape_keys.key_blocks:
    if kb.name == "Smug": kb.value = 0.3

# ---------- 8b. armour: cut from the frog's own skin and lifted off it, so every piece fits every frog ----------
# Each piece is a region of the body surface pushed out along its normals, with a thick turned edge. It
# keeps the body's skin weights (it bends with the same bones) and the body's creator shape keys (a
# fat belly or a wide head moves the armour with it). Small solid details ride one bone each.
from mathutils.kdtree import KDTree as _KD

def amat(name, rgb, rough=0.6):
    m = bpy.data.materials.new(name)
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*rgb, 1); b.inputs["Roughness"].default_value = rough
    return m
A = {
    "shell": amat("armor_shell", (0.25, 0.21, 0.11)), "scute": amat("armor_scute", (0.46, 0.39, 0.2)),
    "reed": amat("armor_reed", (0.45, 0.36, 0.18)), "leaf": amat("armor_leaf", (0.2, 0.3, 0.12)),
    "leather": amat("armor_leather", (0.25, 0.14, 0.08)), "bone": amat("armor_bone", (0.82, 0.77, 0.62)),
    "cloth": amat("armor_cloth", (0.42, 0.36, 0.28)), "wax": amat("armor_wax", (0.78, 0.68, 0.45)),
    "silk": amat("armor_silk", (0.45, 0.46, 0.5)), "cord": amat("armor_cord", (0.5, 0.17, 0.1)),
    "brass": amat("armor_brass", (0.72, 0.55, 0.24), 0.35), "hide": amat("armor_hide", (0.16, 0.18, 0.12), 0.4),
    "wool": amat("armor_wool", (0.33, 0.24, 0.16)),
}
BODY = body.data
KD_BODY = _KD(len(BODY.vertices))
for v in BODY.vertices: KD_BODY.insert(v.co, v.index)
KD_BODY.balance()
GROUP = {g.name: g.index for g in body.vertex_groups}

class Piece:
    """A piece of armour being built: one bmesh, the body vertex each of its vertices follows, its materials."""
    def __init__(self, name):
        self.name = name; self.bm = bmesh.new(); self.deform = self.bm.verts.layers.deform.verify()
        self.src = []; self.mats = []
    def mat_index(self, m):
        if m not in self.mats: self.mats.append(m)
        return self.mats.index(m)

    def skin(self, keep, off, lip, material):
        """The body faces `keep(centre, normal)` chooses, lifted `off` off the skin, with an edge `lip` wide."""
        polys = [p for p in BODY.polygons if keep(p.center, p.normal)]
        ids = sorted({i for p in polys for i in p.vertices})
        made = {}
        for i in ids:
            v = BODY.vertices[i]
            nv = self.bm.verts.new(v.co + v.normal * off)
            for g in v.groups: nv[self.deform][g.group] = g.weight
            made[i] = nv; self.src.append(i)
        mi = self.mat_index(material)
        faces = []
        for p in polys:
            try:
                f = self.bm.faces.new([made[i] for i in p.vertices]); f.material_index = mi; f.smooth = True; faces.append(f)
            except ValueError: pass
        # smooth the hem: the cut follows the mesh's triangles, so walk each edge vertex toward its two neighbours
        back = {nv: i for i, nv in made.items()}
        for _ in range(8):
            moves = {}
            for v in [v for v in back if v.is_boundary]:
                nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
                if len(nb) == 2: moves[v] = (nb[0].co + nb[1].co) / 2
            for v, c in moves.items(): v.co = v.co.lerp(c, 0.5)
        if lip:
            # turn the edge outward, so the piece shows a thickness where it ends
            bnd = [e for e in self.bm.edges if e.is_boundary and all(v in back for v in e.verts)]
            res = bmesh.ops.extrude_edge_only(self.bm, edges=bnd)
            for x in res["geom"]:
                if isinstance(x, bmesh.types.BMVert):
                    # the new vertex sits where its source boundary vertex is: find that one
                    near = min(back, key=lambda o: (o.co - x.co).length_squared)
                    i = back[near]; x.co = near.co + BODY.vertices[i].normal * lip
                    for gi, w in near[self.deform].items(): x[self.deform][gi] = w
                    self.src.append(i)
                elif isinstance(x, bmesh.types.BMFace): x.material_index = mi; x.smooth = True
        return self

    def solid(self, make, bone, material):
        """A small solid detail (a scute, a dart, a ring) that rides one bone."""
        b = bmesh.new(); make(b)
        mi = self.mat_index(material); idx = GROUP[bone]
        vmap = {}
        for v in b.verts:
            nv = self.bm.verts.new(v.co); nv[self.deform][idx] = 1.0; vmap[v] = nv
            self.src.append(KD_BODY.find(v.co)[1])
        for f in b.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts]); nf.material_index = mi; nf.smooth = True
            except ValueError: pass
        b.free()
        return self

    def build(self):
        me = bpy.data.meshes.new(self.name)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self.bm.to_mesh(me); self.bm.free()
        o = bpy.data.objects.new(self.name, me); scene.collection.objects.link(o)
        for m in self.mats: me.materials.append(m)
        for g in body.vertex_groups: o.vertex_groups.new(name=g.name)
        # the creator's shape keys, carried over from each vertex's body vertex
        keys = BODY.shape_keys.key_blocks
        o.shape_key_add(name="Basis")
        for kb in keys[1:]:
            k = o.shape_key_add(name=kb.name)
            for i, (v, src) in enumerate(zip(me.vertices, self.src)):
                k.data[i].co = v.co + (kb.data[src].co - keys[0].data[src].co)
            k.value = kb.value
        am = o.modifiers.new("rig", "ARMATURE"); am.object = rig
        o.parent = rig
        return o

def hexagon(r, at, normal):
    def make(b):
        bmesh.ops.create_cone(b, cap_ends=True, segments=6, radius1=r, radius2=r * 0.8, depth=0.022)
        q = Vector((0, 0, 1)).rotation_difference(normal).to_matrix().to_4x4()
        bmesh.ops.transform(b, matrix=Matrix.Translation(at) @ q, verts=b.verts)
    return make
def cone(r0, r1, depth, at, direction, segs=8):
    def make(b):
        bmesh.ops.create_cone(b, cap_ends=True, segments=segs, radius1=r0, radius2=r1, depth=depth)
        q = Vector((0, 0, 1)).rotation_difference(Vector(direction).normalized()).to_matrix().to_4x4()
        bmesh.ops.transform(b, matrix=Matrix.Translation(Vector(at)) @ q, verts=b.verts)
    return make
def torus(major, minor, at, axis):
    def make(b):
        segs, ring = 24, 8
        rows = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            row = []
            for j in range(ring):
                c = 2 * math.pi * j / ring
                row.append(b.verts.new(((major + minor * math.cos(c)) * math.cos(a), (major + minor * math.cos(c)) * math.sin(a), minor * math.sin(c))))
            rows.append(row)
        for i in range(segs):
            for j in range(ring):
                b.faces.new((rows[i][j], rows[(i + 1) % segs][j], rows[(i + 1) % segs][(j + 1) % ring], rows[i][(j + 1) % ring]))
        q = Vector((0, 0, 1)).rotation_difference(Vector(axis).normalized()).to_matrix().to_4x4()
        bmesh.ops.transform(b, matrix=Matrix.Translation(Vector(at)) @ q, verts=b.verts)
    return make
def on_body(x, z, front=True):
    """A point on the body's surface and its normal, seen from the front (or the back)."""
    hit, nrm, _, _ = BVH_BODY.ray_cast(Vector((x, -2.0 if front else 2.0, z)), Vector((0, 1 if front else -1, 0)))
    return hit, nrm

from mathutils.bvhtree import BVHTree as _BVH
BVH_BODY = _BVH.FromObject(body, bpy.context.evaluated_depsgraph_get(), deform=False)
ARMOR = {}
arm_free = lambda c: not (abs(c.x) > 0.34 and c.z > 0.95)          # keep the arms out of body armour

# Reedguard: a cuirass of shell over chest and belly, four scutes down the front, red-cord bracers
p = Piece("Gear_shell_vest").skin(lambda c, n: 0.62 < c.z < 1.13 and arm_free(c), 0.03, 0.03, A["shell"])
for x, z, r in ((0, 1.0, 0.085), (-0.13, 0.87, 0.075), (0.13, 0.87, 0.075), (0, 0.74, 0.075)):
    hit, nrm = on_body(x, z)
    if hit: p.solid(hexagon(r, hit + nrm * 0.045, nrm), "chest" if z > 0.95 else "spine", A["scute"])
ARMOR["shell_vest"] = p.build()
ARMOR["reed_bracers"] = Piece("Gear_reed_bracers").skin(lambda c, n: 0.52 < abs(c.x) < 0.74 and 0.98 < c.z < 1.24, 0.022, 0.018, A["reed"]).build()
ARMOR["leech_wraps"] = Piece("Gear_leech_wraps").skin(lambda c, n: 0.6 < abs(c.x) < 0.82 and 0.98 < c.z < 1.24, 0.02, 0.014, A["hide"]).build()
# Dartsinger: a cowl of dried leaf over the back of the head and the nape, crossed straps with darts, wrapped feet
ARMOR["leaf_hood"] = Piece("Gear_leaf_hood").skin(lambda c, n: (c.z > 1.36 and c.y > -0.02) or (1.16 < c.z <= 1.36 and c.y > 0.08 and abs(c.x) < 0.42), 0.035, 0.03, A["leaf"]).build()
strap = lambda c: 0.64 < c.z < 1.12 and arm_free(c) and min(abs((c.z - 0.9) - 0.78 * c.x), abs((c.z - 0.9) + 0.78 * c.x)) < 0.045
p = Piece("Gear_dart_harness").skin(lambda c, n: strap(c), 0.022, 0.012, A["leather"])
for k in range(5):
    x = (k - 2) * 0.06; z = 0.9 + 0.78 * x
    hit, nrm = on_body(x, z)
    if hit: p.solid(cone(0.009, 0.003, 0.12, hit + nrm * 0.035 + Vector((0, 0, 0.05)), (0, 0, 1)), "chest" if z > 0.95 else "spine", A["bone"])
ARMOR["dart_harness"] = p.build()
ARMOR["wrap_boots"] = Piece("Gear_wrap_boots").skin(lambda c, n: 0.05 < c.z < 0.3 and abs(abs(c.x) - 0.171) < 0.13 and c.y > -0.1, 0.018, 0.014, A["cloth"]).build()
# Lampwright: a waxed hood with a point at the back, a moth-silk mantle, a cord sash with a brass ring
p = Piece("Gear_tallow_hood").skin(lambda c, n: (c.z > 1.33 and c.y > -0.1) or (1.15 < c.z <= 1.33 and c.y > 0.06 and abs(c.x) < 0.44), 0.035, 0.03, A["wax"])
ARMOR["tallow_hood"] = p.build()
ARMOR["moth_mantle"] = Piece("Gear_moth_mantle").skin(lambda c, n: 0.92 < c.z < 1.24 and abs(c.x) < 0.46 and (c.y > -0.12 or abs(c.x) > 0.22), 0.035, 0.035, A["silk"]).build()
p = Piece("Gear_keeper_sash").skin(lambda c, n: 0.53 < c.z < 0.65 and abs(c.x) < 0.4, 0.025, 0.012, A["cord"])
hit, nrm = on_body(0.2, 0.57)
if hit: p.solid(torus(0.045, 0.01, hit + nrm * 0.05 + Vector((0, 0, -0.04)), nrm), "hips", A["brass"])
ARMOR["keeper_sash"] = p.build()
ARMOR["wend_cloak"] = Piece("Gear_wend_cloak").skin(lambda c, n: (c.y > 0.02 and 0.42 < c.z < 1.24 and abs(c.x) < 0.36) or (1.12 < c.z < 1.24 and abs(c.x) < 0.4 and c.y > -0.15), 0.045, 0.04, A["wool"]).build()
print("armour pieces", len(ARMOR), sorted(ARMOR))

# ---------- 9. export ----------
KEEP = {"Idle", "Unarmed_Idle", "Walking_A", "Walking_Backwards", "Running_A", "Running_Strafe_Left", "Running_Strafe_Right",
        "Jump_Start", "Jump_Idle", "Jump_Land", "Jump_Full_Short", "Dodge_Forward", "Dodge_Backward", "Dodge_Left", "Dodge_Right",
        "2H_Melee_Idle", "2H_Melee_Attack_Stab", "2H_Melee_Attack_Spin", "2H_Melee_Attack_Chop", "1H_Ranged_Shoot", "1H_Ranged_Aiming",
        "Throw", "Spellcast_Shoot", "Spellcast_Long", "Spellcast_Raise", "Spellcasting", "Block", "Blocking", "Block_Hit", "Hit_A", "Hit_B",
        "Death_A", "Death_A_Pose", "Interact", "PickUp", "Cheer", "Use_Item", "Sit_Floor_Down", "Sit_Floor_Idle", "Sit_Chair_Idle",
        "Lie_Idle", "Lie_StandUp"}
for act in list(bpy.data.actions):
    if act.name not in KEEP: bpy.data.actions.remove(act)
print("actions kept", len(bpy.data.actions))
deselect()
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "frog.glb"), export_format="GLB", export_yup=True,
    export_animations=True, export_skins=True, export_morph=True, export_morph_normal=False,
    export_apply=False, export_vertex_color="ACTIVE", export_all_vertex_colors=False)
print("EXPORTED", os.path.join(OUT, "frog.glb"))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "frog.blend"))

# ---------- 10. preview renders ----------
if RENDER:
    world = bpy.data.worlds.new("w"); scene.world = world
    try: world.use_nodes = True
    except Exception: pass
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.06, 0.09, 1)
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try: scene.render.engine = eng; break
        except TypeError: pass
    scene.render.resolution_x = scene.render.resolution_y = 900
    def light(kind, at, energy, rot, color=(1, 1, 1), size=1.0):
        ld = bpy.data.lights.new(kind + str(at), kind); ld.energy = energy; ld.color = color; ld.size = size
        lo = bpy.data.objects.new(ld.name, ld); scene.collection.objects.link(lo); lo.location = at; lo.rotation_euler = rot
    light("AREA", (2.2, -2.6, 3.0), 700, (math.radians(50), 0, math.radians(40)), size=2.5)
    light("AREA", (-2.6, -1.0, 2.0), 250, (math.radians(70), 0, math.radians(-70)), (0.6, 0.75, 1.0), 3)
    light("AREA", (0, 2.6, 2.6), 400, (math.radians(-50), 0, math.radians(180)), (0.7, 0.85, 1.0), 2)
    cam_d = bpy.data.cameras.new("cam"); cam_d.lens = 70
    cam = bpy.data.objects.new("cam", cam_d); scene.collection.objects.link(cam); scene.camera = cam
    def shot(name, at, target=(0, 0, 0.98)):
        cam.location = at; d = Vector(target) - Vector(at); cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(OUT, name); bpy.ops.render.render(write_still=True)
    shot("front.png", (0.0, -5.2, 1.25))
    shot("three-quarter.png", (3.3, -3.9, 1.6))
    shot("face.png", (0.9, -2.7, 1.5), (0, -0.1, 1.42))
    shot("hand.png", (1.45, -1.25, 1.35), (0.82, 0, 1.08))
    shot("foot.png", (0.9, -1.3, 0.55), (0.17, -0.12, 0.05))
    act = bpy.data.actions.get("Running_A")
    if act:
        rig.animation_data_create(); rig.animation_data.action = act
        if hasattr(rig.animation_data, "action_slot") and act.slots: rig.animation_data.action_slot = act.slots[0]
        scene.frame_set(int(act.frame_range[0] + 6)); shot("run.png", (3.3, -3.9, 1.6))
print("DONE")
