import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { retargetClips } from './retarget.js';

// The skinned carriers. Motion comes from Quaternius' "Universal Animation Library" (runner.glb,
// trimmed to the clips the game uses); the bodies, with real faces, eyes and brows, come from his
// "Universal Base Characters" (carrier-f.glb / carrier-m.glb). Both CC0; see public/models/CREDITS.md.
// The clips are retargeted onto each body once, when it loads.

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const load = (url) => new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));

export const BODIES = { f: '/models/carrier-f.glb', m: '/models/carrier-m.glb' };

// Resolves to { body(tag) }: body(tag) resolves to { tag, scene, clips } for 'f' or 'm', loading
// and retargeting on first use. Each body scene is worn by one runner at a time.
export function loadRunnerRig(url = '/models/runner.glb') {
  return load(url).then((anim) => {
    const cache = {};
    const body = (tag) => (cache[tag] ||= load(BODIES[tag]).then((gltf) => ({
      tag,
      scene: gltf.scene,
      clips: retargetClips(anim.animations, anim.scene, gltf.scene),
    })));
    return { body };
  });
}
