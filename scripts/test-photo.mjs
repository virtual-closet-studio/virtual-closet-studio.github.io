import assert from 'node:assert/strict';
import { build } from 'esbuild';
await build({entryPoints:['src/photo-processing.ts','src/photo-material.ts','src/backup.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outdir:'.cache/photo-tests',outExtension:{'.js':'.mjs'}});
const {removeBackground,dominantColor,foregroundBounds,preparePhotoTexture}=await import('../.cache/photo-tests/photo-processing.mjs');
const {parseBackup}=await import('../.cache/photo-tests/backup.mjs');
const {applyPhotoDesign,disposePhotoMaterial,PHOTO_PROFILES}=await import('../.cache/photo-tests/photo-material.mjs');
const THREE=await import('three');
const width=12,height=12,pixels=new Uint8ClampedArray(width*height*4).fill(255);
for(let y=2;y<10;y++)for(let x=3;x<9;x++)pixels.set([180,40,60,255],(y*width+x)*4);
pixels.set([255,255,255,255],(5*width+5)*4); // enclosed white print must survive
const masked=removeBackground(pixels,width,height);
assert.equal(masked[3],0);assert.equal(masked[(5*width+5)*4+3],255);assert.equal(pixels[3],255);
assert.deepEqual(foregroundBounds(masked,width,height),{x:3,y:2,width:6,height:8});
assert.equal(dominantColor(masked),'#b4283c');
const striped=pixels.slice();for(let x=3;x<9;x++)striped.set([255,255,255,255],(6*width+x)*4);
assert.equal(removeBackground(striped,width,height)[(6*width+5)*4+3],255,'white stripe touching garment edge stays visible');
assert.equal(foregroundBounds(new Uint8ClampedArray(16),2,2),undefined);
// A pale antialiased silhouette must not become a white seam when filtered.
const edge=new Uint8ClampedArray(24*24*4);
for(let y=0;y<24;y++)for(let x=0;x<24;x++){
 const inside=x>=3&&x<=20&&y>=3&&y<=20;
 const fringe=inside&&(x===3||x===20||y===3||y===20);
 edge.set(fringe?[230,235,240,255]:inside?[40,100,160,255]:[255,255,255,0],(y*24+x)*4);
}
edge.set([255,255,255,255],(12*24+12)*4);
const clean=preparePhotoTexture(edge,24,24);
assert.equal(clean[(12*24+3)*4+3],0,'pale outer rim removed');
assert.deepEqual([...clean.slice((12*24+2)*4,(12*24+2)*4+4)],[40,100,160,0],'transparent RGB extends fabric color');
assert.deepEqual([...clean.slice((12*24+12)*4,(12*24+12)*4+4)],[255,255,255,255],'interior white print preserved');
assert.equal(clean[(12*24+4)*4+3],128,'boundary blends smoothly');
assert.equal(edge[(12*24+3)*4+3],255,'saved source is not modified');
assert.ok(preparePhotoTexture(new Uint8ClampedArray(16),2,2).every(v=>v===0));
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=';
const side={image,source:image,x:.1,y:-.1,scale:1.2,rotation:30};
const garment={id:'photo',name:'写真',template:'tee',category:'top',color:'#b4283c',pattern:'solid',createdAt:1,photoDesign:{front:side,back:{...side,rotation:-30}}};
const state={version:2,garments:[garment],outfits:[],selected:{top:'photo'},body:{width:1,height:1},materialVersion:2,categoryVersion:1};
assert.deepEqual(parseBackup(JSON.stringify(state)).garments[0],garment);
for(const edit of [s=>s.garments[0].photoDesign.front.scale=0,s=>s.garments[0].photoDesign.front.x=Infinity,s=>s.garments[0].photoDesign.back.image='https://evil.test/a',s=>delete s.garments[0].photoDesign.front,s=>s.garments[0].photoDesign.front.rotation=181]){
 const bad=structuredClone(state);edit(bad);assert.throws(()=>parseBackup(JSON.stringify(bad)));
}
const legacy=structuredClone(state);legacy.version=1;delete legacy.garments[0].photoDesign;
assert.equal(parseBackup(JSON.stringify(legacy)).garments[0].photoDesign,undefined);
globalThis.Image=class { set src(value){this.url=value;} };
for(const template of Object.keys(PHOTO_PROFILES)){
 const group=new THREE.Group(),mat=new THREE.MeshStandardMaterial({metalness:1}),mesh=new THREE.Mesh(new THREE.BoxGeometry(1,2,.5),mat);group.add(mesh);
 let maskedCompile=0;mat.onBeforeCompile=shader=>{maskedCompile++;shader.fragmentShader+='\n//existing visibility mask';};mat.customProgramCacheKey=()=> 'visibility';
 applyPhotoDesign(group,{...garment,template});
 assert.equal(mat.metalness,0,'fabric photo retains its colors');
 const shader={uniforms:{},vertexShader:'#include <common>\n#include <project_vertex>',fragmentShader:'#include <common>\n#include <map_fragment>'};mat.onBeforeCompile(shader,{});
 assert.equal(maskedCompile,1);assert.match(shader.fragmentShader,/existing visibility mask/);assert.match(shader.fragmentShader,/1.0-photoUV.x/);
 const oldTexture=shader.uniforms.photoFront.value;let disposed=0;oldTexture.addEventListener('dispose',()=>disposed++);
 applyPhotoDesign(group,{...garment,template,photoDesign:{...garment.photoDesign,front:{...side,x:.5}}});
 assert.equal(shader.uniforms.photoFront.value,oldTexture,'placement keeps uploaded texture');assert.equal(shader.uniforms.photoFrontTransform.value.x,.5);
 disposePhotoMaterial(mat);assert.equal(disposed,1);assert.equal(mat.metalness,1);assert.equal(mat.customProgramCacheKey(),'visibility');mesh.geometry.dispose();mat.dispose();
}
console.log('PASS: edge-connected background, enclosed print, color/crop, v1/v2 round-trip, invalid photo rejection, nine projection profiles, shader mask composition, uniform updates and texture disposal');
