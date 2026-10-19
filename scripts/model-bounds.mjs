import { NodeIO } from '@gltf-transform/core';
for(const key of ['boots','sneakers','blazer','shirt']) {
 const doc=await new NodeIO().read(`public/models/${key}.glb`);
 for(const node of doc.getRoot().listNodes()) {
  const mesh=node.getMesh(); if(!mesh)continue;
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const p of mesh.listPrimitives()) {const a=p.getAttribute('POSITION').getArray();for(let i=0;i<a.length;i++) {min[i%3]=Math.min(min[i%3],a[i]);max[i%3]=Math.max(max[i%3],a[i]);}}
  console.log(key,node.getName(),JSON.stringify({min,max}));
 }
}
