import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { Document, NodeIO } from '@gltf-transform/core';
import { weld, simplify, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const downloads = process.env.USERPROFILE + '/Downloads/';
const inputs = {
  cargo: ['Baggy+Pro.obj', .99 / (110.44268 - 6.459496), [0,0,0]],
  boots: ['Format2.obj', .01, [0,0,0]],
  sneakers: ['vans.obj', .08, [0,0,0]],
  blazer: ['basicblazerOBJ/basicblazerOBJ.obj', .01, [0,0,0]],
  shirt: ["Men's+Shirt+OBJ/Men's Shirt.obj", .01, [0,0,0]],
};
await MeshoptSimplifier.ready;
await mkdir('public/models', {recursive:true});
for (const key of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(inputs)) {
  const [path, scale] = inputs[key];
  console.log('Converting', key);
  const object = new OBJLoader().parse(await readFile(downloads + path, 'utf8'));
  if (key === 'cargo') {
    // Preserve the complete supplied silhouette: center and scale as one model.
    object.traverse(child => { if(child.isMesh) child.geometry.translate(-.028432, -6.459496 + .10 / scale, -.8872635 + .02 / scale); });
  }
  if (key === 'boots' || key === 'sneakers') {
    const meshes=[]; object.traverse(child=>{if(child.isMesh)meshes.push(child);});
    const groups=key==='boots'?meshes.map(mesh=>[mesh]):[meshes.slice(0,9),meshes.slice(9)];
    groups.forEach((group,index)=>{
      let minY=Infinity,maxY=-Infinity;
      for(const mesh of group) {const p=mesh.geometry.getAttribute('position');for(let i=0;i<p.count;i++){minY=Math.min(minY,p.getY(i));maxY=Math.max(maxY,p.getY(i));}}
      const heel=[0,0],sole=[0,0];let hn=0,sn=0;
      for(const mesh of group) {const p=mesh.geometry.getAttribute('position');for(let i=0;i<p.count;i++){
        if(p.getY(i)>minY+(maxY-minY)*.75){heel[0]+=p.getX(i);heel[1]+=p.getZ(i);hn++;}
        if(p.getY(i)<minY+(maxY-minY)*.15){sole[0]+=p.getX(i);sole[1]+=p.getZ(i);sn++;}
      }}
      heel.forEach((_,i)=>{heel[i]/=hn;sole[i]/=sn;});
      const angle=-Math.atan2(sole[0]-heel[0],sole[1]-heel[1]);
      for(const mesh of group){mesh.geometry.translate(-heel[0],-minY,-heel[1]);mesh.geometry.rotateY(angle);mesh.geometry.translate((index===0?.105:-.105)/scale,.005/scale,0);}
    });
  }
  const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene();
  let texture;
  if (key === 'shirt') {
    // Fill the atlas's black unused padding with fabric white, preventing dark
    // seams when the source UV islands meet or are simplified for the web.
    const {data,info} = await sharp(downloads + "Men's+Shirt+OBJ/Men's Shirt_diffuse_1001.png").removeAlpha().raw().toBuffer({resolveWithObject:true});
    for(let i=0;i<data.length;i+=info.channels) if(data[i]<80 && data[i+1]<80 && data[i+2]<80) {data[i]=245;data[i+1]=247;data[i+2]=245;}
    const image = await sharp(data,{raw:info}).resize(1024,1024,{fit:'inside'}).png().toBuffer();
    texture = doc.createTexture().setImage(image).setMimeType('image/png');
  }
  object.traverse(child => {
    if (!child.isMesh) return;
    const geo = child.geometry;
    const mesh = doc.createMesh(child.name);
    const attrs = {};
    for (const [source,target] of [['position','POSITION'],['normal','NORMAL'],['uv','TEXCOORD_0']]) {
      const attr = geo.getAttribute(source); if (!attr) continue;
      const array = new Float32Array(attr.array);
      if (source === 'position') for (let i=0;i<array.length;i++) array[i]*=scale;
      if (source === 'uv') for (let i=1;i<array.length;i+=2) array[i]=1-array[i];
      attrs[target] = doc.createAccessor().setType(attr.itemSize===2?'VEC2':'VEC3').setArray(array).setBuffer(buffer);
    }
    const groups = geo.groups.length ? geo.groups : [{start:0,count:geo.getAttribute('position').count,materialIndex:0}];
    for (const group of groups) {
      const original = Array.isArray(child.material) ? child.material[group.materialIndex] : child.material;
      const material = doc.createMaterial(original?.name || key).setDoubleSided(true).setRoughnessFactor(key==='boots'?.65:.88);
      if (texture) material.setBaseColorTexture(texture);
      const primitive = doc.createPrimitive().setMaterial(material);
      for (const [name,attr] of Object.entries(attrs)) primitive.setAttribute(name,attr);
      primitive.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from({length:group.count},(_,i)=>group.start+i)).setBuffer(buffer));
      mesh.addPrimitive(primitive);
    }
    scene.addChild(doc.createNode(child.name).setMesh(mesh));
  });
  await doc.transform(weld(), simplify({simplifier:MeshoptSimplifier,ratio:key==='blazer'?.025:key==='cargo'?.85:.5,error:.005}), prune(), dedup());
  await new NodeIO().write(`public/models/${key}.glb`, doc);
  console.log('Written', key);
}
