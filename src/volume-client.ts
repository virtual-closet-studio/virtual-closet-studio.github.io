import * as THREE from 'three';
import type { Volume } from './visibility';
import type { Filter } from './volume-filter';
export class VolumeWorker {
 private worker!:Worker;
 private failed=false;
 private sequence=0;
 private pending=new Map<number,{resolve:(v:Volume|undefined)=>void;reject:(e:Error)=>void}>();
 constructor(){this.start();}
 private start(){
  this.failed=false;
  this.worker=new Worker(new URL('./volume-worker.ts',import.meta.url),{type:'module'});
  this.worker.onmessage=({data})=>{const task=this.pending.get(data.id);if(!task)return;this.pending.delete(data.id);
   if(data.error){task.reject(new Error(data.error));return;}
   const v=data.volume;if(!v){task.resolve(undefined);return;}
   const texture=new THREE.DataTexture(v.radii,128,128,THREE.RedFormat,THREE.FloatType);texture.wrapS=THREE.RepeatWrapping;texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.needsUpdate=true;
   task.resolve({...v,origin:new THREE.Vector3(...v.origin),axis:new THREE.Vector3(...v.axis),u:new THREE.Vector3(...v.u),v:new THREE.Vector3(...v.v),texture});
  };
  this.worker.onerror=()=>{this.failed=true;this.worker.terminate();for(const task of this.pending.values())task.reject(new Error('重ね着の計算に失敗しました'));this.pending.clear();};
 }
 build(root:THREE.Object3D,origin:THREE.Vector3,end:THREE.Vector3,filter:Filter):Promise<Volume|undefined>{
  if(this.failed)this.start();
  root.updateMatrixWorld(true);let size=0;root.traverse(o=>{if(o instanceof THREE.Mesh)size+=(o.geometry.index?.count??o.geometry.getAttribute('position').count)*3;});
  const positions=new Float64Array(size),point=new THREE.Vector3();let offset=0;
  root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;const g=o.geometry,pos=g.getAttribute('position'),index=g.index,count=index?.count??pos.count;
   for(let i=0;i<count;i++){point.fromBufferAttribute(pos,index?index.getX(i):i).applyMatrix4(o.matrixWorld);positions[offset++]=point.x;positions[offset++]=point.y;positions[offset++]=point.z;}
  });
  const id=++this.sequence;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.worker.postMessage({id,positions,origin:origin.toArray(),end:end.toArray(),filter},[positions.buffer]);});
 }
 dispose(){this.worker.terminate();for(const task of this.pending.values())task.reject(new Error('Disposed'));this.pending.clear();}
}
