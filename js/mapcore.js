'use strict';
// Map data helpers, chunked merge buckets, collision grid, landmark helpers. Owner: integrator.
function ctex(w,h,draw,rep=true){const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');draw(g,w,h);const t=new THREE.CanvasTexture(c);if(rep)t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return t;}
const glassGrad=(g,y0,y1,a='#6f88a0',b='#24303c')=>{const gr=g.createLinearGradient(0,y0,0,y1);gr.addColorStop(0,a);gr.addColorStop(1,b);return gr;};
const blobTex=ctex(64,64,g=>{const gr=g.createRadialGradient(32,32,6,32,32,32);gr.addColorStop(0,'rgba(0,0,0,.55)');gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(0,0,64,64);},false);
const blobMat=new THREE.MeshBasicMaterial({map:blobTex,transparent:true,depthWrite:false});
let D=null,BX0=0,BX1=0,BZ0=0,BZ1=0;
function initMap(data){D=data;[BX0,BX1,BZ0,BZ1]=D.bounds;}
const SC=0.1;const dec=a=>{const o=[];for(let i=0;i<a.length;i+=2)o.push([a[i]*SC,a[i+1]*SC]);return o;};
const CH=520;const chunk=(x,z)=>Math.floor((x-BX0)/CH)+'_'+Math.floor((z-BZ0)/CH);
const buckets=new Map();
function bk(name,x,z,mat,uv){const k=name+'|'+chunk(x,z);let b=buckets.get(k);if(!b){b=new Bk(mat,uv);buckets.set(k,b);}return b;}
function ftri(b,y,x0,z0,x1,z1,x2,z2,col){_c.set(col);const cr=(z1-z0)*(x2-x0)-(x1-x0)*(z2-z0);
  if(cr<0){const tx=x1,tz=z1;x1=x2;z1=z2;x2=tx;z2=tz;}
  b.v(x0,y,z0,0,1,0,_c.r,_c.g,_c.b,x0/4,z0/4);b.v(x1,y,z1,0,1,0,_c.r,_c.g,_c.b,x1/4,z1/4);b.v(x2,y,z2,0,1,0,_c.r,_c.g,_c.b,x2/4,z2/4);}
function polyFill(b,y,outer,holes,col){
  const c=outer.map(p=>new THREE.Vector2(p[0],p[1])),h=(holes||[]).map(r=>r.map(p=>new THREE.Vector2(p[0],p[1])));
  let tris;try{tris=THREE.ShapeUtils.triangulateShape(c,h);}catch(e){return;}
  const all=c.concat(...h);for(const t of tris){const a=all[t[0]],bb=all[t[1]],cc=all[t[2]];if(!a||!bb||!cc)continue;ftri(b,y,a.x,a.y,bb.x,bb.y,cc.x,cc.y,col);}
}
const sArea=r=>{let s=0;for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length];s+=a[0]*b[1]-b[0]*a[1];}return s/2;};
function pip(x,z,ring){let ins=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if(((a[1]>z)!==(b[1]>z))&&(x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]))ins=!ins;}return ins;}

// ---- collision grid ----
const GC=16;const ggrid=new Map();
const gk=(i,j)=>i*100000+j;
const polys=[];
function addPoly(rings,h,tile){let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;for(const p of rings[0]){x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);z0=Math.min(z0,p[1]);z1=Math.max(z1,p[1]);}
  const P={rings,h,x0,x1,z0,z1,st:0};polys.push(P);if(tile)tile.polys.push(P);
  for(let i=Math.floor(x0/GC);i<=Math.floor(x1/GC);i++)for(let j=Math.floor(z0/GC);j<=Math.floor(z1/GC);j++){const k=gk(i,j);let c=ggrid.get(k);if(!c){c=[];ggrid.set(k,c);}c.push(P);}
  return P;}
// remove collision polys (e.g. when a tile unloads)
function removePolys(list){const set=new Set(list);for(const P of list){for(let i=Math.floor(P.x0/GC);i<=Math.floor(P.x1/GC);i++)for(let j=Math.floor(P.z0/GC);j<=Math.floor(P.z1/GC);j++){const k=gk(i,j),c=ggrid.get(k);if(!c)continue;const f=c.filter(q=>!set.has(q));if(f.length)ggrid.set(k,f);else ggrid.delete(k);}}
  for(let i=polys.length-1;i>=0;i--)if(set.has(polys[i]))polys.splice(i,1);}
let stamp=1;
function polysNear(x,z,r,cb){stamp++;for(let i=Math.floor((x-r)/GC);i<=Math.floor((x+r)/GC);i++)for(let j=Math.floor((z-r)/GC);j<=Math.floor((z+r)/GC);j++){const c=ggrid.get(gk(i,j));if(!c)continue;
  for(const P of c){if(P.st===stamp)continue;P.st=stamp;if(x+r<P.x0||x-r>P.x1||z+r<P.z0||z-r>P.z1)continue;if(cb(P))return true;}}return false;}
function insidePoly(P,x,z){let ins=false;for(const r of P.rings)if(pip(x,z,r))ins=!ins;return ins;}
function closestOnPoly(P,x,z){let bd=1e9,bx=0,bz=0;for(const r of P.rings)for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[j],b=r[i];const dx=b[0]-a[0],dz=b[1]-a[1],l2=dx*dx+dz*dz||1e-9;
  let t=((x-a[0])*dx+(z-a[1])*dz)/l2;t=t<0?0:t>1?1:t;const qx=a[0]+dx*t,qz=a[1]+dz*t,d=(x-qx)*(x-qx)+(z-qz)*(z-qz);if(d<bd){bd=d;bx=qx;bz=qz;}}return [bx,bz,Math.sqrt(bd)];}
function pushOut(x,z,r){let px=0,pz=0,hit=false;
  polysNear(x,z,r,P=>{const [qx,qz,d]=closestOnPoly(P,x,z);const inside=insidePoly(P,x,z);
    if(inside){const dx=qx-x,dz=qz-z,l=d||1e-6;px+=dx/l*(d+r);pz+=dz/l*(d+r);hit=true;}
    else if(d<r){const l=d||1e-6;px+=(x-qx)/l*(r-d);pz+=(z-qz)/l*(r-d);hit=true;}});
  return hit?{x:px,z:pz}:null;}
function solidAt(x,z,y=0){return polysNear(x,z,0,P=>P.h>y&&insidePoly(P,x,z));} // y = height above the building base
// absolute-height version: building top = P.y0 (base, set by BUILDINGS; 0 if unset) + P.h
function solidAtAbs(x,z,y){return polysNear(x,z,0,P=>(P.y0||0)+P.h>y&&insidePoly(P,x,z));}
// landmark/static helpers
const SB=new Bk(VC,false);
function lm(name,build){const s=D.special[name];if(!s)return;const [x,z,ang,size]=s;build(x,z,ang,size);}
const addRect=(x,z,w,d,ang,h)=>{const c=Math.cos(ang),s=Math.sin(ang);const pts=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([a,b])=>[x+a*c+b*s,z-a*s+b*c]);if(sArea(pts)<0)pts.reverse();addPoly([pts],h);};
function part(geo,x,z,ang,lx,ly,lz,col,ry=0,rx=0){const c=Math.cos(ang),s=Math.sin(ang);SB.add(geo,M(x+lx*c+lz*s,ly,z-lx*s+lz*c,ang+ry,rx),col);}

// Landmark modules may push {x,z,r} here (top-level, at load) to remove OSM buildings whose first vertex/centroid falls inside, before buildBuildings() runs.
const LANDMARK_SKIP=[];
function landmarkSkipped(x,z){for(const s of LANDMARK_SKIP)if(Math.hypot(x-s.x,z-s.z)<s.r)return true;return false;}

// ---------------- terrain height (Copernicus DEM, ground-filtered; see world.json.height) ----------------
// groundY(x,z): terrain height in metres relative to the Arc de Triumf ground (Arc = 0). 0 everywhere if no heightmap.
let HM=null;
async function initHeight(){const m=D&&D.height;if(!m)return;try{const r=await fetch((typeof WORLD!=='undefined'&&WORLD.base?WORLD.base:'world/')+m.file.replace(/^world\//,''));if(!r.ok)throw new Error(r.status);
  let buf;if(/\.json$/.test(m.file)){const j=await r.json();const bs=atob(j.b64);const u=new Uint8Array(bs.length);for(let i=0;i<bs.length;i++)u[i]=bs.charCodeAt(i);buf=u.buffer;}else buf=await r.arrayBuffer();HM={a:new Int16Array(buf),x0:m.x0,z0:m.z0,c:m.cell,nx:m.nx,nz:m.nz,s:m.scale};}catch(e){console.error('heightmap',e);HM=null;}}
function groundY(x,z){if(!HM)return 0;let fx=(x-HM.x0)/HM.c,fz=(z-HM.z0)/HM.c;fx=fx<0?0:fx>HM.nx-1.001?HM.nx-1.001:fx;fz=fz<0?0:fz>HM.nz-1.001?HM.nz-1.001:fz;
  const i=fx|0,j=fz|0,u=fx-i,v=fz-j,a=HM.a,n=HM.nx,k=j*n+i;return ((a[k]*(1-u)+a[k+1]*u)*(1-v)+(a[k+n]*(1-u)+a[k+n+1]*u)*v)*HM.s;}
// unit surface normal [nx,ny,nz] (finite differences over ~4 m)
function groundNormal(x,z){const e=4,dx=groundY(x+e,z)-groundY(x-e,z),dz=groundY(x,z+e)-groundY(x,z-e);const nx=-dx/(2*e),nz=-dz/(2*e),l=Math.hypot(nx,1,nz);return [nx/l,1/l,nz/l];}
// min/max ground height under a ring of [x,z] points (plus centroid)
function groundRange(ring){let lo=1e9,hi=-1e9,cx=0,cz=0;for(const p of ring){const y=groundY(p[0],p[1]);if(y<lo)lo=y;if(y>hi)hi=y;cx+=p[0];cz+=p[1];}const yc=groundY(cx/ring.length,cz/ring.length);return [Math.min(lo,yc),Math.max(hi,yc)];}
