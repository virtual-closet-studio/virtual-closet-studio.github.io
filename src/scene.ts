import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyVisibilityMask, volumeShader, BODY_PROTECTION_GLSL, type Volume } from './visibility';
import { VolumeWorker } from './volume-client';
import type { Body, Garment } from './types';

type Fit = { width: number; height: number; outerWidth: number; depth: number };
export type CameraView = 'full' | 'upper' | 'lower' | 'feet';
type ModelKey = 'body' | Exclude<Garment['template'], 'skirt'>;
const defaultFit: Fit = { width: 1.08, height: 1, outerWidth: 1.18, depth: .05 };

function patternedTexture(item: Garment): THREE.Texture | undefined {
  if (item.pattern === 'solid') return;
  if (item.pattern === 'image' && item.image) {
    const texture = new THREE.Texture();
    const image = new Image();
    image.onload = () => { texture.image = image; texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true; };
    image.src = item.image;
    return texture;
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = item.color;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = item.pattern === 'stripe' ? '#f5eee1' : '#ffffff64';
  if (item.pattern === 'stripe') {
    for (let y = 0; y < 256; y += 42) ctx.fillRect(0, y, 256, 13);
  } else {
    for (let i = 0; i < 256; i += 44) { ctx.fillRect(i, 0, 12, 256); ctx.fillRect(0, i, 256, 12); }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// The supplied hoodie has no UVs. A cylindrical projection enables simple patterns.
function addCylindricalUVs(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry as THREE.BufferGeometry;
    if (geometry.getAttribute('uv')) return;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const positions = geometry.getAttribute('position');
    const uv = new Float32Array(positions.count * 2);
    const height = Math.max(.001, box.max.y - box.min.y);
    for (let i = 0; i < positions.count; i++) {
      uv[i * 2] = Math.atan2(positions.getZ(i), positions.getX(i)) / (2 * Math.PI) + .5;
      uv[i * 2 + 1] = (positions.getY(i) - box.min.y) / height;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  });
}

type SleeveFit = { shoulder: THREE.Vector3; cuff: THREE.Vector3; direction: THREE.Vector3; sourceExitX: number; valid: boolean };
type SleeveFits = { left: SleeveFit; right: SleeveFit };
type ArmLandmark = { shoulder: THREE.Vector3; elbow: THREE.Vector3; wrist: THREE.Vector3 };
type ArmLandmarks = { left: ArmLandmark; right: ArmLandmark };
const defaultArmAngle = 50;
const shoulderX = .24;
const shoulderY = 1.48;
const shoulderZ = -.035;

function fallbackSleeve(side: number, body: Body, shoulder = new THREE.Vector3(side * shoulderX * body.width, shoulderY * body.height, shoulderZ * body.width)): SleeveFit {
  const angle = THREE.MathUtils.degToRad(defaultArmAngle);
  const direction = new THREE.Vector3(side * Math.cos(angle), -Math.sin(angle), 0);
  const cuff = shoulder.clone().addScaledVector(direction, .32 * body.width);
  return { shoulder, cuff, direction, sourceExitX: .56, valid: false };
}

function armCenterAt(root: THREE.Object3D, side: number, x: number, body: Body): THREE.Vector3 {
  const center = new THREE.Vector3();
  let count = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const positions = (object.geometry as THREE.BufferGeometry).getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      const px = positions.getX(i);
      const y = positions.getY(i);
      if (Math.sign(px) !== side || Math.abs(Math.abs(px) - x) > .018 || y < 1.35 || y > 1.62) continue;
      center.add(new THREE.Vector3(px * body.width, y * body.height, positions.getZ(i) * body.width));
      count++;
    }
  });
  return count ? center.divideScalar(count) : new THREE.Vector3(side * x * body.width, shoulderY * body.height, shoulderZ * body.width);
}

function bodyArmLandmarks(root: THREE.Object3D, body: Body): ArmLandmarks {
  const landmark = (side: number): ArmLandmark => ({
    shoulder: armCenterAt(root, side, shoulderX, body),
    elbow: armCenterAt(root, side, .54, body),
    wrist: armCenterAt(root, side, .78, body),
  });
  return { left: landmark(-1), right: landmark(1) };
}

function poseBodyArms(root: THREE.Object3D, sleeves: SleeveFits, landmarks: ArmLandmarks, body: Body): void {
  const fits = [sleeves.left, sleeves.right];
  const corrections = fits.map((fit, index) => {
    const side = index ? 1 : -1;
    const referenceX = fit.sourceExitX;
    const arm = side < 0 ? landmarks.left : landmarks.right;
    const sourceDirection = arm.elbow.clone().sub(arm.shoulder).normalize();
    const rotation = new THREE.Quaternion().setFromUnitVectors(sourceDirection, fit.direction);
    const sourceCenter = armCenterAt(root, side, referenceX, body);
    const rotatedCenter = sourceCenter.sub(fit.shoulder).applyQuaternion(rotation).add(fit.shoulder);
    // Put the original arm cross-section inside the opening without narrowing it.
    const target = fit.cuff.clone().addScaledVector(fit.direction, -.012 * body.width);
    const offset = fit.valid ? target.sub(rotatedCenter) : new THREE.Vector3();
    return { rotation, referenceX, offset };
  });
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = (object.geometry as THREE.BufferGeometry).clone();
    const positions = geometry.getAttribute('position');
    geometry.setAttribute('bodySourcePosition', new THREE.Float32BufferAttribute(new Float32Array(positions.array as ArrayLike<number>), 3));
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const ax = Math.abs(x);
      if (ax < .17 || y < 1.34 || y > 1.63) continue;
      const side = Math.sign(x);
      const blend = THREE.MathUtils.smoothstep(ax, .17, .29);
      const fit = side < 0 ? sleeves.left : sleeves.right;
      const correction = corrections[side < 0 ? 0 : 1];
      const original = new THREE.Vector3(x * body.width, y * body.height, positions.getZ(i) * body.width);
      const posed = original.clone().sub(fit.shoulder).applyQuaternion(correction.rotation).add(fit.shoulder);
      const shift = THREE.MathUtils.smoothstep(ax, .24, correction.referenceX);
      posed.addScaledVector(correction.offset, shift);
      original.lerp(posed, blend);
      positions.setXYZ(i, original.x / body.width, original.y / body.height, original.z / body.width);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    object.geometry = geometry;
    object.userData.ownedGeometry = true;
  });
}

// Weld triangle corners before finding the actual open rings (OBJ has duplicated vertices).
function garmentOpenings(root: THREE.Object3D): THREE.Vector3[] {
  root.updateMatrixWorld(true);
  const vertices = new Map<string, THREE.Vector3>();
  const edges = new Map<string, { a: string; b: string; count: number }>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry as THREE.BufferGeometry;
    const positions = geometry.getAttribute('position');
    const keys: string[] = [];
    for (let i = 0; i < positions.count; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      const key = [point.x, point.y, point.z].map((v) => Math.round(v * 100000)).join(',');
      keys.push(key);
      vertices.set(key, point);
    }
    const indices = geometry.index;
    const count = indices ? indices.count : positions.count;
    for (let i = 0; i < count; i += 3) {
      const triangle = [0, 1, 2].map((j) => keys[indices ? indices.getX(i + j) : i + j]);
      for (let j = 0; j < 3; j++) {
        const a = triangle[j], b = triangle[(j + 1) % 3];
        if (a === b) continue;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const edge = edges.get(key);
        if (edge) edge.count++;
        else edges.set(key, { a, b, count: 1 });
      }
    }
  });
  const boundary = new Set<string>();
  edges.forEach((edge) => { if (edge.count === 1) { boundary.add(edge.a); boundary.add(edge.b); } });
  return [...boundary].map((key) => vertices.get(key)!);
}

function garmentSleeves(root: THREE.Object3D, body: Body, landmarks: ArmLandmarks, longSleeve: boolean): SleeveFits {
  root.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  const sides: THREE.Vector3[][] = [[], []];
  const openings = longSleeve ? [] : garmentOpenings(root);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const positions = (object.geometry as THREE.BufferGeometry).getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      const side = point.x < 0 ? 0 : 1;
      const x = Math.abs(point.x);
      // Exclude the torso and the hood; only the outward sleeve is relevant.
      if (x < .19 * body.width || point.y < .72 * body.height || point.y > 1.60 * body.height) continue;
      sides[side].push(point.clone());
    }
  });
  const fitFor = (points: THREE.Vector3[], side: number, arm: ArmLandmark): SleeveFit => {
    const fallback = fallbackSleeve(side, body, arm.shoulder);
    if (points.length < 20) return fallback;
    if (longSleeve) {
      // Vertical jacket sleeves end below the torso and cannot be found by
      // taking the largest X coordinate (that selected the upper sleeve).
      const sleeve = points.filter((p) => Math.abs(p.x) > .28 * body.width);
      if (sleeve.length >= 20) {
        const ordered = [...sleeve].sort((a,b) => a.y-b.y);
        const endY = ordered[Math.floor(ordered.length * .025)].y;
        const rim = sleeve.filter((p) => p.y < endY + .018 * body.height);
        const cuff = new THREE.Box3().setFromPoints(rim).getCenter(new THREE.Vector3());
        const direction = cuff.clone().sub(arm.shoulder).normalize();
        cuff.addScaledVector(direction, .018 * body.height);
        return { shoulder: arm.shoulder, cuff, direction, sourceExitX: Math.abs(arm.wrist.x)/body.width, valid: true };
      }
    }
    const ordered = [...points].sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
    const edge = Math.abs(ordered[Math.floor(ordered.length * .995)].x);
    if (edge < .29 * body.width) return fallback;
    const center = (sample: THREE.Vector3[]): THREE.Vector3 => {
      const bounds = new THREE.Box3().setFromPoints(sample);
      return bounds.getCenter(new THREE.Vector3());
    };
    const cuffPoints = points.filter((value) => Math.abs(value.x) > edge - .012 * body.width && Math.abs(value.x) < edge + .01 * body.width);
    const baseX = Math.min(edge - .075 * body.width, .27 * body.width);
    const basePoints = points.filter((value) => Math.abs(Math.abs(value.x) - baseX) < .018 * body.width && value.y > 1.2 * body.height);
    if (cuffPoints.length < 3 || basePoints.length < 3) return fallback;
    const cuffBounds = new THREE.Box3().setFromPoints(cuffPoints);
    const cuff = cuffBounds.getCenter(new THREE.Vector3());
    const sleeveBase = center(basePoints);
    const shoulder = arm.shoulder;
    const direction = cuff.clone().sub(sleeveBase);
    if (direction.length() < .06 * body.width || Math.sign(direction.x) !== side) direction.copy(cuff).sub(shoulder);
    direction.normalize();
    const toCuff = cuff.clone().sub(shoulder).normalize();
    direction.lerp(toCuff, .85).normalize();
    if (!Number.isFinite(direction.x) || direction.y > -.15 || Math.sign(direction.x) !== side) return fallback;
    // Find a section perpendicular to the sleeve, rather than an X-axis tip.
    const distal = points.filter((p) => Math.abs(p.x) > edge - .12 * body.width);
    const end = Math.max(...distal.map((p) => p.dot(direction)));
    const sectionDepth = (longSleeve ? .015 : .03) * body.width;
    const opening = openings.filter((p) => Math.sign(p.x) === side
      && Math.abs(p.dot(direction) - (end - sectionDepth)) < .01 * body.width
      && Math.abs(p.x) > edge - .12 * body.width);
    const section = opening.length >= 6 ? opening : distal.filter((p) =>
      Math.abs(p.dot(direction) - (end - sectionDepth)) < .008 * body.width);
    if (section.length >= 6) {
      cuff.copy(center(section));
      // The wrist sits at the distal rim; short sleeves retain an overlap over the arm.
      const exit = longSleeve ? end + .016 * body.width : end - sectionDepth;
      cuff.addScaledVector(direction, exit - cuff.dot(direction));
    }
    const armSpan = arm.wrist.distanceTo(arm.shoulder);
    const wristReach = Math.abs(arm.wrist.x) - Math.abs(arm.shoulder.x);
    const sourceExitX = longSleeve ? Math.abs(arm.wrist.x) / body.width : THREE.MathUtils.clamp(
      (Math.abs(arm.shoulder.x) + cuff.distanceTo(shoulder) * wristReach / armSpan) / body.width,
      .30, .87,
    );
    return {
      shoulder, cuff, direction, sourceExitX, valid: true,
    };
  };
  return { left: fitFor(sides[0], -1, landmarks.left), right: fitFor(sides[1], 1, landmarks.right) };
}

function sectionBounds(root: THREE.Object3D, low: number, high: number, maxX: number, side?: number): THREE.Box3 | undefined {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  let count = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const positions = (object.geometry as THREE.BufferGeometry).getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      if (point.y < low || point.y > high || Math.abs(point.x) > maxX) continue;
      if (side !== undefined && Math.sign(point.x) !== side) continue;
      bounds.expandByPoint(point);
      count++;
    }
  });
  return count >= 3 ? bounds : undefined;
}

function deformGarment(root: THREE.Object3D, move: (point: THREE.Vector3) => void): void {
  root.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.userData.ownedGeometry
      ? object.geometry as THREE.BufferGeometry
      : (object.geometry as THREE.BufferGeometry).clone();
    let positions = geometry.getAttribute('position');
    // GLB positions are quantized integers. Moving beyond that encoding's range
    // wraps coordinates and creates spikes; display deformation needs float positions.
    if (!(positions.array instanceof Float32Array) || positions.normalized || positions instanceof THREE.InterleavedBufferAttribute) {
      const values = new Float32Array(positions.count * 3);
      for (let i = 0; i < positions.count; i++) {
        values[i * 3] = positions.getX(i);
        values[i * 3 + 1] = positions.getY(i);
        values[i * 3 + 2] = positions.getZ(i);
      }
      positions = new THREE.Float32BufferAttribute(values, 3);
      geometry.setAttribute('position', positions);
    }
    const inverse = object.matrixWorld.clone().invert();
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      move(point);
      point.applyMatrix4(inverse);
      positions.setXYZ(i, point.x, point.y, point.z);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    object.geometry = geometry;
    object.userData.ownedGeometry = true;
  });
}

function alignPantsToBody(pants: THREE.Group, bodySource: THREE.Object3D, body: Body): void {
  // The supplied waistband rises above the anatomical waist and the shirt hem.
  deformGarment(pants, (point) => {
    point.y -= .075 * body.height * THREE.MathUtils.smoothstep(point.y, .88 * body.height, 1.15 * body.height);
  });
  // Match the hips, seat and waist separately, using the same body coordinates.
  const sections = [.77, .85, .94, 1.03, 1.12].flatMap((y) => {
    const low = (y - .035) * body.height, high = (y + .035) * body.height;
    const target = sectionBounds(bodySource, low, high, .42 * body.width);
    const source = sectionBounds(pants, low, high, .42 * body.width);
    if (!target || !source) return [];
    const size = target.getSize(new THREE.Vector3());
    const originalSize = source.getSize(new THREE.Vector3());
    return [{ y: y * body.height, target: target.getCenter(new THREE.Vector3()),
      source: source.getCenter(new THREE.Vector3()),
      ratio: new THREE.Vector3((size.x + .016 * body.width) / originalSize.x, 1,
        (size.z + .016 * body.width) / originalSize.z) }];
  });
  if (sections.length) deformGarment(pants, (point) => {
    const upper = sections.findIndex((section) => section.y >= point.y);
    const b = sections[upper < 0 ? sections.length - 1 : upper];
    const a = sections[Math.max(0, (upper < 0 ? sections.length - 1 : upper) - 1)];
    const t = a === b ? 0 : THREE.MathUtils.clamp((point.y - a.y) / (b.y - a.y), 0, 1);
    const source = a.source.clone().lerp(b.source, t);
    const target = a.target.clone().lerp(b.target, t);
    const ratio = a.ratio.clone().lerp(b.ratio, t);
    const weight = THREE.MathUtils.smoothstep(point.y, .65 * body.height, .78 * body.height);
    point.x = THREE.MathUtils.lerp(point.x, target.x + (point.x - source.x) * ratio.x, weight);
    point.z = THREE.MathUtils.lerp(point.z, target.z + (point.z - source.z) * ratio.z, weight);
  });
  const cuffRange: [number, number] = [.135 * body.height, .19 * body.height];
  const cuffs = [-1, 1].map((side) => sectionBounds(pants, ...cuffRange, .45 * body.width, side));
  const ankles = [-1, 1].map((side) => sectionBounds(bodySource, ...cuffRange, .45 * body.width, side));
  if (cuffs.some((bounds) => !bounds) || ankles.some((bounds) => !bounds)) return;
  const offsets = cuffs.map((bounds, side) =>
    ankles[side]!.getCenter(new THREE.Vector3()).sub(bounds!.getCenter(new THREE.Vector3())));
  deformGarment(pants, (point) => {
    const side = point.x < 0 ? 0 : 1;
    const vertical = 1 - THREE.MathUtils.smoothstep(point.y, .22 * body.height, .80 * body.height);
    const sideWeight = THREE.MathUtils.smoothstep(Math.abs(point.x), .025 * body.width, .10 * body.width);
    point.addScaledVector(offsets[side], vertical * sideWeight);
  });
}

function alignTopToBody(root: THREE.Group, garment: THREE.Object3D, bodySource: THREE.Object3D, body: Body): void {
  const low = 1.2 * body.height;
  const high = 1.32 * body.height;
  const bodyChest = sectionBounds(bodySource, low, high, .18 * body.width);
  const garmentChest = sectionBounds(root, low, high, .18 * body.width);
  if (!bodyChest || !garmentChest) return;
  const bodyCenter = bodyChest.getCenter(new THREE.Vector3());
  const garmentCenter = garmentChest.getCenter(new THREE.Vector3());
  garment.position.x += (bodyCenter.x - garmentCenter.x) / root.scale.x;
  garment.position.z += (bodyCenter.z - garmentCenter.z) / root.scale.z;
}

export function fitTailoredTop(root: THREE.Group, garment: THREE.Object3D, bodySource: THREE.Object3D, body: Body, outer: boolean): void {
  const bounds = new THREE.Box3().setFromObject(root);
  const neck = sectionBounds(root, 1.45 * body.height, 1.8 * body.height, .10 * body.width);
  const sourceNeck = neck?.max.y ?? bounds.max.y;
  const targetNeck = (outer ? 1.675 : 1.645) * body.height;
  const targetHem = (outer ? .985 : 1.035) * body.height;
  const scale = (targetNeck-targetHem) / Math.max(.1,sourceNeck-bounds.min.y);
  // Only whole-model dimensions change. No local radial/section deformation:
  // the source collar, folds and shoulder/sleeve cross-sections stay intact.
  root.scale.set(body.width * (outer ? 1.15 : 1.10), body.height * scale, body.width * (outer ? 1.20 : 1.10));
  root.position.y = targetNeck-sourceNeck*scale;
  alignTopToBody(root,garment,bodySource,body);
  if (outer) {
    // Settle the shoulders and bring the collar toward the front of the neck.
    // Translation only: retain the existing garment dimensions and geometry.
    root.position.y -= .035 * body.height;
    root.position.z += .030 * body.width;
  }
}

function clearClones(group: THREE.Group): void {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material.dispose());
    if (object.userData.ownedGeometry) object.geometry.dispose();
  });
  group.clear();
}

export class ClosetScene {
  readonly ready: Promise<void>;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, .1, 100);
  private renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private controls: OrbitControls;
  private mannequin = new THREE.Group();
  private clothing = new THREE.Group();
  private models: Partial<Record<ModelKey, THREE.Object3D>> = {};
  private volumeWorker = new VolumeWorker();
  private modelRequests = new Map<ModelKey,Promise<THREE.Object3D>>();
  private revision=0;
  private building=false;
  private disposed=false;
  private prepared=new Map<string,{body:THREE.Group;clothes:THREE.Group;volumes:Volume[]}>();
  private fitted=new Map<string,THREE.Group>();
  private appearance='';
  private currentKey='';
  private volumeBuilds=0;
  private modelLoads=0;
  private volumeCache = new Map<string, Volume[]>();
  private fit = defaultFit;
  private body: Body = { width: 1, height: 1 };
  private selected: Garment[] = [];
  private frame = 0;
  private resizeObserver: ResizeObserver;
  private loadingLabel: HTMLDivElement;
  private view: CameraView = 'full';
  private transition?: { start: number; from: THREE.Vector3; targetFrom: THREE.Vector3; to: THREE.Vector3; targetTo: THREE.Vector3 };

  constructor(private host: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;
    host.append(this.renderer.domElement);
    this.loadingLabel = document.createElement('div');
    this.loadingLabel.className = 'model-loading';
    this.loadingLabel.textContent = '3Dモデルを読み込み中…';
    host.append(this.loadingLabel);
    this.scene.background = new THREE.Color('#f1f1ef');
    this.scene.add(this.mannequin, this.clothing);
    this.camera.position.set(0, 1.0, 3.75);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.minDistance = .8;
    this.controls.maxDistance = 7;
    this.controls.maxPolarAngle = Math.PI * .75;
    this.controls.target.set(0, .95, 0);
    this.controls.update();
    this.controls.addEventListener('start', () => { this.transition = undefined; });
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#9c9b92', 2.1));
    const light = new THREE.DirectionalLight('#ffffff', 2.1);
    light.position.set(2.8, 5, 4);
    this.scene.add(light);
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, .035, 64), new THREE.MeshStandardMaterial({ color: '#e5e5e2', roughness: 1 }));
    floor.position.y = -.04;
    this.scene.add(floor);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.23, .008, 4, 64), new THREE.MeshBasicMaterial({ color: '#d0d0cb' }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -.013;
    this.scene.add(ring);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.ready = this.loadModels();
    this.animate();
  }

  private ensureModel(key:ModelKey):Promise<THREE.Object3D> {
    const existing=this.modelRequests.get(key);if(existing)return existing;
    const urls:Partial<Record<ModelKey,string>>={body:'body.obj',tee:'tshirt.obj',jacket:'hoodie.glb',pants:'sweatpants.glb'};
    const file=urls[key]??`${key}.glb`;
    this.host.dataset.modelLoads=String(++this.modelLoads);
    const url = `${import.meta.env.BASE_URL}models/${file}`;
    const request=(file.endsWith('.obj')?new OBJLoader().loadAsync(url):new GLTFLoader().loadAsync(url).then(g=>g.scene)).then(model=>{
      if(key==='jacket')addCylindricalUVs(model);
      this.models[key]=model;return model;
    }).catch(error=>{this.modelRequests.delete(key);throw error;});
    this.modelRequests.set(key,request);return request;
  }
  private async loadModels():Promise<void>{
    await this.ensureModel('body');
    this.requestLook();
  }
  private requestLook():void {
    this.revision++;
    if(!this.building)void this.drainLooks();
  }
  private async drainLooks():Promise<void>{
    this.building=true;
    let completed=0;
    while(!this.disposed&&completed!==this.revision){
      const revision=this.revision;completed=revision;
      const body={...this.body},fit={...this.fit},selected=this.selected.map(item=>({...item}));
      try {
        await Promise.all(selected.filter(item=>item.template!=='skirt').map(item=>this.ensureModel(item.template as ModelKey).catch(()=>{throw new Error(`${item.name}を読み込めませんでした`);})));
        if(revision!==this.revision)continue;
        await this.renderLook(body,fit,selected,revision);
        if(revision===this.revision){this.loadingLabel.remove();
          // Low priority assets never delay the selected look.
          void this.prefetchModels();
        }
      }catch(error){
        if(this.disposed)break;
        this.loadingLabel.replaceChildren(document.createTextNode(`${error instanceof Error?error.message:'3D表示に失敗しました'} `));
        const retry=document.createElement('button');retry.textContent='再試行';retry.onclick=()=>this.requestLook();this.loadingLabel.append(retry);this.host.append(this.loadingLabel);
      }
    }
    this.building=false;
  }
  private prefetchStarted=false;
  private async prefetchModels(){
    if(this.prefetchStarted)return;this.prefetchStarted=true;
    for(const key of ['tee','jacket','pants','boots','sneakers','blazer','shirt','cargo'] as ModelKey[]){
      await new Promise<void>(resolve=>setTimeout(resolve,0));
      if(this.disposed)return;
      try{await this.ensureModel(key);}catch{/* Selected assets offer retry. */}
    }
  }
  setLook(body: Body, selected: Garment[], fit?: Fit): void {
    const bodyChanged = this.body.width !== body.width || this.body.height !== body.height;
    this.body = body;
    this.selected = selected;
    if (fit) this.fit = {width:fit.width,height:fit.height,outerWidth:fit.outerWidth,depth:fit.depth};
    this.requestLook();
    if (bodyChanged) this.setView(this.view);
  }

  private async renderLook(bodyConfig:Body,fitConfig:Fit,selection:Garment[],revision:number):Promise<void> {
    const started=performance.now();
    const key=JSON.stringify([bodyConfig,fitConfig,selection.map(item=>[item.category,item.template])]);
    const appearance=JSON.stringify(selection);
    if(key===this.currentKey&&appearance===this.appearance)return;
    const cached=this.prepared.get(key);
    if(cached){
      this.prepared.delete(key);this.prepared.set(key,cached);
      this.scene.remove(this.mannequin,this.clothing);this.mannequin=cached.body;this.clothing=cached.clothes;this.scene.add(this.mannequin,this.clothing);
      this.updateAppearance(selection);this.currentKey=key;this.appearance=appearance;this.recordLook(started,selection);return;
    }
    this.loadingLabel.textContent=this.currentKey?'着替えを準備中…':'3Dモデルを読み込み中…';
    this.host.append(this.loadingLabel);
    const mannequin=new THREE.Group(),clothing=new THREE.Group();
    let committed=false;
    const usedVolumes:Volume[]=[];
    const stagingTextures:THREE.Texture[]=[];
    if (!this.models.body) return;
    try {
    const hasHoodie = selection.some((item) => item.template === 'jacket');
    const hasBlazer = selection.some((item) => item.template === 'blazer');
    const longSleeve = hasHoodie || hasBlazer || selection.some((item) => item.template === 'shirt');
    const bodyReference = this.models.body.clone(true);
    bodyReference.scale.set(bodyConfig.width, bodyConfig.height, bodyConfig.width);
    const landmarks = bodyArmLandmarks(this.models.body, bodyConfig);
    let sleeveRoot: THREE.Object3D | undefined;

    let innerRoot: THREE.Object3D | undefined;
    let outerRoot: THREE.Object3D | undefined;
    let bottomRoot: THREE.Object3D | undefined;
    let shoeRoot: THREE.Object3D | undefined;
    for (const item of selection) {
      const fitKey=JSON.stringify([item.template,bodyConfig,fitConfig]);
      const fitted=this.fitted.get(fitKey);
      if(fitted){
        this.fitted.delete(fitKey);this.fitted.set(fitKey,fitted);
        const root=fitted.clone(true);
        root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;if(o.userData.ownedGeometry)o.geometry=o.geometry.clone();const originals=Array.isArray(o.material)?o.material:[o.material];const materials=originals.map(m=>{const mat=m.clone();mat.userData={sourceMap:m.userData.sourceMap};return mat;});o.material=Array.isArray(o.material)?materials:materials[0];});
        root.userData.category=item.category;clothing.add(root);
        if(item.category==='outer'||(item.category==='top'&&!sleeveRoot))sleeveRoot=root;
        if(item.category==='top')innerRoot=root;if(item.category==='outer')outerRoot=root;
        if(item.template==='pants'||item.template==='cargo')bottomRoot=root;if(item.category==='shoes')shoeRoot=root;
        continue;
      }
      const source = this.models[item.template as ModelKey];
      if (!source) { if (item.template === 'skirt') this.addLegacySkirt(item,clothing,bodyConfig); continue; }
      const root = new THREE.Group();
      const garment = source.clone(true);
      const texture = patternedTexture(item);
      if (texture) stagingTextures.push(texture);
      garment.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const originals = Array.isArray(object.material) ? object.material : [object.material];
        const materials = originals.map((original) => {
          const mat = original instanceof THREE.MeshStandardMaterial ? original.clone() : new THREE.MeshStandardMaterial();
          mat.userData={sourceMap:item.template==='shirt'?mat.map:null,patternTexture:texture};
          mat.color.set(texture ? '#ffffff' : item.color);
          mat.map = texture ?? (item.template === 'shirt' ? mat.map : null);
          mat.side = THREE.DoubleSide;
          mat.roughness = .88;
          mat.transparent = false;
          mat.opacity = 1;
          mat.alphaTest = 0;
          mat.depthWrite = true;
          mat.needsUpdate = true;
          return mat;
        });
        object.material = Array.isArray(object.material) ? materials : materials[0];
      });
      if (item.category === 'shoes' || item.template === 'cargo') {
        root.scale.set(bodyConfig.width, bodyConfig.height, bodyConfig.width);
      } else if (item.template === 'shirt' || item.template === 'blazer') {
        root.scale.set(bodyConfig.width, bodyConfig.height, bodyConfig.width);
      } else if (item.template === 'pants') {
        // The supplied trousers are modelled away from the origin.
        garment.position.set(1.73004, 0, 2.28468);
        root.scale.set(bodyConfig.width * 1.04, bodyConfig.height, bodyConfig.width * 1.04);
      } else if (item.template === 'jacket') {
        root.scale.set(fitConfig.outerWidth / 1.18, bodyConfig.height * .95, fitConfig.outerWidth / 1.18);
        root.position.y = .015 * bodyConfig.height;
      } else {
        garment.position.y = .12;
        root.scale.set(fitConfig.width, bodyConfig.height, fitConfig.width);
      }
      root.userData.category=item.category;
      root.userData.template=item.template;
      root.add(garment);
      clothing.add(root);
      if (item.template === 'shirt' || item.template === 'blazer') {
        fitTailoredTop(root, garment, bodyReference, bodyConfig, item.category === 'outer');
      } else if (item.category === 'top' || item.category === 'outer') {
        alignTopToBody(root, garment, bodyReference, bodyConfig);
      }
      if (item.category === 'outer' || (item.category === 'top' && !sleeveRoot)) sleeveRoot = root;
      if (item.category === 'top') innerRoot = root;
      if (item.category === 'outer') outerRoot = root;
      if (item.template === 'pants' || item.template === 'cargo') bottomRoot = root;
      if (item.category === 'shoes') shoeRoot = root;
      if (item.template === 'pants') {
        alignPantsToBody(root, bodyReference, bodyConfig);
      }
      const prototype=root.clone(true);
      prototype.traverse(o=>{if(!(o instanceof THREE.Mesh))return;if(o.userData.ownedGeometry)o.geometry=o.geometry.clone();
        const originals=Array.isArray(o.material)?o.material:[o.material];
        const materials=originals.map(m=>{const mat=m.clone() as THREE.MeshStandardMaterial;mat.map=m.userData.sourceMap??null;mat.userData={sourceMap:mat.map};return mat;});o.material=Array.isArray(o.material)?materials:materials[0];
      });
      this.fitted.set(fitKey,prototype);
      while(this.fitted.size>12){const first=this.fitted.keys().next().value!;clearClones(this.fitted.get(first)!);this.fitted.delete(first);}
    }
    const sleeves = sleeveRoot ? garmentSleeves(sleeveRoot, bodyConfig, landmarks, longSleeve) : undefined;
    const innerItem = selection.find(item=>item.category==='top');
    if (innerRoot && outerRoot && sleeves) {
      const innerSleeves=garmentSleeves(innerRoot,bodyConfig,landmarks,innerItem?.template!=='tee');
      const corrections=[innerSleeves.left,innerSleeves.right].map((fit,i)=>({
        origin:fit.shoulder,target:i?sleeves.right:sleeves.left,
        rotation:new THREE.Quaternion().setFromUnitVectors(fit.direction,(i?sleeves.right:sleeves.left).direction),
      }));
      // Pose sleeves around their shoulder; do not enlarge or flatten the fabric.
      deformGarment(innerRoot,point=>{
        const side=point.x<0?0:1,ax=Math.abs(point.x),correction=corrections[side];
        if(ax<.19*bodyConfig.width||point.y>1.60*bodyConfig.height)return;
        const posed=point.clone().sub(correction.origin).applyQuaternion(correction.rotation).add(correction.target.shoulder);
        point.lerp(posed,THREE.MathUtils.smoothstep(ax,.19*bodyConfig.width,.29*bodyConfig.width));
      });
    }
    const cachedVolumes=async(key:string,build:()=>Promise<Volume[]>)=>{
      const cacheKey=key+JSON.stringify([bodyConfig,fitConfig]);
      let volumes=this.volumeCache.get(cacheKey);
      if(!volumes){this.host.dataset.volumeBuilds=String(++this.volumeBuilds);volumes=await build();this.volumeCache.set(cacheKey,volumes);}
      this.volumeCache.delete(cacheKey);this.volumeCache.set(cacheKey,volumes);
      usedVolumes.push(...volumes);return volumes;
    };
    const topVolumes=(root:THREE.Object3D,fit:SleeveFits|undefined,key:string)=>cachedVolumes(key,async()=>{
      const bounds=new THREE.Box3().setFromObject(root),width=.27*bodyConfig.width;
      const chest=sectionBounds(root,1.2*bodyConfig.height,1.4*bodyConfig.height,.18*bodyConfig.width)??bounds;
      const z=chest.getCenter(new THREE.Vector3()).z;
      const neck=sectionBounds(root,1.45*bodyConfig.height,1.8*bodyConfig.height,.10*bodyConfig.width);
      const top=Math.min(neck?.max.y??bounds.max.y,1.64*bodyConfig.height);
      const torso=await this.volumeWorker.build(root,new THREE.Vector3(0,bounds.min.y,z),new THREE.Vector3(0,top,z),{kind:'torso',width});
      const result:Volume[]=torso?[torso]:[];
      if(fit)for(const [i,sleeve] of [fit.left,fit.right].entries()){
        if(!sleeve.valid)continue;
        const end=sleeve.cuff.clone().addScaledVector(sleeve.direction,-.018*bodyConfig.height);
        const volume=await this.volumeWorker.build(root,sleeve.shoulder,end,{kind:'sleeve',side:i?1:-1,shoulder:sleeve.shoulder.toArray(),direction:sleeve.direction.toArray(),minX:Math.abs(sleeve.shoulder.x)-.035*bodyConfig.width,radius:.14*bodyConfig.width});
        if(volume)result.push(volume);
      }
      return result;
    });
    const outerVolumes=outerRoot?await topVolumes(outerRoot,sleeves,'outer:'+selection.find(item=>item.category==='outer')?.template):[];
    const innerFits=innerRoot?garmentSleeves(innerRoot,bodyConfig,landmarks,innerItem?.template!=='tee'):undefined;
    const innerVolumes=innerRoot?await topVolumes(innerRoot,innerFits,'inner:'+innerItem?.template+':'+(selection.find(item=>item.category==='outer')?.template??'single')):[];
    if(outerRoot&&innerRoot&&outerVolumes.length){
      const mask=volumeShader(outerVolumes,'outerVolume',-.004*bodyConfig.width);
      applyVisibilityMask(innerRoot,`!(${mask.inside('maskWorld')})`,mask.uniforms,mask.declarations);
    }
    const legVolumes=bottomRoot?await cachedVolumes('bottom:'+selection.find(item=>item.category==='bottom')?.template,async()=>{
      const bounds=new THREE.Box3().setFromObject(bottomRoot),volumes:Volume[]=[];
      for(const side of [-1,1]){
        const cuff=sectionBounds(bottomRoot,bounds.min.y,bounds.min.y+.06*bodyConfig.height,.5*bodyConfig.width,side);
        const center=cuff?.getCenter(new THREE.Vector3())??new THREE.Vector3(side*.105*bodyConfig.width,0,0);
        const volume=await this.volumeWorker.build(bottomRoot,new THREE.Vector3(center.x,cuff?.min.y??bounds.min.y,center.z),new THREE.Vector3(center.x,bounds.max.y,center.z),{kind:'side',side});
        if(volume)volumes.push(volume);
      }
      return volumes;
    }):[];
    if(shoeRoot&&legVolumes.length){
      const mask=volumeShader(legVolumes,'legVolume',.004*bodyConfig.width);
      const cut=legVolumes.map(v=>`(maskWorld.x ${v.origin.x<0?'<':'>='} 0.0 && maskWorld.y >= ${v.origin.y.toFixed(7)})`).join(' || ');
      applyVisibilityMask(shoeRoot,`(${cut}) && !(${mask.inside('maskWorld')})`,mask.uniforms,mask.declarations);
    }
    const footVolumes=shoeRoot?await cachedVolumes('shoes:'+selection.find(item=>item.category==='shoes')?.template,async()=>{
      const bounds=new THREE.Box3().setFromObject(shoeRoot),volumes:Volume[]=[];
      for(const side of [-1,1]){
        const origin=new THREE.Vector3(side*.105*bodyConfig.width,bounds.min.y,0);
        const volume=await this.volumeWorker.build(shoeRoot,origin,new THREE.Vector3(origin.x,bounds.max.y,0),{kind:'side',side});
        if(volume)volumes.push(volume);
      }
      return volumes;
    }):[];
    const body = this.models.body.clone(true);
    poseBodyArms(body, sleeves ?? {
      left: fallbackSleeve(-1, bodyConfig, landmarks.left.shoulder),
      right: fallbackSleeve(1, bodyConfig, landmarks.right.shoulder),
    }, landmarks, bodyConfig);
    body.scale.set(bodyConfig.width, bodyConfig.height, bodyConfig.width);
    body.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const mat = new THREE.MeshStandardMaterial({ color: '#d5b4a1', roughness: .92, side: THREE.DoubleSide });
      object.material = mat;
    });
    const skinVolumes=innerVolumes.length?innerVolumes:outerVolumes;
    const allVolumes=[...skinVolumes,...legVolumes,...footVolumes];
    if(allVolumes.length){
      const mask=volumeShader(allVolumes,'skinVolume',-.003*bodyConfig.width);
      const topRoot=innerRoot??outerRoot;
      const hem=topRoot?new THREE.Box3().setFromObject(topRoot).min.y/bodyConfig.height:0;
      const fits=innerFits??sleeves;
      const armRegions=fits?[fits.left,fits.right].filter(fit=>fit.valid).map((fit,i)=>`(maskSource.x ${i===0?'< -':'> '}.17 && abs(maskSource.x)<${(fit.sourceExitX-.025).toFixed(7)} && maskSource.y>1.20 && maskSource.y<1.75)`):[];
      const torso=topRoot?`(maskSource.y>${hem.toFixed(7)} && maskSource.y<1.55 && abs(maskSource.x)<.27)`:'false';
      const legs=bottomRoot?`(maskSource.y>${(new THREE.Box3().setFromObject(bottomRoot).min.y/bodyConfig.height).toFixed(7)} && maskSource.y<${(new THREE.Box3().setFromObject(bottomRoot).max.y/bodyConfig.height).toFixed(7)} && abs(maskSource.x)<.42)`:'false';
      const feet=shoeRoot?`(maskSource.y<${(new THREE.Box3().setFromObject(shoeRoot).max.y/bodyConfig.height).toFixed(7)})`:'false';
      const protectedRegion=BODY_PROTECTION_GLSL;
      const outerSkin=volumeShader(outerVolumes,'outerSkinVolume',-.002*bodyConfig.width);
      const outerArmRegions=sleeves?[sleeves.left,sleeves.right].map((fit,i)=>fit.valid?`(maskSource.x ${i===0?'< -':'> '}.17 && abs(maskSource.x)<${(fit.sourceExitX-.025).toFixed(7)} && maskSource.y>1.20 && maskSource.y<1.75)`:'false'):[];
      const outerCut=outerVolumes.length?`((${[torso,...outerArmRegions].join(' || ')}) && !(${outerSkin.inside('maskWorld')}))`:'false';
      applyVisibilityMask(body,`!${protectedRegion} && (((${[torso,legs,feet,...armRegions].join(' || ')}) && !(${mask.inside('maskWorld')})) || ${outerCut})`,{...mask.uniforms,...outerSkin.uniforms},mask.declarations+'\n'+outerSkin.declarations,true);
    }
    mannequin.add(body);
    if(this.disposed||revision!==this.revision)return;
    this.scene.remove(this.mannequin,this.clothing);this.mannequin=mannequin;this.clothing=clothing;this.scene.add(mannequin,clothing);
    this.prepared.set(key,{body:mannequin,clothes:clothing,volumes:usedVolumes});
    committed=true;

    this.updateAppearance(selection);this.currentKey=key;this.appearance=appearance;this.recordLook(started,selection);
    while(this.prepared.size>6){const oldest=this.prepared.keys().next().value!;const look=this.prepared.get(oldest)!;this.disposeLook(look);this.prepared.delete(oldest);}
    const pinned=new Set([...this.prepared.values()].flatMap(look=>look.volumes));
    for(const [cacheKey,volumes] of this.volumeCache){if(this.volumeCache.size<=24)break;if(volumes.some(volume=>pinned.has(volume)))continue;volumes.forEach(volume=>volume.texture.dispose());this.volumeCache.delete(cacheKey);}
    } finally {if(!committed){clearClones(mannequin);clearClones(clothing);stagingTextures.forEach(t=>t.dispose());}}
  }
  private recordLook(started:number,selection:Garment[]){
    this.host.dataset.lookMs=(performance.now()-started).toFixed(1);
    this.host.dataset.readyLook=selection.map(item=>item.id).join(',');
    this.host.dataset.preparedLooks=String(this.prepared.size);
  }

  private disposeLook(look:{body:THREE.Group;clothes:THREE.Group}){
    const owned=new Set<THREE.Texture>();look.clothes.traverse(o=>{if(o instanceof THREE.Mesh)for(const mat of Array.isArray(o.material)?o.material:[o.material])if(mat.userData.patternTexture)owned.add(mat.userData.patternTexture);});
    owned.forEach(t=>t.dispose());clearClones(look.body);clearClones(look.clothes);
  }
  private updateAppearance(selection:Garment[]){
    for(const root of this.clothing.children){
      const item=selection.find(item=>item.category===root.userData.category);if(!item)continue;
      const texture=patternedTexture(item),old=new Set<THREE.Texture>();
      root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;for(const material of Array.isArray(o.material)?o.material:[o.material]){
        const mat=material as THREE.MeshStandardMaterial;
        if(mat.userData.patternTexture)old.add(mat.userData.patternTexture);
        if(!('sourceMap' in mat.userData))mat.userData.sourceMap=item.template==='shirt'?mat.map:null;
        const hadMap=!!mat.map;mat.map=texture??mat.userData.sourceMap;mat.color.set(texture?'#ffffff':item.color);mat.userData.patternTexture=texture;
        if(hadMap!==!!mat.map)mat.needsUpdate=true;
      }});old.forEach(t=>t.dispose());
    }
  }
  private addLegacySkirt(item: Garment,group=this.clothing,body=this.body): void {
    const mat = new THREE.MeshStandardMaterial({ color: item.color, roughness: .88, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(.34 * body.width, .52 * body.width, .54 * body.height, 28), mat);
    mesh.position.y = .91 * body.height;
    mesh.scale.z = .72;
    mesh.userData.ownedGeometry = true;
    mesh.userData.category=item.category;
    group.add(mesh);
  }

  private resize(): void {
    const { clientWidth, clientHeight } = this.host;
    if (!clientWidth || !clientHeight) return;
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.setView(this.view, false);
  }

  private animate = (): void => {
    this.frame = requestAnimationFrame(this.animate);
    const transition = this.transition;
    if (transition) {
      const t = Math.min(1, (performance.now() - transition.start) / 400);
      const ease = t * t * (3 - 2 * t);
      this.camera.position.lerpVectors(transition.from, transition.to, ease);
      this.controls.target.lerpVectors(transition.targetFrom, transition.targetTo, ease);
      const damping = this.controls.enableDamping;
      this.controls.enableDamping = false;
      this.controls.update();
      this.controls.enableDamping = damping;
      if (t === 1) this.transition = undefined;
    } else this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  setView(view: CameraView, animated = true): void {
    this.view = view;
    // Fit the relevant body region inside the available viewport, including narrow phones.
    const regions = { full: { min: -.08, max: 1.9, width: 1.2 }, upper: { min: .88, max: 1.91, width: 1.12 }, lower: { min: -.06, max: 1.14, width: .86 }, feet: { min: -.06, max: .48, width: .7 } };
    const region = regions[view];
    const height = (region.max - region.min) * this.body.height;
    const width = region.width * this.body.width;
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const distance = Math.max(height / (2 * tan), width / (2 * tan * this.camera.aspect)) * 1.13 + .2 * this.body.width;
    this.controls.maxDistance = Math.max(7, distance * 1.6);
    const target = new THREE.Vector3(0, (region.min + region.max) / 2 * this.body.height, 0);
    const position = target.clone().add(new THREE.Vector3(0, .04, distance));
    // Flush OrbitControls' previous damping before taking over the camera.
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = damping;
    if (animated && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.transition = { start: performance.now(), from: this.camera.position.clone(), targetFrom: this.controls.target.clone(), to: position, targetTo: target };
    } else {
      this.transition = undefined;
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
    }
  }

  resetCamera(): void {
    this.setView(this.view);
  }

  dispose(): void {
    this.disposed=true;this.revision++;this.volumeWorker.dispose();
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.prepared.forEach(look=>this.disposeLook(look));this.prepared.clear();
    this.fitted.forEach(root=>clearClones(root));this.fitted.clear();
    for (const source of Object.values(this.models)) source?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
    this.volumeCache.forEach(volumes=>volumes.forEach(volume=>volume.texture.dispose()));
    this.renderer.dispose();
  }
}
