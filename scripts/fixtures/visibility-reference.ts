import * as THREE from 'three';
const f=(v:number)=>v.toFixed(7);
const vec=(v:THREE.Vector3)=>`vec3(${f(v.x)},${f(v.y)},${f(v.z)})`;
export type Volume={origin:THREE.Vector3;axis:THREE.Vector3;u:THREE.Vector3;v:THREE.Vector3;length:number;radii:Float32Array;texture:THREE.DataTexture};
const angles=128, rows=128;

// Cross-sections close only the fitting envelope, never the visible garment.
// Each radial intersection is taken from fitted triangles, independent of camera.
export function fittingVolume(root:THREE.Object3D,origin:THREE.Vector3,end:THREE.Vector3,accept:(p:THREE.Vector3)=>boolean=()=>true):Volume|undefined {
 const axis=end.clone().sub(origin),length=axis.length();if(length<1e-5)return;
 axis.normalize();const u=new THREE.Vector3(1,0,0).addScaledVector(axis,-axis.x).normalize();
 if(u.lengthSq()<.1)u.set(0,0,1).addScaledVector(axis,-axis.z).normalize();
 const v=new THREE.Vector3().crossVectors(axis,u).normalize(),radii=new Float32Array(angles*rows),points=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];
 root.updateMatrixWorld(true);
 root.traverse(object=>{
  if(!(object instanceof THREE.Mesh))return;
  const geo=object.geometry,pos=geo.getAttribute('position'),index=geo.index,count=index?.count??pos.count;
  for(let i=0;i<count;i+=3){
   const t=[];for(let j=0;j<3;j++){points[j].fromBufferAttribute(pos,index?index.getX(i+j):i+j).applyMatrix4(object.matrixWorld);t.push(points[j].clone().sub(origin).dot(axis));}
   const low=Math.max(0,Math.ceil(Math.min(...t)/length*(rows-1))),high=Math.min(rows-1,Math.floor(Math.max(...t)/length*(rows-1)));
   for(let row=low;row<=high;row++){
    const level=row/(rows-1)*length,cut:THREE.Vector3[]=[];
    for(let j=0;j<3;j++){const k=(j+1)%3;if(Math.abs(t[k]-t[j])<1e-8)continue;const weight=(level-t[j])/(t[k]-t[j]);if(weight>=0&&weight<=1)cut.push(points[j].clone().lerp(points[k],weight));}
    if(cut.length<2)continue;
    const a=cut[0].clone().sub(origin),b=cut[1].clone().sub(origin),ax=a.dot(u),ay=a.dot(v),dx=b.dot(u)-ax,dy=b.dot(v)-ay;
    for(let col=0;col<angles;col++){
     const angle=col/angles*Math.PI*2,rx=Math.cos(angle),ry=Math.sin(angle),den=rx*dy-ry*dx;if(Math.abs(den)<1e-9)continue;
     const r=(ax*dy-ay*dx)/den,w=(ax*ry-ay*rx)/den;
     if(r<=0||w<0||w>1)continue;
     const point=origin.clone().addScaledVector(axis,level).addScaledVector(u,rx*r).addScaledVector(v,ry*r);
     if(accept(point)){const cell=row*angles+col;radii[cell]=radii[cell]>0?Math.min(radii[cell],r):r;}
    }
   }
  }
 });
 if(!radii.some(r=>r>0))return;
 // Bridge open collars, cuffs and jacket fronts in the invisible volume.
 for(let row=0;row<rows;row++){
  const base=row*angles,original=radii.slice(base,base+angles);
  if(!original.some(r=>r>0))continue;
  for(let col=0;col<angles;col++)if(!original[col]){
   let left=1,right=1;while(left<angles&&!original[(col-left+angles)%angles])left++;while(right<angles&&!original[(col+right)%angles])right++;
   radii[base+col]=(original[(col-left+angles)%angles]*right+original[(col+right)%angles]*left)/(left+right);
  }
 }
 for(let row=0;row<rows;row++)if(!radii[row*angles]){
  let nearest=-1;for(let delta=1;delta<rows;delta++){if(row-delta>=0&&radii[(row-delta)*angles]){nearest=row-delta;break;}if(row+delta<rows&&radii[(row+delta)*angles]){nearest=row+delta;break;}}
  if(nearest>=0)radii.set(radii.slice(nearest*angles,(nearest+1)*angles),row*angles);
 }
 const texture=new THREE.DataTexture(radii,angles,rows,THREE.RedFormat,THREE.FloatType);texture.wrapS=THREE.RepeatWrapping;texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.needsUpdate=true;
 return {origin:origin.clone(),axis,u,v,length,radii,texture};
}
