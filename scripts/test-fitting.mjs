import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import * as THREE from 'three';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {NodeIO} from '@gltf-transform/core';
await mkdir('.cache/fitting-tests',{recursive:true});
await build({entryPoints:['src/scene.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.cache/fitting-tests/scene.mjs'});
const {fitTailoredTop}=await import('../.cache/fitting-tests/scene.mjs');
const bodySource=new OBJLoader().parse(await readFile('public/models/body.obj','utf8'));
for(const key of ['shirt','blazer']) {
 const document=await new NodeIO().read(`public/models/${key}.glb`), source=new THREE.Group();
 for(const node of document.getRoot().listNodes()) for(const primitive of node.getMesh()?.listPrimitives()??[]) {
  const geometry=new THREE.BufferGeometry();
  const position=primitive.getAttribute('POSITION');
  geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(position.getArray()),3));
  if(primitive.getIndices()) geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(primitive.getIndices().getArray()),1));
  source.add(new THREE.Mesh(geometry));
 }
 const original=source.children.map(mesh=>new Float32Array(mesh.geometry.getAttribute('position').array));
 for(const body of [{width:.75,height:.8},{width:1,height:1},{width:1.35,height:1.25},{width:.75,height:1.25},{width:1.35,height:.8}]) {
  const garment=source.clone(true),root=new THREE.Group(),reference=bodySource.clone(true);
  root.scale.set(body.width,body.height,body.width);root.add(garment);
  reference.scale.set(body.width,body.height,body.width);
  fitTailoredTop(root,garment,reference,body,key==='blazer');
  const bounds=new THREE.Box3().setFromObject(root);
  assert.ok(Math.abs(bounds.max.y/body.height-(key==='blazer'?1.640:1.645))<.015,`${key}: collar stays anchored`);
  assert.ok(bounds.min.y/body.height>.94,`${key}: hem stays at waist`);
  garment.traverse(mesh=>{if(!mesh.isMesh)return; for(const value of mesh.geometry.getAttribute('position').array) assert.ok(Number.isFinite(value),'finite geometry');});
  garment.children.forEach((mesh,i)=>{
    assert.deepEqual(mesh.geometry.getAttribute('position').array,original[i],`${key}: fitting cannot inflate or deform vertices`);
    assert.equal(mesh.geometry,source.children[i].geometry,'fitting uses only model transforms');
  });
  assert.ok(root.scale.x/body.width<=1.15+.00001,'bounded overall width');
 }
 source.children.forEach((mesh,i)=>assert.deepEqual(mesh.geometry.getAttribute('position').array,original[i],'source geometry unchanged'));
}
console.log('PASS: collar/hem anchors, no local vertex deformation, bounded model size and immutable sources across standard/extreme body proportions');
