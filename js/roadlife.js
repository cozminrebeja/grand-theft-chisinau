'use strict';
// Road life (owner: roadlife): traffic lights at the big junctions, rush hour from the game clock (env_gameMin), AI
// drivers that honk / change lane / get out and argue when you block them, and ambulances + fire trucks with sirens
// that make traffic pull over to the right.
// Hooks: game.js updAI → aiTarget(v,a,target,dt) returns the capped target speed, aiPost(v,dt) adds a lateral offset
// after the car snapped to its lane; frame → roadUpdate(dt,player). Debug: window.__road (lights, em('amb'|'fire'), rush).

const RL_L_RAGE=['Ce stai în mijlocul drumului, mă?!','Ai cumpărat permisul la piață?','Mută mașina, că te mut eu!','Mișcă, frate, am treabă!'];
const RL_L_RAGE_END=['Fugi, fugi, că te prind eu!','Lasă, că ne mai vedem noi.'];
const rl_hour=()=>typeof env_gameMin!=='undefined'?(env_gameMin/60)%24:12;
let rl_t=0,rl_dead=false;
const rl_v3=new THREE.Vector3();

// ================= sound =================
function rl_snd(x,z,gain){const a=typeof fx_AC!=='undefined'?fx_AC:null;if(!a||typeof fx_master==='undefined'||!fx_master)return null;
  const dx=x-camera.position.x,dz=z-camera.position.z,d=Math.hypot(dx,dz),v=gain/(1+d*.06);if(v<.003)return null;
  const g=a.createGain();g.gain.value=0;let out=g;
  if(a.createStereoPanner){const pn=a.createStereoPanner();camera.getWorldDirection(rl_v3);pn.pan.value=clamp((dx*-rl_v3.z+dz*rl_v3.x)/(d+1),-1,1)*.8;g.connect(pn);out=pn;}
  out.connect(fx_master);return {a,g,v,t:a.currentTime};}
function rl_horn(v,long){const s=rl_snd(v.x,v.z,.075);if(!s)return;const {a,g,v:vol,t}=s,lp=a.createBiquadFilter();lp.type='lowpass';lp.frequency.value=1500;lp.connect(g);
  const f=v.rl_hf||(v.rl_hf=mpick([370,392,415,440,466])),pat=long?[[0,.9]]:Math.random()<.5?[[0,.18],[.26,.3]]:[[0,.45]];let end=0;
  for(const [t0,l] of pat){g.gain.setValueAtTime(0,t+t0);g.gain.linearRampToValueAtTime(vol,t+t0+.02);g.gain.setValueAtTime(vol,t+t0+l);g.gain.linearRampToValueAtTime(0,t+t0+l+.04);end=Math.max(end,t0+l+.06);}
  for(const m of[1,1.26]){const o=a.createOscillator();o.type='square';o.frequency.value=f*m;o.connect(lp);o.start(t);o.stop(t+end);}}

// ================= traffic lights =================
const RL_MAJOR=/Ștefan cel Mare|Ismail|Mihai Eminescu|Bănulescu|Pușkin|31 August|Grigore Vieru|Dacia|Decebal|Calea Ieșilor|Mircea cel Bătrân|Alecu Russo|Renașterii|Cuza[- ]Vodă|Traian|Calea Orheiului|Hâncești|Columna|Vasile Alecsandri|Kogălniceanu|Negruzzi|Calea Basarabiei|Albișoara|Ion Creangă|Alba[- ]Iulia|Burebista|Cantemir|Independenței|Muncești|Calea Moșilor|Vadul lui Vodă|Tighina|Armenească|Bulgară|Sfatul Țării/;
const rl_major=e=>e.w>=11||(e.w>=7&&RL_MAJOR.test(e.name||''));
const rl_ctrlOf=new Map(),rl_ctrls=[],rl_seen=new Set();
const RL_G=[16,12],RL_Y=3,RL_AR=1.5,RL_T=RL_G[0]+RL_G[1]+2*(RL_Y+RL_AR);
function rl_state(C,grp){const t=(rl_t+C.off)%RL_T,a0=RL_G[0],a1=a0+RL_Y,a2=a1+RL_AR,b0=a2+RL_G[1],b1=b0+RL_Y;
  if(grp===0)return t<a0?'g':t<a1?'y':'r';return t>=a2&&t<b0?'g':t>=b0&&t<b1?'y':'r';}
// scan graph nodes around the player; nodes ≥3 ways with a major road become (clusters of) controlled junctions
function rl_scan(P){const R=480;const fresh=[];
  for(let i=Math.floor((P.x-R)/EG);i<=Math.floor((P.x+R)/EG);i++)for(let j=Math.floor((P.z-R)/EG);j<=Math.floor((P.z+R)/EG);j++){const c=egrid.get(gk(i,j));if(!c)continue;
    for(const e of c)for(const n of[e.a,e.b]){if(rl_seen.has(n))continue;rl_seen.add(n);const L=adj.get(n)||[];
      if(L.length<3||!L.some(rl_major)||L.filter(f=>f.w>=6).length<3)continue;
      const p=nodePos[n];let C=null;for(const D of rl_ctrls)if(Math.hypot(D.cx-p[0],D.cz-p[1])<34){C=D;break;}
      if(!C){C={id:rl_ctrls.length,nodes:new Set(),cx:p[0],cz:p[1],off:Math.random()*RL_T,ready:false,mesh:null,ap:new Map(),heads:[]};rl_ctrls.push(C);}
      C.nodes.add(n);rl_ctrlOf.set(n,C);let sx=0,sz=0;for(const m of C.nodes){sx+=nodePos[m][0];sz+=nodePos[m][1];}C.cx=sx/C.nodes.size;C.cz=sz/C.nodes.size;C.ready=false;fresh.push(C);}}
  for(const C of new Set(fresh))rl_setup(C);}
function rl_setup(C){C.ap.clear();C.heads.length=0;const L=[];
  for(const n of C.nodes)for(const e of adj.get(n)||[]){const m=e.a===n?e.b:e.a;if(C.nodes.has(m))continue;
    const d=e.b===n?1:-1;if(d>0?e.ow===-1:e.ow===1)continue; // traffic can't arrive this way
    const P=e.pts,q=d>0?P[P.length-2]:P[1],p=nodePos[n],ox=q[0]-p[0],oz=q[1]-p[1],l=Math.hypot(ox,oz)||1;L.push({e,n,ox:ox/l,oz:oz/l,ax:((Math.atan2(ox,oz)%Math.PI)+Math.PI)%Math.PI});}
  if(L.length<2){C.ready=false;return;}
  const ref=L.reduce((a,b)=>b.e.w>a.e.w?b:a);C.refAx=ref.ax;
  for(const A of L){let d=Math.abs(A.ax-ref.ax);d=Math.min(d,Math.PI-d);A.grp=d<Math.PI/4?0:1;}
  if(!L.some(A=>A.grp===1)){C.ready=false;return;}
  for(const A of L){const other=L.filter(B=>B.grp!==A.grp).reduce((m,B)=>Math.max(m,B.e.w),0),nd=Math.hypot(nodePos[A.n][0]-C.cx,nodePos[A.n][1]-C.cz);
    A.stopD=other/2+2.5+Math.max(0,nd*.3);C.ap.set(A.e.i+'_'+A.n,A);
    if(A.e.w>=6){const rx=A.oz,rz=-A.ox,o=A.e.ow?A.e.w/2+.8:A.e.w/2+.8,p=nodePos[A.n];
      C.heads.push({x:p[0]+A.ox*A.stopD+rx*o,z:p[1]+A.oz*A.stopD+rz*o,h:Math.atan2(A.ox,A.oz),grp:A.grp});}}
  // drop heads standing inside buildings
  C.heads=C.heads.filter(H=>!pushOut(H.x,H.z,.2));
  C.ready=true;if(C.mesh){scene.remove(C.mesh);C.mesh.geometry.dispose();C.mesh=null;}}
// lamps: one instanced disc set (on = bright, off = dark) + additive glow quads on the lit ones
const RL_LN=900;
const rl_lampIM=new THREE.InstancedMesh(new THREE.CircleGeometry(.11,12),new THREE.MeshBasicMaterial({toneMapped:false}),RL_LN);
const rl_glowIM=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:typeof veh_glowTex!=='undefined'?veh_glowTex:null,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}),RL_LN/3);
for(const m of[rl_lampIM,rl_glowIM]){m.frustumCulled=false;m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);m.setColorAt(0,new THREE.Color(0));m.count=0;scene.add(m);}
rl_glowIM.renderOrder=3;
const rl_m4=new THREE.Matrix4(),rl_q=new THREE.Quaternion(),rl_up=new THREE.Vector3(0,1,0),rl_p=new THREE.Vector3(),rl_s=new THREE.Vector3(),rl_c=new THREE.Color();
const RL_ON=[0xff2a1a,0xffb000,0x22ff7a],RL_OFF=[0x2a0c0a,0x2a1e08,0x0a2414];
function rl_lights(P){let n=0,g=0;const cx=camera.position.x,cz=camera.position.z;
  for(const C of rl_ctrls){if(!C.ready)continue;const d=Math.hypot(C.cx-cx,C.cz-cz);
    if(d>600){if(C.mesh){scene.remove(C.mesh);C.mesh.geometry.dispose();C.mesh=null;}continue;}
  }
  const fl=(rl_t*1.25|0)%2;
  if(typeof WORLD!=='undefined'&&WORLD.tiles)for(const t of WORLD.tiles.values()){if(t.state!=='ready'||!t.st_tl)continue;
    for(const H of t.st_tl){const dx=H.x-cx,dz=H.z-cz,d=Math.hypot(dx,dz);if(d>300)continue;
      if(H.C===undefined||(H.C===null&&rl_t-H.ct>4)){H.ct=rl_t;H.C=null;let bd=40;for(const C of rl_ctrls){if(!C.ready)continue;const k=Math.hypot(C.cx-H.cx,C.cz-H.cz);if(k<bd){bd=k;H.C=C;}}
        if(H.C){let a=((Math.atan2(H.ax,H.az)%Math.PI)+Math.PI)%Math.PI,df=Math.abs(a-H.C.refAx);df=Math.min(df,Math.PI-df);H.grp=df<Math.PI/4?0:1;H.C.vis=true;}}
      const st=H.C&&H.C.ready?rl_state(H.C,H.grp):(fl?'y':'off'),c=Math.cos(H.face),s=Math.sin(H.face);rl_q.setFromAxisAngle(rl_up,H.face);
      for(let k=0;k<3;k++){if(n>=RL_LN)break;const on=(k===0&&st==='r')||(k===1&&st==='y')||(k===2&&st==='g'),ly=H.y+.3-k*.3+(H.gy||(H.gy=groundY(H.x,H.z)));
        rl_p.set(H.x+.175*s,ly,H.z+.175*c);rl_m4.compose(rl_p,rl_q,rl_s.set(1,1,1));rl_lampIM.setMatrixAt(n,rl_m4);rl_lampIM.setColorAt(n,rl_c.set(on?RL_ON[k]:RL_OFF[k]));n++;
        if(on&&g<RL_LN/3&&d<220){rl_p.set(H.x+.2*s,ly,H.z+.2*c);rl_m4.compose(rl_p,rl_q,rl_s.set(.85,.85,1));rl_glowIM.setMatrixAt(g,rl_m4);rl_glowIM.setColorAt(g,rl_c.set(RL_ON[k]).multiplyScalar(.55));g++;}}}}
  rl_lampIM.count=n;rl_glowIM.count=g;for(const m of[rl_lampIM,rl_glowIM]){m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;}}
// speed cap for an AI car approaching a red / amber light (red-runners and emergency vehicles ignore them)
function rl_lightCap(v,a,target){if(v.rl_em)return target;const e=a.e,n=a.dir>0?e.b:e.a,C=rl_ctrlOf.get(n);if(!C||!C.ready)return target;
  if(C.nodes.has(a.dir>0?e.a:e.b))return target; // already inside the junction
  if(!C.vis)return target; // only where the street has visible lights
  const A=C.ap.get(e.i+'_'+n);if(!A)return target;const st=rl_state(C,A.grp);if(st==='g')return target;
  const dn=a.rem-2,stop=A.stopD+v.spec.len/2;if(dn<stop-1.5)return target;
  if(st==='y'&&dn<stop+Math.max(0,v.speed)*1.2)return target;
  if(v.rl_rr==null)v.rl_rr=Math.random()<.05;if(v.rl_rr&&st==='r'&&dn<stop+25)return target;
  return Math.min(target,Math.max(0,(dn-stop)*1.1));}

// ================= blocked by the player: honk, change lane, road rage =================
function rl_lane(v,a,dk){const e=a.e,k=a.k+dk;if(a.kind!=='car'||k<0||k>=e.nPer)return false;
  const o1=laneOff(e,'car',a.k),o2=laneOff(e,'car',k),dl=o2-o1,fx=Math.sin(v.h),fz=Math.cos(v.h),rx=-fz,rz=fx,qx=a.x+rx*dl,qz=a.z+rz*dl;
  for(const o of vehicles){if(o===v)continue;if(Math.abs(o.x-qx)<12&&Math.abs(o.z-qz)<12){const ox=o.x-qx,oz=o.z-qz,ah=ox*fx+oz*fz,lat=Math.abs(ox*rx+oz*rz);if(lat<2.2&&ah>-(v.spec.len/2+o.spec.len/2+3)&&ah<v.spec.len/2+o.spec.len/2+8)return false;}}
  const P=edgePath(e,a.dir,o2);let j=P.length-1;for(let i=0;i<P.length;i++){if((P[i][0]-qx)*fx+(P[i][1]-qz)*fz>1.5){j=i;break;}}
  a.k=k;a.path=[[qx,qz],...P.slice(j)];a.seg=0;a.x=qx;a.z=qz;v.rl_lc=(v.rl_lc||0)-dl;return true;}
function rl_blocked(v,a,dt,P){const car=P.mode==='car'?P.car:null,fx=Math.sin(v.h),fz=Math.cos(v.h);
  const ob=car||(P.mode==='foot'?P:null);if(!ob)return false;const ox=ob.x-v.x,oz=ob.z-v.z,ah=ox*fx+oz*fz,ol=car?car.spec.len:.5,ow=car?car.spec.wid:.6;
  if(ah<=0||ah>v.spec.len/2+ol/2+9)return false;if(Math.abs(ox*fz-oz*fx)>(v.spec.wid+ow)/2+.3)return false;return !car||Math.abs(car.speed)<1.5;}
function rl_driver(v,a,dt,P,target){
  if(v.rl_rage){rl_rageStep(v,dt,P);return 0;}
  if(!rl_blocked(v,a,dt,P)){v.rl_blk=Math.max(0,(v.rl_blk||0)-dt*2);return target;}
  v.rl_blk=(v.rl_blk||0)+dt;v.rl_hT=(v.rl_hT||0)-dt;
  const atLight=rl_ctrls.some(C=>C.ready&&Math.abs(C.cx-P.x)<45&&Math.abs(C.cz-P.z)<45); // you're probably waiting at the light too
  if(atLight){if(v.rl_blk>4&&v.rl_hT<=0){rl_horn(v,false);v.rl_hT=mr(4,7);}return target;}
  if(v.rl_blk>1.2&&v.rl_hT<=0){rl_horn(v,v.rl_blk>6);v.rl_hT=mr(1.8,3.2);}
  if(v.rl_blk>3.2&&!v.rl_lcTried){v.rl_lcTried=true;if(rl_lane(v,a,-1)||rl_lane(v,a,1)){v.rl_blk=0;return target;}}
  if(v.rl_blk>6.5&&!v.rl_rageDone&&v.type!=='trolley'&&v.type!=='police'&&!v.rl_em){v.rl_rageDone=true;if(P.mode==='car'&&Math.random()<.45&&typeof lf_add==='function')rl_rageStart(v,P);}
  return target;}
function rl_rageStart(v,P){const lx=Math.cos(v.h),lz=-Math.sin(v.h),x=v.x+lx*(v.spec.wid/2+.6),z=v.z+lz*(v.spec.wid/2+.6);if(pushOut(x,z,.3))return;
  const p=lf_add(mpick(['track','man']),x,z,v.h,{armL:0});if(!p)return;p.mv=true;p.solid=true;v.rl_rage={p,t:0,stage:'out',sx:P.car.x,sz:P.car.z,li:0,sayT:0};}
function rl_rageStep(v,dt,P){const R=v.rl_rage,p=R.p;R.t+=dt;R.sayT-=dt;
  if(!lf_P||lf_P[p.i]!==p){v.rl_rage=null;return;}
  const car=P.car;let tx,tz;
  if(R.stage==='out'){if(!car||Math.hypot(car.x-R.sx,car.z-R.sz)>14){R.stage='back';if(typeof lf_say==='function'){lf_sayT=0;lf_say('Șoferul nervos',mpick(RL_L_RAGE_END),.9,'#ff8a65');}}
    else{const lx=Math.cos(car.h),lz=-Math.sin(car.h);tx=car.x+lx*(car.spec.wid/2+.9);tz=car.z+lz*(car.spec.wid/2+.9);
      if(Math.hypot(tx-p.x,tz-p.z)<.6){p.sp=0;p.h=lerpAng(p.h,Math.atan2(car.x-p.x,car.z-p.z),1-Math.exp(-6*dt));p.st.wave=Math.sin(R.t*4)>-.2;
        if(R.sayT<=0&&R.li<3&&typeof lf_say==='function'){lf_sayT=0;lf_say('Șoferul nervos',mpick(RL_L_RAGE),.9,'#ff8a65');R.li++;R.sayT=3;}
        if(R.li>=3&&R.sayT<=0)R.stage='back';tx=null;}}}
  if(R.stage==='back'){p.st.wave=false;const lx=Math.cos(v.h),lz=-Math.sin(v.h);tx=v.x+lx*(v.spec.wid/2+.6);tz=v.z+lz*(v.spec.wid/2+.6);
    if(Math.hypot(tx-p.x,tz-p.z)<.5||R.t>40){lf_del(p);v.rl_rage=null;v.rl_blk=0;return;}}
  if(tx!=null){const dx=tx-p.x,dz=tz-p.z,l=Math.hypot(dx,dz);p.sp=Math.min(R.stage==='back'?2.2:1.8,l*2);p.h=lerpAng(p.h,Math.atan2(dx,dz),1-Math.exp(-8*dt));p.x+=Math.sin(p.h)*p.sp*dt;p.z+=Math.cos(p.h)*p.sp*dt;}
  if(p.down>0){lf_del(p);v.rl_rage=null;}}

// ================= emergency vehicles =================
const rl_em=[];let rl_emT=100,rl_H=null;
const rl_flA=new THREE.MeshBasicMaterial({color:0x3a7aff,toneMapped:false}),rl_flB=new THREE.MeshBasicMaterial({color:0x0a1430,toneMapped:false});
const rl_signMats={};
function rl_sign(text,bg,fg){if(rl_signMats[text])return rl_signMats[text];const c=document.createElement('canvas');c.width=512;c.height=96;const g=c.getContext('2d');g.fillStyle=bg;g.fillRect(0,0,512,96);
  g.fillStyle=fg;g.font='900 62px Arial,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(text,256,52);const t=new THREE.CanvasTexture(c);t.anisotropy=4;
  return rl_signMats[text]=new THREE.MeshLambertMaterial({map:t,transparent:true,alphaTest:.1});}
function rl_deco(kind,v){if(rl_H==null){rl_H=2.55;try{const g=VEH_POOL.sprinter.near.geometry;if(!g.boundingBox)g.computeBoundingBox();rl_H=g.boundingBox.max.y;}catch(e){}}
  const L=v.spec.len,W=v.spec.wid,H=rl_H,grp=new THREE.Group(),b=new Bk(VC),red=0xc8141c,white=0xf4f4f2;
  if(kind==='amb'){for(const s of[1,-1]){b.add(BOX(.02,.2,L*.86),M(s*(W/2+.012),H*.46,0),red);b.add(BOX(.02,.07,L*.86),M(s*(W/2+.012),H*.33,0),0x1a4fd0);
      b.add(BOX(.02,.36,.12),M(s*(W/2+.013),H*.72,-.4),red);b.add(BOX(.02,.12,.36),M(s*(W/2+.013),H*.72,-.4),red);}
    b.add(BOX(W*.7,.2,.02),M(0,H*.5,-L/2-.012),red);}
  else{for(const s of[1,-1]){b.add(BOX(.02,.16,L*.9),M(s*(W/2+.012),H*.42,0),white);}
    for(const x of[.36,-.36])b.add(BOX(.06,.06,L*.82),M(x,H+.3,-.1),0xc8c8cc);for(let z=-L*.38;z<L*.32;z+=.42)b.add(BOX(.72,.04,.04),M(0,H+.3,z),0xc8c8cc);
    for(const z of[L*.3,-L*.38])for(const x of[.36,-.36])b.add(BOX(.05,.25,.05),M(x,H+.13,z),0x555555);}
  b.add(BOX(1.1,.06,.3),M(0,H+.03,L/2-.55),0x222222);
  const m=new THREE.Mesh(b.geo(),VC);grp.add(m);
  for(const [x,mat] of[[.28,rl_flA],[-.28,rl_flB]]){const l=new THREE.Mesh(BOX(.5,.14,.26),mat);l.position.set(x,H+.13,L/2-.55);grp.add(l);}
  const sm=rl_sign(kind==='amb'?'AMBULANȚA':'POMPIERI',kind==='amb'?'rgba(0,0,0,0)':'rgba(0,0,0,0)',kind==='amb'?'#c8141c':'#ffffff');
  for(const s of[1,-1]){const p=new THREE.Mesh(new THREE.PlaneGeometry(L*.55,L*.55*96/512),sm);p.position.set(s*(W/2+.03),H*.6,.25);p.rotation.y=s*Math.PI/2;grp.add(p);}
  if(kind==='amb'){const p=new THREE.Mesh(new THREE.PlaneGeometry(W*.8,W*.8*96/512),sm);p.position.set(0,H*.62,L/2+.04);p.scale.x=-1;grp.add(p);} // mirrored on the front, read in mirrors
  grp.rotation.order='YXZ';scene.add(grp);return grp;}
function rl_siren(kind){const a=typeof fx_AC!=='undefined'?fx_AC:null;if(!a||!fx_master)return null;
  const o=a.createOscillator();o.type=kind==='amb'?'square':'sawtooth';o.frequency.value=700;const bp=a.createBiquadFilter();bp.type='bandpass';bp.frequency.value=1100;bp.Q.value=.7;
  const g=a.createGain();g.gain.value=0;o.connect(bp);bp.connect(g);let pn=null;if(a.createStereoPanner){pn=a.createStereoPanner();g.connect(pn);pn.connect(fx_master);}else g.connect(fx_master);o.start();
  return {a,o,g,pn};}
function rl_emSpawn(P,kind){kind=kind||(Math.random()<.6?'amb':'fire');if(!gtcApi.spawnAI)return null;const v=gtcApi.spawnAI('rutiera','car',{x:P.x,z:P.z,min:170,max:320});if(!v)return null;
  v.paint=kind==='amb'?0xf4f4f0:0xc4161c;v.veh_col=new THREE.Color(v.paint);v.v0=kind==='amb'?16.5:15;v.rl_em=kind;v.rl_rr=true;v.rl_life=0;
  v.rl_g=rl_deco(kind,v);v.rl_s=rl_siren(kind);rl_em.push(v);return v;}
function rl_emKill(v){if(v.rl_g){scene.remove(v.rl_g);v.rl_g.traverse(o=>{if(o.geometry)o.geometry.dispose();});v.rl_g=null;}
  if(v.rl_s){try{v.rl_s.o.stop();v.rl_s.g.disconnect();}catch(e){}v.rl_s=null;}}
function rl_emUpdate(dt,P){
  rl_emT-=dt;if(rl_emT<=0){rl_emT=mr(130,260);if(rl_em.length<2)rl_emSpawn(P);}
  const fl=(rl_t*6|0)%2;rl_flA.color.setHex(fl?0x3a7aff:0x0a1430);rl_flB.color.setHex(fl?0x0a1430:0x3a7aff);
  for(let i=rl_em.length-1;i>=0;i--){const v=rl_em[i];v.rl_life+=dt;const d=Math.hypot(v.x-P.x,v.z-P.z),mine=v===P.car;
    if(!vehicles.includes(v)||(!mine&&(d>480||(v.rl_life>110&&d>190)))){if(vehicles.includes(v)&&!mine)removeVehicle(v);rl_emKill(v);rl_em.splice(i,1);continue;}
    if(v.rl_g){v.rl_g.position.set(v.x,v.y+(v.bump||0),v.z);v.rl_g.rotation.set(-(v.pitch||0),v.h,v.roll||0);}
    const on=v.mode==='ai'||(mine&&v.mode==='player');
    if(v.rl_s){const s=v.rl_s,t=s.a.currentTime,f=v.rl_em==='amb'?((rl_t/.55|0)%2?960:720):700+520*(.5-.5*Math.cos(rl_t/1.9*TAU));s.o.frequency.setTargetAtTime(f,t,.015);
      const dx=v.x-camera.position.x,dz=v.z-camera.position.z,dc=Math.hypot(dx,dz);s.g.gain.setTargetAtTime(on?.055/(1+dc*.035):0,t,.08);
      if(s.pn){camera.getWorldDirection(rl_v3);s.pn.pan.setTargetAtTime(clamp((dx*-rl_v3.z+dz*rl_v3.x)/(dc+1),-1,1)*.7,t,.08);}}
    if(v.mode!=='ai')continue;
    // traffic ahead pulls over to the right; oncoming traffic slows down
    const fx=Math.sin(v.h),fz=Math.cos(v.h);
    for(const o of vehicles){if(o===v||o.mode!=='ai'||o.rl_em||Math.abs(o.x-v.x)>55||Math.abs(o.z-v.z)>55)continue;const ox=o.x-v.x,oz=o.z-v.z,ah=ox*fx+oz*fz,lat=Math.abs(ox*fz-oz*fx),dot=Math.sin(o.h)*fx+Math.cos(o.h)*fz;
      if(ah>0&&ah<50&&lat<5){if(dot>.5)o.rl_yield=2.6;else if(dot<-.5&&ah<30)o.rl_slow=1.5;}}}}
function rl_emTarget(v,a,target){let t=v.v0;if(a.turn>.55&&a.rem<16)t=Math.min(t,a.turn>1.2?6:9);const fx=Math.sin(v.h),fz=Math.cos(v.h);
  for(const o of vehicles){if(o===v||Math.abs(o.x-v.x)>30||Math.abs(o.z-v.z)>30)continue;const ox=o.x-v.x,oz=o.z-v.z,ah=ox*fx+oz*fz;if(ah<=0||ah>v.spec.len/2+o.spec.len/2+14)continue;
    const lat=Math.abs(ox*fz-oz*fx);if(lat>(v.spec.wid+o.spec.wid)/2+.2)continue;if((o.rl_off||0)>1.6)continue;const gap=ah-v.spec.len/2-o.spec.len/2;t=Math.min(t,gap<2.5?0:(gap-2.5)*1.5);
    if(o.mode==='player'&&gap<12){v.rl_hT=(v.rl_hT||0)-.016;if(v.rl_hT<=0){rl_horn(v,true);v.rl_hT=2.5;}}}
  return t;}

// ================= rush hour (AI car count follows the game clock) =================
const RL_RUSH=[[0,.35],[5,.4],[6.5,1],[8,1.7],[9.5,1.05],[16.5,1.05],[18,1.7],[19.5,1.1],[21,.8],[23,.5],[24,.35]];
function rl_rush(h){for(let i=1;i<RL_RUSH.length;i++)if(h<=RL_RUSH[i][0]){const [h0,a]=RL_RUSH[i-1],[h1,b]=RL_RUSH[i];return a+(b-a)*(h-h0)/(h1-h0);}return 1;}
const RL_MIX=[['taxi',10],['yaris',4],['logan',7],['lada',6],['suv',4],['rutiera',6]],RL_MIXN=[['taxi',14],['logan',3],['lada',2],['suv',2],['yaris',2]];
let rl_base=0,rl_rushT=3;
const rl_civ=v=>v.mode==='ai'&&v.ai&&v.ai.kind==='car'&&v.type!=='police'&&!v.rl_em&&!v.lfOwn;
function rl_rushStep(P){const h=rl_hour(),f=rl_rush(h),cars=vehicles.filter(rl_civ);if(!rl_base){rl_base=Math.max(20,cars.length);return;}
  const want=Math.round(rl_base*f);
  if(cars.length<want&&gtcApi.spawnAI){const mix=h<5||h>=22?RL_MIXN:RL_MIX;for(let k=0;k<Math.min(3,want-cars.length);k++){let tot=0;for(const m of mix)tot+=m[1];let r=Math.random()*tot,t='taxi';for(const m of mix){r-=m[1];if(r<=0){t=m[0];break;}}
      gtcApi.spawnAI(t,'car',{x:P.x,z:P.z,min:170,max:420});}}
  else if(cars.length>want+2){camera.getWorldDirection(rl_v3);let n=Math.min(3,cars.length-want);
    for(const v of cars){if(n<=0)break;const dx=v.x-P.x,dz=v.z-P.z,d=Math.hypot(dx,dz);if(d<200||(dx*rl_v3.x+dz*rl_v3.z)/d>.2&&d<320)continue;removeVehicle(v);n--;}}}

// ================= hooks =================
function aiTarget(v,a,target,dt){if(rl_dead)return target;
  if(v.rl_em)return rl_emTarget(v,a,target);
  const P=gtcApi.player;let t=rl_lightCap(v,a,target);const red=t<target-.01;
  if(v.rl_yield>0){v.rl_yield-=dt;t=Math.min(t,2.5);}if(v.rl_slow>0){v.rl_slow-=dt;t=Math.min(t,5);}
  if(!red&&a.kind==='car')t=rl_driver(v,a,dt,P,t);
  const f=rl_rush(rl_hour());if(f>1.4)t*=.88;
  return t;}
function aiPost(v,dt){if(rl_dead)return;const want=v.rl_yield>0?2.3:0;v.rl_off=(v.rl_off||0)+(want-(v.rl_off||0))*Math.min(1,dt*1.8);
  if(v.rl_lc){const s=Math.sign(v.rl_lc);v.rl_lc-=s*Math.min(Math.abs(v.rl_lc),dt*2.4);}
  const o=(v.rl_off||0)+(v.rl_lc||0);if(Math.abs(o)>.01){v.x+=-Math.cos(v.h)*o;v.z+=Math.sin(v.h)*o;}}
let rl_scanT=0;
function roadUpdate(dt,P){if(rl_dead||!P)return;try{rl_t+=dt;rl_scanT-=dt;if(rl_scanT<=0){rl_scanT=2;rl_scan(P);}
    rl_rushT-=dt;if(rl_rushT<=0){rl_rushT=2;rl_rushStep(P);}
    rl_lights(P);rl_emUpdate(dt,P);}
  catch(e){console.error('[roadlife] disabled',e);rl_dead=true;}}
window.__road={get lights(){return rl_ctrls.filter(C=>C.ready).length},em:k=>!!rl_emSpawn(gtcApi.player,k),get rush(){return rl_rush(rl_hour())},off:()=>{rl_dead=true;}};
