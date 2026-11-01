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

const {beyondCuff}=await import('../.cache/visibility-test.mjs');
for(const side of [-1,1])for(const scale of [.75,1,1.35]){
 const direction=new THREE.Vector3(side*.6,-.8,0);
 const shoulder=new THREE.Vector3(side*.24,1.48,0).multiplyScalar(scale);
 const cuff=shoulder.clone().addScaledVector(direction,.5*scale);
 const boundary={shoulder,cuff,direction,valid:true};
 assert.ok(beyondCuff(cuff.clone().addScaledVector(direction,.03*scale),boundary),'excess inner sleeve beyond outer cuff is cut');
 assert.ok(!beyondCuff(cuff.clone().addScaledVector(direction,-.03*scale),boundary),'inner sleeve inside outer cuff remains');
 assert.ok(!beyondCuff(new THREE.Vector3(0,.5,0),boundary),'torso and hem are not sleeve excess');
 assert.ok(!beyondCuff(cuff.clone().addScaledVector(direction,.03*scale),{...boundary,valid:false}),'invalid sleeve fit cannot cut');
}

const vertical={shoulder:new THREE.Vector3(.24,1.48,0),cuff:new THREE.Vector3(.24,.98,0),direction:new THREE.Vector3(0,-1,0),valid:true};
assert.ok(beyondCuff(new THREE.Vector3(.20,.96,0),vertical),'inward half of cuff ring is also trimmed');
assert.ok(!beyondCuff(new THREE.Vector3(.24,.9,.2),vertical),'hip beyond cuff plane but away from sleeve axis is retained');

const shells=new THREE.Group();
for(const radius of [.18,.22]){const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,1,64,32,true));mesh.position.y=.5;shells.add(mesh);}
const surface=fittingVolume(shells,new THREE.Vector3(),new THREE.Vector3(0,1,0));
assert.ok(volumeContains(surface,new THREE.Vector3(.20,.5,0)),'inner lining cannot overcut a point beneath the outer fabric surface');
assert.ok(protrudes([surface],new THREE.Vector3(.24,.5,0),.12),'point beyond outer fabric still clips');
surface.texture.dispose();
