'use strict';
// Trees, bushes, hedges, flower beds, grass. Owner: VEGETATION agent.
// Trees: 4 archetypes (linden, chestnut, poplar, birch/acacia). Near the camera: full 3D trees (bark trunk + branches +
// alpha-tested leaf cards + inner foliage blobs, wind sway). Everywhere else: 3-quad impostors from one InstancedMesh.
// LOD selection runs from the impostor mesh's onBeforeRender (no game.js hook needed).

const veg_U={uTime:{value:0}};
const veg_Q=GTC_Q==='ultra'?{nearR:230,nearCap:1500,bushR:150,bushCap:3200,grassR:70,grassCap:9000,maxTrees:21000,tileMaxTrees:5000,dens:80,flowerR:90,flowerCap:3000}:GTC_Q==='med'?{nearR:110,nearCap:350,bushR:90,bushCap:1500,grassR:40,grassCap:3000,maxTrees:16000,tileMaxTrees:3000,dens:110,flowerR:60,flowerCap:1200}:{nearR:160,nearCap:700,bushR:120,bushCap:2400,grassR:55,grassCap:6000,maxTrees:21000,tileMaxTrees:4500,dens:80,flowerR:90,flowerCap:3000};

// ---------- textures ----------
function veg_leafAtlas(){
  const c=document.createElement('canvas');c.width=c.height=1024;const g=c.getContext('2d');g.scale(2,2);
  const leafCols=[[[74,118,46],[92,138,52],[60,100,38],[108,150,60]],   // linden
                  [[58,102,40],[76,124,48],[48,88,34],[96,140,58]],     // chestnut
                  [[86,124,52],[104,142,62],[70,108,44],[122,156,70]],  // poplar
                  [[100,140,58],[124,160,70],[84,124,50],[140,172,84]]];// birch / acacia
  const rgb=(a,k=1)=>`rgb(${a[0]*k|0},${a[1]*k|0},${a[2]*k|0})`;
  function leaf(x,y,len,wid,rot,col,shape){g.save();g.translate(x,y);g.rotate(rot);g.fillStyle=col;g.beginPath();
    if(shape==='heart'){g.moveTo(0,-len*.5);g.bezierCurveTo(wid,-len*.45,wid*.9,len*.3,0,len*.5);g.bezierCurveTo(-wid*.9,len*.3,-wid,-len*.45,0,-len*.5);}
    else g.ellipse(0,0,wid*.5,len*.5,0,0,Math.PI*2);
    g.fill();g.strokeStyle='rgba(20,40,10,.35)';g.lineWidth=.6;g.beginPath();g.moveTo(0,-len*.45);g.lineTo(0,len*.45);g.stroke();g.restore();}
  for(let a=0;a<4;a++){const ox=a*128,oy=0,cx=ox+64,cy=oy+64;const cols=leafCols[a];
    g.save();g.beginPath();g.rect(ox,oy,128,128);g.clip();
    const n=a===1?26:a===2?150:a===3?170:120;
    for(let i=0;i<n;i++){const r=Math.sqrt(Math.random())*56,t=Math.random()*Math.PI*2;const x=cx+Math.cos(t)*r,y=cy+Math.sin(t)*r*.92;
      const shade=.78+Math.random()*.42-(y-cy)/220;const col=rgb(cols[Math.random()*4|0],shade);
      if(a===1){ // chestnut: palmate leaf clusters
        for(let k=0;k<6;k++){const rot=k/6*Math.PI*2+Math.random()*.3;const L=18+Math.random()*8;leaf(x+Math.sin(rot)*L*.45,y-Math.cos(rot)*L*.45,L,L*.36,rot,col,'ell');}}
      else if(a===0)leaf(x,y,13+Math.random()*5,11+Math.random()*4,Math.random()*6.3,col,'heart');
      else if(a===2)leaf(x,y,9+Math.random()*3,8+Math.random()*3,Math.random()*6.3,col,'ell');
      else leaf(x,y,8+Math.random()*3,4.5+Math.random()*2,Math.random()*6.3,col,'ell');}
    g.restore();}
  // row 1: grass blades (0), flowers (128), solid foliage (256), bush leaves (384)
  g.save();g.beginPath();g.rect(0,128,128,128);g.clip();
  for(let i=0;i<70;i++){const x=6+Math.random()*116,h=50+Math.random()*70,b=Math.random()*14-7;const s=.75+Math.random()*.5;
    g.strokeStyle=`rgb(${70*s|0},${120*s|0},${40*s|0})`;g.lineWidth=2+Math.random()*2;g.beginPath();g.moveTo(x,256);g.quadraticCurveTo(x+b*.4,256-h*.6,x+b,256-h);g.stroke();}
  g.restore();
  g.fillStyle='rgb(70,104,44)';g.fillRect(128,128,128,128);
  const FL=['#e8304a','#f7d23a','#ffffff','#b04ad8','#ff8a2a','#f06aa8'];
  for(let i=0;i<600;i++){const x=128+Math.random()*128,y=128+Math.random()*128;g.fillStyle=Math.random()<.35?'rgb(50,90,34)':FL[i%FL.length];g.beginPath();g.arc(x,y,1.5+Math.random()*2.2,0,7);g.fill();}
  g.fillStyle='rgb(66,104,42)';g.fillRect(256,128,128,128);for(let i=0;i<900;i++){const s=.8+Math.random()*.4;g.fillStyle=`rgb(${60*s|0},${98*s|0},${38*s|0})`;g.fillRect(256+Math.random()*128,128+Math.random()*128,3,3);}
  g.save();g.beginPath();g.rect(384,128,128,128);g.clip();
  for(let i=0;i<160;i++){const r=Math.sqrt(Math.random())*58,t=Math.random()*6.3;leaf(448+Math.cos(t)*r,192+Math.sin(t)*r,9+Math.random()*4,6+Math.random()*3,Math.random()*6.3,rgb(leafCols[1][Math.random()*4|0],.8+Math.random()*.35),'ell');}
  g.restore();
  // rows 2-3: bark brown (0..256), birch (256..512)
  g.fillStyle='#5a4532';g.fillRect(0,256,256,256);
  for(let i=0;i<260;i++){const x=Math.random()*256;g.fillStyle=Math.random()<.5?'rgba(30,20,12,.45)':'rgba(120,100,80,.3)';g.fillRect(x,256,1+Math.random()*3,256);}
  for(let i=0;i<120;i++){g.fillStyle='rgba(25,18,10,.5)';g.fillRect(Math.random()*256,256+Math.random()*256,4+Math.random()*10,2);}
  g.fillStyle='#e9e6dc';g.fillRect(256,256,256,256);
  for(let i=0;i<520;i++){g.fillStyle='rgba(30,30,30,'+(.45+Math.random()*.45)+')';g.fillRect(256+Math.random()*256,256+Math.random()*256,3+Math.random()*12,.6+Math.random()*1.4);}for(let i=0;i<300;i++){g.fillStyle='rgba(150,140,120,.25)';g.fillRect(256+Math.random()*256,256+Math.random()*256,2,8+Math.random()*20);}
  const t=new THREE.CanvasTexture(c);t.anisotropy=8;return t;
}
// impostor atlas: side views (4 × 128x256) then top views (4 × 128x128 in the upper half)
function veg_impostorAtlas(){
  const c=document.createElement('canvas');c.width=2048;c.height=512;const g=c.getContext('2d');g.scale(2,2);
  const base=[[78,120,48],[64,108,42],[92,130,56],[108,146,62]];
  for(let a=0;a<4;a++){const A=veg_ARCH[a],H=A.cy+A.ry,ox=a*128;
    const X=x=>ox+64+x/(A.rx*1.12)*64,Y=y=>256-y/H*256;
    g.fillStyle=a===3?'#d9d4c8':'#4d3b2a';g.fillRect(X(-A.tr*1.3),Y(A.cy),X(A.tr*1.3)-X(-A.tr*1.3),Y(0)-Y(A.cy));
    const n=a===2?260:320;
    for(let i=0;i<n;i++){const u=Math.random()*2-1,v=Math.random()*2-1;if(u*u+v*v>1)continue;const lit=(-u*.4+v*.7+1)/2;
      const x=u*A.rx,y=A.cy+v*A.ry;const k=.55+lit*.6+(Math.random()-.5)*.15;const b=base[a];
      g.fillStyle=`rgb(${b[0]*k|0},${b[1]*k|0},${b[2]*k|0})`;g.beginPath();g.arc(X(x),Y(y),(a===2?3:4)+Math.random()*4,0,7);g.fill();}
    // top view
    const tx=512+a*128;
    for(let i=0;i<300;i++){const u=Math.random()*2-1,v=Math.random()*2-1;if(u*u+v*v>.95)continue;const lit=(-u*.5-v*.5+1.4)/2.4;const k=.6+lit*.55+(Math.random()-.5)*.15;const b=base[a];
      g.fillStyle=`rgb(${b[0]*k|0},${b[1]*k|0},${b[2]*k|0})`;g.beginPath();g.arc(tx+64+u*58,64+v*58,4+Math.random()*5,0,7);g.fill();}}
  const t=new THREE.CanvasTexture(c);t.anisotropy=8;return t;
}

// ---------- archetypes ----------
// rx/ry crown radii, cy crown centre height, tr trunk radius, cards, card size, blobs, bark region
const veg_ARCH=[
  {name:'linden',  rx:4.0,ry:3.7,cy:7.4, tr:.26,cards:105,cs:2.5,cell:0,birch:false,subs:[[0,0,0,1]],w:.36},
  {name:'chestnut',rx:4.6,ry:4.0,cy:7.2, tr:.32,cards:115,cs:2.8,cell:1,birch:false,subs:[[0,0,0,1]],w:.32},
  {name:'poplar',  rx:2.0,ry:7.6,cy:11.6,tr:.30,cards:150,cs:2.1,cell:2,birch:false,subs:[[0,0,0,1]],w:.08},
  {name:'birch',   rx:3.3,ry:3.8,cy:7.6, tr:.20,cards:90,cs:2.1,cell:3,birch:true, subs:[[-1.2,-.4,.6,.62],[1.3,.3,-.5,.6],[0,1.6,.2,.55]],w:.24},
];
// geometry builder with custom attribute aLeaf
function veg_GB(){return {p:[],n:[],u:[],c:[],l:[]};}
function veg_push(b,x,y,z,nx,ny,nz,u,v,c,leaf){b.p.push(x,y,z);b.n.push(nx,ny,nz);b.u.push(u,v);b.c.push(c,c,c);b.l.push(leaf);}
function veg_geo(b){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(b.p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(b.n,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(b.u,2));g.setAttribute('color',new THREE.Float32BufferAttribute(b.c,3));g.setAttribute('aLeaf',new THREE.Float32BufferAttribute(b.l,1));g.computeBoundingSphere();return g;}
// atlas uv regions (canvas y is flipped: v = 1 - y/512)
const veg_cellUV=(cx,cy)=>[cx*.25,1-(cy+1)*.25,(cx+1)*.25,1-cy*.25]; // [u0,v0,u1,v1] for 128px cells
function veg_card(b,cx,cy,cz,size,uv,shade,ncx,ncy,ncz,rnd){
  // random orientation, normals point away from crown centre (soft volumetric lighting)
  let nx=cx-ncx,ny=cy-ncy+.6,nz=cz-ncz;const l=Math.hypot(nx,ny,nz)||1;nx/=l;ny/=l;nz/=l;const h=size/2;
  // card plane normal = outward direction + jitter; tangents from it
  let px=nx+(rnd()-.5)*1.1,py=ny+(rnd()-.5)*1.1,pz=nz+(rnd()-.5)*1.1;const pl=Math.hypot(px,py,pz)||1;px/=pl;py/=pl;pz/=pl;
  let rx=rnd()-.5,ry=rnd()-.5,rz=rnd()-.5;let ux=py*rz-pz*ry,uy=pz*rx-px*rz,uz=px*ry-py*rx;let ul=Math.hypot(ux,uy,uz)||1;ux/=ul;uy/=ul;uz/=ul;
  const vx=py*uz-pz*uy,vy=pz*ux-px*uz,vz=px*uy-py*ux;
  const P=[[cx-ux*h-vx*h,cy-uy*h-vy*h,cz-uz*h-vz*h,uv[0],uv[1]],[cx+ux*h-vx*h,cy+uy*h-vy*h,cz+uz*h-vz*h,uv[2],uv[1]],[cx+ux*h+vx*h,cy+uy*h+vy*h,cz+uz*h+vz*h,uv[2],uv[3]],[cx-ux*h+vx*h,cy-uy*h+vy*h,cz-uz*h+vz*h,uv[0],uv[3]]];
  for(const i of[0,1,2,0,2,3]){const q=P[i];veg_push(b,q[0],q[1],q[2],nx,ny,nz,q[3],q[4],shade,1);}
}
function veg_blob(b,cx,cy,cz,rx,ry,rz,uv,shade,detail=0){const g=new THREE.IcosahedronGeometry(1,detail).toNonIndexed();const p=g.attributes.position;
  for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i);const j=1+Math.sin(i*2.1)*.12;veg_push(b,cx+x*rx*j,cy+y*ry*j,cz+z*rz*j,x,y+.3,z,uv[0]+(uv[2]-uv[0])*(.5+x*.4),uv[1]+(uv[3]-uv[1])*(.5+z*.4),shade*(.75+.25*(y+1)/2),1);}}
function veg_cyl(b,x0,y0,z0,x1,y1,z1,r0,r1,seg,uv,shade){
  const dx=x1-x0,dy=y1-y0,dz=z1-z0,L=Math.hypot(dx,dy,dz);const ax=new THREE.Vector3(dx/L,dy/L,dz/L);const t1=new THREE.Vector3(1,0,0);if(Math.abs(ax.x)>.9)t1.set(0,0,1);
  const t2=new THREE.Vector3().crossVectors(ax,t1).normalize();t1.crossVectors(t2,ax).normalize();
  for(let i=0;i<seg;i++){const a0=i/seg*Math.PI*2,a1=(i+1)/seg*Math.PI*2;
    const ring=(a,r,x,y,z)=>{const cx=Math.cos(a),sx=Math.sin(a);const nx=t1.x*cx+t2.x*sx,ny=t1.y*cx+t2.y*sx,nz=t1.z*cx+t2.z*sx;return [x+nx*r,y+ny*r,z+nz*r,nx,ny,nz];};
    const A=ring(a0,r0,x0,y0,z0),B=ring(a1,r0,x0,y0,z0),C=ring(a1,r1,x1,y1,z1),Dd=ring(a0,r1,x1,y1,z1);
    const u0=uv[0]+(uv[2]-uv[0])*i/seg,u1=uv[0]+(uv[2]-uv[0])*(i+1)/seg;
    const V=[[A,u0,uv[1]],[B,u1,uv[1]],[C,u1,uv[3]],[A,u0,uv[1]],[C,u1,uv[3]],[Dd,u0,uv[3]]];
    for(const [q,u,v] of V)veg_push(b,q[0],q[1],q[2],q[3],q[4],q[5],u,v,shade,0);}}
function veg_treeGeo(A,rndSeed){let s=rndSeed;const rnd=()=>{s=(s*16807)%2147483647;return (s-1)/2147483646;};
  const b=veg_GB();const bark=A.birch?[.5,0,1,.5]:[0,0,.5,.5];const leafUV=veg_cellUV(A.cell,0);const solid=veg_cellUV(2,1);
  const base=A.cy-A.ry*.72;
  // trunk
  veg_cyl(b,0,0,0,0,base+1.2,0,A.tr,A.tr*.6,7,bark,1);
  // branches to sub-crowns
  const nb=A.name==='poplar'?3:4;
  for(let i=0;i<nb;i++){const a=i/nb*Math.PI*2+rnd();const r=A.rx*.55;const y=base+.4+rnd()*1.2;
    veg_cyl(b,0,y,0,Math.cos(a)*r,y+A.ry*.55,Math.sin(a)*r,A.tr*.45,A.tr*.18,5,bark,.95);}
  // inner foliage volume
  for(const [ox,oy,oz,k] of A.subs){{const bk=A.name==='poplar'?.5:.62;veg_blob(b,ox,A.cy+oy,oz,A.rx*bk*k,A.ry*bk*k,A.rx*bk*k,solid,.7,1);}}
  // leaf cards on the crown shell (denser outside, a few inside)
  for(let i=0;i<A.cards;i++){const sub=A.subs[i%A.subs.length];const k=sub[3];
    let x,y,z;do{x=rnd()*2-1;y=rnd()*2-1;z=rnd()*2-1;}while(x*x+y*y+z*z>1);const r=.55+.45*Math.cbrt(rnd());const l=Math.hypot(x,y,z)||1;
    x=x/l*r;y=y/l*r;z=z/l*r;const cx=sub[0]+x*A.rx*k,cy=A.cy+sub[1]+y*A.ry*k,cz=sub[2]+z*A.rx*k;
    const shade=.84+.34*((y+1)/2)+(rnd()-.5)*.12;
    veg_card(b,cx,cy,cz,A.cs*(.8+rnd()*.45),leafUV,shade,sub[0],A.cy+sub[1],sub[2],rnd);}
  return veg_geo(b);}
function veg_bushGeo(){let s=77;const rnd=()=>{s=(s*16807)%2147483647;return (s-1)/2147483646;};const b=veg_GB();const uv=veg_cellUV(3,1),solid=veg_cellUV(2,1);
  veg_blob(b,0,.55,0,.9,.6,.9,solid,.7,1);
  for(let i=0;i<22;i++){let x,y,z;do{x=rnd()*2-1;y=rnd();z=rnd()*2-1;}while(x*x+y*y+z*z>1);veg_card(b,x*.95,.45+y*.6,z*.95,1.1,uv,.8+.3*y,0,.2,0,rnd);}
  return veg_geo(b);}
function veg_grassGeo(){const b=veg_GB();const uv=veg_cellUV(0,1);
  for(let k=0;k<3;k++){const a=k*Math.PI/3+.4,ux=Math.cos(a)*.45,uz=Math.sin(a)*.45;
    const P=[[-ux,0,-uz,uv[0],uv[1]],[ux,0,uz,uv[2],uv[1]],[ux,.55,uz,uv[2],uv[3]],[-ux,.55,-uz,uv[0],uv[3]]];
    for(const i of[0,1,2,0,2,3]){const q=P[i];veg_push(b,q[0],q[1],q[2],0,1,0,q[3],q[4],1,q[1]>0?1:0);}}
  return veg_geo(b);}
function veg_impostorGeo(){ // unit-sized: width 1 (x), height 1 (y); top quad height set per arch in shader
  const b=veg_GB();
  for(let k=0;k<2;k++){const a=k*Math.PI/2,ux=Math.cos(a)*.5,uz=Math.sin(a)*.5;
    const P=[[-ux,0,-uz,0,0],[ux,0,uz,.125,0],[ux,1,uz,.125,1],[-ux,1,-uz,0,1]];
    for(const i of[0,1,2,0,2,3]){const q=P[i];veg_push(b,q[0],q[1],q[2],0,1,0,q[3],q[4],1,0);}}
  const P=[[-.5,2,-.5,.5,.5],[.5,2,-.5,.625,.5],[.5,2,.5,.625,1],[-.5,2,.5,.5,1]]; // y=2 marks the top quad
  for(const i of[0,2,1,0,3,2]){const q=P[i];veg_push(b,q[0],q[1],q[2],0,1,0,q[3],q[4],1,0);}
  return veg_geo(b);}

// ---------- materials (wind + leaf-only instance tint + two-sided foliage lighting) ----------
function veg_mat(map,opts={}){
  const m=new THREE.MeshLambertMaterial({map,vertexColors:true,alphaTest:.5,side:THREE.DoubleSide});
  m.onBeforeCompile=sh=>{sh.uniforms.uTime=veg_U.uTime;
    let vs='attribute float aLeaf;\nuniform float uTime;\n'+(opts.impostor?'attribute float aArch;\nuniform float uTopH[4];\n':'')+sh.vertexShader;
    if(opts.impostor){sh.uniforms.uTopH={value:veg_ARCH.map(A=>A.cy/(A.cy+A.ry))};
      vs=vs.replace('#include <uv_vertex>','#include <uv_vertex>\n#ifdef USE_UV\nvUv.x+=aArch*0.125;\n#endif');
      vs=vs.replace('#include <begin_vertex>','#include <begin_vertex>\nif(transformed.y>1.5){transformed.y=uTopH[int(aArch+.5)];}');}
    else vs=vs.replace('#include <begin_vertex>',`#include <begin_vertex>
#ifdef USE_INSTANCING
  vec2 vegIp=vec2(instanceMatrix[3][0],instanceMatrix[3][2]);
#else
  vec2 vegIp=vec2(0.);
#endif
  float vegPh=vegIp.x*.13+vegIp.y*.11;float vegK=aLeaf*max(transformed.y-${opts.bush?'0.2':'2.5'},0.)*${opts.bush?'0.05':'0.035'};
  float vegG=.6+.4*sin(uTime*.45+vegPh*.3);
  transformed.x+=sin(uTime*1.7+vegPh+transformed.y*.35)*vegK*vegG;transformed.z+=cos(uTime*1.3+vegPh*1.4+transformed.x*.4)*vegK*.8*vegG;`);
    vs=vs.replace('#include <color_vertex>',`#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
  vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor.xyz *= ${opts.impostor||opts.grass?'instanceColor.xyz':'mix(vec3(1.0),instanceColor.xyz,aLeaf)'};
#endif`);
    sh.vertexShader=vs;
    sh.fragmentShader=sh.fragmentShader.replace('( gl_FrontFacing ) ? vLightFront : vLightBack','vLightFront').replace('( gl_FrontFacing ) ? vIndirectFront : vIndirectBack','vIndirectFront');};
  m.customProgramCacheKey=()=>'veg'+JSON.stringify(opts);
  const dm=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,map,alphaTest:.5});
  return [m,dm];}

// ---------- streaming state (global; shared by all tiles) ----------
// Each loaded tile contributes instance lists (trees / bushes / grass). Global InstancedMeshes (far impostors,
// 4 near-tree archetypes, bushes, grass) are refilled from the union of loaded tiles whenever the tile set changes,
// so vegetation costs ~8 draw calls no matter how many tiles are loaded. Flower beds are a per-tile mesh in t.group.
const veg_tiles=new Map();               // tile key -> {trees:[[x,z,s,rot,arch,tint]], bushes:[[x,z,s,rot,tint]], grass:[...], ms}
const veg_TINT=[0xffffff,0xf0f6e6,0xe4ecd6,0xfff6dc,0xdde8d0,0xf6ffe8,0xe8f0e0,0xfaf0d0].map(c=>new THREE.Color(c));
let veg_S=null;
function veg_rng(key){let h=2166136261;const s0=String(key);for(let i=0;i<s0.length;i++)h=Math.imul(h^s0.charCodeAt(i),16777619);
  let s=((h>>>0)%2147483646)+1;return ()=>{s=(s*16807)%2147483647;return (s-1)/2147483646;};}
function veg_init(){if(veg_S)return veg_S;const Q=veg_Q;
  const leafTex=veg_leafAtlas(),impTex=veg_impostorAtlas();
  const [farM,farD]=veg_mat(impTex,{impostor:true});const farG=veg_impostorGeo();
  const [nearM,nearD]=veg_mat(leafTex,{});
  const nearMeshes=veg_ARCH.map((A,ai)=>{const m=new THREE.InstancedMesh(veg_treeGeo(A,1234+ai*999),nearM,Q.nearCap);m.customDepthMaterial=nearD;m.frustumCulled=false;m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for(let i=0;i<Q.nearCap;i++)m.setColorAt(i,veg_TINT[0]);m.count=0;m.name='veg_near'+ai;scene.add(m);return m;});
  const [bushM,bushD]=veg_mat(leafTex,{bush:true});const bushMesh=new THREE.InstancedMesh(veg_bushGeo(),bushM,Q.bushCap);bushMesh.customDepthMaterial=bushD;bushMesh.frustumCulled=false;bushMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for(let i=0;i<Q.bushCap;i++)bushMesh.setColorAt(i,veg_TINT[0]);bushMesh.count=0;bushMesh.name='veg_bush';scene.add(bushMesh);
  const [grassM]=veg_mat(leafTex,{bush:true,grass:true});const grassMesh=new THREE.InstancedMesh(veg_grassGeo(),grassM,Q.grassCap);grassMesh.frustumCulled=false;grassMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for(let i=0;i<Q.grassCap;i++)grassMesh.setColorAt(i,veg_TINT[i%8]);grassMesh.count=0;grassMesh.name='veg_grass';scene.add(grassMesh);
  const bedMat=new THREE.MeshLambertMaterial({map:leafTex,vertexColors:true});
  veg_S={leafTex,impTex,farM,farD,farG,far:null,farCap:0,nearMeshes,bushMesh,grassMesh,bedMat,
    all:[],bushes:[],grass:[],cells:new Map(),bushCells:new Map(),grassCells:new Map(),isNear:new Uint8Array(0),nearList:[],dirty:true,lastRebuild:0,lx:1e9,lz:1e9,ly:1e9,lt:0,rebuildMs:0};
  veg_ensureFar(8192);
  window.__veg={get trees(){return veg_S.all.length},get bushes(){return veg_S.bushes.length},get grass(){return veg_S.grass.length},tiles:veg_tiles,
    near:()=>nearMeshes.map(m=>m.count),get rebuildMs(){return veg_S.rebuildMs},tileMs:()=>[...veg_tiles.values()].map(r=>r.ms)};
  return veg_S;}
function veg_ensureFar(n){const S=veg_S;if(S.far&&n<=S.farCap)return;const cap=Math.max(8192,Math.ceil(n*1.4));
  if(S.far){scene.remove(S.far);if(S.far.dispose)S.far.dispose();}
  S.farG.setAttribute('aArch',new THREE.InstancedBufferAttribute(new Float32Array(cap),1));
  const far=new THREE.InstancedMesh(S.farG,S.farM,cap);far.customDepthMaterial=S.farD;far.frustumCulled=false;far.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for(let i=0;i<cap;i++)far.setColorAt(i,veg_TINT[0]);far.count=0;far.name='veg_far';
  far.onBeforeRender=(r,s,cam)=>{veg_U.uTime.value=performance.now()/1000;veg_update(cam);};
  scene.add(far);S.far=far;S.farCap=cap;S.dirty=true;}
const veg_tmp=new THREE.Matrix4(),veg_zero=new THREE.Matrix4().makeScale(0,0,0),veg_q=new THREE.Quaternion(),veg_up=new THREE.Vector3(0,1,0),veg_v3=new THREE.Vector3(),veg_sc=new THREE.Vector3();
function veg_mFar(p,m){const A=veg_ARCH[p[4]],s=p[2];return m.compose(veg_v3.set(p[0],p[6]||0,p[1]),veg_q.setFromAxisAngle(veg_up,p[3]),veg_sc.set(A.rx*2.24*s,(A.cy+A.ry)*s,A.rx*2.24*s));}
function veg_mNear(p,m){return m.compose(veg_v3.set(p[0],p[6]||0,p[1]),veg_q.setFromAxisAngle(veg_up,p[3]),veg_sc.set(p[2],p[2]*(.92+(p[5]%4)*.05),p[2]));}
const veg_CS=40,veg_ck=(i,j)=>i*65536+j;
// terrain base for an instance: groundY minus a slope allowance (radius r) so nothing floats downhill
function veg_baseY(x,z,r){const g=groundY(x,z);if(typeof HM==='undefined'||!HM)return g;const e=1.5,dx=groundY(x+e,z)-groundY(x-e,z),dz=groundY(x,z+e)-groundY(x,z-e);return g-Math.min(1.5,Math.hypot(dx,dz)/(2*e)*r);}
function veg_index(list){const map=new Map();for(let k=0;k<list.length;k++){const p=list[k];const key=veg_ck(Math.floor(p[0]/veg_CS),Math.floor(p[1]/veg_CS));let c=map.get(key);if(!c){c=[];map.set(key,c);}c.push(k);}return map;}
// refill the global instance buffers from the union of loaded tiles (only when the tile set changed)
function veg_rebuild(){const S=veg_S,t0=performance.now();const all=[],bushes=[],grass=[];let total=0;
  for(const r of veg_tiles.values())total+=r.trees.length;
  veg_ensureFar(total);const far=S.far,arch=S.farG.attributes.aArch;let off=0;
  for(const r of veg_tiles.values()){far.instanceMatrix.array.set(r.farM,off*16);far.instanceColor.array.set(r.col,off*3);arch.array.set(r.arch,off);off+=r.trees.length;
    for(const p of r.trees)all.push(p);for(const p of r.bushes)bushes.push(p);for(const p of r.grass)grass.push(p);}
  far.count=all.length;far.instanceMatrix.needsUpdate=true;if(far.instanceColor)far.instanceColor.needsUpdate=true;arch.needsUpdate=true;
  S.all=all;S.bushes=bushes;S.grass=grass;S.cells=veg_index(all);S.bushCells=veg_index(bushes);S.grassCells=veg_index(grass);
  S.isNear=new Uint8Array(all.length);S.nearList=[];S.lx=1e9;S.lt=0;S.dirty=false;S.lastRebuild=performance.now();S.rebuildMs=Math.round(performance.now()-t0);}
function veg_gather(map,list,cx,cy,cz,R2,cap){const out=[];const r=Math.sqrt(R2);
  for(let i=Math.floor((cx-r)/veg_CS);i<=Math.floor((cx+r)/veg_CS);i++)for(let j=Math.floor((cz-r)/veg_CS);j<=Math.floor((cz+r)/veg_CS);j++){const c=map.get(veg_ck(i,j));if(!c)continue;
    for(const k of c){const p=list[k];const d=(p[0]-cx)**2+(p[1]-cz)**2+cy*cy*.35;if(d<R2)out.push([d,k]);}}
  if(out.length>cap){out.sort((a,b)=>a[0]-b[0]);out.length=cap;}return out;}
// LOD selection — runs from the impostor mesh's onBeforeRender, at most every ~0.7 s or 6 m of camera movement
function veg_update(cam){const S=veg_S,Q=veg_Q;const c=cam.position,now=performance.now();
  if(S.dirty&&(now-S.lastRebuild>350||!S.all.length))veg_rebuild();
  if((c.x-S.lx)**2+(c.z-S.lz)**2+(c.y-S.ly)**2<36&&now-S.lt<700)return;S.lx=c.x;S.lz=c.z;S.ly=c.y;S.lt=now;
  const cy=Math.max(0,c.y-groundY(c.x,c.z)-2),all=S.all,far=S.far,N=all.length;
  const sel=veg_gather(S.cells,all,c.x,cy,c.z,Q.nearR*Q.nearR,Q.nearCap);const now2=new Uint8Array(N);for(const [,k] of sel)now2[k]=1;
  for(const k of S.nearList)if(!now2[k])far.setMatrixAt(k,veg_mFar(all[k],veg_tmp));
  const counts=[0,0,0,0];
  for(const [,k] of sel){if(!S.isNear[k])far.setMatrixAt(k,veg_zero);const p=all[k],m=S.nearMeshes[p[4]];const n=counts[p[4]]++;m.setMatrixAt(n,veg_mNear(p,veg_tmp));m.setColorAt(n,veg_TINT[p[5]]);}
  for(let a=0;a<4;a++){const m=S.nearMeshes[a];m.count=counts[a];m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;}
  S.isNear=now2;S.nearList=sel.map(s=>s[1]);far.instanceMatrix.needsUpdate=true;
  const bm=S.bushMesh,bs=veg_gather(S.bushCells,S.bushes,c.x,cy,c.z,Q.bushR*Q.bushR,Q.bushCap);
  for(let n=0;n<bs.length;n++){const p=S.bushes[bs[n][1]];bm.setMatrixAt(n,veg_tmp.compose(veg_v3.set(p[0],p[5]||0,p[1]),veg_q.setFromAxisAngle(veg_up,p[3]),veg_sc.set(p[2]*1.2,p[2],p[2]*1.2)));bm.setColorAt(n,veg_TINT[p[4]]);}
  bm.count=bs.length;bm.instanceMatrix.needsUpdate=true;if(bm.instanceColor)bm.instanceColor.needsUpdate=true;
  const gm=S.grassMesh,gs=cy>25?[]:veg_gather(S.grassCells,S.grass,c.x,cy,c.z,Q.grassR*Q.grassR,Q.grassCap);
  for(let n=0;n<gs.length;n++){const p=S.grass[gs[n][1]];gm.setMatrixAt(n,veg_tmp.compose(veg_v3.set(p[0],(p[5]||0)+0.02,p[1]),veg_q.setFromAxisAngle(veg_up,p[3]),veg_sc.set(p[2],p[2],p[2])));}
  gm.count=gs.length;gm.instanceMatrix.needsUpdate=true;}

// ---------- per-tile placement (deterministic per tile key) ----------
function buildVegetationTile(t){const t0=performance.now();const S=veg_init(),Q=veg_Q;
  const R=veg_rng('veg:'+t.key),rr=(a,b)=>a+R()*(b-a);const d=t.data||{};const sec={m0:t0};
  const X0=t.x0,X1=t.x1,Z0=t.z0,Z1=t.z1,inT=(x,z)=>x>=X0&&x<X1&&z>=Z0&&z<Z1;
  const maxT=t.vegMaxTrees||Q.tileMaxTrees;
  const pts=[];const G=new Map(),GC=6;const gkey=(x,z)=>Math.floor(x/GC)*73856093^Math.floor(z/GC)*19349663;
  const near=(x,z,dd)=>{for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++){const c=G.get((Math.floor(x/GC)+i)*73856093^(Math.floor(z/GC)+j)*19349663);if(!c)continue;for(const k of c){const p=pts[k];if((p[0]-x)**2+(p[1]-z)**2<dd*dd)return true;}}return false;};
  const add=(x,z,s,arch,tint,yo=0)=>{if(pts.length>=maxT)return;const rot=R()*Math.PI*2,tn=tint==null?(R()*8)|0:tint;if(inWater(x,z))return;const k=gkey(x,z);let c=G.get(k);if(!c){c=[];G.set(k,c);}c.push(pts.length);pts.push([x,z,s,rot,arch,tn,veg_baseY(x,z,.45*s)+yo]);};
  // this tile's road pieces (render pieces incl. footways); legacy builder passes decoded roads in t.vegRoads
  const rds=t.vegRoads||(d.r||[]).map(r=>({kind:r[0],w:r[1],pts:dec(r[6])}));
  const FG=new Map(),FC=12;
  for(const r of rds){if(r.kind<1)continue;for(let i=0;i<r.pts.length-1;i++){const a=r.pts[i],c=r.pts[i+1];const sg=[a,c,r.w/2+.35];
    for(let x=Math.floor((Math.min(a[0],c[0])-3)/FC);x<=Math.floor((Math.max(a[0],c[0])+3)/FC);x++)for(let z=Math.floor((Math.min(a[1],c[1])-3)/FC);z<=Math.floor((Math.max(a[1],c[1])+3)/FC);z++){const k=x*65536+z;let L=FG.get(k);if(!L){L=[];FG.set(k,L);}L.push(sg);}}}
  const RGd=new Map();
  for(const r of rds){if(r.kind!==0)continue;for(let i=0;i<r.pts.length-1;i++){const a=r.pts[i],c=r.pts[i+1];const sg=[a,c,r.w/2];
    for(let x=Math.floor((Math.min(a[0],c[0])-r.w)/FC);x<=Math.floor((Math.max(a[0],c[0])+r.w)/FC);x++)for(let z=Math.floor((Math.min(a[1],c[1])-r.w)/FC);z<=Math.floor((Math.max(a[1],c[1])+r.w)/FC);z++){const k=x*65536+z;let L=RGd.get(k);if(!L){L=[];RGd.set(k,L);}L.push(sg);}}}
  const segHit=(L,x,z,m)=>{if(!L)return false;for(const [a,c,hw] of L){const dx=c[0]-a[0],dz=c[1]-a[1],l2=dx*dx+dz*dz||1e-9;let tt=((x-a[0])*dx+(z-a[1])*dz)/l2;tt=tt<0?0:tt>1?1:tt;const qx=a[0]+dx*tt-x,qz=a[1]+dz*tt-z;if(qx*qx+qz*qz<(hw+m)*(hw+m))return true;}return false;};
  // tile-local road grid; within 15 m of the tile border also ask the global road index (neighbour tiles' pieces)
  const onRoadF=(x,z,m=.5)=>{if(segHit(RGd.get(Math.floor(x/FC)*65536+Math.floor(z/FC)),x,z,m))return true;
    if(x-X0<15||X1-x<15||z-Z0<15||Z1-z<15){const ns=nearestSeg(x,z,14);return !!(ns&&ns.d<ns.s.r.w/2+m);}return false;};
  const onPath=(x,z,m=0)=>{const L=FG.get(Math.floor(x/FC)*65536+Math.floor(z/FC));if(!L)return false;for(const [a,c,hw] of L){const dx=c[0]-a[0],dz=c[1]-a[1],l2=dx*dx+dz*dz||1e-9;let tt=((x-a[0])*dx+(z-a[1])*dz)/l2;tt=tt<0?0:tt>1?1:tt;const qx=a[0]+dx*tt-x,qz=a[1]+dz*tt-z;if(qx*qx+qz*qz<(hw+m)*(hw+m))return true;}return false;};
  const pickArch=(street)=>{const r=R();return street?(r<.5?0:r<.88?1:r<.95?3:2):(r<.34?0:r<.62?1:r<.8?3:2);};
  // areas of this tile (parks / water / plazas) — parsed first so placement can reject water
  const parks=[],waters=[],plazas=[];
  for(const [kind,ring,holes] of (d.a||[])){const o=dec(ring);if(o.length<3)continue;let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;for(const p of o){x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);z0=Math.min(z0,p[1]);z1=Math.max(z1,p[1]);}
    const P={o,hs:(holes||[]).map(dec),A:Math.abs(sArea(o)),x0,x1,z0,z1};(kind==='park'?parks:kind==='water'?waters:plazas).push(P);}
  const inWater=(x,z)=>{for(const W of waters)if(x>W.x0-1&&x<W.x1+1&&z>W.z0-1&&z<W.z1+1&&pip(x,z,W.o))return true;return false;};
  sec.m1=performance.now();
  // 1) individually mapped trees
  const tr=d.trees||[];for(let i=0;i<tr.length;i+=2){const x=tr[i]*SC,z=tr[i+1]*SC;if(near(x,z,2.5)||onRoadF(x,z)||solidAt(x,z))continue;add(x,z,rr(.75,1.2),pickArch(true));}
  sec.m2=performance.now();
  // 2) street trees along this tile's drivable road pieces (lindens and chestnuts)
  for(const r of rds){if(r.kind!==0||r.w>24)continue;let acc=R()*13;
    for(let i=0;i<r.pts.length-1;i++){const a=r.pts[i],c=r.pts[i+1],dx=c[0]-a[0],dz=c[1]-a[1],l=Math.hypot(dx,dz);if(l<.1)continue;const nx=-dz/l,nz=dx/l;
      for(let s=13-acc%13;s<l;s+=13){for(const sd of[-1,1]){if(R()<.42)continue;const o=r.w/2+1.25;const x=a[0]+dx/l*s+nx*o*sd,z=a[1]+dz/l*s+nz*o*sd;
          if(near(x,z,7)||onRoadF(x,z)||pushOut(x,z,1.6))continue;add(x,z,rr(.8,1.15),pickArch(true),null,.17);}}
      acc+=l;}}
  sec.m3=performance.now();
  // inside-cell mask per park (pip once per cell; only edge cells need a per-point test) — shared by trees, bushes, grass
  for(const P of parks){if(P.A<150)continue;let cm=6;while(((P.x1-P.x0)/cm)*((P.z1-P.z0)/cm)>9000)cm*=1.5;
    const nx=Math.max(1,Math.ceil((P.x1-P.x0)/cm)),nz=Math.max(1,Math.ceil((P.z1-P.z0)/cm));const m=new Uint8Array(nx*nz);
    for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const x=P.x0+(i+.5)*cm,z=P.z0+(j+.5)*cm;if(pip(x,z,P.o)&&!P.hs.some(h=>pip(x,z,h)))m[j*nx+i]=1;}
    const cells=[];for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const k=j*nx+i;if(!m[k])continue;
      const edge=i===0||j===0||i===nx-1||j===nz-1||!m[k-1]||!m[k+1]||!m[k-nx]||!m[k+nx];if(edge)m[k]=2;cells.push(k);}
    P.cm=cm;P.nx=nx;P.mask=m;P.cells=cells;}
  const inPark=(P,x,z)=>{if(!P.mask||x<P.x0||x>=P.x1||z<P.z0||z>=P.z1)return false;const i=Math.floor((x-P.x0)/P.cm),j=Math.floor((z-P.z0)/P.cm);const v=P.mask[j*P.nx+i];
    return v===1||(v===2&&pip(x,z,P.o)&&!P.hs.some(h=>pip(x,z,h)));};
  const sampleIn=P=>{if(!P.cells||!P.cells.length)return null;const k=P.cells[(R()*P.cells.length)|0];const i=k%P.nx,j=(k/P.nx)|0;
    const x=P.x0+(i+R())*P.cm,z=P.z0+(j+R())*P.cm;if(P.mask[k]===2&&(!pip(x,z,P.o)||P.hs.some(h=>pip(x,z,h))))return null;return [x,z];};
  // 3) parks & forest parks (Valea Morilor, La Izvor, Grădina Botanică, Dendrariu …) — dense fill
  for(const P of parks){const {A}=P;if(A<250)continue;const forest=A>40000;const dens=forest?Q.dens*.75:Q.dens;
    const n=Math.min(forest?1600:420,Math.floor(A/dens));
    for(let k=0;k<n*2&&k<(forest?3400:900);k++){const q=sampleIn(P);if(!q)continue;const x=q[0],z=q[1];if(near(x,z,forest?3.8:4.2)||onRoadF(x,z)||onPath(x,z,.6)||solidAt(x,z))continue;add(x,z,rr(.85,1.35),pickArch(false));}}
  sec.m4=performance.now();
  // 4) lake shores
  const inList=(L,x,z)=>L.some(P=>x>P.x0&&x<P.x1&&z>P.z0&&z<P.z1&&pip(x,z,P.o));
  for(const W of waters){if(W.A<3000)continue;const o=W.o;const sg=sArea(o)>0?1:-1;
    for(let i=0;i<o.length;i++){const a=o[i],c=o[(i+1)%o.length],dx=c[0]-a[0],dz=c[1]-a[1],l=Math.hypot(dx,dz);if(l<1)continue;const ox=dz/l*sg,oz=-dx/l*sg;
      for(let s=0;s<l;s+=6){for(let k=0;k<2;k++){const dd=rr(5,30);const x=a[0]+dx/l*s+ox*dd,z=a[1]+dz/l*s+oz*dd;
        if(!inT(x,z)||inList(waters,x,z)||near(x,z,4.5)||onRoadF(x,z)||onPath(x,z,.8)||solidAt(x,z))continue;add(x,z,rr(.9,1.35),R()<.25?2:pickArch(false));}}}}
  sec.m5=performance.now();
  // 5) private-house gardens (outskirts): walnut / apple / cherry around small low houses
  for(const b of (d.b||[])){const h=b[0],ring=b[4];if(h>8.5||ring.length<6)continue;let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;
    for(let i=0;i<ring.length;i+=2){const x=ring[i]*SC,z=ring[i+1]*SC;x0=Math.min(x0,x);x1=Math.max(x1,x);z0=Math.min(z0,z);z1=Math.max(z1,z);}
    const w=x1-x0,dp=z1-z0;if(w*dp>260||w*dp<20)continue;const cx=(x0+x1)/2,cz=(z0+z1)/2,rad=Math.max(w,dp)/2;const n=1+((R()*3)|0);
    for(let k=0;k<n;k++){const a=R()*Math.PI*2,dd=rad+rr(3,9);const x=cx+Math.cos(a)*dd,z=cz+Math.sin(a)*dd;
      if(!inT(x,z)||near(x,z,3.2)||onRoadF(x,z)||onPath(x,z,.5)||pushOut(x,z,1.4))continue;
      const walnut=R()<.25;add(x,z,walnut?rr(.75,1):rr(.45,.65),walnut?1:(R()<.6?0:3),walnut?2:(R()<.5?5:7));}}
  sec.m6=performance.now();
  // 6) courtyards / free land between Soviet blocks and buildings
  for(let x=X0+10;x<X1-1;x+=19)for(let z=Z0+10;z<Z1-1;z+=19){if(R()<.45)continue;const px=x+rr(-8,8),pz=z+rr(-8,8);
    if(near(px,pz,6)||onRoadF(px,pz,2.2)||onPath(px,pz,1)||pushOut(px,pz,3.2))continue;if(inList(waters,px,pz)||inList(plazas,px,pz))continue;
    add(px,pz,rr(.8,1.25),pickArch(false));}
  sec.m7=performance.now();
  // ---- bushes / hedges / grass ----
  const bushes=[],grass=[];
  for(const P of parks){const {o,A}=P;
    if(A>900&&P.mask)for(let i=0;i<o.length;i++){if(R()<.3)continue;const a=o[i],c=o[(i+1)%o.length],dx=c[0]-a[0],dz=c[1]-a[1],l=Math.hypot(dx,dz);if(l<6||l>400)continue;
      const inx=-dz/l,inz=dx/l;const sgn=sArea(o)>0?1:-1;
      for(let s=2;s<l-2;s+=2.1){const x=a[0]+dx/l*s+inx*1.6*sgn,z=a[1]+dz/l*s+inz*1.6*sgn;if(!inT(x,z)||!inPark(P,x,z)||onRoadF(x,z)||solidAt(x,z))continue;{const sc=rr(.8,1.15),ro=R()*6.3,tn=(R()*8)|0;if(!inWater(x,z))bushes.push([x,z,sc,ro,tn,veg_baseY(x,z,.9*sc)]);}}}
    const nb=Math.min(A>40000?600:220,A/170|0);for(let k=0;k<nb*1.5;k++){const q=sampleIn(P);if(!q)continue;const x=q[0],z=q[1];if(onPath(x,z,.8)||onRoadF(x,z)||solidAt(x,z))continue;{const sc=rr(.9,1.6),ro=R()*6.3,tn=(R()*8)|0;if(!inWater(x,z))bushes.push([x,z,sc,ro,tn,veg_baseY(x,z,.9*sc)]);}}
    const ng=Math.min(3500,A/5|0);for(let k=0;k<ng;k++){const q=sampleIn(P);if(!q)continue;const x=q[0],z=q[1];if(onPath(x,z,.1))continue;{const sc=rr(.7,1.4),ro=R()*6.3,tn=(R()*8)|0;if(!inWater(x,z))grass.push([x,z,sc,ro,tn,groundY(x,z)]);}}}
  for(const r of rds){if(r.kind!==3)continue;for(let i=0;i<r.pts.length-1;i++){const a=r.pts[i],c=r.pts[i+1],dx=c[0]-a[0],dz=c[1]-a[1],l=Math.hypot(dx,dz);if(l<4)continue;const nx=-dz/l,nz=dx/l;
    for(let s=2;s<l;s+=rr(3,7)){if(R()<.35)continue;const sd=R()<.5?1:-1;const x=a[0]+dx/l*s+nx*(r.w/2+1)*sd,z=a[1]+dz/l*s+nz*(r.w/2+1)*sd;
      if(!parks.some(P=>inPark(P,x,z)))continue;if(onRoadF(x,z)||onPath(x,z,.3)||solidAt(x,z))continue;{const sc=rr(.8,1.3),ro=R()*6.3,tn=(R()*8)|0;bushes.push([x,z,sc,ro,tn,veg_baseY(x,z,.9*sc)]);}}}}
  sec.m8=performance.now();
  // ---- flower beds in big parks (per-tile mesh, shared material) ----
  {const b=new Bk(S.bedMat,true);const fuv=veg_cellUV(1,1);
    for(const P of parks){if(P.A<6000)continue;const n=Math.min(6,P.A/9000|0)+1;let nbed=0;
      for(let k=0;k<n*6;k++){const x=rr(P.x0,P.x1),z=rr(P.z0,P.z1);const rx=rr(2.2,4.5),rz=rx*rr(.6,1);
        if(!inT(x,z)||!inPark(P,x,z)||onRoadF(x,z)||onPath(x,z,.5)||solidAt(x,z)||pushOut(x,z,Math.max(rx,rz)+1)||near(x,z,Math.max(rx,rz)+1))continue;
        const G0=(vx,vz)=>groundY(vx,vz);const yc=G0(x,z);const seg=16;for(let sI=0;sI<seg;sI++){const a0=sI/seg*Math.PI*2,a1=(sI+1)/seg*Math.PI*2;const c0=Math.cos(a0),s0=Math.sin(a0),c1=Math.cos(a1),s1=Math.sin(a1);
          const uvp=(cc,ss)=>[fuv[0]+(fuv[2]-fuv[0])*(.5+cc*.48),fuv[1]+(fuv[3]-fuv[1])*(.5+ss*.48)];
          const A0=uvp(c0,s0),A1=uvp(c1,s1),C=uvp(0,0);
          b.v(x,yc+.32,z,0,1,0,1,1,1,C[0],C[1]);b.v(x+c1*rx,G0(x+c1*rx,z+s1*rz)+.3,z+s1*rz,0,1,0,1,1,1,A1[0],A1[1]);b.v(x+c0*rx,G0(x+c0*rx,z+s0*rz)+.3,z+s0*rz,0,1,0,1,1,1,A0[0],A0[1]);
          const ko=1.08,y0=-.25,y1=.34;const g0=G0(x+c0*rx*ko,z+s0*rz*ko),g1=G0(x+c1*rx*ko,z+s1*rz*ko);const q=[[x+c0*rx*ko,g0+y0,z+s0*rz*ko],[x+c1*rx*ko,g1+y0,z+s1*rz*ko],[x+c1*rx*ko,g1+y1,z+s1*rz*ko],[x+c0*rx*ko,g0+y1,z+s0*rz*ko]];
          const nx=(c0+c1)/2,nz=(s0+s1)/2;const kc=.78;for(const i of[0,2,1,0,3,2])b.v(q[i][0],q[i][1],q[i][2],nx,0,nz,kc,kc,kc*.95,.6,.05);
          const tq=[[x+c0*rx,G0(x+c0*rx,z+s0*rz)+y1,z+s0*rz],[x+c1*rx,G0(x+c1*rx,z+s1*rz)+y1,z+s1*rz],[x+c1*rx*ko,g1+y1,z+s1*rz*ko],[x+c0*rx*ko,g0+y1,z+s0*rz*ko]];for(const i of[0,2,1,0,3,2])b.v(tq[i][0],tq[i][1],tq[i][2],0,1,0,kc,kc,kc*.95,.6,.05);}
        if(++nbed>=n)break;}}
    if(b.p.length){const m=b.mesh();m.name='veg_beds';(t.group||scene).add(m);}}
  sec.end=performance.now();const ks=Object.keys(sec);const prof={};for(let i=1;i<ks.length;i++)prof[ks[i-1]]=Math.round(sec[ks[i]]-sec[ks[i-1]]);
  const N=pts.length,farM=new Float32Array(N*16),col=new Float32Array(N*3),arch=new Float32Array(N);
  for(let i=0;i<N;i++){const p=pts[i];veg_mFar(p,veg_tmp).toArray(farM,i*16);const c=veg_TINT[p[5]];col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;arch[i]=p[4];}
  const rec={trees:pts,bushes,grass,farM,col,arch,ms:Math.round(performance.now()-t0),prof,n:[N,bushes.length,grass.length]};veg_tiles.set(t.key,rec);S.dirty=true;return rec;}
function vegetationUnloadTile(t){if(veg_tiles.delete(t.key)&&veg_S)veg_S.dirty=true;}
// legacy whole-map builder (used if the world loader has no tiles): one pseudo-tile covering the data bounds
function buildVegetation(){return buildVegetationTile({key:'legacy',x0:BX0,x1:BX1,z0:BZ0,z1:BZ1,group:scene,vegMaxTrees:veg_Q.maxTrees,
  data:{trees:D.trees||[],a:D.a||[],b:D.b||[]},vegRoads:roads.map(r=>({kind:r.kind,w:r.w,pts:r.pts}))});}
// create shared textures/materials/instanced meshes up front (during loading) so the first tile doesn't pay for it
try{veg_init();}catch(e){console.error('veg_init',e);}
