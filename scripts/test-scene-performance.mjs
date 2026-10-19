import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import * as THREE from 'three';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
await build({entryPoints:['src/scene.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.cache/scene-performance.mjs'});
await build({entryPoints:['src/visibility.ts','src/volume-filter.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outdir:'.cache/performance',outExtension:{'.js':'.mjs'}});
const {ClosetScene}=await import('../.cache/scene-performance.mjs');
const {fittingVolume}=await import('../.cache/performance/visibility.mjs');
const {accepts}=await import('../.cache/performance/volume-filter.mjs');
const models={body:new OBJLoader().parse(await readFile('public/models/body.obj','utf8')),tee:new OBJLoader().parse(await readFile('public/models/tshirt.obj','utf8'))};
for(const key of ['jacket','pants','boots','sneakers','blazer','shirt','cargo']){
 const file=key==='jacket'?'hoodie':key==='pants'?'sweatpants':key;
 const doc=await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(`public/models/${file}.glb`),root=new THREE.Group();
 for(const node of doc.getRoot().listNodes())for(const primitive of node.getMesh()?.listPrimitives()??[]){
  const g=new THREE.BufferGeometry(),pos=primitive.getAttribute('POSITION');g.setAttribute('position',new THREE.BufferAttribute(pos.getArray(),3,pos.getNormalized()));
  if(primitive.getIndices())g.setIndex(new THREE.BufferAttribute(primitive.getIndices().getArray(),1));
  const mesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial());mesh.applyMatrix4(new THREE.Matrix4().fromArray(node.getWorldMatrix()));root.add(mesh);
 }models[key]=root;
}
let builds=0,disposals=0;
const scene=Object.create(ClosetScene.prototype);
Object.assign(scene,{models,modelRequests:new Map(Object.entries(models).map(([k,v])=>[k,Promise.resolve(v)])),revision:0,building:false,disposed:false,prepared:new Map(),fitted:new Map(),appearance:'',currentKey:'',volumeBuilds:0,modelLoads:0,volumeCache:new Map(),generatedTextures:[],body:{width:1,height:1},fit:{width:1.08,height:1,outerWidth:1.18,depth:.05},selected:[],scene:new THREE.Scene(),mannequin:new THREE.Group(),clothing:new THREE.Group(),host:{dataset:{},append(){}},loadingLabel:{remove(){},replaceChildren(){throw new Error('Unexpected rendering failure');}},prefetchStarted:true});
scene.setView=()=>{};
scene.volumeWorker={async build(root,origin,end,filter){builds++;await new Promise(r=>setTimeout(r,0));const volume=fittingVolume(root,origin,end,p=>accepts(filter,p));if(volume)volume.texture.addEventListener('dispose',()=>disposals++);return volume;}};
const garment=(template,category,color='#777777')=>({id:template,template,category,color,pattern:'solid',name:template});
const tee=garment('tee','top'),shirt=garment('shirt','top'),hoodie=garment('jacket','top'),outer=garment('blazer','outer'),pants=garment('pants','bottom'),cargo=garment('cargo','bottom'),boots=garment('boots','shoes'),sneakers=garment('sneakers','shoes');
async function settled(){while(scene.building)await new Promise(r=>setTimeout(r,2));}
async function wear(items,body={width:1,height:1}){scene.setLook(body,items,{width:body.width*1.08,height:body.height,outerWidth:body.width*1.18,depth:.05});await settled();assert.equal(scene.host.dataset.readyLook,items.map(g=>g.id).join(','));}
await wear([pants,tee,outer,boots]);const firstBuilds=builds,firstBody=scene.mannequin,firstClothes=scene.clothing;
await wear([pants,{...tee,color:'#aa2233'},outer,boots]);assert.equal(builds,firstBuilds,'appearance changes do not rebuild volumes');assert.equal(scene.mannequin,firstBody);assert.equal(scene.clothing,firstClothes);
await wear([pants,shirt,outer,boots]);const secondBuilds=builds;assert.equal(secondBuilds-firstBuilds,3,'only inner torso/sleeves need new volumes');
await wear([pants,tee,outer,boots]);assert.equal(builds,secondBuilds,'revisiting a prepared look performs no geometry/volume work');assert.equal(scene.clothing,firstClothes);
// Start a cold look then supersede it before its worker returns.
scene.setLook({width:1,height:1},[cargo,hoodie,outer,sneakers]);await Promise.resolve();scene.setLook({width:1,height:1},[pants,shirt,outer,boots]);await settled();assert.equal(scene.host.dataset.readyLook,'pants,shirt,blazer,boots','stale work cannot replace final selection');
for(const body of [{width:.75,height:.8},{width:1,height:1},{width:1.35,height:1.25}]){
 for(const inner of [tee,shirt,hoodie])for(const layered of [false,true])await wear([pants,inner,...layered?[outer]:[],boots],body);
 for(const bottom of [pants,cargo])for(const shoe of [boots,sneakers])await wear([bottom,shirt,outer,shoe],body);
 assert.ok(scene.prepared.size<=6);assert.ok(scene.fitted.size<=12);assert.ok(scene.volumeCache.size<=24);
}
for(let i=0;i<10;i++)await wear([cargo,shirt,outer,sneakers],{width:.8+i*.03,height:1});
assert.ok(disposals>0,'evicted unreferenced volume textures are released');
for(const look of scene.prepared.values())for(const volume of look.volumes)assert.ok([...scene.volumeCache.values()].some(v=>v.includes(volume)),'live cached looks retain their GPU textures');
console.log(`PASS: material-only reuse, per-model fitting cache, dependency-aware volumes, stale request suppression, all tops/layers/legs/shoes at body extremes, bounded caches and ${disposals} texture disposals`);
