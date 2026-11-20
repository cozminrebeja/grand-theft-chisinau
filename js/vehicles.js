'use strict';
// Vehicles: Blender-made low-poly models (tools/blender/cars.py → models/cars.glb, loaded by models.js), instanced pools
// (near model + far LOD with baked wheels), separate instanced wheels that spin + steer, brake/reverse lamp glows,
// police light bar, trolleybus poles, per-frame instance compaction. Owner: VEHICLES agent.
// Shading: MeshPhysical paint (clear-coat, PMREM env reflections) driven by per-vertex roughness/metal/coat/tint
// attributes picked from the glTF material names ('paint' is tinted per car, 'glass', 'chrome', 'dec_*' = atlas decals).
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

// ================= decal atlas (plates, route boards, police text, taxi sign) =================
const veh_AW=1024,veh_AH=512,veh_COLS=8,veh_COLW=veh_AW/veh_COLS;
const veh_ROUTES=['105','112','117','121','125','135','156','192'];
const veh_TROUTES=['1','3','4','8','10','22','24','30']; // trolleybus routes, one per atlas column (picked by aVar)
const veh_atlas=(()=>{const cv=document.createElement('canvas');cv.width=veh_AW;cv.height=veh_AH;const g=cv.getContext('2d');
  g.fillStyle='#ffffff';g.fillRect(0,0,veh_AW,veh_AH);
  const L='ABCEHKMOPTX';
  for(let k=0;k<veh_COLS;k++){const x=k*veh_COLW;
    // plate 0..30
    g.fillStyle='#fdfdfb';g.fillRect(x+2,2,124,28);g.strokeStyle='#111';g.lineWidth=2;g.strokeRect(x+3,3,122,26);
    g.fillStyle='#1f4fb5';g.fillRect(x+4,4,18,24);g.fillStyle='#ffd200';g.font='bold 7px Arial';g.textAlign='center';g.fillText('MD',x+13,25);
    g.fillStyle='#0046ae';g.fillRect(x+7,7,4,9);g.fillStyle='#ffd200';g.fillRect(x+11,7,4,9);g.fillStyle='#cc092f';g.fillRect(x+15,7,4,9);
    const txt=L[(k*3)%L.length]+L[(k*5+2)%L.length]+L[(k*7+4)%L.length]+' '+String(100+((k*137)%899));
    g.fillStyle='#111';g.font='bold 20px Arial';g.textAlign='center';g.textBaseline='middle';g.fillText(txt,x+72,17);
    // rutieră LED board 34..82
    g.fillStyle='#0c0c0c';g.fillRect(x+2,34,124,46);g.fillStyle='#ff9a1a';g.font='900 34px Arial';g.fillText(veh_ROUTES[k],x+64,58);
    g.fillStyle='rgba(255,154,26,.25)';for(let yy=36;yy<80;yy+=3)g.fillRect(x+2,yy,124,1);
    // police text 86..118 (white on blue)
    g.fillStyle='#1f4fa8';g.fillRect(x,86,128,32);g.fillStyle='#fff';g.font='900 22px Arial';g.fillText('POLIȚIA',x+64,103);
    // route card 122..170 (white card black number)
    g.fillStyle='#fbfbf6';g.fillRect(x+6,122,116,48);g.strokeStyle='#c22';g.lineWidth=3;g.strokeRect(x+8,124,112,44);g.fillStyle='#111';g.font='900 30px Arial';g.fillText(veh_ROUTES[k],x+64,142);
    g.font='bold 9px Arial';g.fillText('CENTRU',x+64,162);
    // police hood/rear text 174..198 (blue on white)
    g.fillStyle='#fff';g.fillRect(x,174,128,24);g.fillStyle='#1f4fa8';g.font='900 19px Arial';g.fillText('POLIȚIA',x+64,187);
    // taxi sign 202..242 (black on yellow, checker strip)
    g.fillStyle='#ffd23f';g.fillRect(x,202,128,40);g.fillStyle='#111';g.font='900 27px Arial';g.fillText('TAXI',x+64,218);
    for(let i=0;i<16;i++){g.fillRect(x+i*8,i%2?234:238,8,4);}
    // trolleybus route board 246..278 (orange on black)
    const tr=veh_TROUTES[k],dest=tr==='22'||tr==='4'?'BD. DACIA':tr==='10'||tr==='24'?'STR. MIORIȚA':'CENTRU';
    g.fillStyle='#0b0b0b';g.fillRect(x,246,128,32);g.fillStyle='#ff9a1a';g.textAlign='left';g.font='900 24px Arial';g.fillText(tr,x+5,263);
    g.font='bold 12px Arial';g.fillText(dest,x+(tr.length>1?36:24),263);g.textAlign='center';
    g.fillStyle='rgba(255,154,26,.2)';for(let yy=247;yy<278;yy+=3)g.fillRect(x,yy,128,1);
  }
  const t=new THREE.CanvasTexture(cv);t.anisotropy=renderer.capabilities.getMaxAnisotropy();return t;})();
const veh_px=(x0,y0,x1,y1)=>[x0/veh_AW,1-y1/veh_AH,x1/veh_AW,1-y0/veh_AH];
const veh_UV={plate:veh_px(2,2,126,30),led:veh_px(2,34,126,80),pol:veh_px(0,86,128,118),card:veh_px(6,122,122,170),polw:veh_px(0,174,128,198),taxi:veh_px(2,203,126,241),tled:veh_px(0,246,128,278)};
const veh_WU=(veh_AW-40)/veh_AW,veh_WV=1-(veh_AH-10)/veh_AH; // white texel (col 7 bottom, never decal-shifted)

// ================= geometry builder with material attributes =================
const veh_nm=new THREE.Matrix3(),veh_v=new THREE.Vector3(),veh_n=new THREE.Vector3(),veh_c=new THREE.Color();
class veh_B{
  constructor(){this.p=[];this.n=[];this.c=[];this.uv=[];this.aT=[];this.aR=[];this.aM=[];this.aC=[];this.aD=[];}
  add(geo,m,color,o){o=o||{};const g=geo.index?geo.toNonIndexed():geo;const P=g.attributes.position,N=g.attributes.normal,U=g.attributes.uv;
    m=m||veh_I;veh_nm.getNormalMatrix(m);veh_c.set(color);const t=o.t||0,ro=o.ro!=null?o.ro:.5,me=o.me||0,co=o.co||0,dec=o.dec?1:0,ur=o.uvr;
    const flip=m.determinant()<0;
    for(let k=0;k<P.count;k+=3)for(let q=0;q<3;q++){const i=flip?k+(q===0?0:3-q):k+q;
      veh_v.fromBufferAttribute(P,i).applyMatrix4(m);veh_n.fromBufferAttribute(N,i).applyMatrix3(veh_nm).normalize();
      this.p.push(veh_v.x,veh_v.y,veh_v.z);this.n.push(veh_n.x,veh_n.y,veh_n.z);this.c.push(veh_c.r,veh_c.g,veh_c.b);
      if(ur&&U)this.uv.push(ur[0]+U.getX(i)*(ur[2]-ur[0]),ur[1]+U.getY(i)*(ur[3]-ur[1]));else this.uv.push(veh_WU,veh_WV);
      this.aT.push(t);this.aR.push(ro);this.aM.push(me);this.aC.push(co);this.aD.push(dec);}}
  geo(){const g=new THREE.BufferGeometry(),F=(a,n)=>new THREE.Float32BufferAttribute(a,n);
    g.setAttribute('position',F(this.p,3));g.setAttribute('normal',F(this.n,3));g.setAttribute('color',F(this.c,3));g.setAttribute('uv',F(this.uv,2));
    g.setAttribute('aTint',F(this.aT,1));g.setAttribute('aRough',F(this.aR,1));g.setAttribute('aMetal',F(this.aM,1));g.setAttribute('aCoat',F(this.aC,1));g.setAttribute('aDec',F(this.aD,1));
    g.computeBoundingSphere();return g;}
  tris(){return this.p.length/9;}
}
const veh_I=new THREE.Matrix4();
const veh_q=new THREE.Quaternion(),veh_e=new THREE.Euler(),veh_s3=new THREE.Vector3(),veh_p3=new THREE.Vector3();
const veh_M=(x,y,z,ry=0,rx=0,rz=0,sx=1,sy=1,sz=1)=>new THREE.Matrix4().compose(veh_p3.set(x,y,z),veh_q.setFromEuler(veh_e.set(rx,ry,rz,'YXZ')),veh_s3.set(sx,sy,sz));
// shading per glTF material name (t = takes the per-car paint tint); anything else is a flat c_rrggbb colour
const veh_MAT={paint:{t:1,ro:.28,me:.12,co:1},glass:{ro:.04,me:.35,co:1},chrome:{ro:.12,me:1,co:.4}},veh_MAT0={ro:.62,me:0,co:.12};

function veh_physMat(extra){
  const m=new THREE.MeshPhysicalMaterial(Object.assign({vertexColors:true,map:veh_atlas,roughness:1,metalness:1,clearcoat:1,clearcoatRoughness:.05,envMap:veh_env,envMapIntensity:.6},extra||{}));
  m.onBeforeCompile=sh=>{
    sh.vertexShader='attribute float aTint;attribute float aRough;attribute float aMetal;attribute float aCoat;attribute float aDec;attribute float aVar;\nvarying float vRough;varying float vMetal;varying float vCoat;\n'+sh.vertexShader;
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
vRough = aRough; vMetal = aMetal; vCoat = aCoat;`).replace('#include <uv_vertex>','#include <uv_vertex>\n#ifdef USE_UV\nvUv.x += aVar * '+(veh_COLW/veh_AW).toFixed(5)+' * aDec;\n#endif');
    sh.fragmentShader='varying float vRough;varying float vMetal;varying float vCoat;\n'+sh.fragmentShader;
    sh.fragmentShader=sh.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor = vRough;')
      .replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\nmetalnessFactor = vMetal;')
      .replace('#include <lights_physical_fragment>','#include <lights_physical_fragment>\n#ifdef CLEARCOAT\nmaterial.clearcoat *= vCoat;\n#endif');};
  m.customProgramCacheKey=()=>'vehPhys2';return m;}
const veh_bodyMat=veh_physMat();

// ================= model baking (models/cars.glb) =================
// Collision/camera size per model (must match tools/blender/cars.py); wheels, lamps and poles come from the glb.
const veh_DEFS={yaris:{L:3.75,W:1.695},taxi:{L:3.75,W:1.695},logan:{L:4.29,W:1.74},police:{L:4.29,W:1.74},lada:{L:4.13,W:1.62},
  suv:{L:4.0,W:1.735},sprinter:{L:5.91,W:1.99},trolley:{L:12,W:2.55}};
const veh_rel=(node,root)=>{root.updateMatrixWorld(true);return new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(node.matrixWorld);};
const veh_under=(o,top,re)=>{for(;o&&o!==top;o=o.parent)if(re.test(o.name))return true;return false;};
// decal faces: group triangles by plane, give each group 0..1 UVs (u = right, v = up as seen from outside;
// flat decals read from the nearer end of the car); veh_B maps them into the atlas row
function veh_decalUV(geo,m){const g=(geo.index?geo.toNonIndexed():geo.clone()).applyMatrix4(m);const P=g.attributes.position,n=P.count,uv=new Float32Array(n*2);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),N=new THREE.Vector3(),U=new THREE.Vector3(),R=new THREE.Vector3(),groups=new Map();
  for(let i=0;i<n;i+=3){a.fromBufferAttribute(P,i);b.fromBufferAttribute(P,i+1);c.fromBufferAttribute(P,i+2);N.subVectors(b,a).cross(c.clone().sub(a)).normalize();
    const k=[N.x,N.y,N.z].map(v=>Math.round(v*20)).join()+'|'+Math.round(N.dot(a)*40);let G=groups.get(k);if(!G)groups.set(k,G={n:N.clone(),z:a.z,t:[]});G.t.push(i);}
  for(const G of groups.values()){N.copy(G.n);if(Math.abs(N.y)>.7)U.set(0,0,G.z>0?-1:1);else U.set(0,1,0);U.addScaledVector(N,-U.dot(N)).normalize();R.crossVectors(U,N);
    let u0=1e9,u1=-1e9,v0=1e9,v1=-1e9;for(const i of G.t)for(let q=0;q<3;q++){a.fromBufferAttribute(P,i+q);const u=a.dot(R),v=a.dot(U);u0=Math.min(u0,u);u1=Math.max(u1,u);v0=Math.min(v0,v);v1=Math.max(v1,v);}
    for(const i of G.t)for(let q=0;q<3;q++){a.fromBufferAttribute(P,i+q);uv[(i+q)*2]=(a.dot(R)-u0)/(u1-u0||1);uv[(i+q)*2+1]=(a.dot(U)-v0)/(v1-v0||1);}}
  g.setAttribute('uv',new THREE.BufferAttribute(uv,2));return g;}
// every mesh under node into B (car space = relative to `space`, default node), skipping subtrees whose name matches skip
function veh_bake(B,node,space,skip,m0){mdl_each(node,(g,m,mt,mesh)=>{if(skip&&veh_under(mesh,node,skip))return;
  let mm=space&&space!==node?veh_rel(node,space).multiply(m):m;if(m0)mm=new THREE.Matrix4().multiplyMatrices(m0,mm);const nm=mt.name||'';
  if(nm.startsWith('dec_')&&veh_UV[nm.slice(4)]){B.add(veh_decalUV(g,mm),null,0xffffff,{dec:1,uvr:veh_UV[nm.slice(4)],ro:.45,co:.5});return;}
  B.add(g,mm,mt.color.getHex(),veh_MAT[nm]||veh_MAT0);});return B;}
const veh_child=(root,suf)=>root&&root.getObjectByName(root.name+suf);

// ================= pools =================
const veh_NEAR=130,veh_FAR=640,veh_NEAR2=veh_NEAR*veh_NEAR,veh_FAR2=veh_FAR*veh_FAR;
const VEH_POOL={};let veh_TRIS={},veh_WHEEL=null,veh_WT={},veh_barIM=null,veh_poleIM=null,veh_ready=false;
function veh_im(geo,mat,cap,inst){const m=new THREE.InstancedMesh(geo,mat,cap);m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);m.frustumCulled=false;m.count=0;m.castShadow=true;m.receiveShadow=true;
  m.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(cap*3).fill(1),3);m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  if(inst){const a=new THREE.InstancedBufferAttribute(new Float32Array(cap),1);a.setUsage(THREE.DynamicDrawUsage);geo.setAttribute('aVar',a);}
  scene.add(m);return m;}
// built on the first makeVehicle(), i.e. after main() has awaited mdl_preload(); without cars.glb the cars are plain boxes
function veh_init(){if(veh_ready)return;veh_ready=true;
  const unitWheel=n=>{const B=new veh_B();if(n)veh_bake(B,n);else B.add(CYL(1,1,1,8).rotateZ(Math.PI/2),null,0x1c1c1c,veh_MAT0);return B.geo();};
  veh_WHEEL={alloy:veh_im(unitWheel(mdl_get('cars','wheel_alloy')),veh_bodyMat,460,false),steel:veh_im(unitWheel(mdl_get('cars','wheel_steel')),veh_bodyMat,460,false)};
  for(const k in veh_WHEEL){veh_WHEEL[k].k=0;veh_WT[k]=veh_WHEEL[k].geometry.attributes.position.count/3;}
  const farW=mdl_get('cars','wheel_far');
  for(const name in veh_DEFS){const root=mdl_get('cars',name),D=veh_DEFS[name];
    let d;try{d=root&&JSON.parse(root.userData.car);}catch(e){d=null;}
    if(!d){d={L:D.L,W:D.W,wheel:{r:.32,tw:.2,zf:D.L*.3,zr:-D.L*.3,x:D.W/2-.12,style:'steel'},tail:[],head:[]};if(root)console.warn('cars.glb: no props for',name);}
    const hi=new veh_B(),lo=new veh_B(),body=veh_child(root,'_body');
    if(root){veh_bake(hi,root,root,/^(police_bar|trolley_pole)$/);if(body)veh_bake(lo,body,root);}
    else for(const B of[hi,lo])B.add(BOX(D.W,1.1,D.L),veh_M(0,.9,0),0xffffff,veh_MAT.paint);
    const W=d.wheel;for(const z of[W.zf,W.zr])for(const s of[1,-1]){const m=veh_M(s*W.x,W.r,z,s<0?Math.PI:0,0,0,W.tw,W.r,W.r);
      if(farW)veh_bake(lo,farW,null,null,m);else lo.add(CYL(1,1,1,8).rotateZ(Math.PI/2),m,0x1c1c1c,veh_MAT0);}
    const tr=name==='trolley',hg=hi.geo(),lg=lo.geo();
    VEH_POOL[name]={d,near:veh_im(hg,veh_bodyMat,tr?24:90,true),far:veh_im(lg,veh_bodyMat,tr?24:260,true),nk:0,fk:0,nearR2:veh_NEAR2*(tr?1.6:1)};
    veh_TRIS[name]=[hg.attributes.position.count/3,lg.attributes.position.count/3];}
  // police light bar (red | blue halves; flashing = per-instance colour)
  {const n=mdl_get('cars','police_bar'),B=new veh_B();if(n)veh_bake(B,n,mdl_get('cars','police'));
   veh_barIM=new THREE.InstancedMesh(B.geo(),new THREE.MeshBasicMaterial({vertexColors:true}),60);veh_barIM.frustumCulled=false;veh_barIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);veh_barIM.setColorAt(0,veh_c.set(0xffffff));veh_barIM.count=0;scene.add(veh_barIM);}
  // trolleybus current-collector poles (pivot at the origin, lifted by v.poles[i].rotation.x — see updPoles in game.js)
  {const n=mdl_get('cars','trolley_pole'),B=new veh_B();if(n)veh_bake(B,n);else B.add(CYL(.03,.04,6.2,6).rotateX(Math.PI/2).translate(0,0,-3.1),null,0x262626,veh_MAT0);
   veh_poleIM=veh_im(B.geo(),veh_bodyMat,60,false);}
}
const veh_glowTex=ctex(64,64,g=>{const gr=g.createRadialGradient(32,32,2,32,32,32);gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(.25,'rgba(255,255,255,.55)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(0,0,64,64);},false);
const veh_lampIM=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:veh_glowTex,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}),700);
veh_lampIM.frustumCulled=false;veh_lampIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);veh_lampIM.setColorAt(0,veh_c.set(0));veh_lampIM.count=0;veh_lampIM.renderOrder=3;scene.add(veh_lampIM);
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
    veh_rot:Math.random()*6,veh_ps:0,veh_brk:0,veh_var:Math.floor(Math.random()*veh_COLS),veh_st:0};
  v.veh_pool=VEH_POOL[sp.model];v.paint=paint!=null?paint:type==='taxi'?(Math.random()<.85?0xf2c318:0xf4f4f2):mpick(veh_PAINTS[sp.model]);v.veh_col=new THREE.Color(v.paint);
  if(v.veh_pool.d.poles)v.poles=v.veh_pool.d.poles.map(()=>{const o=new THREE.Object3D();o.rotation.x=.33;return o;});
  v.y=veh_sy(x,z,null,Math.sin(h),Math.cos(h));v.pitch=0;v.roll=0;vehicles.push(v);return v;}
function removeVehicle(v){const i=vehicles.indexOf(v);if(i>=0)vehicles.splice(i,1);}

// ================= per-frame render (instance compaction + LOD) =================
const veh_fr=new THREE.Frustum(),veh_pmx=new THREE.Matrix4(),veh_sph=new THREE.Sphere(),veh_m4=new THREE.Matrix4(),veh_m5=new THREE.Matrix4(),veh_qq=new THREE.Quaternion(),veh_up=new THREE.Vector3(0,1,0),veh_one=new THREE.Vector3(1,1,1),veh_tp=new THREE.Vector3(),veh_ts=new THREE.Vector3();
const veh_qy=new THREE.Quaternion(),veh_qx=new THREE.Quaternion(),veh_qs=new THREE.Quaternion(),veh_X=new THREE.Vector3(1,0,0);
let veh_lk=0;
function veh_lamp(base,x,y,z,sx,sy,col,ry){veh_m5.compose(veh_tp.set(x,y,z),veh_qq.setFromAxisAngle(veh_up,ry||0),veh_ts.set(sx,sy,1));veh_m5.premultiply(base);if(veh_lk<700){veh_lampIM.setMatrixAt(veh_lk,veh_m5);veh_lampIM.setColorAt(veh_lk,veh_c.set(col));veh_lk++;}}
function veh_wheelsOf(v,base,W){const im=veh_WHEEL[W.style]||veh_WHEEL.steel;
  for(const az of[W.zf,W.zr])for(const s of[1,-1]){if(im.k>=460)return;const front=az===W.zf;
    veh_qy.setFromAxisAngle(veh_up,(front?-v.steer*.42:0)+(s<0?Math.PI:0));veh_qx.setFromAxisAngle(veh_X,s>0?v.veh_rot:-v.veh_rot);veh_qs.multiplyQuaternions(veh_qy,veh_qx);
    veh_m5.compose(veh_tp.set(s*W.x,W.r,az),veh_qs,veh_ts.set(W.tw,W.r,W.r));veh_m5.premultiply(base);im.setMatrixAt(im.k++,veh_m5);}}
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
  for(const k in VEH_POOL){VEH_POOL[k].nk=0;VEH_POOL[k].fk=0;}veh_WHEEL.alloy.k=veh_WHEEL.steel.k=0;veh_lk=0;let bk=0,blk=0,pk=0;
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
    if(near){if(P.nk<P.near.instanceMatrix.count){P.near.setMatrixAt(P.nk,veh_m4);P.near.setColorAt(P.nk,v.veh_col);P.near.geometry.attributes.aVar.setX(P.nk,v.veh_var);P.nk++;}
      veh_wheelsOf(v,veh_m4,d.wheel);}
    else if(P.fk<P.far.instanceMatrix.count){P.far.setMatrixAt(P.fk,veh_m4);P.far.setColorAt(P.fk,v.veh_col);P.far.geometry.attributes.aVar.setX(P.fk,v.veh_var);P.fk++;}
    if(blk<700){veh_m5.compose(veh_tp.set(v.x,v.y+.055,v.z),veh_qq,veh_ts.set(v.spec.wid*1.45,1,v.spec.len*1.12));veh_blobIM.setMatrixAt(blk++,veh_m5);}
    if(v.poles&&pk<60)for(let i=0;i<v.poles.length;i++){const pv=d.poles[i];veh_m5.compose(veh_tp.set(pv[0],pv[1],pv[2]),veh_qs.setFromAxisAngle(veh_X,v.poles[i].rotation.x),veh_one);veh_m5.premultiply(veh_m4);veh_poleIM.setMatrixAt(pk++,veh_m5);}
    if(d2<veh_NEAR2*3){const b=v.veh_brk,rev=sp<-.3,big=v.spec.len>7?1.4:1;
      for(const t of d.tail){const k=.22+b*1.0;veh_lamp(veh_m4,t[0],t[1],t[2],(.36*k+.12)*big,(.22*k+.1)*big,rev?0xbfbfbf:veh_c.setRGB(.95*k,.07*k,.05*k).getHex(),Math.PI);}
      if(moving)for(const t of d.head)veh_lamp(veh_m4,t[0],t[1],t[2],.32*big,.2*big,0x5a5548,0);}
    if(d.bar&&bk<60){const [bx,by,bz]=d.bar;veh_barIM.setMatrixAt(bk,veh_m4);
      const ch=v.mode==='chase';veh_barIM.setColorAt(bk,ch?veh_c.setRGB(flash?1:.15,flash?.4:.4,flash?.15:1):veh_c.setRGB(.35,.35,.35));bk++;
      if(ch){const red=flash;veh_lamp(veh_m4,red?bx-.31:bx+.31,by,bz,2.2,1.4,red?0xff2020:0x2060ff,0);veh_lamp(veh_m4,red?bx-.31:bx+.31,by,bz,2.2,1.4,red?0xff2020:0x2060ff,Math.PI);
        if(flash2)veh_lamp(veh_m4,bx,by+.01,bz+.1,3.4,2.2,0xffffff,Math.PI/2);}}}
  for(const k in VEH_POOL){const P=VEH_POOL[k];P.near.count=P.nk;P.far.count=P.fk;
    for(const m of[P.near,P.far]){m.instanceMatrix.needsUpdate=true;m.instanceColor.needsUpdate=true;m.geometry.attributes.aVar.needsUpdate=true;}}
  for(const k in veh_WHEEL){const m=veh_WHEEL[k];m.count=m.k;m.instanceMatrix.needsUpdate=true;}
  veh_poleIM.count=pk;veh_poleIM.instanceMatrix.needsUpdate=true;
  veh_lampIM.count=veh_lk;veh_lampIM.instanceMatrix.needsUpdate=true;if(veh_lampIM.instanceColor)veh_lampIM.instanceColor.needsUpdate=true;
  veh_barIM.count=bk;veh_barIM.instanceMatrix.needsUpdate=true;if(veh_barIM.instanceColor)veh_barIM.instanceColor.needsUpdate=true;
  veh_blobIM.count=blk;veh_blobIM.instanceMatrix.needsUpdate=true;}
window.veh_stats=()=>{if(!veh_ready)return null;let t=0,calls=0;for(const k in VEH_POOL){const P=VEH_POOL[k];t+=P.near.count*veh_TRIS[k][0]+P.far.count*veh_TRIS[k][1];calls+=(P.near.count?1:0)+(P.far.count?1:0);}
  for(const k in veh_WHEEL){t+=veh_WHEEL[k].count*veh_WT[k];calls+=veh_WHEEL[k].count?1:0;}
  t+=veh_poleIM.count*veh_poleIM.geometry.attributes.position.count/3;calls+=(veh_poleIM.count?1:0)+(veh_barIM.count?1:0)+(veh_lampIM.count?1:0)+(veh_blobIM.count?1:0);
  return {frameVehicleTris:Math.round(t),approxCalls:calls,model:veh_TRIS,wheelTris:veh_WT};};
