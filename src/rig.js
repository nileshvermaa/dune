import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Skinned runner body and motion clips: Quaternius "Universal Animation Library" (CC0),
// trimmed to the clips the game uses (see public/models/CREDITS.md).

export function loadRunnerRig(url = '/models/runner.glb') {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
}
