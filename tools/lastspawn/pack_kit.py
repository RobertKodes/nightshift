"""Packs chosen KayKit pieces into one GLB: one node per piece, named after it, sharing one texture."""
import bpy, sys, os
args = sys.argv[sys.argv.index("--") + 1:]
src, out, names = args[0], args[1], args[2:]
bpy.ops.wm.read_factory_settings(use_empty=True)
x = 0.0
for n in names:
    p = next((os.path.join(src, f) for f in (n + ".gltf.glb", n + ".glb", n + ".gltf") if os.path.exists(os.path.join(src, f))), None)
    if not p: print("MISSING", n); continue
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=p)
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None or o.parent not in new]
    if len(roots) == 1: root = roots[0]
    else:
        root = bpy.data.objects.new(n, None); bpy.context.scene.collection.objects.link(root)
        for o in roots: o.parent = root
    root.name = n; root.location = (x, 0, 0); x += 12
# one texture for all: point every material at the first image
imgs = [i for i in bpy.data.images if i.size[0] > 0]
if imgs:
    first = imgs[0]
    for m in bpy.data.materials:
        if m.node_tree:
            for nd in m.node_tree.nodes:
                if nd.type == "TEX_IMAGE" and nd.image: nd.image = first
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_yup=True, export_animations=False)
print("PACKED", len(names), "images", len(imgs), out)
