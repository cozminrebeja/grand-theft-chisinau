'use strict';
// Vehicles: PS2-style Blender models (tools/blender/cars.py → models/cars.glb, loaded by models.js): smooth low-poly
// bodies with one baked texture per model (plates, lettering, lamps, seams, grime are in the texture). Instanced pools
// per model (near model + far LOD with baked wheels + instanced wheels that spin and steer), brake/reverse lamp glows,
// police light bar, trolleybus poles, per-frame instance compaction. Owner: VEHICLES agent.
// Shading: MeshPhysical with a light clear-coat env shine, per-vertex roughness/metal/coat/tint from the glTF material
// kind ('paint' areas are neutral grey in the texture and multiplied by the car's paint colour; 'glass', 'chrome').
const _pos=new THREE.Vector3(); // shared temp (also used by game.js)

// ================= environment map for reflections =================
const veh_env=(()=>{
  const s=new THREE.Scene();
  const g=new THREE.SphereGeometry(50,32,16),c=[];const top=new THREE.Color(0x4f86c6),hor=new THREE.Color(0xdfe8ef),gnd=new THREE.Color(0x4a4a48);
  const p=g.attributes.position;for(let i=0;i<p.count;i++){const y=p.getY(i)/50;const col=y>0?hor.clone().lerp(top,Math.pow(y,.6)):hor.clone().lerp(gnd,Math.min(1,-y*4));c.push(col.r,col.g,col.b);}
  g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));
  s.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.BackSide})));
  // sun + bright sky patches + building silhouettes around the horizon
  const sunM=new THREE.Mesh(new THREE.SphereGeometry(3,12,8),new THREE.MeshBasicMaterial({color:0xfff6e0}));sunM.position.set(-25,32,18);s.add(sunM);
  const bm=new THREE.MeshBasicMaterial({color:0x6d6e70}),bl=new THREE.MeshBasicMaterial({color:0xa9adb1});
  for(let i=0;i<26;i++){const a=i/26*Math.PI*2,h=4+((i*7919)%9);const b=new THREE.Mesh(new THREE.BoxGeometry(7,h,2),i%3?bm:bl);b.position.set(Math.cos(a)*44,h/2-2,Math.sin(a)*44);b.lookAt(0,h/2-2,0);s.add(b);}
  const soft=new THREE.Mesh(new THREE.PlaneGeometry(40,10),new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide}));soft.position.set(0,40,0);soft.rotation.x=Math.PI/2;s.add(soft);
  const pm=new THREE.PMREMGenerator(renderer);const rt=pm.fromScene(s,0.02);pm.dispose();return rt.texture;})();

// ================= geometry builder with material attributes =================
const veh_nm=new THREE.Matrix3(),veh_v=new THREE.Vector3(),veh_n=new THREE.Vector3(),veh_c=new THREE.Color();
class veh_B{
  constructor(){this.p=[];this.n=[];this.c=[];this.uv=[];this.aT=[];this.aR=[];this.aM=[];this.aC=[];}
  add(geo,m,color,o){o=o||{};const g=geo.index?geo.toNonIndexed():geo;const P=g.attributes.position,N=g.attributes.normal,U=g.attributes.uv;
    m=m||veh_I;veh_nm.getNormalMatrix(m);veh_c.set(color);const t=o.t||0,ro=o.ro!=null?o.ro:.5,me=o.me||0,co=o.co||0;
    const flip=m.determinant()<0;
    for(let k=0;k<P.count;k+=3)for(let q=0;q<3;q++){const i=flip?k+(q===0?0:3-q):k+q;
      veh_v.fromBufferAttribute(P,i).applyMatrix4(m);veh_n.fromBufferAttribute(N,i).applyMatrix3(veh_nm).normalize();
      this.p.push(veh_v.x,veh_v.y,veh_v.z);this.n.push(veh_n.x,veh_n.y,veh_n.z);this.c.push(veh_c.r,veh_c.g,veh_c.b);
      if(U)this.uv.push(U.getX(i),U.getY(i));else this.uv.push(0,0);
      this.aT.push(t);this.aR.push(ro);this.aM.push(me);this.aC.push(co);}}
  geo(){const g=new THREE.BufferGeometry(),F=(a,n)=>new THREE.Float32BufferAttribute(a,n);
    g.setAttribute('position',F(this.p,3));g.setAttribute('normal',F(this.n,3));g.setAttribute('color',F(this.c,3));g.setAttribute('uv',F(this.uv,2));
    g.setAttribute('aTint',F(this.aT,1));g.setAttribute('aRough',F(this.aR,1));g.setAttribute('aMetal',F(this.aM,1));g.setAttribute('aCoat',F(this.aC,1));
    g.computeBoundingSphere();return g;}
}
const veh_I=new THREE.Matrix4();
const veh_q=new THREE.Quaternion(),veh_e=new THREE.Euler(),veh_s3=new THREE.Vector3(),veh_p3=new THREE.Vector3();
const veh_M=(x,y,z,ry=0,rx=0,rz=0,sx=1,sy=1,sz=1)=>new THREE.Matrix4().compose(veh_p3.set(x,y,z),veh_q.setFromEuler(veh_e.set(rx,ry,rz,'YXZ')),veh_s3.set(sx,sy,sz));
// shading per glTF material kind ('<kind>.<model>'; t = takes the per-car paint colour, the texture is neutral grey there)
const veh_MAT={paint:{t:1,ro:.38,me:.08,co:.7},glass:{ro:.16,me:.1,co:.55},chrome:{ro:.22,me:.85,co:.3}},veh_MAT0={ro:.8,me:0,co:0};
const veh_kind=mt=>(mt.name||'').split('.')[0];

// one material per baked texture: PS2 texture × paint colour, light env-map shine on paint / glass / chrome
const veh_MATS=new Map();
function veh_physMat(map){let m=veh_MATS.get(map||null);if(m)return m;
  m=new THREE.MeshPhysicalMaterial({vertexColors:true,map:map||null,roughness:1,metalness:1,clearcoat:1,clearcoatRoughness:.12,envMap:veh_env,envMapIntensity:.45});
  m.onBeforeCompile=sh=>{
    sh.vertexShader='attribute float aTint;attribute float aRough;attribute float aMetal;attribute float aCoat;\nvarying float vRough;varying float vMetal;varying float vCoat;\n'+sh.vertexShader;
    sh.vertexShader=sh.vertexShader.replace('#include <color_vertex>',`
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
vColor *= mix( vec3( 1.0 ), instanceColor, aTint );
#endif
vRough = aRough; vMetal = aMetal; vCoat = aCoat;`);
    sh.fragmentShader='varying float vRough;varying float vMetal;varying float vCoat;\n'+sh.fragmentShader;
    sh.fragmentShader=sh.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor = vRough;')
      .replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\nmetalnessFactor = vMetal;')
      .replace('#include <lights_physical_fragment>','#include <lights_physical_fragment>\n#ifdef CLEARCOAT\nmaterial.clearcoat *= vCoat;\n#endif');};
  m.customProgramCacheKey=()=>'vehPhys3'+(map?'t':'');veh_MATS.set(map||null,m);return m;}

// ================= model baking (models/cars.glb) =================
// Collision/camera size per model (must match tools/blender/cars.py); wheels, lamps and poles come from the glb.
const veh_DEFS={yaris:{L:3.75,W:1.695},taxi:{L:3.75,W:1.695},logan:{L:4.29,W:1.74},police:{L:4.29,W:1.74},lada:{L:4.13,W:1.62},
  suv:{L:4.0,W:1.735},sprinter:{L:5.91,W:1.99},trolley:{L:12,W:2.55}};
const veh_rel=(node,root)=>{root.updateMatrixWorld(true);return new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(node.matrixWorld);};
const veh_under=(o,top,re)=>{for(;o&&o!==top;o=o.parent)if(re.test(o.name))return true;return false;};
// every mesh under node into B (car space = relative to `space`, default node), skipping subtrees whose name matches skip;
// returns the texture the meshes use (one per model)
function veh_bake(B,node,space,skip,m0){let map=null;mdl_each(node,(g,m,mt,mesh)=>{if(skip&&veh_under(mesh,node,skip))return;
  let mm=space&&space!==node?veh_rel(node,space).multiply(m):m;if(m0)mm=new THREE.Matrix4().multiplyMatrices(m0,mm);
  if(mt.map)map=mt.map;B.add(g,mm,mt.map?0xffffff:mt.color.getHex(),veh_MAT[veh_kind(mt)]||veh_MAT0);});return map;}
const veh_child=(root,suf)=>root&&root.getObjectByName(root.name+suf);

// ================= pools =================
const veh_NEAR=130,veh_FAR=640,veh_NEAR2=veh_NEAR*veh_NEAR,veh_FAR2=veh_FAR*veh_FAR;
const VEH_POOL={};let veh_TRIS={},veh_barIM=null,veh_poleIM=null,veh_ready=false;
function veh_im(geo,mat,cap){const m=new THREE.InstancedMesh(geo,mat,cap);m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);m.frustumCulled=false;m.count=0;m.castShadow=true;m.receiveShadow=true;
  m.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(cap*3).fill(1),3);m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  scene.add(m);return m;}
const veh_cylX=(r,w,n)=>CYL(r,r,w,n).rotateZ(Math.PI/2);
// built on the first makeVehicle(), i.e. after main() has awaited mdl_preload(); without cars.glb the cars are plain boxes
function veh_init(){if(veh_ready)return;veh_ready=true;
  for(const name in veh_DEFS){const root=mdl_get('cars',name),D=veh_DEFS[name];
    let d;try{d=root&&JSON.parse(root.userData.car);}catch(e){d=null;}
    if(!d){d={L:D.L,W:D.W,wheel:{r:.32,tw:.2,zf:D.L*.3,zr:-D.L*.3,x:D.W/2-.12,style:'steel',real:1},tail:[],head:[]};if(root)console.warn('cars.glb: no props for',name);}
    const W=d.wheel,hi=new veh_B(),lo=new veh_B(),wh=new veh_B(),body=veh_child(root,'_body'),wn=veh_child(root,'_wheel'),wf=veh_child(root,'_wfar');
    let map=null;
    if(root){map=veh_bake(hi,root,root,/^(police_bar|trolley_pole)$|_wheel$|_wfar$/);if(body)veh_bake(lo,body,root);}
    else for(const B of[hi,lo])B.add(BOX(D.W,1.1,D.L),veh_M(0,.9,0),0xffffff,veh_MAT.paint);
    if(wn)veh_bake(wh,wn);else wh.add(veh_cylX(W.r,W.tw,8),null,0x1c1c1c,veh_MAT0);
    // far LOD: plain wheels baked in place (unit-size wheels in older files are scaled)
    for(const z of[W.zf,W.zr])for(const s of[1,-1]){const m=W.real?veh_M(s*W.x,W.r,z,s<0?Math.PI:0):veh_M(s*W.x,W.r,z,s<0?Math.PI:0,0,0,W.tw,W.r,W.r);
      if(wf)veh_bake(lo,wf,null,null,m);else lo.add(veh_cylX(W.real?W.r:1,W.real?W.tw:1,8),m,0x1c1c1c,veh_MAT0);}
    const tr=name==='trolley',hg=hi.geo(),lg=lo.geo(),wg=wh.geo(),mat=veh_physMat(map),cap=tr?24:90;
    const P=VEH_POOL[name]={d,near:veh_im(hg,mat,cap),far:veh_im(lg,mat,tr?24:260),wheel:veh_im(wg,mat,cap*4),nk:0,fk:0,wk:0,nearR2:veh_NEAR2*(tr?1.6:1)};
    P.wheel.receiveShadow=false;
    veh_TRIS[name]=[hg.attributes.position.count/3,lg.attributes.position.count/3,wg.attributes.position.count/3];
    // police light bar (red | blue halves; flashing = per-instance colour)
    if(name==='police'){const n=mdl_get('cars','police_bar'),B=new veh_B();if(n)veh_bake(B,n,root);
      veh_barIM=new THREE.InstancedMesh(B.geo(),new THREE.MeshBasicMaterial({map,vertexColors:true}),60);veh_barIM.frustumCulled=false;veh_barIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);veh_barIM.setColorAt(0,veh_c.set(0xffffff));veh_barIM.count=0;scene.add(veh_barIM);}
    // trolleybus current-collector poles (pivot at the origin, lifted by v.poles[i].rotation.x — see updPoles in game.js)
    if(name==='trolley'){const n=mdl_get('cars','trolley_pole'),B=new veh_B();if(n)veh_bake(B,n);else B.add(CYL(.03,.04,6.2,6).rotateX(Math.PI/2).translate(0,0,-3.1),null,0x262626,veh_MAT0);
      veh_poleIM=veh_im(B.geo(),mat,60);}}
}
const veh_glowTex=ctex(64,64,g=>{const gr=g.createRadialGradient(32,32,2,32,32,32);gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(.25,'rgba(255,255,255,.55)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(0,0,64,64);},false);
const veh_lampIM=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:veh_glowTex,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}),700);
veh_lampIM.frustumCulled=false;veh_lampIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);veh_lampIM.setColorAt(0,veh_c.set(0));veh_lampIM.count=0;veh_lampIM.renderOrder=3;scene.add(veh_lampIM);
// headlight beams on the road at night: additive fan decal in car space ahead of each moving car (no real lights: Lambert is per-vertex)
const veh_beamTex=ctex(64,128,(g,w,h)=>{const im=g.createImageData(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const t=y/h,u=Math.abs(x/(w-1)*2-1),half=.32+.68*t;
  const a=Math.pow(1-t,1.3)*clamp((half-u)/(.35*half),0,1)*clamp(t*6,0,1),i=(y*w+x)*4;im.data[i]=im.data[i+1]=im.data[i+2]=255;im.data[i+3]=a*255;}g.putImageData(im,0,0);},false);
const veh_beamIM=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({map:veh_beamTex,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4}),120);
veh_beamIM.frustumCulled=false;veh_beamIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);veh_beamIM.setColorAt(0,veh_c.set(0));veh_beamIM.count=0;veh_beamIM.renderOrder=2;scene.add(veh_beamIM);
// blob shadows
const veh_blobIM=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),blobMat,700);veh_blobIM.frustumCulled=false;veh_blobIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);veh_blobIM.count=0;scene.add(veh_blobIM);


// ================= vehicle API =================
const SPEC={
  taxi:{model:'taxi',max:38,acc:11,brake:26,turn:2.1,cam:8.2,camH:3.0,name:'Toyota Yaris · Taxi'},
  yaris:{model:'yaris',max:38,acc:11,brake:26,turn:2.1,cam:8.2,camH:3.0,name:'Toyota Yaris'},
  logan:{model:'logan',max:40,acc:10,brake:24,turn:2.0,cam:8.6,camH:3.1,name:'Dacia Logan'},
  lada:{model:'lada',max:31,acc:7.5,brake:18,turn:1.9,cam:8.4,camH:3.0,name:'VAZ-2107 „Jiguli”'},
  suv:{model:'suv',max:41,acc:10.5,brake:25,turn:1.95,cam:9,camH:3.3,name:'Toyota RAV4'},
  rutiera:{model:'sprinter',max:30,acc:6.8,brake:17,turn:1.45,cam:11,camH:4.3,name:'Mercedes Sprinter · Rutieră'},
  police:{model:'police',max:45,acc:12.5,brake:27,turn:2.15,cam:8.8,camH:3.1,name:'Poliția'},
  trolley:{model:'trolley',max:19,acc:3.8,brake:10,turn:.95,cam:17,camH:6,name:'Troleibuz'},
};
for(const k in SPEC){const s=SPEC[k];s.max*=1.5;s.acc*=1.5; // player-driven top speed & pull +50% (AI/chase use their own speeds)
  const d=veh_DEFS[s.model];s.len=d.L;s.wid=d.W;}
const veh_PAINTS={yaris:[0xc9ccd0,0x1f1f22,0xb51d24,0x2a4f8a,0xe8e8e6,0x6b6e72,0x8a9a5b],logan:[0xe8e8e6,0x8d9298,0x2b2d31,0x7a1c20,0x23395c,0x5d6b55,0xb7a98a,0x3d4a5c],
  lada:[0xf1efe4,0xb94a32,0x2d5b3a,0x55224a,0xd8c48d,0x3b6aa3,0x8a8f7a,0x6e1f22],suv:[0xe8e8e6,0x2b2d31,0x8d9298,0x5a1f24,0x39465a,0x6f7a63],sprinter:[0xf4f4f2,0xeeeeea,0xf3f1ea],police:[0xf7f7f7],
  trolley:[0x1d5fb4,0x1d5fb4,0x2a4f8f,0xb8312f,0x2f8a55]}; // trolleybus: colour of the livery bands
const vehicles=[];
function makeVehicle(type,x,z,h,paint){veh_init();const sp=SPEC[type];
  const v={type,spec:sp,x,z,h,speed:0,mode:'parked',ai:null,driver:false,stuck:0,rev:0,wire:true,v0:12,steer:0,
    veh_rot:Math.random()*6,veh_ps:0,veh_brk:0,veh_st:0};
  v.veh_pool=VEH_POOL[sp.model];v.paint=paint!=null?paint:type==='taxi'?(Math.random()<.85?0xf2c318:0xf4f4f2):mpick(veh_PAINTS[sp.model]);v.veh_col=new THREE.Color(v.paint);
  if(v.veh_pool.d.poles)v.poles=v.veh_pool.d.poles.map(()=>{const o=new THREE.Object3D();o.rotation.x=.33;return o;});
  v.y=veh_sy(x,z,null,Math.sin(h),Math.cos(h));v.pitch=0;v.roll=0;vehicles.push(v);return v;}
function removeVehicle(v){const i=vehicles.indexOf(v);if(i>=0)vehicles.splice(i,1);}

// ================= per-frame render (instance compaction + LOD) =================
const veh_fr=new THREE.Frustum(),veh_pmx=new THREE.Matrix4(),veh_sph=new THREE.Sphere(),veh_m4=new THREE.Matrix4(),veh_m5=new THREE.Matrix4(),veh_qq=new THREE.Quaternion(),veh_up=new THREE.Vector3(0,1,0),veh_one=new THREE.Vector3(1,1,1),veh_tp=new THREE.Vector3(),veh_ts=new THREE.Vector3();
const veh_qy=new THREE.Quaternion(),veh_qx=new THREE.Quaternion(),veh_qs=new THREE.Quaternion(),veh_X=new THREE.Vector3(1,0,0);
let veh_lk=0;
function veh_lamp(base,x,y,z,sx,sy,col,ry){veh_m5.compose(veh_tp.set(x,y,z),veh_qq.setFromAxisAngle(veh_up,ry||0),veh_ts.set(sx,sy,1));veh_m5.premultiply(base);if(veh_lk<700){veh_lampIM.setMatrixAt(veh_lk,veh_m5);veh_lampIM.setColorAt(veh_lk,veh_c.set(col));veh_lk++;}}
function veh_wheelsOf(v,P,base,W){const im=P.wheel,cap=im.instanceMatrix.count,sx=W.real?1:W.tw,sy=W.real?1:W.r;
  for(const az of[W.zf,W.zr])for(const s of[1,-1]){if(P.wk>=cap)return;const front=az===W.zf;
    veh_qy.setFromAxisAngle(veh_up,(front?-v.steer*.42:0)+(s<0?Math.PI:0));veh_qx.setFromAxisAngle(veh_X,s>0?v.veh_rot:-v.veh_rot);veh_qs.multiplyQuaternions(veh_qy,veh_qx);
    veh_m5.compose(veh_tp.set(s*W.x,W.r,az),veh_qs,veh_ts.set(sx,sy,sy));veh_m5.premultiply(base);im.setMatrixAt(P.wk++,veh_m5);}}
// ---- terrain: ground height + pitch/roll from the four wheel-contact heights (exposes v.y, v.pitch, v.roll) ----
const veh_eu=new THREE.Euler(0,0,0,'YXZ');
const veh_gy=(x,z)=>typeof groundY==='function'?groundY(x,z):0;
// road surface (bridge decks via bridges.js); refY = vehicle's previous height so it can also pass UNDER a bridge
const veh_sy=(x,z,r,hx,hz)=>typeof surfaceY==='function'?surfaceY(x,z,r,hx,hz):veh_gy(x,z);
function veh_ground(v,dt){const W=v.veh_pool.d.wheel,zf=W.zf,zr=W.zr,hw=v.spec.wid*.42,sh=Math.sin(v.h),ch=Math.cos(v.h);
  const ry=v.y==null||!isFinite(v.y)?null:v.y,G=(a,s)=>veh_sy(v.x+sh*a+ch*s*hw,v.z+ch*a-sh*s*hw,ry,sh,ch);
  const yfl=G(zf,1),yfr=G(zf,-1),yrl=G(zr,1),yrr=G(zr,-1),yf=(yfl+yfr)*.5,yr=(yrl+yrr)*.5;
  const pitch=Math.atan2(yf-yr,zf-zr),roll=Math.atan2((yfl+yrl)-(yfr+yrr),4*hw);
  v.y=yr+(yf-yr)*(-zr)/(zf-zr);
  if(v.veh_pt==null||!(dt>0)){v.veh_pt=pitch;v.veh_rl=roll;}else{const k=1-Math.exp(-dt*10);v.veh_pt+=(pitch-v.veh_pt)*k;v.veh_rl+=(roll-v.veh_rl)*k;}
  v.pitch=v.veh_pt;v.roll=v.veh_rl;}
function renderVehicles(dt){dt=dt||0.016;if(!veh_ready)return;
  camera.updateMatrixWorld();veh_pmx.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);veh_fr.setFromProjectionMatrix(veh_pmx);
  const cx=camera.position.x,cz=camera.position.z,now=performance.now(),flash=(now/140|0)%2,flash2=(now/70|0)%4===0;
  for(const k in VEH_POOL){const P=VEH_POOL[k];P.nk=P.fk=P.wk=0;}veh_lk=0;let bk=0,blk=0,pk=0,bmk=0;const hl=env_lightsU.value;
  for(const v of vehicles){const sp=v.speed||0,P=v.veh_pool,d=P.d;v.veh_rot+=sp*dt/d.wheel.r;
    const acc=(sp-v.veh_ps)/Math.max(dt,1e-3);v.veh_ps=sp;const moving=v.mode!=='parked';
    const want=moving&&(acc<-1.2||(Math.abs(sp)<.4&&v.mode!=='player')||(v.mode==='player'&&Math.abs(sp)<.4))?1:0;v.veh_brk+=(want-v.veh_brk)*Math.min(1,dt*12);
    const dx=v.x-cx,dz=v.z-cz,d2=dx*dx+dz*dz;
    // ground fit = 4 surface queries: only when the car moved and is close enough to matter (or is the player's)
    if((v._gx!==v.x||v._gz!==v.z||v._gh!==v.h||v.y==null)&&(d2<veh_FAR2*1.2||v.mode==='player'||v.y==null)){veh_ground(v,dt);v._gx=v.x;v._gz=v.z;v._gh=v.h;}
    if(d2>veh_FAR2)continue;
    veh_qq.setFromEuler(veh_eu.set(-v.pitch,v.h,v.roll));veh_m4.compose(veh_tp.set(v.x,v.y,v.z),veh_qq,veh_one);
    veh_sph.center.set(v.x,v.y+1,v.z);veh_sph.radius=v.spec.len*.6+1;if(!veh_fr.intersectsSphere(veh_sph))continue;
    const near=d2<P.nearR2;
    if(near){if(P.nk<P.near.instanceMatrix.count){P.near.setMatrixAt(P.nk,veh_m4);P.near.setColorAt(P.nk,v.veh_col);P.nk++;}
      veh_wheelsOf(v,P,veh_m4,d.wheel);}
    else if(P.fk<P.far.instanceMatrix.count){P.far.setMatrixAt(P.fk,veh_m4);P.far.setColorAt(P.fk,v.veh_col);P.fk++;}
    if(blk<700){veh_m5.compose(veh_tp.set(v.x,v.y+.055,v.z),veh_qq,veh_ts.set(v.spec.wid*1.45,1,v.spec.len*1.12));veh_blobIM.setMatrixAt(blk++,veh_m5);}
    if(v.poles&&pk<60)for(let i=0;i<v.poles.length;i++){const pv=d.poles[i];veh_m5.compose(veh_tp.set(pv[0],pv[1],pv[2]),veh_qs.setFromAxisAngle(veh_X,v.poles[i].rotation.x),veh_one);veh_m5.premultiply(veh_m4);veh_poleIM.setMatrixAt(pk++,veh_m5);}
    if(d2<veh_NEAR2*3){const b=v.veh_brk,rev=sp<-.3,big=v.spec.len>7?1.4:1;
      for(const t of d.tail){const k=.22+b*1.0+hl*.3;veh_lamp(veh_m4,t[0],t[1],t[2],(.36*k+.12)*big,(.22*k+.1)*big,rev?0xbfbfbf:veh_c.setRGB(.95*k,.07*k,.05*k).getHex(),Math.PI);}
      if(moving){const hs=1+hl*1.6,hc=veh_c.setRGB(.35+.65*hl,.33+.62*hl,.28+.52*hl).getHex();for(const t of d.head)veh_lamp(veh_m4,t[0],t[1],t[2],.32*big*hs,.2*big*hs,hc,0);
        if(hl>.01&&bmk<120&&(d2<veh_NEAR2||v.mode==='player')){const L=v.spec.len,bl=big>1?20:16;veh_m5.compose(veh_tp.set(0,.14,L/2+bl/2-.2),veh_qs.identity(),veh_ts.set(v.spec.wid*3.4,1,bl));veh_m5.premultiply(veh_m4);
          veh_beamIM.setMatrixAt(bmk,veh_m5);veh_beamIM.setColorAt(bmk++,veh_c.setRGB(.5*hl,.46*hl,.36*hl));}}}
    if(d.bar&&bk<60){const [bx,by,bz]=d.bar;veh_barIM.setMatrixAt(bk,veh_m4);
      const ch=v.mode==='chase';veh_barIM.setColorAt(bk,ch?veh_c.setRGB(flash?1:.15,flash?.4:.4,flash?.15:1):veh_c.setRGB(.35,.35,.35));bk++;
      if(ch){const red=flash;veh_lamp(veh_m4,red?bx-.31:bx+.31,by,bz,2.2,1.4,red?0xff2020:0x2060ff,0);veh_lamp(veh_m4,red?bx-.31:bx+.31,by,bz,2.2,1.4,red?0xff2020:0x2060ff,Math.PI);
        if(flash2)veh_lamp(veh_m4,bx,by+.01,bz+.1,3.4,2.2,0xffffff,Math.PI/2);}}}
  for(const k in VEH_POOL){const P=VEH_POOL[k];P.near.count=P.nk;P.far.count=P.fk;
    P.wheel.count=P.wk;for(const m of[P.near,P.far,P.wheel]){m.instanceMatrix.needsUpdate=true;m.instanceColor.needsUpdate=true;}}
  veh_poleIM.count=pk;veh_poleIM.instanceMatrix.needsUpdate=true;
  veh_lampIM.count=veh_lk;veh_lampIM.instanceMatrix.needsUpdate=true;if(veh_lampIM.instanceColor)veh_lampIM.instanceColor.needsUpdate=true;
  veh_barIM.count=bk;veh_barIM.instanceMatrix.needsUpdate=true;if(veh_barIM.instanceColor)veh_barIM.instanceColor.needsUpdate=true;
  veh_blobIM.count=blk;veh_blobIM.instanceMatrix.needsUpdate=true;
  veh_beamIM.count=bmk;veh_beamIM.instanceMatrix.needsUpdate=true;if(veh_beamIM.instanceColor)veh_beamIM.instanceColor.needsUpdate=true;}
window.veh_stats=()=>{if(!veh_ready)return null;let t=0,calls=0;for(const k in VEH_POOL){const P=VEH_POOL[k];t+=P.near.count*veh_TRIS[k][0]+P.far.count*veh_TRIS[k][1]+P.wheel.count*veh_TRIS[k][2];calls+=(P.near.count?1:0)+(P.far.count?1:0)+(P.wheel.count?1:0);}
  t+=veh_poleIM.count*veh_poleIM.geometry.attributes.position.count/3;calls+=(veh_poleIM.count?1:0)+(veh_barIM.count?1:0)+(veh_lampIM.count?1:0)+(veh_blobIM.count?1:0);
  return {frameVehicleTris:Math.round(t),approxCalls:calls,model:veh_TRIS};};
