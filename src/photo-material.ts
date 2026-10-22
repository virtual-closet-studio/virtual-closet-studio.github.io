import * as THREE from 'three';
import type { Garment, PhotoSide } from './types';
import { preparePhotoTexture } from './photo-processing';

type State = {
  original: THREE.Material['onBeforeCompile']; key: string; metalness: number;
  uniforms: Record<string, { value: unknown }>; textures: THREE.Texture[]; sources: string;
};
const states = new WeakMap<THREE.Material, State>();
// All fitted assets face +Z. Explicit profiles keep photo orientation independent of source UVs.
export const PHOTO_PROFILES: Record<Garment['template'], { front: number }> = {
  tee: { front: 1 }, jacket: { front: 1 }, shirt: { front: 1 },
  blazer: { front: 1 }, pants: { front: 1 }, cargo: { front: 1 },
  skirt: { front: 1 }, boots: { front: 1 }, sneakers: { front: 1 },
};
const empty = () => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1); t.needsUpdate = true; return t;
};
function texture(url?: string): THREE.Texture {
  if (!url) return empty();
  const t = new THREE.DataTexture(); t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = true; t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  const img = new Image(); let disposed = false;
  t.addEventListener('dispose', () => { disposed = true; img.onload = null; });
  img.onload = () => {
    if (disposed) return;
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const context = canvas.getContext('2d')!; context.drawImage(img, 0, 0);
    const pixels = context.getImageData(0, 0, img.width, img.height);
    t.image = { data: preparePhotoTexture(pixels.data, img.width, img.height), width: img.width, height: img.height };
    t.needsUpdate = true;
  };
  img.src = url; return t;
}
const transform = (side?: PhotoSide) => new THREE.Vector4(side?.x ?? 0, side?.y ?? 0, side?.scale ?? 1, (side?.rotation ?? 0) * Math.PI / 180);

export function disposePhotoMaterial(mat: THREE.Material): void {
  const state = states.get(mat); if (!state) return;
  state.textures.forEach(t => t.dispose());
  mat.onBeforeCompile = state.original; mat.customProgramCacheKey = () => state.key;
  (mat as THREE.MeshStandardMaterial).metalness = state.metalness;
  states.delete(mat); mat.needsUpdate = true;
}

export function applyPhotoDesign(root: THREE.Object3D, item: Garment): void {
  root.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(root), size = bounds.getSize(new THREE.Vector3());
  const profile = PHOTO_PROFILES[item.template];
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const mat = material as THREE.MeshStandardMaterial;
      if (!item.photoDesign) { disposePhotoMaterial(mat); continue; }
      const design = item.photoDesign;
      let state = states.get(mat);
      if (!state) {
        state = { original: mat.onBeforeCompile, key: mat.customProgramCacheKey(), metalness: mat.metalness, uniforms: {}, textures: [], sources: '' };
        states.set(mat, state);
        // Imported glTF materials default to metallic=1 when omitted. Photos are fabric.
        mat.metalness = 0;
        const data = state;
        mat.onBeforeCompile = (shader, renderer) => {
          data.original.call(mat, shader, renderer);
          Object.assign(shader.uniforms, data.uniforms);
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 photoWorld; varying vec3 photoNormal; uniform mat3 photoNormalMatrix;')
            .replace('#include <project_vertex>', 'photoWorld=(modelMatrix*vec4(transformed,1.0)).xyz; photoNormal=photoNormalMatrix*objectNormal;\n#include <project_vertex>');
          shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 photoWorld; varying vec3 photoNormal;
uniform sampler2D photoFront; uniform sampler2D photoBack;
uniform vec3 photoMin; uniform vec3 photoSize;
uniform vec4 photoFrontTransform; uniform vec4 photoBackTransform;
uniform float photoDirection;
vec4 samplePhoto(sampler2D tex, vec2 uv, vec4 placement) {
  vec2 p=(uv-vec2(.5)-placement.xy)/placement.z;
  float c=cos(placement.w), s=sin(placement.w);
  p=mat2(c,-s,s,c)*p+vec2(.5);
  if(any(lessThan(p,vec2(0.0)))||any(greaterThan(p,vec2(1.0))))return vec4(0.0);
  return texture2D(tex,p);
}`)
            .replace('#include <map_fragment>', `#include <map_fragment>
vec2 photoUV=(photoWorld.xy-photoMin.xy)/photoSize.xy;
float facing=normalize(photoNormal).z*photoDirection;
vec4 frontInk=samplePhoto(photoFront, photoUV, photoFrontTransform);
vec4 backInk=samplePhoto(photoBack, vec2(1.0-photoUV.x,photoUV.y), photoBackTransform);
vec4 ink=facing>=0.0?frontInk:backInk;
float photoWeight=smoothstep(.12,.65,abs(facing))*ink.a;
diffuseColor.rgb=mix(diffuseColor.rgb,ink.rgb,photoWeight);`);
        };
        mat.customProgramCacheKey = () => data.key + '|photo-projection-v1';
        mat.needsUpdate = true;
      }
      const sources = design.front.image + '|' + (design.back?.image ?? '');
      if (state.sources !== sources) {
        state.textures.forEach(t => t.dispose()); state.textures = [texture(design.front.image), texture(design.back?.image)]; state.sources = sources;
      }
      // Reuse uniform objects: compiled shaders retain references to them.
      const values = {
        photoFront: state.textures[0], photoBack: state.textures[1], photoMin: bounds.min,
        photoSize: new THREE.Vector3(Math.max(size.x, .001), Math.max(size.y, .001), Math.max(size.z, .001)),
        photoFrontTransform: transform(design.front), photoBackTransform: transform(design.back), photoDirection: profile.front,
        photoNormalMatrix: new THREE.Matrix3().getNormalMatrix(object.matrixWorld),
      };
      for (const [name, value] of Object.entries(values)) {
        if (state.uniforms[name]) state.uniforms[name].value = value; else state.uniforms[name] = { value };
      }
    }
  });
}
