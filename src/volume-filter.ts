import * as THREE from 'three';
export type Filter={kind:'torso';width:number}|{kind:'side';side:number}|{kind:'sleeve';side:number;shoulder:number[];direction:number[];minX:number;radius:number};
export type VolumeJob={positions:Float64Array;origin:[number,number,number];end:[number,number,number];filter:Filter};
export function accepts(filter:Filter,p:THREE.Vector3):boolean{
 if(filter.kind==='torso')return Math.abs(p.x)<filter.width;
 if(Math.sign(p.x)!==filter.side)return false;
 if(filter.kind==='side')return true;
 const dx=p.x-filter.shoulder[0],dy=p.y-filter.shoulder[1],dz=p.z-filter.shoulder[2];
 const t=dx*filter.direction[0]+dy*filter.direction[1]+dz*filter.direction[2];
 return Math.abs(p.x)>filter.minX&&Math.hypot(dx-t*filter.direction[0],dy-t*filter.direction[1],dz-t*filter.direction[2])<filter.radius;
}
