import assert from 'node:assert/strict';
import {build} from 'esbuild';
import * as THREE from 'three';
await build({entryPoints:['src/visibility.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.cache/visibility-test.mjs'});
const {fittingVolume,volumeContains,volumeShader,applyVisibilityMask,protectedBody,protrudes}=await import('../.cache/visibility-test.mjs');
for(const scale of [.8,1,1.25]){
 const root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.CylinderGeometry(.2,.25,1,64,32,true),new THREE.MeshStandardMaterial());mesh.position.y=.5;root.add(mesh);root.scale.setScalar(scale);
 const original=new Float32Array(mesh.geometry.getAttribute('position').array);
 const volume=fittingVolume(root,new THREE.Vector3(),new THREE.Vector3(0,scale,0));assert.ok(volume);
 for(const p of [new THREE.Vector3(0,.5*scale,0),new THREE.Vector3(.1*scale,.5*scale,0),new THREE.Vector3(0,.001*scale,.1*scale)])assert.ok(volumeContains(volume,p),'interior including open hem stays present');
 assert.ok(!volumeContains(volume,new THREE.Vector3(.4*scale,.5*scale,0)),'only exterior protrusion is clipped');
 assert.ok(!volumeContains(volume,new THREE.Vector3(0,1.1*scale,0)),'outside coverage stays outside volume');
 assert.ok(protrudes([volume],new THREE.Vector3(.26*scale,.5*scale,0),.12*scale),'nearby exterior skin/fabric is clipped');
 assert.ok(!protrudes([volume],new THREE.Vector3(.1*scale,.5*scale,0),.12*scale),'interior is retained');
 for(const y of [-.01,1.01])assert.ok(!protrudes([volume],new THREE.Vector3(.26*scale,y*scale,0),.12*scale),'exposed hem/cuff beyond outer garment is retained');
 assert.ok(!protrudes([volume],new THREE.Vector3(.8*scale,.5*scale,0),.12*scale),'unrelated neighboring limb is retained');
 const mask=volumeShader([volume],'volume',.002);applyVisibilityMask(root,`!(${mask.inside('maskWorld')})`,mask.uniforms,mask.declarations);
 assert.deepEqual(mesh.geometry.getAttribute('position').array,original,'visible model has no caps or geometry deletion');
 const shader={uniforms:{},vertexShader:'#include <common>\n#include <project_vertex>',fragmentShader:'#include <common>\n#include <clipping_planes_fragment>'};mesh.material.onBeforeCompile(shader);assert.ok(shader.fragmentShader.includes('Contains'));assert.ok(!shader.fragmentShader.includes('frontMask'));
 volume.texture.dispose();
}
// An open front has no actual cloth, even though the containment envelope is closed.
const open=new THREE.Mesh(new THREE.CylinderGeometry(.2,.2,1,64,32,true,Math.PI/4,Math.PI*1.5));open.position.y=.5;
const openVolume=fittingVolume(open,new THREE.Vector3(),new THREE.Vector3(0,1,0));
assert.ok(!protrudes([openVolume],new THREE.Vector3(0,.5,.24),.12),'open jacket front retains visible inner fabric');
assert.ok(protrudes([openVolume],new THREE.Vector3(0,.5,-.24),.12),'closed back clips only the protrusion');
const wide=new THREE.Mesh(new THREE.CylinderGeometry(.3,.3,1,64,32,true));wide.position.y=.5;
const wideVolume=fittingVolume(wide,new THREE.Vector3(),new THREE.Vector3(0,1,0));
const overlap=new THREE.Vector3(0,.5,-.24);
assert.ok(volumeContains(wideVolume,overlap));
assert.ok([ [openVolume], [wideVolume] ].some(layer=>protrudes(layer,overlap,.12)),'another garment containing the point cannot hide a collision with this layer');
openVolume.texture.dispose();wideVolume.texture.dispose();
for(const y of [1.55,1.58,1.65,1.8])assert.ok(protectedBody(new THREE.Vector3(.1,y,.12)),'neck/chin/face stay protected regardless of garment');
assert.ok(protectedBody(new THREE.Vector3(.8,1.45,0)),'hands protected');
assert.ok(!protectedBody(new THREE.Vector3(.2,1.45,0)),'torso protrusions remain eligible');
console.log('PASS: retained interiors, closed invisible fitting envelope, exterior-only cuts, protected neck/chin/head/hands and source immutability');

assert.ok(!protectedBody(new THREE.Vector3(.15,1.58,0)), 'shoulder beside neck remains eligible for clipping');
