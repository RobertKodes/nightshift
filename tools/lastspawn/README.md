# LASTSPAWN art pipeline

Every model in `apps/web/public/lastspawn` is built by a script here. Nothing is hand-exported, so any change can be made again from source.

| Script | Makes | Run |
|---|---|---|
| `build_frog.py` | `frog.glb`: the base frog, modeled and carved in code, skinned to the KayKit Rig_Medium, with creator shape keys, a colour-region mask and the game's animations | `blender -b --factory-startup --python build_frog.py -- <KayKit Knight.glb> <out> [render]` |
| `build_gear.py` | `gear.glb`: the reed glaive, the shell shield, the blowgun and the firefly lantern | `blender -b --factory-startup --python build_gear.py -- <out> [render]` |
| `pack_kit.py` | `stone.glb` and `marsh.glb`: the KayKit pieces the zones use, packed into one file per kit | `blender -b --factory-startup --python pack_kit.py -- <pack's gltf folder> <out.glb> <piece names...>` |
| `render_frog.py` | Preview renders of a built frog | `blender -b <out>/frog.blend --python render_frog.py -- <out> hand foot idle` |

After building, compress the files with `npx @gltf-transform/cli@4.5.1 resample` (frog only), then `meshopt`.

**Sources:**
- Blender 5.1.
- KayKit Adventurers, Dungeon Remastered and Halloween Bits 1.0 by Kay Lousberg, CC0, from github.com/KayKit-Game-Assets.
