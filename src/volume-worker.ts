import * as THREE from 'three';
import { fittingVolume } from './visibility';
import { accepts, type VolumeJob } from './volume-filter';
self.onmessage=(event:MessageEvent<VolumeJob & {id:number}>)=>{
 const {id,positions,origin,end,filter}=event.data;
 try {
  const mesh=new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(positions,3)));
  const volume=fittingVolume(mesh,new THREE.Vector3(...origin),new THREE.Vector3(...end),p=>accepts(filter,p));
  self.postMessage({id,volume:volume?{origin:volume.origin.toArray(),axis:volume.axis.toArray(),u:volume.u.toArray(),v:volume.v.toArray(),length:volume.length,radii:volume.radii}:undefined},volume?[volume.radii.buffer]:[]);
 }catch(error){self.postMessage({id,error:String(error)});}
};
