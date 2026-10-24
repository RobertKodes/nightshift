import bpy, sys, math, os
from mathutils import Vector
args = sys.argv[sys.argv.index("--") + 1:]; OUT = args[0]; shots = args[1:]
scene = bpy.context.scene; rig = bpy.data.objects["FrogRig"]
world = bpy.data.worlds.new("w"); scene.world = world
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.06, 0.09, 1)
for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
    try: scene.render.engine = eng; break
    except TypeError: pass
scene.render.resolution_x = scene.render.resolution_y = 900
def light(at, energy, rot, color=(1, 1, 1), size=1.0):
    ld = bpy.data.lights.new("L" + str(at), "AREA"); ld.energy = energy; ld.color = color; ld.size = size
    lo = bpy.data.objects.new(ld.name, ld); scene.collection.objects.link(lo); lo.location = at; lo.rotation_euler = rot
light((2.2, -2.6, 3.0), 700, (math.radians(50), 0, math.radians(40)), size=2.5)
light((-2.6, -1.0, 2.0), 250, (math.radians(70), 0, math.radians(-70)), (0.6, 0.75, 1.0), 3)
light((0, 2.6, 2.6), 400, (math.radians(-50), 0, math.radians(180)), (0.7, 0.85, 1.0), 2)
cam_d = bpy.data.cameras.new("cam"); cam_d.lens = 70
cam = bpy.data.objects.new("cam", cam_d); scene.collection.objects.link(cam); scene.camera = cam
def shot(name, at, target, rest=False, action=None, frame=0):
    rig.data.pose_position = "REST" if rest else "POSE"
    if action:
        a = bpy.data.actions[action]; rig.animation_data_create(); rig.animation_data.action = a
        if hasattr(rig.animation_data, "action_slot") and a.slots: rig.animation_data.action_slot = a.slots[0]
        scene.frame_set(int(a.frame_range[0] + frame))
    cam.location = at; d = Vector(target) - Vector(at); cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(OUT, name); bpy.ops.render.render(write_still=True)
S = {
  "hand": lambda: shot("hand.png", (1.25, -0.75, 1.75), (0.86, 0, 1.09), rest=True),
  "palm": lambda: shot("palm.png", (1.2, -0.55, 0.6), (0.86, 0, 1.09), rest=True),
  "foot": lambda: shot("foot.png", (0.75, -1.0, 0.45), (0.17, -0.15, 0.04), rest=True),
  "idle": lambda: shot("idle.png", (2.0, -4.6, 1.4), (0, 0, 0.95), action="Idle", frame=10),
  "tpose": lambda: shot("tpose.png", (0.0, -5.6, 1.1), (0, 0, 0.95), rest=True),
}
for s in shots: S[s]()
