import assert from 'node:assert/strict';
import {build} from 'esbuild';
import * as THREE from 'three';
await build({entryPoints:['src/sleeve-opening.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.cache/sleeve-opening-test.mjs'});
const {sleeveOpening}=await import('../.cache/sleeve-opening-test.mjs');
for(const scale of [.75,1,1.35])for(const side of [-1,1])for(const closed of [false,true]){
 const axis=new THREE.Vector3(side*.7,-.7,.1).normalize(),center=new THREE.Vector3(side*.5,1.1,.05).multiplyScalar(scale);
 const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.045*scale,.045*scale,.3*scale,48,12,!closed));
 mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),axis);mesh.position.copy(center).addScaledVector(axis,-.15*scale);
 const guess=center.clone().add(new THREE.Vector3(-side*.04*scale,-.012*scale,0));
 const opening=sleeveOpening(mesh,guess,axis,scale);assert.ok(opening);
 const error=opening.center.clone().sub(center),along=error.dot(axis);
 assert.ok(error.addScaledVector(axis,-along).length()<.002*scale,'wrist follows actual rim center despite biased initial guess');
 assert.ok(along<0&&along>-.035*scale,'wrist anchor stays just inside the sleeve');
 assert.ok(Math.abs(opening.radius-.045*scale)<.003*scale,'actual cuff contour is measured');
}
console.log('PASS: actual cuff centers, slanted sleeves, closed rims, left/right and body scaling');
