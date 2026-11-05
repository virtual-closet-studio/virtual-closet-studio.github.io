import * as THREE from 'three';

/** Fitted triangle cross-section; also works on cuffs with closed/thick rims. */
export function sleeveOpening(root:THREE.Object3D,guess:THREE.Vector3,direction:THREE.Vector3,width:number){
 const triangles:THREE.Vector3[][]=[],side=Math.sign(guess.x),axis=direction.clone().normalize();
 let end=-Infinity;
 root.updateMatrixWorld(true);
 root.traverse(o=>{
  if(!(o instanceof THREE.Mesh))return;
  const p=o.geometry.getAttribute('position'),idx=o.geometry.index,n=idx?.count??p.count;
  for(let i=0;i<n;i+=3){
   const tri=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(p,idx?idx.getX(i+j):i+j).applyMatrix4(o.matrixWorld));
   if(!tri.some(p=>p.x*side>.25*width&&p.distanceTo(guess)<.16*width))continue;
   triangles.push(tri);
   for(const p of tri)if(p.distanceTo(guess)<.16*width)end=Math.max(end,p.dot(axis));
  }
 });
 if(!Number.isFinite(end))return;
 const u=new THREE.Vector3(0,0,1).addScaledVector(axis,-axis.z).normalize(),v=new THREE.Vector3().crossVectors(axis,u);
 const section=(level:number)=>{
  const points:THREE.Vector3[]=[];
  for(const tri of triangles)for(let j=0;j<3;j++){
   const a=tri[j],b=tri[(j+1)%3],ta=a.dot(axis)-level,tb=b.dot(axis)-level;
   if(ta*tb>0||Math.abs(ta-tb)<1e-9)continue;
   const p=a.clone().lerp(b,ta/(ta-tb));
   if(p.distanceTo(guess)<.16*width)points.push(p);
  }
  if(points.length<6)return;
  const us=points.map(p=>p.dot(u)),vs=points.map(p=>p.dot(v));
  const minU=Math.min(...us),maxU=Math.max(...us),minV=Math.min(...vs),maxV=Math.max(...vs);
  return {center:axis.clone().multiplyScalar(level).addScaledVector(u,(minU+maxU)/2).addScaledVector(v,(minV+maxV)/2),area:(maxU-minU)*(maxV-minV),radius:Math.max(maxU-minU,maxV-minV)/2};
 };
 // Move just inside the distal lip until a complete cross-section is present.
 const samples=[.008,.014,.020,.026,.032].map(d=>section(end-d*width)).filter((s):s is NonNullable<typeof s>=>!!s);
 const maxArea=Math.max(...samples.map(s=>s.area));
 const opening=samples.find(s=>s.area>=maxArea*.85);
 return opening?{...opening,exit:opening.center.clone().addScaledVector(axis,end-opening.center.dot(axis))}:undefined;
}
