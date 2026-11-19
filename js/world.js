'use strict';
// World tiles: streaming + module builder orchestration. Owner: ENGINE. See WORLD.md.
// Streaming contract additions (ENGINE):
//  • t.lod 'near' (≤ WORLD.nearR) builds buildings+streets+vegetation+transit; 'far' (≤ WORLD.loadR) builds buildings+streets only
//    (vegetation too if window.VEGETATION_LOD===true). LOD switches build a replacement tile in the background and swap it in.
//  • Builders may be cooperative: check t.deadline (performance.now() ms) and return 'more' to be called again next slice.
//  • Vegetation of a tile waits until the 8 neighbours (that will load) have their buildings built (≤ 4 s).
//  • geometry.userData.shared=true → not disposed on unload. Hooks: envTileReady(t), <module>UnloadTile(t), WORLD.onReady/onUnload.
//  • Dev: ?world=<dir> picks the dataset folder (default world/); dev/make_far.py <dir> builds the distant silhouette far.json.
// Two modes:
//  'stream'  – every core module has per-tile builders (buildStreetsGlobal + buildBuildingsTile + buildStreetsTile + buildVegetationTile):
//              tiles are fetched/built/unloaded around the player, time-sliced.
//  'legacy'  – some module still only has a global builder: load ALL tiles once (only sane for the centre-only dataset).
const WORLD={tiles:new Map(),T:500,ready:false,mode:'legacy',
  base:((/[?&]world=([\w-]+)/.exec(location.search)||[0,'world'])[1])+'/',
  nearR:800,loadR:1900,unloadR:2300,lodHyst:150,startR:620,viewDist:3800,
  budgetMs:7,fetchMax:4,
  stats:{fetched:0,built:0,unloaded:0,step:{},frameBuildMs:0,maxFrameBuildMs:0},
  onReady:[],onUnload:[]};
const WORLD_STEPS=['buildBuildingsTile','buildStreetsTile','buildVegetationTile','buildTransitTile','buildBridgesTile'];
// far-LOD tiles (beyond WORLD.nearR) only get cheap builders; vegetation joins if the module sets window.VEGETATION_LOD=true
const world_stepsFor=lod=>lod==='far'?['buildBuildingsTile','buildStreetsTile'].concat(window.VEGETATION_LOD?['buildVegetationTile']:[],['buildBridgesTile']):WORLD_STEPS;
const WORLD_UNLOAD=['buildingsUnloadTile','streetsUnloadTile','bridgesUnloadTile','vegetationUnloadTile','transitUnloadTile'];
const worldHas=n=>typeof window[n]==='function';
let world_px=0,world_pz=0,world_scanT=0,world_fetching=0;const world_queue=[];   // tiles with data waiting / in progress
const world_keyOf=(x,z)=>Math.floor(x/WORLD.T)+'_'+Math.floor(z/WORLD.T);
// true if (x,z) lies in a fully built tile (always true in legacy mode)
function worldReadyAt(x,z){if(WORLD.mode!=='stream')return true;const t=WORLD.tiles.get(world_keyOf(x,z));return !!t&&t.state==='ready';}
function world_rectDist(i,j,x,z){const T=WORLD.T,x0=i*T,z0=j*T;const dx=Math.max(x0-x,0,x-(x0+T)),dz=Math.max(z0-z,0,z-(z0+T));return Math.hypot(dx,dz);}
const world_packs=new Map();
async function worldFetchTile(key){
  if(D.packs){const [i,j]=key.split('_').map(Number);const pk='p_'+Math.floor(i/D.packs)+'_'+Math.floor(j/D.packs);
    let pr=world_packs.get(pk);if(!pr){pr=fetch(WORLD.base+'packs/'+pk+'.json').then(r=>{if(!r.ok)throw new Error('pack '+pk+' '+r.status);return r.json();});world_packs.set(pk,pr);pr.catch(()=>world_packs.delete(pk));}
    const P=await pr;const t=P[key];if(!t)throw new Error('tile '+key+' missing in '+pk);return t;}
  const r=await fetch(WORLD.base+'tiles/'+key+'.json');if(!r.ok)throw new Error('tile '+key+' '+r.status);return r.json();}
function worldMakeTile(key,data,lod='near'){const [i,j]=key.split('_').map(Number);const T=WORLD.T;
  const t={key,i,j,x0:i*T,z0:j*T,x1:(i+1)*T,z1:(j+1)*T,data,lod,steps:world_stepsFor(lod),group:new THREE.Group(),polys:[],state:'building',step:0,pri:0,next:null};
  t.group.name='tile_'+key;t.group.visible=false;scene.add(t.group);WORLD.tiles.set(key,t);return t;}
// run the next module builder for tile t; returns true when the tile is complete
function world_step(t){const ST=t.steps;
  while(t.step<ST.length&&!worldHas(ST[t.step]))t.step++;
  if(t.step<ST.length){const n=ST[t.step++],t0=performance.now();let r;
    // cooperative builders may check t.deadline (performance.now() ms) and return 'more' to be called again next slice
    try{r=window[n](t);}catch(e){console.error(n+' '+t.key,e);}
    if(r==='more')t.step--;else if(n==='buildBuildingsTile')t.bDone=true;
    const ms=performance.now()-t0,key=n+(t.lod==='far'?'@far':''),S=WORLD.stats.step[key]||(WORLD.stats.step[key]={n:0,sum:0,max:0});S.n++;S.sum+=ms;S.max=Math.max(S.max,ms);}
  if(t.step>=ST.length){
    if(t.swapOf){world_swap(t.swapOf,t);t=WORLD.tiles.get(t.key);}
    else{t.state='ready';t.group.visible=true;}
    WORLD.stats.built++;for(const f of WORLD.onReady)try{f(t);}catch(e){console.error(e);}hook('envTileReady',t);return true;}
  return false;}
// vegetation (and later steps) wait until the 8 neighbours that will be loaded have their buildings built,
// so edge trees don't land inside a neighbour's houses (solidAt). Gives up after 4 s to avoid deadlocks.
function world_blocked(t){const n=t.steps[t.step];if(n!=='buildVegetationTile'||!worldHas(n))return false;
  if(!t.waitT)t.waitT=performance.now();if(performance.now()-t.waitT>4000)return false;
  for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++){if(!di&&!dj)continue;const k=(t.i+di)+'_'+(t.j+dj);if(!D.tiles[k])continue;
    if(world_rectDist(t.i+di,t.j+dj,world_px,world_pz)>WORLD.loadR)continue;const nb=WORLD.tiles.get(k);
    if(!nb||!(nb.bDone||nb.state==='ready'))return true;}
  return false;}
// LOD change: build a replacement tile object in the background, swap when complete (no holes)
function world_relod(t,lod){if(t.next)return;const n=worldMakeTile(t.key,t.data,lod);WORLD.tiles.set(t.key,t);n.swapOf=t;n.pri=t.pri-(lod==='near'?400:0);t.next=n;world_queue.push(n);}
function world_swap(old,n){world_disposeTile(old);n.swapOf=null;n.state='ready';n.group.visible=true;WORLD.tiles.set(n.key,n);WORLD.stats.relod=(WORLD.stats.relod||0)+1;}
function world_disposeGroup(g){g.traverse(o=>{const geo=o.geometry;if(geo&&!(geo.userData&&geo.userData.shared))geo.dispose();if(o.isInstancedMesh&&typeof o.dispose==='function')o.dispose();});}
function world_disposeTile(t){if(!t.group)return;scene.remove(t.group);world_disposeGroup(t.group);if(t.polys.length)removePolys(t.polys);
  for(const n of WORLD_UNLOAD)if(worldHas(n))try{window[n](t);}catch(e){console.error(n,e);}
  t.state='unloaded';t.group=null;t.polys=[];const qi=world_queue.indexOf(t);if(qi>=0)world_queue.splice(qi,1);}
function worldUnloadTile(t){if(t.next){world_disposeTile(t.next);t.next=null;}world_disposeTile(t);
  for(const f of WORLD.onUnload)try{f(t);}catch(e){console.error(e);}
  t.data=null;WORLD.tiles.delete(t.key);WORLD.stats.unloaded++;}
function world_requestFetch(key,pri,lod){const [i,j]=key.split('_').map(Number);
  const stub={key,i,j,state:'fetching',pri,lod};WORLD.tiles.set(key,stub);world_fetching++;
  worldFetchTile(key).then(d=>{world_fetching--;WORLD.stats.fetched++;
    if(WORLD.tiles.get(key)!==stub)return;               // unloaded/cancelled meanwhile
    WORLD.tiles.delete(key);const t=worldMakeTile(key,d,stub.lod);t.pri=stub.pri;world_queue.push(t);})
   .catch(e=>{world_fetching--;console.error(e);if(WORLD.tiles.get(key)===stub)WORLD.tiles.delete(key);});}
// rescan: which tiles to fetch / unload, priority = distance minus view-direction bonus
function world_scan(){const px=world_px,pz=world_pz;let fx=0,fz=1;try{const v=new THREE.Vector3();camera.getWorldDirection(v);const l=Math.hypot(v.x,v.z)||1;fx=v.x/l;fz=v.z/l;}catch(e){}
  const T=WORLD.T,want=[];
  for(const key in D.tiles){const k=key.indexOf('_'),i=+key.slice(0,k),j=+key.slice(k+1);const d=world_rectDist(i,j,px,pz);
    const t=WORLD.tiles.get(key);
    if(d>WORLD.unloadR){if(t){if(t.state==='fetching')WORLD.tiles.delete(key);else worldUnloadTile(t);}continue;}
    if(d>WORLD.loadR)continue;
    const cx=(i+.5)*T-px,cz=(j+.5)*T-pz,cl=Math.hypot(cx,cz)||1,dot=(cx*fx+cz*fz)/cl;
    const near=t&&t.lod==='near'?d<WORLD.nearR+WORLD.lodHyst:d<WORLD.nearR,lod=near?'near':'far';
    const pri=d-Math.max(0,dot)*220+(near?0:500);
    if(t){t.pri=pri;if(t.state==='building'&&!t.swapOf&&t.lod!==lod&&t.step===0){t.lod=lod;t.steps=world_stepsFor(lod);}
      else if(t.state==='ready'&&t.lod!==lod)world_relod(t,lod);
      if(t.next)t.next.pri=pri-(t.next.lod==='near'?400:0);continue;}
    want.push([pri,key,lod]);}
  want.sort((a,b)=>a[0]-b[0]);
  for(const [pri,key,lod] of want){if(world_fetching>=WORLD.fetchMax)break;world_requestFetch(key,pri,lod);}
  world_queue.sort((a,b)=>a.pri-b.pri);}
// per frame (called by game.js): streaming + time-sliced building
function worldUpdate(dt,px,pz){world_px=px;world_pz=pz;world_terrainUpdate(dt);if(WORLD.mode!=='stream'){world_farUpdate();return;}
  world_scanT-=dt;if(world_scanT<=0||world_fetching<WORLD.fetchMax&&world_scanT<.15){world_scanT=.3;world_scan();}
  const t0=performance.now();let spent=0,calls=0;
  while(world_queue.length&&(spent=performance.now()-t0)<WORLD.budgetMs){let qi=-1;for(let k=0;k<world_queue.length&&k<24;k++)if(!world_blocked(world_queue[k])){qi=k;break;}
    if(qi<0)break;const t=world_queue[qi];
    // don't start a builder whose average cost exceeds what's left of this frame's budget (at most one heavy call per frame)
    const n=t.steps[t.step],S=n&&WORLD.stats.step[n+(t.lod==='far'?'@far':'')];if(calls&&S&&S.sum/S.n>WORLD.budgetMs-spent)break;
    t.deadline=t0+WORLD.budgetMs;calls++;if(world_step(t)){const k=world_queue.indexOf(t);if(k>=0)world_queue.splice(k,1);}}
  WORLD.stats.frameBuildMs=performance.now()-t0;WORLD.stats.maxFrameBuildMs=Math.max(WORLD.stats.maxFrameBuildMs*.995,WORLD.stats.frameBuildMs);
  world_farUpdate();}
// blocking load around (cx,cz): fetch tiles within rFetch, build those within rBuild now (rest go to the streaming queue).
// beforeBuild(datas) runs after fetching (e.g. landmarks need nearby building footprints).
async function worldLoadAround(cx,cz,rBuild,rFetch,onProgress,beforeBuild){world_px=cx;world_pz=cz;
  const dist=k=>{const [i,j]=k.split('_').map(Number);return world_rectDist(i,j,cx,cz);};
  const keys=Object.keys(D.tiles).filter(k=>dist(k)<=rFetch).sort((a,b)=>dist(a)-dist(b));
  const nb=keys.filter(k=>dist(k)<=rBuild).length;let done=0;const total=keys.length+nb;const prog=()=>onProgress&&onProgress(done,total);
  const datas=new Map();let next=0;
  await Promise.all([...Array(6)].map(async()=>{while(next<keys.length){const k=keys[next++];try{datas.set(k,await worldFetchTile(k));}catch(e){console.error(e);}done++;prog();}}));
  if(beforeBuild)beforeBuild(datas);
  const now=[];
  for(const k of keys){const d=datas.get(k);if(!d||WORLD.tiles.has(k))continue;const t=worldMakeTile(k,d,dist(k)<WORLD.nearR?'near':'far');
    if(dist(k)<=rBuild)now.push(t);else{t.pri=dist(k)+(t.lod==='far'?500:0);world_queue.push(t);}}
  for(const t of now){while(t.step<t.steps.length&&t.steps[t.step]!=='buildVegetationTile'&&!t.bDone)world_step(t);await new Promise(r=>setTimeout(r,0));}  // buildings ring first
  for(const t of now){t.waitT=performance.now()-5000;while(!world_step(t)){}done++;prog();await new Promise(r=>setTimeout(r,0));}
  world_queue.sort((a,b)=>a.pri-b.pri);}
function world_aggregate(datas){D.b=[];D.a=[];D.trees=[];D.cross=[];
  for(const d of datas){D.b.push(...(d.b||[]));D.a.push(...(d.a||[]));D.trees.push(...(d.trees||[]));D.cross.push(...(d.cross||[]));}}
async function worldInitialLoad(onProgress,cx=0,cz=0){
  WORLD.T=D.tile||500;
  const streams=['buildStreetsGlobal','buildBuildingsTile','buildStreetsTile','buildVegetationTile'].every(worldHas);
  WORLD.mode=streams?'stream':'legacy';
  if(WORLD.mode==='stream'){
    buildStreetsGlobal();buildGraph();
    // landmarks look up OSM footprints in D.b → aggregate the start area (≈1 km around the Arc) before their pre-build hook
    await worldLoadAround(cx,cz,WORLD.startR,1000,onProgress,datas=>{world_aggregate(datas.values());hook('landmarksPreBuild');});
    buildLandmarks();D.b=[];D.a=[];D.trees=[];D.cross=[];
    if(!worldHas('buildTransitTile'))try{buildTransit();}catch(e){console.error('buildTransit fallback',e);}   // fallback: global wires/stops
    world_farInit();
  }else{
    if(worldHas('buildStreetsGlobal'))buildStreetsGlobal();
    const keys=Object.keys(D.tiles);let done=0;
    const datas=await Promise.all(keys.map(k=>worldFetchTile(k).then(d=>{done++;onProgress&&onProgress(done,keys.length);return [k,d];})));
    world_aggregate(datas.map(x=>x[1]));hook('landmarksPreBuild');
    const tiles=datas.map(([k,d])=>worldMakeTile(k,d));
    if(worldHas('buildBuildingsTile'))for(const t of tiles)buildBuildingsTile(t);else buildBuildings();
    if(worldHas('buildStreetsTile'))for(const t of tiles)buildStreetsTile(t);else buildStreets();
    buildGraph();
    if(worldHas('buildVegetationTile'))for(const t of tiles)buildVegetationTile(t);else buildVegetation();
    buildLandmarks();
    if(worldHas('buildTransitTile'))for(const t of tiles)buildTransitTile(t);else buildTransit();
    if(worldHas('buildBridgesTile'))for(const t of tiles)buildBridgesTile(t);
    for(const t of tiles){t.state='ready';t.step=t.steps.length;t.group.visible=true;}
    world_farInit();
  }
  WORLD.ready=true;}

// ---------- far-city silhouette (world/far.json: {cell, boxes:[[cx,cz,size,h],…]} in metres) ----------
let world_far=null;
function world_farInit(){
  try{world_terrainInit();}catch(e){console.error('terrain',e);}
  if(camera.far<WORLD.viewDist+300){camera.far=WORLD.viewDist+300;camera.updateProjectionMatrix();}
  // ENV owns fog; if it hasn't been adapted to the streaming radius yet, stretch it so far-LOD tiles are visible through the haze
  if(WORLD.mode==='stream'&&scene.fog&&scene.fog.far<WORLD.loadR){scene.fog.near=Math.max(scene.fog.near,260);scene.fog.far=WORLD.loadR+400;WORLD.fogAdjusted=true;}
  fetch(WORLD.base+'far.json').then(r=>r.ok?r.json():null).then(F=>{if(!F||!F.boxes||!F.boxes.length)return;
    const SZ=2000,groups=new Map();
    for(const b of F.boxes){const k=Math.floor(b[0]/SZ)+'_'+Math.floor(b[1]/SZ);let a=groups.get(k);if(!a){a=[];groups.set(k,a);}a.push(b);}
    const fogC=scene.fog?scene.fog.color.clone():new THREE.Color(0xc4d6e6);
    const mat=new THREE.MeshLambertMaterial({vertexColors:true,fog:false});
    const U={uP:{value:new THREE.Vector2()},uR0:{value:WORLD.loadR-150},uR1:{value:WORLD.viewDist},uFog:{value:fogC}};
    mat.onBeforeCompile=s=>{Object.assign(s.uniforms,U);
      s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vWP;').replace('#include <project_vertex>','#include <project_vertex>\nvWP=(modelMatrix*vec4(transformed,1.0)).xyz;');
      s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vWP;uniform vec2 uP;uniform float uR0,uR1;uniform vec3 uFog;')
        .replace('void main() {','void main() {\n float wd=distance(vWP.xz,uP);if(wd<uR0)discard;')
        .replace('#include <dithering_fragment>','#include <dithering_fragment>\n gl_FragColor.rgb=mix(gl_FragColor.rgb,uFog,clamp(0.8+0.2*(wd-uR0)/(uR1-uR0),0.0,0.97));');};
    mat.customProgramCacheKey=()=>'world_far1';
    const box=new THREE.BoxGeometry(1,1,1);box.translate(0,.5,0);const bp=box.attributes.position,bn=box.attributes.normal,bi=box.index.array;
    const root=new THREE.Group();root.name='world_far';
    for(const [,list] of groups){const P=[],N=[],C=[],I=[];let v0=0;
      for(const [cx,cz,s,h] of list){const shade=.78+((cx*7+cz*13)%17)/80;const gy=Math.min(groundY(cx-s/2,cz-s/2),groundY(cx+s/2,cz-s/2),groundY(cx-s/2,cz+s/2),groundY(cx+s/2,cz+s/2))-1;
        for(let k=0;k<bp.count;k++){P.push(cx+bp.getX(k)*s,gy+bp.getY(k)*(h+1),cz+bp.getZ(k)*s);N.push(bn.getX(k),bn.getY(k),bn.getZ(k));C.push(.86*shade,.83*shade,.78*shade);}
        for(let k=0;k<bi.length;k++){const f=Math.floor(k/3);/* drop bottom face (indices 18..23 → face 3) */const face=Math.floor(k/6);if(face===3)continue;I.push(bi[k]+v0);}v0+=bp.count;}
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(N,3));g.setAttribute('color',new THREE.Float32BufferAttribute(C,3));
      g.setIndex(I.length>65535?new THREE.Uint32BufferAttribute(I,1):new THREE.Uint16BufferAttribute(I,1));g.computeBoundingSphere();
      const m=new THREE.Mesh(g,mat);m.matrixAutoUpdate=false;m.castShadow=m.receiveShadow=false;m.userData.noShadow=true;root.add(m);}
    scene.add(root);world_far={root,U};}).catch(()=>{});}
function world_farUpdate(){if(world_far)world_far.U.uP.value.set(world_px,world_pz);}
// ---------------- distant terrain (whole heightmap extent, coarse) ----------------
// Shows Chișinău's real relief to the horizon. Fragments inside tiles that build their own detailed ground are discarded via a
// per-tile mask: a tile is masked when t.state==='ready' and t.hasTerrain===true (set by the STREETS/ground builder for tiles whose
// terrain mesh it built). Until a tile has its own terrain, this coarse surface (lowered 0.6 m) is the ground there.
let world_terr=null;
function world_terrainInit(){if(!HM||world_terr)return;
  const STEP=3,c=HM.c*STEP,nx=Math.floor((HM.nx-1)/STEP)+1,nz=Math.floor((HM.nz-1)/STEP)+1,x0=HM.x0,z0=HM.z0;
  const pos=new Float32Array(nx*nz*3),col=new Float32Array(nx*nz*3);
  const G1=new THREE.Color(0x6f8a4a),G2=new THREE.Color(0x8c8a5e),G3=new THREE.Color(0x56723c),tmp=new THREE.Color();
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const k=j*nx+i,x=x0+i*c,z=z0+j*c,y=groundY(x,z)-.6;pos[k*3]=x;pos[k*3+1]=y;pos[k*3+2]=z;
    const n=groundNormal(x,z),slope=1-n[1],hn=(Math.sin(x*.013)+Math.sin(z*.011+1.7)+Math.sin((x+z)*.005))/3;
    tmp.copy(G1).lerp(G3,clamp(.5+hn*.6,0,1)).lerp(G2,clamp(slope*14,0,.75));col[k*3]=tmp.r;col[k*3+1]=tmp.g;col[k*3+2]=tmp.b;}
  const idx=new Uint32Array((nx-1)*(nz-1)*6);let q=0;
  for(let j=0;j<nz-1;j++)for(let i=0;i<nx-1;i++){const a=j*nx+i,b=a+1,d=a+nx,e=d+1;idx[q++]=a;idx[q++]=d;idx[q++]=b;idx[q++]=b;idx[q++]=d;idx[q++]=e;}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('color',new THREE.BufferAttribute(col,3));g.setIndex(new THREE.BufferAttribute(idx,1));g.computeVertexNormals();g.computeBoundingSphere();
  // tile mask (1 = tile has its own detailed ground)
  const T=WORLD.T,mx0=Math.floor(x0/T),mz0=Math.floor(z0/T),mw=Math.ceil((x0+(nx-1)*c)/T)-mx0+1,mh=Math.ceil((z0+(nz-1)*c)/T)-mz0+1;
  const mdata=new Uint8Array(mw*mh*4),mtex=new THREE.DataTexture(mdata,mw,mh,THREE.RGBAFormat);mtex.magFilter=mtex.minFilter=THREE.NearestFilter;mtex.needsUpdate=true;
  const U={uMask:{value:mtex},uM0:{value:new THREE.Vector2(mx0*T,mz0*T)},uMS:{value:new THREE.Vector2(mw*T,mh*T)}};
  const mat=new THREE.MeshLambertMaterial({vertexColors:true});
  mat.onBeforeCompile=sh=>{Object.assign(sh.uniforms,U);
    sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vTW;').replace('#include <project_vertex>','#include <project_vertex>\nvTW=(modelMatrix*vec4(transformed,1.0)).xz;');
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vTW;uniform sampler2D uMask;uniform vec2 uM0,uMS;')
      .replace('void main() {','void main() {\n if(texture2D(uMask,(vTW-uM0)/uMS).r>0.5)discard;');};
  mat.customProgramCacheKey=()=>'world_terr1';
  const m=new THREE.Mesh(g,mat);m.name='world_terrain';m.matrixAutoUpdate=false;m.frustumCulled=false;m.receiveShadow=true;m.castShadow=false;m.userData.noShadow=false;scene.add(m);
  world_terr={m,mdata,mtex,mx0,mz0,mw,mh,sig:'',t:0};}
function world_terrainUpdate(dt){const W=world_terr;if(!W)return;W.t-=dt||0;if(W.t>0)return;W.t=.25;
  let sig='';const keys=[];for(const t of WORLD.tiles.values())if(t.state==='ready'&&t.hasTerrain===true){keys.push(t);sig+=t.key+',';}
  if(sig===W.sig)return;W.sig=sig;W.mdata.fill(0);for(const t of keys){const i=t.i-W.mx0,j=t.j-W.mz0;if(i<0||j<0||i>=W.mw||j>=W.mh)continue;W.mdata[(j*W.mw+i)*4]=255;}W.mtex.needsUpdate=true;}
