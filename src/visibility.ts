import * as THREE from 'three';
const f=(v:number)=>v.toFixed(7);
const vec=(v:THREE.Vector3)=>`vec3(${f(v.x)},${f(v.y)},${f(v.z)})`;
export type Volume={origin:THREE.Vector3;axis:THREE.Vector3;u:THREE.Vector3;v:THREE.Vector3;length:number;radii:Float32Array;texture:THREE.DataTexture};
const angles=128, rows=128;
const cosines=Float64Array.from({length:angles},(_,i)=>Math.cos(i/angles*Math.PI*2));
const sines=Float64Array.from({length:angles},(_,i)=>Math.sin(i/angles*Math.PI*2));

// Cross-sections close only the fitting envelope, never the visible garment.
// Each radial intersection is taken from fitted triangles, independent of camera.
export function fittingVolume(root:THREE.Object3D,origin:THREE.Vector3,end:THREE.Vector3,accept:(p:THREE.Vector3)=>boolean=()=>true):Volume|undefined {
 const axis=end.clone().sub(origin),length=axis.length();if(length<1e-5)return;
 axis.normalize();const u=new THREE.Vector3(1,0,0).addScaledVector(axis,-axis.x).normalize();
 if(u.lengthSq()<.1)u.set(0,0,1).addScaledVector(axis,-axis.z).normalize();
 const v=new THREE.Vector3().crossVectors(axis,u).normalize(),radii=new Float32Array(angles*rows),points=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];
 root.updateMatrixWorld(true);
 const heights=new Float64Array(3),xs=new Float64Array(3),ys=new Float64Array(3),cuts=new Float64Array(4),candidate=new THREE.Vector3();
 root.traverse(object=>{
  if(!(object instanceof THREE.Mesh))return;
  const geo=object.geometry,pos=geo.getAttribute('position'),index=geo.index,count=index?.count??pos.count;
  for(let i=0;i<count;i+=3){
   for(let j=0;j<3;j++){
    const p=points[j].fromBufferAttribute(pos,index?index.getX(i+j):i+j).applyMatrix4(object.matrixWorld).sub(origin);
    heights[j]=p.dot(axis);xs[j]=p.dot(u);ys[j]=p.dot(v);
   }
   const low=Math.max(0,Math.ceil(Math.min(heights[0],heights[1],heights[2])/length*(rows-1))),high=Math.min(rows-1,Math.floor(Math.max(heights[0],heights[1],heights[2])/length*(rows-1)));
   for(let row=low;row<=high;row++){
    const level=row/(rows-1)*length;let n=0;
    for(let j=0;j<3&&n<2;j++){
     const k=(j+1)%3,delta=heights[k]-heights[j];if(Math.abs(delta)<1e-8)continue;
     const weight=(level-heights[j])/delta;
     if(weight>=0&&weight<=1){cuts[n*2]=xs[j]+(xs[k]-xs[j])*weight;cuts[n*2+1]=ys[j]+(ys[k]-ys[j])*weight;n++;}
    }
    if(n<2)continue;
    const ax=cuts[0],ay=cuts[1],dx=cuts[2]-ax,dy=cuts[3]-ay;
    const start=Math.atan2(ay,ax),finish=Math.atan2(cuts[3],cuts[2]);
    let span=finish-start;if(span>Math.PI)span-=Math.PI*2;if(span<-Math.PI)span+=Math.PI*2;
    const first=Math.ceil((Math.min(start,start+span)-1e-12)*angles/(Math.PI*2)),last=Math.floor((Math.max(start,start+span)+1e-12)*angles/(Math.PI*2));
    for(let sample=first;sample<=last;sample++){
     const col=(sample%angles+angles)%angles,rx=cosines[col],ry=sines[col],den=rx*dy-ry*dx;if(Math.abs(den)<1e-9)continue;
     const r=(ax*dy-ay*dx)/den,w=(ax*ry-ay*rx)/den;
     if(r<=0||w<0||w>1)continue;
     candidate.copy(origin).addScaledVector(axis,level).addScaledVector(u,rx*r).addScaledVector(v,ry*r);
     if(accept(candidate)){const cell=row*angles+col;radii[cell]=radii[cell]>0?Math.min(radii[cell],r):r;}
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
export function volumeContains(volume:Volume,p:THREE.Vector3,tolerance=0):boolean{
 const d=p.clone().sub(volume.origin),t=d.dot(volume.axis);if(t<0||t>volume.length)return false;
 let angle=Math.atan2(d.dot(volume.v),d.dot(volume.u))/(2*Math.PI);if(angle<0)angle+=1;
 const y=t/volume.length*(rows-1),x=angle*angles,row=Math.floor(y),col=Math.floor(x)%angles,dy=y-row,dx=x-Math.floor(x);
 const sample=(r:number,c:number)=>volume.radii[Math.min(rows-1,r)*angles+c%angles];
 const r0=sample(row,col)*(1-dx)+sample(row,col+1)*dx,r1=sample(row+1,col)*(1-dx)+sample(row+1,col+1)*dx;
 return Math.hypot(d.dot(volume.u),d.dot(volume.v))<=r0*(1-dy)+r1*dy+tolerance;
}
export function volumeShader(volumes:Volume[],prefix:string,tolerance:number){
 const uniforms:Record<string,{value:unknown}>={},functions:string[]=[];
 volumes.forEach((volume,i)=>{
  const name=`${prefix}${i}`;uniforms[name]={value:volume.texture};
  functions.push(`uniform sampler2D ${name};\nbool ${name}Contains(vec3 p){vec3 d=p-${vec(volume.origin)};float t=dot(d,${vec(volume.axis)});float a=atan(dot(d,${vec(volume.v)}),dot(d,${vec(volume.u)}))/6.28318530718;vec2 grid=vec2(fract(a)*128.0,clamp(t/${f(volume.length)},0.0,1.0)*127.0);vec2 cell=floor(grid),blend=fract(grid);vec2 uv=(cell+0.5)/128.0;float r0=mix(texture2D(${name},uv).r,texture2D(${name},uv+vec2(0.0078125,0.0)).r,blend.x);float r1=mix(texture2D(${name},uv+vec2(0.0,0.0078125)).r,texture2D(${name},uv+vec2(0.0078125)).r,blend.x);float radius=mix(r0,r1,blend.y);return t>=0.0&&t<=${f(volume.length)}&&length(vec2(dot(d,${vec(volume.u)}),dot(d,${vec(volume.v)})))<=radius+${f(tolerance)};}`);
 });
 return {uniforms,declarations:functions.join('\n'),inside:(p:string)=>volumes.map((_,i)=>`${prefix}${i}Contains(${p})`).join(' || ')||'false'};
}
export const BODY_PROTECTION_GLSL='((maskSource.y>=1.55 && abs(maskSource.x)<.17) || (abs(maskSource.x)>=.76 && maskSource.y>1.30))';
export function protectedBody(source:THREE.Vector3):boolean{return source.y>=1.55&&Math.abs(source.x)<.17||Math.abs(source.x)>=.76&&source.y>1.30;}
export function applyVisibilityMask(root:THREE.Object3D,condition:string,uniforms:Record<string,{value:unknown}>={},declarations='',bodySource=false):void{
 root.traverse(object=>{
  if(!(object instanceof THREE.Mesh))return;
  for(const material of Array.isArray(object.material)?object.material:[object.material]){
   const mat=material as THREE.MeshStandardMaterial;
   mat.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\nvarying vec3 maskWorld;${bodySource?'\nattribute vec3 bodySourcePosition;varying vec3 maskSource;':''}`).replace('#include <project_vertex>',`maskWorld=(modelMatrix*vec4(transformed,1.0)).xyz;${bodySource?'maskSource=bodySourcePosition;':''}\n#include <project_vertex>`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 maskWorld;${bodySource?'varying vec3 maskSource;':''}\n${declarations}`).replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>\nif(${condition})discard;`);
   };mat.customProgramCacheKey=()=>condition+declarations;mat.needsUpdate=true;
  }
 });
}
