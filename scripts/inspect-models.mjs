import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
const paths = [process.env.USERPROFILE + '/Downloads/Format2.obj', process.env.USERPROFILE + '/Downloads/vans.obj', process.env.USERPROFILE + '/Downloads/basicblazerOBJ/basicblazerOBJ.obj', process.env.USERPROFILE + "/Downloads/Men's+Shirt+OBJ/Men's Shirt.obj", 'public/models/body.obj', 'public/models/tshirt.obj'];
for (const path of paths) {
  const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity]; let vertices = 0, faces = 0;
  for await (const line of createInterface({input:createReadStream(path), crlfDelay:Infinity})) {
    if (line.startsWith('v ')) { const v=line.trim().split(/\s+/).slice(1).map(Number); v.forEach((x,i)=>{min[i]=Math.min(min[i],x);max[i]=Math.max(max[i],x);}); vertices++; }
    if (line.startsWith('f ')) faces++;
  }
  console.log(JSON.stringify({path,min,max,vertices,faces}));
}
