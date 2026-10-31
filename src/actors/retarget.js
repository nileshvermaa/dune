import * as THREE from 'three';

// Moves animation clips from one skeleton to another whose bones are named differently but stand
// in the same rest pose (here: the Universal Animation Library's Rigify-style "DEF-" rig onto the
// Universal Base Characters' Unreal-style rig; both are T-posed with matching joints).
//
// Each target bone takes the source bone's rotation *relative to rest*, measured in model space,
// so differences in how the two rigs orient their bone axes cancel out. The hips also carry the
// clip's bounce and travel, scaled by the ratio of hip heights.

// source bone → target bone
export const UAL_TO_UBC = {
  root: 'root',
  'DEF-hips': 'pelvis',
  'DEF-spine001': 'spine_01',
  'DEF-spine002': 'spine_02',
  'DEF-spine003': 'spine_03',
  'DEF-neck': 'neck_01',
  'DEF-head': 'Head',
  ...Object.fromEntries(['L', 'R'].flatMap((s) => {
    const t = s.toLowerCase();
    return [
      [`DEF-shoulder${s}`, `clavicle_${t}`], [`DEF-upper_arm${s}`, `upperarm_${t}`], [`DEF-forearm${s}`, `lowerarm_${t}`],
      [`DEF-hand${s}`, `hand_${t}`], [`DEF-thigh${s}`, `thigh_${t}`], [`DEF-shin${s}`, `calf_${t}`],
      [`DEF-foot${s}`, `foot_${t}`], [`DEF-toe${s}`, `ball_${t}`],
    ];
  })),
};

const bonesByName = (root) => {
  const out = {};
  root.traverse((o) => { if (o.isBone) out[o.name] = o; });
  return out;
};

export function retargetClips(clips, srcRoot, dstRoot, map = UAL_TO_UBC, hips = ['DEF-hips', 'pelvis']) {
  const src = bonesByName(srcRoot), dst = bonesByName(dstRoot);
  const srcOf = {}; // target name → source bone
  for (const [s, d] of Object.entries(map)) if (src[s] && dst[d]) srcOf[d] = src[s];
  const order = []; // target bones, parents before children
  dstRoot.traverse((o) => { if (o.isBone && srcOf[o.name]) order.push(o); });

  const rest = [...Object.values(src)].map((b) => [b, b.position.clone(), b.quaternion.clone()]);
  srcRoot.updateMatrixWorld(true);
  dstRoot.updateMatrixWorld(true);
  const p = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Quaternion();
  const worldQ = (b) => (b.matrixWorld.decompose(p, q, s), q.clone());
  const corr = {}; // target world = source world · corr
  for (const b of order) corr[b.name] = worldQ(srcOf[b.name]).invert().multiply(worldQ(b));
  const hipS = src[hips[0]], hipD = dst[hips[1]];
  const restHipS = new THREE.Vector3().setFromMatrixPosition(hipS.matrixWorld);
  const restHipD = new THREE.Vector3().setFromMatrixPosition(hipD.matrixWorld);
  const k = restHipD.y / restHipS.y;

  const W = new Map(), M = new Map();
  const local = new THREE.Matrix4(), inv = new THREE.Matrix4(), pq = new THREE.Quaternion();
  const out = clips.map((clip) => {
    const tracks = clip.tracks.map((t) => {
      const [name, prop] = t.name.split('.');
      return src[name] && (prop === 'quaternion' || prop === 'position') ? { t, bone: src[name], prop, it: t.createInterpolant() } : null;
    }).filter(Boolean);
    const times = [...new Set(tracks.flatMap((x) => [...x.t.times]))].sort((a, b) => a - b);
    const qs = Object.fromEntries(order.map((b) => [b.name, new Float32Array(times.length * 4)]));
    const hipPos = new Float32Array(times.length * 3);
    times.forEach((time, i) => {
      for (const [b, rp, rq] of rest) { b.position.copy(rp); b.quaternion.copy(rq); }
      for (const x of tracks) x.bone[x.prop].fromArray(x.it.evaluate(time));
      srcRoot.updateMatrixWorld(true);
      W.clear(); M.clear();
      for (const b of order) {
        const wq = worldQ(srcOf[b.name]).multiply(corr[b.name]);
        const parentM = M.get(b.parent) || b.parent.matrixWorld; // unmapped parents stay at rest
        parentM.decompose(p, pq, s);
        const lq = pq.invert().multiply(wq);
        let lp = b.position;
        if (b === hipD) {
          const now = new THREE.Vector3().setFromMatrixPosition(hipS.matrixWorld).sub(restHipS).multiplyScalar(k).add(restHipD);
          lp = now.applyMatrix4(inv.copy(parentM).invert());
          lp.toArray(hipPos, i * 3);
        }
        lq.toArray(qs[b.name], i * 4);
        M.set(b, new THREE.Matrix4().multiplyMatrices(parentM, local.compose(lp, lq, b.scale)));
      }
    });
    const newTracks = order.map((b) => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, qs[b.name]));
    newTracks.push(new THREE.VectorKeyframeTrack(`${hipD.name}.position`, times, hipPos));
    return new THREE.AnimationClip(clip.name, clip.duration, newTracks);
  });
  for (const [b, rp, rq] of rest) { b.position.copy(rp); b.quaternion.copy(rq); }
  srcRoot.updateMatrixWorld(true);
  return out;
}
