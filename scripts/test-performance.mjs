import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import * as THREE from 'three';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
await mkdir('.cache/performance',{recursive:true});
await build({entryPoints:['scripts/fixtures/visibility-reference.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.cache/performance/before.mjs'});
await build({entryPoints:['src/visibility.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.cache/performance/after.mjs'});
const before=await import('../.cache/performance/before.mjs'),after=await import('../.cache/performance/after.mjs');
const measurements=[];
for(const key of ['blazer','shirt','sweatpants','cargo','boots','sneakers','hoodie']){
 const document=await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(`public/models/${key}.glb`),root=new THREE.Group();
 for(const node of document.getRoot().listNodes())for(const p of node.getMesh()?.listPrimitives()??[]){
  const g=new THREE.BufferGeometry(),pos=p.getAttribute('POSITION');g.setAttribute('position',new THREE.BufferAttribute(pos.getArray(),3,pos.getNormalized()));
  if(p.getIndices())g.setIndex(new THREE.BufferAttribute(p.getIndices().getArray(),1));root.add(new THREE.Mesh(g));
 }
 const box=new THREE.Box3().setFromObject(root),center=box.getCenter(new THREE.Vector3()),origin=new THREE.Vector3(center.x,box.min.y,center.z),end=new THREE.Vector3(center.x,box.max.y,center.z);
 let start=performance.now();const old=before.fittingVolume(root,origin,end);const oldMs=performance.now()-start;
 start=performance.now();const next=after.fittingVolume(root,origin,end);const newMs=performance.now()-start;
 assert.equal(!!old,!!next);let maxError=0;if(old&&next){for(let i=0;i<old.radii.length;i++)maxError=Math.max(maxError,Math.abs(old.radii[i]-next.radii[i]));assert.ok(maxError<.000002,`${key}: retained 128x128 boundary, error ${maxError}`);old.texture.dispose();next.texture.dispose();}
 measurements.push({model:key,beforeMs:+oldMs.toFixed(1),afterMs:+newMs.toFixed(1),speedup:+(oldMs/newMs).toFixed(1),maxError});
}
console.log(JSON.stringify(measurements,null,2));
