'use strict';
// Street life (owner: life): NPC types with their own behaviour + small random ambient events around the player.
//  scenes  — babushkas selling flowers / seeds / pickles (Piața Centrală, bus stops), pensioners playing chess (parks,
//            quiet streets), student groups (USM, ASEM, UTM), weekend crowds (Piața Centrală) and families walking at
//            Valea Morilor, cars parked on the sidewalk, a pack of street dogs that chases cars, scooter couriers.
//  events  — one at a time, every ~1–2 min, ahead of the player: fender-bender, wedding convoy, trolleybus with its poles
//            off the wire, road works ("LUCRĂRI"), funeral procession, police checkpoint.
// People are one extra instanced crowd built from people.js (same parts, outfits and pose solver), so all of them cost
// 14 draw calls; props are one merged mesh per scene. Spawned within ~260 m of the player, dropped beyond ~380 m.
// Hooks (game.js): lifeUpdate(dt,player) every frame, lifeAction() on E. Debug: window.__life (event('wedding'), …).
// Weekend = the real calendar day (Saturday/Sunday); __life.weekend=true forces it.

// ================= lines (tools/gen_piper.py pre-renders every LF_L_* array) =================
const LF_L_FLORI=['Flori, flori frumoase! Luați pentru doamna!','Trandafiri proaspeți, ieftin dau!','Lalele, puișor, ia un buchet!'];
const LF_L_SEM=['Semințe prăjite, fierbinți! Un pahar, cinci lei.','Ia semințe, drăguță, că-s de casă!','Semințe, semințe! Mari și sărate!'];
const LF_L_MUR=['Murături de casă! Castraveți, roșii, varză!','Ia un borcan, că le-am făcut cu mâna mea.','Pătlăgele murate, ca la bunica!'];
const LF_L_BUY=['Mulțumesc, sănătate să ai!','Să fii sănătos, puișor!','Poftă bună, să-ți fie de bine!'];
const LF_L_POOR=['N-ai bani? Nu-i nimic, treci mâine.'];
const LF_L_CHESS=['Șah! Ia să vedem acum, Vasile.','Piesa atinsă, piesa mutată!','Pe vremuri jucam toată ziua aici.','Tinere, nu sta deasupra, ne încurci.','Ai văzut ce mutare? Ca Kasparov!'];
const LF_L_CHESS_GO=['Hai, stai jos. Zece lei pe masă.'];
const LF_L_CHESS_WIN=['Ai câștigat, tinere! Ia banii, meriți.','Bravo, m-ai prins. Ia zece lei.'];
const LF_L_CHESS_LOSE=['Șah și mat! Mulțumesc pentru zece lei.','Mai ai de învățat, tinere. Mat!'];
const LF_L_STUD=['Ai făcut referatul pentru mâine?','Hai la o shaorma după pereche.','Colocviul e luni, frate, suntem terminați.','Profesorul iar n-a venit la curs.','Bursa vine abia la sfârșitul lunii.'];
const LF_L_PARK=['Doar un minut, frate, iau o cafea!','Unde să parchez, dacă nu-i loc nicăieri?','Ce te uiți? Toți parchează așa.'];
const LF_L_CRASH=['Unde te uiți, mă?! N-ai văzut că am frânat?','Tu ai frânat brusc! Ai permisul cumpărat?','Chemăm poliția, sau ne înțelegem?','Cine plătește bara acum?','Am filmat tot, am cameră!','Lasă, lasă, ne vedem la asigurare!'];
const LF_L_WED=['Trăiască mirii! Casă de piatră!','Hai la nuntă, că-i masa mare!'];
const LF_L_TROL=['Iar au sărit coarnele de pe fir.','Un minut, oameni buni, acuș pornim!','Mai repede, că întârzii la lucru!'];
const LF_L_WORK=['Ocolește, șefu, aici se lucrează!','Asfaltăm până la iarnă, garantat.','Nu te uita, că nu-i gata.'];
const LF_L_FUN=['Dumnezeu să-l ierte.','Era un om bun.'];
const LF_L_POL=['Bună ziua! Actele la control, vă rog.','Circulați, circulați.','Stai! Viteză excesivă!','Opriți motorul și coborâți din mașină!'];
const LF_L_COUR=['Bă, mi-ai stricat comanda!','Hei, uită-te în oglindă!','Clientul așteaptă, frate!'];

let lf_weekend=(()=>{const d=new Date().getDay();return d===0||d===6;})();
const lf_v3=new THREE.Vector3();
const lf_segD=(v,px,pz)=>{const fx=Math.sin(v.h),fz=Math.cos(v.h),L=v.spec.len/2-v.spec.wid/2;const t=clamp((px-v.x)*fx+(pz-v.z)*fz,-L,L);return Math.hypot(px-(v.x+fx*t),pz-(v.z+fz*t));};

// ================= crowd pool (people.js parts, own instanced set) =================
const LF_N=80,LF_HI_D=50,LF_VIS=190;
let lf_HI=null,lf_LO=null,lf_ok=false;
const lf_P=new Array(LF_N).fill(null);
function lf_init(){if(lf_ok)return true;if(typeof ppl_init!=='function')return false;ppl_init();if(!ppl_G)return false;
  lf_HI=ppl_mkSet(ppl_G,LF_N,ppl_mat);lf_LO=ppl_mkSet(ppl_GL,LF_N,ppl_matLO);
  for(const m of lf_HI.concat(lf_LO)){for(let i=0;i<m.count;i++)m.setMatrixAt(i,ppl_zero);m.count=0;scene.add(m);}
  lf_ok=true;return true;}
// outfit for a life role (people.js casting + uniforms)
function lf_look(kind,ov){const F=ppl_F;
  const base={police:'man',worker:'man',courier:'man',kid:'student',mourner:mpick(['man','granny','woman','oldman']),shopper:mpick(['granny','woman','oldman','man','dress'])}[kind]||kind;
  const o=ppl_outfit(base);
  if(kind==='police'){o.top=0x2a3550;o.bot=0x232a3b;o.shoe=0x111111;o.acc=0x2a3550;o.mask=F.hair|F.hairS|F.sleeves|F.pants|F.jacket|F.cap;o.armL=o.armR=0;}
  else if(kind==='worker'){o.top=0xff7a12;o.bot=0x3a3f4a;o.shoe=0x2a1d14;o.acc=0xe8e8e0;o.mask=F.hair|F.hairS|F.sleeves|F.pants|F.jacket|F.stripes|(Math.random()<.5?F.cap:0);o.armL=o.armR=0;}
  else if(kind==='mourner'){o.top=mpick([0x161616,0x1d1d20,0x222226]);o.bot=0x141414;o.shoe=0x111111;if(o.mask&F.scarf)o.acc=0x111111;o.armL=o.armR=0;}
  else if(kind==='kid'){o.armL=0;}
  return Object.assign(o,ov||{});}
function lf_add(kind,x,z,h,ov){if(!lf_init())return null;const i=lf_P.indexOf(null);if(i<0)return null;const o=lf_look(kind,ov);
  const p={i,kind,x,z,h,o,sp:0,sc:1,y:null,dy:0,roll:0,down:0,look:0,lookTo:0,lookT:Math.random()*3,mv:false,
    st:{t:Math.random()*6,k:0,run:0,fall:0,time:0,look:0,phoneL:false,wave:false,sit:0,cards:false,sip:0,work:0}};
  lf_P[i]=p;ppl_applyLook(lf_HI,i,LF_N,o);ppl_applyLook(lf_LO,i,LF_N,o);return p;}
function lf_del(p){if(!p||lf_P[p.i]!==p)return;ppl_writeSet(lf_HI,p.i,LF_N,null);ppl_writeSet(lf_LO,p.i,LF_N,null);lf_P[p.i]=null;}
const lf_qr=new THREE.Quaternion(),lf_Z=new THREE.Vector3(0,0,1);
function lf_render(dt){if(!lf_ok)return;const now=performance.now()/1000,cx=camera.position.x,cz=camera.position.z;let top=0;
  for(const p of lf_P){if(!p)continue;top=p.i+1;
    const d2=(p.x-cx)**2+(p.z-cz)**2;
    if(d2>LF_VIS*LF_VIS){if(!p.hidden){ppl_writeSet(lf_HI,p.i,LF_N,null);ppl_writeSet(lf_LO,p.i,LF_N,null);p.hidden=true;}continue;}p.hidden=false;
    if(p.down>0)p.down-=dt;
    const s=p.st,sp=p.down>0?0:p.sp;
    s.t+=dt*TAU*ppl_freq(sp);s.k+=((sp>.05?1:0)-s.k)*Math.min(1,dt*6);s.run+=(ppl_runTarget(sp)-s.run)*Math.min(1,dt*5);
    s.fall+=((p.down>0?1:0)-s.fall)*Math.min(1,dt*(p.down>0?14:5));s.time=now+p.i*1.7;
    p.lookT-=dt;if(p.lookT<=0){p.lookT=1.5+Math.random()*4;p.lookTo=Math.random()<.5?0:(Math.random()-.5)*1.3;}
    let lt=p.lookTo;if(p.lookAt){const a=angDiff(Math.atan2(p.lookAt.x-p.x,p.lookAt.z-p.z),p.h);lt=Math.abs(a)<2.2?clamp(a,-1.1,1.1):0;}
    p.look+=(lt-p.look)*Math.min(1,dt*3);s.look=p.look*(1-s.run);
    s.phoneL=p.phone!=null?p.phone:(p.o.armL===ppl_F.phone&&s.run<.5);
    if(p.y==null||p.mv){const hx=Math.sin(p.h),hz=Math.cos(p.h);p.y=surfaceY(p.x,p.z,p.y==null||!isFinite(p.y)?null:p.y,hx,hz);}
    ppl_q.setFromAxisAngle(ppl_up,p.h);if(p.roll){lf_qr.setFromAxisAngle(lf_Z,p.roll);ppl_q.multiply(lf_qr);}
    ppl_root.compose(ppl_pos.set(p.x,p.y+PPL_Y+(s.fall>.5?0:p.dy),p.z),ppl_q,ppl_scl.set(p.o.sw*p.sc,p.o.sh*p.sc,(p.o.sw*.96+.04)*p.sc));
    ppl_pose(ppl_root,s,ppl_out);
    const hi=d2<LF_HI_D*LF_HI_D;ppl_writeSet(hi?lf_HI:lf_LO,p.i,LF_N,ppl_out);ppl_writeSet(hi?lf_LO:lf_HI,p.i,LF_N,null);}
  for(let j=0;j<7;j++){const n=PPL_DOUBLE[j]?LF_N+top:top;lf_HI[j].count=n;lf_LO[j].count=n;lf_HI[j].instanceMatrix.needsUpdate=true;lf_LO[j].instanceMatrix.needsUpdate=true;}}

// ================= sound (WebAudio through fx.js master; positional volume + pan) =================
function lf_snd(x,z,gain){const a=typeof fx_AC!=='undefined'?fx_AC:null;if(!a||typeof fx_master==='undefined'||!fx_master||(typeof fx_muted!=='undefined'&&fx_muted))return null;
  const dx=x-camera.position.x,dz=z-camera.position.z,d=Math.hypot(dx,dz),v=gain/(1+d*.07);if(v<.004)return null;
  const g=a.createGain();g.gain.value=0;let out=g;
  if(a.createStereoPanner){const pn=a.createStereoPanner();camera.getWorldDirection(lf_v3);pn.pan.value=clamp((dx*-lf_v3.z+dz*lf_v3.x)/(d+1),-1,1)*.8;g.connect(pn);out=pn;}
  out.connect(fx_master);return {a,g,v,t:a.currentTime};}
function lf_bark(x,z,pm){const s=lf_snd(x,z,.16);if(!s)return;const {a,g,v,t}=s,n=Math.random()<.35?2:1;
  const bp=a.createBiquadFilter();bp.type='bandpass';bp.frequency.value=950*(pm||1);bp.Q.value=1.3;bp.connect(g);
  for(let k=0;k<n;k++){const t0=t+k*.2,f0=(330+Math.random()*120)*(pm||1),o=a.createOscillator();o.type='sawtooth';
    o.frequency.setValueAtTime(f0*.8,t0);o.frequency.linearRampToValueAtTime(f0,t0+.03);o.frequency.exponentialRampToValueAtTime(f0*.5,t0+.14);o.connect(bp);o.start(t0);o.stop(t0+.17);
    g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(v,t0+.015);g.gain.exponentialRampToValueAtTime(.0005,t0+.15);}}
function lf_yelp(x,z){const s=lf_snd(x,z,.13);if(!s)return;const {a,g,v,t}=s,o=a.createOscillator();o.type='triangle';
  o.frequency.setValueAtTime(900,t);o.frequency.linearRampToValueAtTime(1500,t+.08);o.frequency.exponentialRampToValueAtTime(500,t+.4);o.connect(g);
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(v,t+.02);g.gain.exponentialRampToValueAtTime(.0005,t+.42);o.start(t);o.stop(t+.45);}
// car horn; pat = list of [start, length] in seconds (wedding: tu-tu-tuuu)
function lf_horn(x,z,pat,base){const s=lf_snd(x,z,.07);if(!s)return;const {a,g,v,t}=s,lp=a.createBiquadFilter();lp.type='lowpass';lp.frequency.value=1500;lp.connect(g);
  const f=base||mpick([392,415,440]);let end=0;for(const [t0,l] of pat){g.gain.setValueAtTime(0,t+t0);g.gain.linearRampToValueAtTime(v,t+t0+.02);g.gain.setValueAtTime(v,t+t0+l);g.gain.linearRampToValueAtTime(0,t+t0+l+.04);end=Math.max(end,t0+l+.06);}
  for(const m of[1,1.26]){const o=a.createOscillator();o.type='square';o.frequency.value=f*m;o.connect(lp);o.start(t);o.stop(t+end);}}
function lf_beep(x,z){lf_horn(x,z,[[0,.09],[.14,.09]],880);}

// ================= talk =================
let lf_sayT=0;
function lf_say(who,text,pitch,col){if(lf_sayT>0)return false;lf_sayT=3;subtitle(who,text,col||'#ffd23f');if(typeof lst_speak==='function')lst_speak(text,pitch||1,1.05);return true;}

// ================= props =================
const lf_W=(S,lx,lz)=>[S.x+lx*Math.cos(S.a)+lz*Math.sin(S.a),S.z-lx*Math.sin(S.a)+lz*Math.cos(S.a)];
// one merged vertex-coloured mesh per scene, built in the scene's local frame (+z = S.a, +x = left of +z)
function lf_mesh(S,build,lx,lz,ry){const b=new Bk(VC);build(b);const m=new THREE.Mesh(b.geo(),VC);const [x,z]=lf_W(S,lx||0,lz||0);
  m.position.set(x,lx||lz?groundY(x,z):S.y,z);m.rotation.y=S.a+(ry||0);m.castShadow=true;m.receiveShadow=true;scene.add(m);S.props.push(m);return m;}
const lf_mats=new Map();
function lf_signMat(text,bg,fg,w,h,font){const k=text+bg+fg;if(lf_mats.has(k))return lf_mats.get(k);const c=document.createElement('canvas');c.width=256;c.height=Math.max(32,Math.round(256*h/w));
  const g=c.getContext('2d');g.fillStyle=bg;g.fillRect(0,0,c.width,c.height);g.strokeStyle=fg;g.lineWidth=6;g.strokeRect(5,5,c.width-10,c.height-10);g.fillStyle=fg;g.textAlign='center';g.textBaseline='middle';
  const ls=text.split('\n');let fs=Math.min(c.height*.62/ls.length,52);g.font=(font||'900 ')+fs+'px Arial,sans-serif';while(fs>10&&Math.max(...ls.map(l=>g.measureText(l).width))>c.width-24){fs-=2;g.font=(font||'900 ')+fs+'px Arial,sans-serif';}
  ls.forEach((l,i)=>g.fillText(l,c.width/2,c.height*(i+.5)/ls.length+2));
  const t=new THREE.CanvasTexture(c);t.anisotropy=4;const m=new THREE.MeshLambertMaterial({map:t});lf_mats.set(k,m);return m;}
const lf_planeG=new THREE.PlaneGeometry(1,1);
function lf_sign(S,text,lx,ly,lz,ry,w,h,bg,fg,font){const m=new THREE.Mesh(lf_planeG,lf_signMat(text,bg,fg,w,h,font));m.scale.set(w,h,1);const [x,z]=lf_W(S,lx,lz);
  m.position.set(x,groundY(x,z)+ly,z);m.rotation.y=S.a+ry;scene.add(m);S.props.push(m);return m;}
const lf_cone=(b,x,z)=>{b.add(CYL(.03,.16,.5,8),M(x,.27,z),0xff6a10);b.add(CYL(.09,.12,.08,8),M(x,.3,z),0xf4f4f4);b.add(BOX(.36,.04,.36),M(x,.02,z),0x222222);};
const lf_stool=(b,x,z,col)=>{b.add(BOX(.36,.05,.36),M(x,.45,z),col||0x6a4a2e);for(const [a,c] of[[1,1],[1,-1],[-1,1],[-1,-1]])b.add(BOX(.04,.43,.04),M(x+a*.14,.215,z+c*.14),0x3a2a1a);};

// ================= spots =================
// random sidewalk/roadside spot near (px,pz): off(e) = distance from the road centre line; nx,nz = road → spot
function lf_edgeSpot(px,pz,dmin,dmax,f,off,tries){for(let t=0;t<(tries||30);t++){const e=randEdgeNear(px,pz,dmin,dmax,edges,30);if(!e||e.len<20||(f&&!f(e)))continue;
    const P=e.pts,s=Math.floor(Math.random()*(P.length-1)),a=P[s],b=P[s+1],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);if(l<9)continue;
    const fr=.2+Math.random()*.6,side=Math.random()<.5?1:-1,nx=-dz/l*side,nz=dx/l*side,o=typeof off==='function'?off(e):off,qx=a[0]+dx*fr,qz=a[1]+dz*fr;
    return {e,x:qx+nx*o,z:qz+nz*o,qx,qz,ux:dx/l,uz:dz/l,nx,nz,a:Math.atan2(-nx,-nz)};}
  return null;}
const lf_free=(x,z,r)=>worldReadyAt(x,z)&&!pushOut(x,z,r||.8);
const lf_taken=(x,z,r)=>lf_scenes.some(S=>Math.abs(S.x-x)<r&&Math.abs(S.z-z)<r);
// arc-length walk along a polyline [[x,z],…]
function lf_len(P){let L=0;for(let i=1;i<P.length;i++)L+=Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]);return L;}
function lf_along(P,s){s=Math.max(0,s);for(let i=1;i<P.length;i++){const dx=P[i][0]-P[i-1][0],dz=P[i][1]-P[i-1][1],l=Math.hypot(dx,dz);
    if(s<=l||i===P.length-1){const t=l>0?Math.min(1,s/l):0;return {x:P[i-1][0]+dx*t,z:P[i-1][1]+dz*t,h:Math.atan2(dx,dz),ux:dx/(l||1),uz:dz/(l||1)};}s-=l;}
  return {x:P[0][0],z:P[0][1],h:0,ux:0,uz:1};}
// point `back` metres behind the newest point of a trail (oldest first)
function lf_trailAt(T,back){for(let i=T.length-1;i>0;i--){const dx=T[i][0]-T[i-1][0],dz=T[i][1]-T[i-1][1],l=Math.hypot(dx,dz);
    if(back<=l){const t=l>0?back/l:0;return {x:T[i][0]-dx*t,z:T[i][1]-dz*t,h:Math.atan2(dx,dz)};}back-=l;}
  const a=T[0],b=T[1]||T[0];return {x:a[0],z:a[1],h:Math.atan2(b[0]-a[0],b[1]-a[1])};}
function lf_trailPush(T,x,z,max){const l=T[T.length-1];if(!l||Math.hypot(x-l[0],z-l[1])>.6){T.push([x,z]);let L=lf_len(T);while(T.length>2&&L>max){L-=Math.hypot(T[1][0]-T[0][0],T[1][1]-T[0][1]);T.shift();}}}
// a road edge ahead of the player (camera direction) for events
function lf_aheadEdge(px,pz,f,dmin,dmax){camera.getWorldDirection(lf_v3);const fx=lf_v3.x,fz=lf_v3.z,l=Math.hypot(fx,fz)||1;
  for(let t=0;t<40;t++){const k=mr(90,200),e=randEdgeNear(px+fx/l*k,pz+fz/l*k,0,120,edges,30);if(!e||(f&&!f(e)))continue;const d=Math.hypot(e.mid[0]-px,e.mid[1]-pz);if(d<(dmin||70)||d>(dmax||250))continue;return e;}
  return null;}

// ================= scenes =================
const lf_scenes=[];
function lf_scene(kind,x,z,a,grp){const S={kind,x,z,a,y:groundY(x,z),grp,people:[],props:[],cars:[],t:0,talkT:0};lf_scenes.push(S);return S;}
function lf_kill(S){if(S.end)try{S.end();}catch(e){}
  for(const p of S.people)lf_del(p);
  for(const m of S.props){scene.remove(m);if(m.geometry&&m.geometry!==lf_planeG&&!m.geometry.userData.shared)m.geometry.dispose();}
  for(const v of S.cars)if(v&&(v.mode==='parked'||v.mode==='lf'||(v.mode==='ai'&&v.lfOwn))&&vehicles.includes(v))removeVehicle(v);
  const i=lf_scenes.indexOf(S);if(i>=0)lf_scenes.splice(i,1);if(lf_ev===S)lf_ev=null;}

// ---- babushka vendor (flowers / seeds / pickles) ----
const LF_GOODS={flori:{name:'flori',sign:'FLORI',price:30,lines:LF_L_FLORI,buy:'Ai cumpărat un buchet de flori'},
  seminte:{name:'semințe',sign:'SEMINȚE',price:5,lines:LF_L_SEM,buy:'Ronțăi semințe'},
  muraturi:{name:'murături',sign:'MURĂTURI',price:25,lines:LF_L_MUR,buy:'Ai cumpărat un borcan de murături'}};
function lf_vendor(x,z,a,type,grp){const G=LF_GOODS[type];const S=lf_scene('vend',x,z,a,grp);S.goods=G;
  lf_mesh(S,b=>{lf_stool(b,0,-.5);
    b.add(BOX(.9,.5,.5),M(0,.25,.18),0x8a6a40);b.add(BOX(.94,.03,.54),M(0,.51,.18),0x6e5232); // crate with a board on top
    if(type==='flori'){b.add(CYL(.16,.13,.34,10),M(.62,.17,.25),0x2f5a3a);
      for(let i=0;i<14;i++){const bx=mr(-.38,.38),bz=mr(.02,.34),c=mpick([0xc0182a,0xf2f0ea,0xf4c430,0xd0407a,0xb01020]);b.add(CYL(.008,.008,.26,4),M(bx,.65,bz),0x3a7a3a);b.add(new THREE.SphereGeometry(.045,6,4),M(bx,.79,bz),c);}
      for(let i=0;i<7;i++){const c=mpick([0xc0182a,0xf2f0ea,0xd0407a]);b.add(CYL(.008,.008,.5,4),M(.62+mr(-.08,.08),.55,.25+mr(-.08,.08)),0x3a7a3a);b.add(new THREE.SphereGeometry(.05,6,4),M(.62+mr(-.1,.1),.82,.25+mr(-.1,.1)),c);}}
    else if(type==='seminte'){b.add(CYL(.2,.17,.34,10),M(.05,.7,.2),0xd8c8a0);b.add(CYL(.19,.19,.04,10),M(.05,.88,.2),0x1e1a16);
      b.add(CYL(.04,.035,.09,8),M(-.3,.57,.28),0xf2f2f0);for(let i=0;i<4;i++)b.add(CYL(.045,.005,.16,6),M(.32+i*.05,.6,.08),0xe8e0c8,undefined);}
    else{for(let i=0;i<8;i++){const c=mpick([0x4a7a2a,0x5a8a30,0xb83a24,0x6a8a3a]),jx=-.34+(i%4)*.22,jz=.08+Math.floor(i/4)*.2;b.add(CYL(.07,.07,.2,8),M(jx,.62,jz),c);b.add(CYL(.072,.072,.03,8),M(jx,.74,jz),0xd0c040);}}
  });
  lf_sign(S,G.sign,0,.3,.44,0,.6,.2,'#c8a46a','#3a2210','italic 900 ');
  const p=lf_add('granny',...lf_W(S,0,-.5),a);if(p){p.st.sit=1;p.lookAt=gtcApi.player;S.people.push(p);}
  S.hint='E — Cumpără '+G.name+' ('+G.price+' lei)';S.ax=x;S.az=z;
  S.act=()=>{if(gtcApi.money<G.price){lf_sayT=0;lf_say('Bunica',LF_L_POOR[0],1.25,'#ffb37a');return;}gtcApi.money-=G.price;lf_sayT=0;lf_say('Bunica',mpick(LF_L_BUY),1.25,'#ffb37a');gtcApi.say('-'+G.price+' lei',G.buy,1.8,'#ffd23f');};
  S.upd=(dt,P,d)=>{if(d<9&&S.talkT<=0&&P.mode==='foot'){if(lf_say('Bunica',mpick(G.lines),1.25,'#ffb37a'))S.talkT=25;}};
  return S;}

// ---- pensioners playing chess (two seated, one or two watching) ----
function lf_chess(x,z,a,grp){const S=lf_scene('chess',x,z,a,grp);
  lf_mesh(S,b=>{b.add(CYL(.05,.07,.68,8),M(0,.34,0),0x3a3a3a);b.add(BOX(.62,.04,.62),M(0,.7,0),0x7a5a3a);
    for(let i=0;i<8;i++)for(let j=0;j<8;j++)b.add(BOX(.055,.012,.055),M(-.1925+i*.055,.725,-.1925+j*.055),(i+j)%2?0x2a2018:0xe8dcc0);
    for(let k=0;k<14;k++){const w=k%2;b.add(CYL(.012,.018,.05+(k%5===0?.03:0),6),M(-.19+Math.floor(Math.random()*8)*.055,.755,(w?-.19:.08)+Math.floor(Math.random()*3)*.055),w?0xf4f0e6:0x15110e);}
    lf_stool(b,-.62,0);lf_stool(b,.62,0);});
  for(const sd of[-1,1]){const p=lf_add('oldman',...lf_W(S,sd*.62,0),a-sd*Math.PI/2);if(p){p.st.sit=1;p.lookTo=0;S.people.push(p);}}
  const nw=Math.random()<.5?1:2;for(let k=0;k<nw;k++){const lx=k?-.35:.3,lz=k?-.95:.95;const p=lf_add(Math.random()<.7?'oldman':'granny',...lf_W(S,lx,lz),a+(lz>0?Math.PI:0)+mr(-.3,.3));if(p){p.solid=true;S.people.push(p);}}
  S.hint='E — Joacă o partidă de șah (10 lei)';S.ax=x;S.az=z;S.playT=0;
  S.act=()=>{if(S.playT>0)return;if(gtcApi.money<10){gtcApi.say('N-ai 10 lei','',1.6,'#ff8a65');return;}S.playT=6;lf_sayT=0;lf_say('Moș Vasile',LF_L_CHESS_GO[0],.9,'#c9e3a0');
    setTimeout(()=>{const win=Math.random()<.45;gtcApi.money+=win?10:-10;lf_sayT=0;lf_say('Moș Vasile',mpick(win?LF_L_CHESS_WIN:LF_L_CHESS_LOSE),.9,'#c9e3a0');gtcApi.say(win?'+10 lei':'-10 lei',win?'Ai câștigat la șah':'Ai pierdut la șah',2,win?'#7dff8a':'#ff8a65');},3500);};
  S.upd=(dt,P,d)=>{S.playT-=dt;const t=performance.now()/1000;S.people.forEach((p,i)=>{if(i<2){p.st.cards=Math.sin(t*.7+i*2)>.6;}});
    if(d<8&&S.talkT<=0){if(lf_say('Moș Vasile',mpick(LF_L_CHESS),.9,'#c9e3a0'))S.talkT=20;}};
  return S;}

// ---- student group chatting in a circle ----
function lf_students(x,z,a,grp,n){const S=lf_scene('stud',x,z,a,grp);n=n||4+Math.floor(Math.random()*3);
  for(let k=0;k<n;k++){const an=k/n*TAU+mr(-.25,.25),r=mr(.85,1.15),lx=Math.sin(an)*r,lz=Math.cos(an)*r;const p=lf_add(Math.random()<.75?'student':mpick(['man','woman','dress']),...lf_W(S,lx,lz),a+an+Math.PI);
    if(p){p.solid=true;if(Math.random()<.3)p.phone=true;S.people.push(p);}}
  S.upd=(dt,P,d)=>{if(d<10&&S.talkT<=0){if(lf_say('Student',mpick(LF_L_STUD),1.1,'#9fd8ff'))S.talkT=22;}
    for(const p of S.people)if(p.phone==null&&Math.random()<dt*.15)p.lookTo=mr(-.6,.6);};
  return S;}

// ---- shoppers milling around along a stretch of sidewalk ----
function lf_crowd(sp,grp,n){const S=lf_scene('crowd',sp.x,sp.z,sp.a,grp);
  for(let k=0;k<n;k++){const lx=mr(-9,9),lz=mr(-.8,.8),[x,z]=lf_W(S,lx,lz);if(!lf_free(x,z,.4))continue;const p=lf_add('shopper',x,z,S.a+Math.PI/2*(Math.random()<.5?1:-1));
    if(p){p.mv=true;p.wT=mr(0,4);p.tx=x;p.tz=z;S.people.push(p);}}
  S.upd=(dt,P,d)=>{for(const p of S.people){if(p.down>0){p.sp=0;continue;}
      const dx=p.tx-p.x,dz=p.tz-p.z,l=Math.hypot(dx,dz);
      if(l<.3){p.sp=0;p.wT-=dt;if(p.wT<=0){const[x,z]=lf_W(S,mr(-10,10),mr(-.9,.9));if(lf_free(x,z,.4)){p.tx=x;p.tz=z;p.wT=mr(2,7);}}continue;}
      p.sp=p.o.v*.75;p.h=lerpAng(p.h,Math.atan2(dx,dz),1-Math.exp(-6*dt));p.x+=Math.sin(p.h)*p.sp*dt;p.z+=Math.cos(p.h)*p.sp*dt;
      const q=pushOut(p.x,p.z,.35);if(q){p.x+=q.x;p.z+=q.z;p.tx=p.x;p.tz=p.z;}}};
  return S;}

// ---- family strolling (ped agent; parents side by side, kids around; a balloon on weekends) ----
function lf_family(e,grp){const a={kind:'ped'};placeAgent(a,e,mpick(dirsFor(e,'ped')),Math.random());if(!lf_free(a.x,a.z,.5))return null;
  const S=lf_scene('family',a.x,a.z,0,grp);S.ag=a;S.v=mr(.85,1.05);
  const roles=[['man',-.5,0,1],['woman',.5,0,1]];const kids=1+(Math.random()<.5?1:0);for(let k=0;k<kids;k++)roles.push(['kid',k?-1.1:1.1,.9,mr(.58,.68)]);
  for(const [kind,lat,fw,sc] of roles){const p=lf_add(kind,a.x,a.z,0,kind==='woman'&&Math.random()<.5?{armL:0}:null);if(p){p.mv=true;p.sc=sc;p.lat=lat;p.fw=fw;S.people.push(p);}}
  if(lf_weekend&&Math.random()<.7){const b=new Bk(VC);b.add(new THREE.SphereGeometry(.2,10,8),M(0,1.55,0,0,0,0,1,1.2,1),mpick([0xe02030,0x2a7ae0,0xf4c430,0xe060a0]));b.add(BOX(.008,.9,.008),M(0,.95,0),0xf0f0f0);
    S.bal=new THREE.Mesh(b.geo(),VC);scene.add(S.bal);S.props.push(S.bal);}
  S.upd=(dt,P,d)=>{const stop=S.people.some(p=>p.down>0);agentStep(a,stop?0:S.v*dt);if(a.dead){S.done=true;return;}S.x=a.x;S.z=a.z;const h=Math.atan2(a.hx,a.hz),rx=-a.hz,rz=a.hx;
    for(const p of S.people){if(p.down>0){p.sp=0;continue;}const tx=a.x+rx*p.lat+a.hx*p.fw,tz=a.z+rz*p.lat+a.hz*p.fw;p.sp=stop?0:S.v;p.x+=(tx-p.x)*Math.min(1,dt*4);p.z+=(tz-p.z)*Math.min(1,dt*4);p.h=lerpAng(p.h,h,1-Math.exp(-6*dt));}
    if(S.bal){const k=S.people[S.people.length-1];if(k){const t=performance.now()/1000;S.bal.position.set(k.x+Math.sin(k.h+1.2)*.25,(k.y||0)+.1,k.z+Math.cos(k.h+1.2)*.25);S.bal.rotation.set(Math.sin(t*1.3)*.12,0,Math.cos(t*1.1)*.12);}}};
  return S;}

// ---- car parked fully on the sidewalk (Chișinău classic), sometimes with the driver on the phone next to it ----
function lf_sidePark(px,pz,dmin,dmax){const sp=lf_edgeSpot(px,pz,dmin,dmax,e=>e.w>=6&&e.w<=12&&!e.tw,e=>e.w/2+1.55);if(!sp)return null;
  const ang=Math.atan2(sp.ux,sp.uz)+(Math.random()<.5?Math.PI:0)+(Math.random()<.4?mpick([-1,1])*mr(.15,.35):0),fx=Math.sin(ang),fz=Math.cos(ang);
  for(const k of[-2.2,0,2.2])if(!lf_free(sp.x+fx*k,sp.z+fz*k,1.1))return null;
  if(vehicles.some(v=>Math.abs(v.x-sp.x)<7&&Math.abs(v.z-sp.z)<7)||lf_taken(sp.x,sp.z,8))return null;
  const v=makeVehicle(mpick(['logan','logan','lada','yaris','suv','taxi']),sp.x,sp.z,ang);if(!v)return null;
  const S=lf_scene('spark',sp.x,sp.z,sp.a);S.cars.push(v);
  if(Math.random()<.4){const ox=sp.x+Math.cos(ang)*1.3,oz=sp.z-Math.sin(ang)*1.3;if(lf_free(ox,oz,.4)){const p=lf_add(mpick(['man','track','office']),ox,oz,ang+Math.PI/2,{armL:ppl_F.phone});if(p){p.solid=true;p.phone=true;S.people.push(p);}}}
  S.upd=(dt,P,d)=>{if(v.mode!=='parked'){S.cars.length=0;S.done=true;return;}if(S.people.length&&d<8&&S.talkT<=0){if(lf_say('Șoferul',mpick(LF_L_PARK),.95,'#ffd27f'))S.talkT=30;}};
  return S;}

// ================= street dogs =================
const LF_DN=12;
const lf_dogMat=new THREE.MeshLambertMaterial({vertexColors:true});
const lf_dogBody=(()=>{const b=new Bk(lf_dogMat),W=0xffffff,K=0x181818;
  b.add(BOX(.3,.3,.7),M(0,.53,0),W);b.add(BOX(.33,.34,.26),M(0,.57,.22),W);b.add(BOX(.17,.2,.2),M(0,.7,.4,0,-.6),W);b.add(BOX(.22,.2,.26),M(0,.8,.5),W);
  b.add(BOX(.12,.1,.16),M(0,.75,.68),W);b.add(BOX(.06,.045,.03),M(0,.785,.765),K);b.add(BOX(.03,.03,.01),M(.06,.85,.635),K);b.add(BOX(.03,.03,.01),M(-.06,.85,.635),K);
  b.add(BOX(.06,.12,.04),M(.08,.94,.45,0,0,-.25),W);b.add(BOX(.06,.12,.04),M(-.08,.94,.45,0,0,.25),W);return b.geo();})();
const lf_limbG=BOX(.08,.42,.08).translate(0,-.21,0);
const lf_dogIM=new THREE.InstancedMesh(lf_dogBody,lf_dogMat,LF_DN),lf_limbIM=new THREE.InstancedMesh(lf_limbG,new THREE.MeshLambertMaterial(),LF_DN*5);
for(const m of[lf_dogIM,lf_limbIM]){m.frustumCulled=false;m.castShadow=true;m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);m.count=0;m.setColorAt(0,new THREE.Color(1,1,1));scene.add(m);}
const LF_COATS=[0x8a6a44,0x5a4630,0x2a2420,0xc8a878,0xb07a40,0xe0d8c8,0x6a5a4a,0x9a8a70];
const lf_dogs=[];let lf_pack=null;
const lf_sv=new THREE.Vector3(),lf_m4=new THREE.Matrix4(),lf_m5=new THREE.Matrix4(),lf_m6=new THREE.Matrix4(),lf_qd=new THREE.Quaternion(),lf_e=new THREE.Euler(0,0,0,'YXZ'),lf_pp=new THREE.Vector3(),lf_one=new THREE.Vector3(1,1,1),lf_cc=new THREE.Color();
function lf_packSpawn(P){const e=randEdgeNear(P.x,P.z,110,230,edges,40);if(!e)return;const a={kind:'ped'};placeAgent(a,e,mpick(dirsFor(e,'ped')),Math.random());if(!lf_free(a.x,a.z,.5))return;
  lf_dogs.length=0;const n=3+Math.floor(Math.random()*3);
  for(let k=0;k<n;k++)lf_dogs.push({x:a.x+mr(-1.5,1.5),z:a.z+mr(-1.5,1.5),h:Math.random()*TAU,sp:0,ph:Math.random()*6,y:null,col:new THREE.Color(mpick(LF_COATS)),sc:mr(.85,1.15),ox:k?mr(-1.4,1.4):0,oz:k?-mr(.6,2.6):0,flee:0,barkT:mr(0,1),lie:0,pm:mr(.85,1.25),tail:Math.random()*6});
  lf_pack={a,mode:'roam',t:0,walkT:mr(6,14),rest:0,car:null,cool:3};}
function lf_dogUpdate(dt,P){
  if(!lf_pack||Math.hypot(lf_pack.a.x-P.x,lf_pack.a.z-P.z)>330){lf_pack=null;lf_dogs.length=0;if(Math.random()<dt*.5)lf_packSpawn(P);lf_dogIM.count=0;lf_limbIM.count=0;return;}
  const K=lf_pack,a=K.a,car=P.mode==='car'?P.car:null;K.t+=dt;
  // pack mode: roam (walk / rest) → chase a passing car → run back
  if(K.mode==='roam'){if(K.rest>0){K.rest-=dt;}else{agentStep(a,1.25*dt);K.walkT-=dt;if(K.walkT<=0){K.rest=mr(4,10);K.walkT=mr(7,16);}if(a.dead){lf_pack=null;return;}}
    if(car&&Math.abs(car.speed)>6&&K.cool<=0&&lf_dogs.some(d=>Math.hypot(d.x-car.x,d.z-car.z)<20)){K.mode='chase';K.t=0;K.car=car;K.rest=0;}}
  else if(K.mode==='chase'){const c=K.car;if(!c||K.t>6.5||Math.abs(c.speed)<1.5||lf_dogs.every(d=>Math.hypot(d.x-c.x,d.z-c.z)>38)){K.mode='back';K.t=0;}}
  else if(K.mode==='back'){if(lf_dogs.every(d=>Math.hypot(d.x-a.x,d.z-a.z)<4)||K.t>12){K.mode='roam';K.cool=8;}}
  K.cool=(K.cool||0)-dt;
  const ah=Math.atan2(a.hx,a.hz),rx=-a.hz,rz=a.hx;let ni=0,li=0;
  lf_dogs.forEach((d,k)=>{let tx,tz,vmax;
    if(d.flee>0){d.flee-=dt;tx=d.x+Math.sin(d.fh)*5;tz=d.z+Math.cos(d.fh)*5;vmax=9;}
    else if(K.mode==='chase'){const c=K.car,fx=Math.sin(c.h),fz=Math.cos(c.h),side=k%2?1:-1;tx=c.x-fz*side*(c.spec.wid/2+1.1)-fx*(c.spec.len*.2+k*1.1);tz=c.z+fx*side*(c.spec.wid/2+1.1)-fz*(c.spec.len*.2+k*1.1);vmax=Math.min(11,Math.abs(c.speed)+2);
      d.barkT-=dt;if(d.barkT<=0){d.barkT=mr(.35,.9);lf_bark(d.x,d.z,d.pm);}}
    else{tx=a.x+rx*d.ox+a.hx*d.oz;tz=a.z+rz*d.ox+a.hz*d.oz;vmax=K.mode==='back'?5:(K.rest>0?.8:2.2);
      if(P.mode==='foot'&&Math.hypot(P.x-d.x,P.z-d.z)<7){d.barkT-=dt;if(d.barkT<=0){d.barkT=mr(.8,2);lf_bark(d.x,d.z,d.pm);}tx=d.x;tz=d.z;d.h=lerpAng(d.h,Math.atan2(P.x-d.x,P.z-d.z),1-Math.exp(-5*dt));}}
    const dx=tx-d.x,dz=tz-d.z,l=Math.hypot(dx,dz);let sp=l>.35?Math.min(vmax,l*1.8):0;
    if(sp>0){d.h=lerpAng(d.h,Math.atan2(dx,dz),1-Math.exp(-(sp>4?7:4)*dt));d.x+=Math.sin(d.h)*sp*dt;d.z+=Math.cos(d.h)*sp*dt;}
    d.sp+=(sp-d.sp)*Math.min(1,dt*6);const q=pushOut(d.x,d.z,.3);if(q){d.x+=q.x;d.z+=q.z;}
    // hit by the player's car: yelp and run off (never hurt)
    if(car&&d.flee<=0&&Math.abs(car.speed)>3&&Math.abs(car.x-d.x)<7&&Math.abs(car.z-d.z)<7&&lf_segD(car,d.x,d.z)<car.spec.wid/2+.35){d.flee=3;d.fh=Math.atan2(d.x-car.x,d.z-car.z);d.x+=Math.sin(d.fh)*1.2;d.z+=Math.cos(d.fh)*1.2;lf_yelp(d.x,d.z);K.mode='back';K.t=0;}
    d.lie+=(((K.mode==='roam'&&K.rest>1&&d.sp<.3&&k%2===0)?1:0)-d.lie)*Math.min(1,dt*2);
    // draw: body + 4 legs + tail
    d.y=surfaceY(d.x,d.z,d.y==null||!isFinite(d.y)?null:d.y,Math.sin(d.h),Math.cos(d.h));
    const dd=(d.x-camera.position.x)**2+(d.z-camera.position.z)**2;if(dd>160*160)return;
    d.ph+=dt*(d.sp<.1?0:3+d.sp*1.5);d.tail+=dt*(d.sp>3?14:7);const bob=d.sp>.1?Math.abs(Math.sin(d.ph))*.04*Math.min(1,d.sp/3):0,low=d.lie*.3;
    lf_qd.setFromEuler(lf_e.set(d.sp>5?-.06:0,d.h,0));lf_m4.compose(lf_pp.set(d.x,d.y+bob-low,d.z),lf_qd,lf_sv.set(d.sc,d.sc,d.sc));
    lf_dogIM.setMatrixAt(ni,lf_m4);lf_dogIM.setColorAt(ni,d.col);ni++;
    lf_cc.copy(d.col).multiplyScalar(.85);
    const sw=d.sp>.1?Math.sin(d.ph)*Math.min(.9,.35+d.sp*.08):0;
    for(const [lx,lz,s] of[[.1,.25,1],[-.1,.25,-1],[.1,-.27,-1],[-.1,-.27,1]]){lf_m5.compose(lf_pp.set(lx,.44,lz),lf_qd.setFromEuler(lf_e.set(d.lie>.5?-1.35*Math.sign(lz):sw*s,0,0)),lf_one);lf_m6.multiplyMatrices(lf_m4,lf_m5);lf_limbIM.setMatrixAt(li,lf_m6);lf_limbIM.setColorAt(li,lf_cc);li++;}
    lf_m5.compose(lf_pp.set(0,.64,-.33),lf_qd.setFromEuler(lf_e.set(-2.2+(d.sp>3?.5:0),Math.sin(d.tail)*.5,0)),lf_sv.set(.7,.75,.7));lf_m6.multiplyMatrices(lf_m4,lf_m5);lf_limbIM.setMatrixAt(li,lf_m6);lf_limbIM.setColorAt(li,lf_cc);li++;});
  lf_dogIM.count=ni;lf_limbIM.count=li;for(const m of[lf_dogIM,lf_limbIM]){m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;}}

// ================= scooter couriers (invented brands: FUGA yellow, PACHEȚEL green) =================
const LF_BRANDS=[{name:'FUGA',col:0xf5c400,dk:0x2a2a2a},{name:'PACHEȚEL',col:0x2fae4f,dk:0xf2f2f2}];
const lf_scootG=LF_BRANDS.map(B=>{const b=new Bk(VC);
  for(const z of[.55,-.55]){b.add(CYL(.2,.2,.1,12),M(0,.2,z,0,0,Math.PI/2),0x161616);b.add(CYL(.09,.09,.11,8),M(0,.2,z,0,0,Math.PI/2),0x9a9a9a);}
  b.add(BOX(.32,.16,.95),M(0,.36,0),0x2a2c30);b.add(BOX(.36,.32,.5),M(0,.55,-.2),0xe8e8e4);b.add(BOX(.36,.56,.08),M(0,.62,.46,0,-.25),0xe8e8e4);
  b.add(CYL(.03,.03,.55,6),M(0,.9,.52,0,-.25),0x333333);b.add(BOX(.58,.04,.04),M(0,1.16,.6),0x1a1a1a);b.add(BOX(.14,.08,.04),M(0,.98,.6),0xfff4d0);
  b.add(BOX(.3,.09,.52),M(0,.75,-.18),0x141414);
  b.add(BOX(.46,.42,.44),M(0,1.0,-.52),B.col);b.add(BOX(.47,.07,.45),M(0,1.04,-.52),B.dk);b.add(BOX(.48,.03,.46),M(0,1.22,-.52),B.col);
  const g=b.geo();g.userData.shared=true;return g;});
const lf_cour=[];
function lf_courSpawn(c,P,dmin,dmax){const e=randEdgeNear(P.x,P.z,dmin,dmax,edges,40);if(!e||e.w<6)return false;const ds=dirsFor(e,'car');if(!ds.length)return false;
  const a={kind:'car'};placeAgent(a,e,mpick(ds),Math.random()*.8+.1);c.a=a;c.x=a.x;c.z=a.z;c.h=Math.atan2(a.hx,a.hz);c.lat=0;c.latT=0;c.sp=6;c.down=0;c.y=null;return true;}
function lf_courUpdate(dt,P){const want=isTouch?2:3;
  while(lf_cour.length<want){const B=lf_cour.length%2?LF_BRANDS[1]:LF_BRANDS[0],m=new THREE.Mesh(lf_scootG[LF_BRANDS.indexOf(B)],VC);m.rotation.order='YXZ';m.castShadow=true;m.visible=false;scene.add(m);
    lf_cour.push({B,m,p:null,a:null,v0:mr(11.5,14.5),latT:0,lat:0,wT:0});}
  const car=P.mode==='car'?P.car:null;
  for(const c of lf_cour){
    if(!c.a||c.a.dead||Math.hypot(c.x-P.x,c.z-P.z)>330){if(c.p){lf_del(c.p);c.p=null;}c.m.visible=false;if(Math.random()<dt*.7)lf_courSpawn(c,P,c.a?140:40,c.a?280:260);continue;}
    if(!c.p){c.p=lf_add('courier',c.x,c.z,c.h,{top:c.B.col,acc:c.B.col,mask:ppl_F.hair|ppl_F.hairS|ppl_F.sleeves|ppl_F.pants|ppl_F.jacket|ppl_F.cap,armL:0,armR:0});if(!c.p)continue;c.p.st.sit=1;c.p.mv=true;c.p.noHit=true;}
    const a=c.a,fx=Math.sin(c.h),fz=Math.cos(c.h),rx=-fz,rz=fx;
    if(c.down>0){c.down-=dt;c.sp=0;if(c.down<=0){c.p.down=0;lf_sayT=0;if(Math.hypot(c.x-P.x,c.z-P.z)<30)lf_say('Curierul '+c.B.name,mpick(LF_L_COUR),1.05,'#'+c.B.col.toString(16).padStart(6,'0'));}}
    else{let target=Math.min(c.v0,a.e.vmax+3),blocked=0;
      if(a.turn>.55&&a.rem<14)target=Math.min(target,a.turn>1.2?6:9);
      for(const o of vehicles){if(Math.abs(o.x-c.x)>22||Math.abs(o.z-c.z)>22)continue;const ox=o.x-c.x,oz=o.z-c.z,ah=ox*fx+oz*fz;if(ah<=0||ah>12+o.spec.len/2)continue;
        const lr=ox*rx+oz*rz;if(Math.abs(lr)>o.spec.wid/2+.75)continue;blocked=lr>0?-1:1;const gap=ah-o.spec.len/2-1.5;if(Math.abs(c.lat)>1.4)target=Math.min(target,Math.max(0,gap*1.4));}
      if(P.mode==='foot'){const ox=P.x-c.x,oz=P.z-c.z,ah=ox*fx+oz*fz;if(ah>0&&ah<8&&Math.abs(ox*rx+oz*rz)<1)target=0;}
      c.wT-=dt;if(blocked){c.latT=blocked*1.8;c.wT=2.5;if(Math.random()<dt*.5)lf_beep(c.x,c.z);}else if(c.wT<=0){c.wT=mr(2,4);c.latT=mr(-.7,.7);}
      const l0=c.lat;c.lat+=clamp(c.latT-c.lat,-1.4*dt,1.4*dt);
      c.sp+=clamp(target-c.sp,-12*dt,3.5*dt);agentStep(a,Math.max(0,c.sp)*dt);if(a.dead)continue;
      const h0=c.h;c.h=lerpAng(c.h,Math.atan2(a.hx,a.hz),1-Math.exp(-7*dt));c.x=a.x+(-a.hz)*c.lat;c.z=a.z+a.hx*c.lat;
      const roll=clamp(angDiff(c.h,h0)/Math.max(dt,1e-3)*.18*Math.min(1,c.sp/6)+(c.lat-l0)/Math.max(dt,1e-3)*.12,-.35,.35);c.roll=(c.roll||0)+(roll-(c.roll||0))*Math.min(1,dt*5);
      // knocked over by the player's car
      if(car&&Math.abs(car.speed)>4&&Math.abs(car.x-c.x)<7&&Math.abs(car.z-c.z)<7&&lf_segD(car,c.x,c.z)<car.spec.wid/2+.45){c.down=4;c.p.down=4;c.roll=0;gtcApi.addStar(1);gtcApi.shake=.25;if(typeof fxEvent==='function')fxEvent('knockdown',{x:c.x,z:c.z});}}
    c.y=surfaceY(c.x,c.z,c.y==null||!isFinite(c.y)?null:c.y,fx,fz);
    c.m.visible=true;c.m.position.set(c.x,c.y,c.z);c.m.rotation.set(0,c.h,c.down>0?1.35:c.roll||0);
    const p=c.p;p.h=c.h;p.roll=c.down>0?0:(c.roll||0);if(c.down>0){p.x=c.x+rx*1.3;p.z=c.z+rz*1.3;}else{p.x=c.x-fx*.12;p.z=c.z-fz*.12;}p.dy=.29;p.sp=0;}}

// ================= events =================
let lf_ev=null,lf_evT=40,lf_evLast='';
// fender-bender: two cars in the curb lane, the drivers arguing on the kerb
function lf_evCrash(P){const e=lf_aheadEdge(P.x,P.z,e=>e.w>=7&&e.len>40&&!e.tw);if(!e)return null;const dir=mpick(dirsFor(e,'car')),k=e.nPer-1;
  const Pt=edgePath(e,dir,laneOff(e,'car',k)),L=lf_len(Pt),s0=L*mr(.45,.7),tA=mpick(['logan','yaris','lada','suv']),tB=mpick(['logan','lada','yaris','taxi']);
  const gap=(SPEC[tA].len+SPEC[tB].len)/2-.1,A=lf_along(Pt,s0),B=lf_along(Pt,s0-gap);
  if(!lf_free(A.x,A.z,1.6)||!lf_free(B.x,B.z,1.6)||vehicles.some(v=>Math.hypot(v.x-A.x,v.z-A.z)<14))return null;
  const S=lf_scene('crash',A.x,A.z,A.h);const vA=makeVehicle(tA,A.x,A.z,A.h+mr(-.05,.05)),vB=makeVehicle(tB,B.x,B.z,B.h+mpick([-1,1])*mr(.1,.2));S.cars.push(vA,vB);
  const rx=-A.uz,rz=A.ux,mx=(A.x+B.x)/2+rx*2.1,mz=(A.z+B.z)/2+rz*2.1;
  const d1=lf_add(mpick(['man','track']),mx+A.ux*.6,mz+A.uz*.6,A.h+Math.PI),d2=lf_add(mpick(['office','man','woman']),mx-A.ux*.6,mz-A.uz*.6,A.h,{armL:ppl_F.phone});
  for(const p of[d1,d2])if(p){p.solid=true;S.people.push(p);}if(d1&&d2){d1.lookAt=d2;d2.lookAt=d1;}
  const T=lf_along(Pt,s0-gap-9);const S2={x:T.x,z:T.z,a:T.h+Math.PI,y:groundY(T.x,T.z),props:S.props};
  lf_mesh(S2,b=>{b.add(CYL(.32,.32,.03,3),M(0,.3,0,0,Math.PI/2,0),0xd01818);b.add(CYL(.2,.2,.035,3),M(0,.3,0,0,Math.PI/2,0),0xf0f0f0);b.add(BOX(.5,.02,.12),M(0,.02,0),0x222222);});
  lf_mesh(S,b=>{for(let i=0;i<6;i++)b.add(BOX(mr(.08,.25),.02,mr(.05,.15)),M(mr(-1,1),.02,-gap/2+mr(-.6,.6),mr(0,3)),mpick([0x202020,0x8a8a8a,0xb01818]));});
  S.li=0;S.life=200;
  S.upd=(dt,P,d)=>{if(d<28&&S.talkT<=0&&S.li<LF_L_CRASH.length){const w=S.li%2;lf_sayT=0;if(lf_say(w?'Șoferița':'Șoferul',LF_L_CRASH[S.li],w?1.22:.95,w?'#ffb3d1':'#ffd27f')){S.li++;S.talkT=3;}}
    if(S.li>=LF_L_CRASH.length&&S.talkT<=-25)S.li=0;const t=performance.now()/1000,w=S.li%2;if(d1)d1.st.wave=w===1&&Math.sin(t*3)>-.4;if(d2){d2.st.wave=w===0&&Math.sin(t*3+1)>-.4;d2.phone=!d2.st.wave;}
    S.cars=S.cars.filter(v=>v.mode==='parked');};
  return S;}
// wedding convoy: decorated cars driving in a line, honking
const lf_balG=(()=>{const b=new Bk(VC);for(const [x,z,c] of[[.75,.85,0xffffff],[-.75,.85,0xe02030],[.8,.6,0xf0c0d0],[-.8,.6,0xffffff]]){b.add(new THREE.SphereGeometry(.2,10,8),M(x,2.05+mr(0,.25),z,0,0,0,1,1.2,1),c);b.add(BOX(.008,.62,.008),M(x,1.55,z),0xf4f4f4);}
  b.add(BOX(.08,.02,1.6),M(.35,1.32,.2),0xffffff);b.add(BOX(.08,.02,1.6),M(-.35,1.32,.2),0xffffff);const g=b.geo();g.userData.shared=true;return g;})();
function lf_evWedding(P){const e=lf_aheadEdge(P.x,P.z,e=>e.w>=7&&e.len>60&&!e.tw,60,200);if(!e)return null;const ds=dirsFor(e,'car');if(!ds.length)return null;
  const a={kind:'car'};placeAgent(a,e,mpick(ds),mr(.55,.85));if(lf_len(a.path.slice(0,a.seg+1).concat([[a.x,a.z]]))<30)return null;
  const T=a.path.slice(0,a.seg+1).concat([[a.x,a.z]]);if(vehicles.some(v=>Math.hypot(v.x-a.x,v.z-a.z)<10))return null;
  const S=lf_scene('wedding',a.x,a.z,0);S.trail=T;S.life=1e9;
  const lead=makeVehicle('suv',a.x,a.z,Math.atan2(a.hx,a.hz),0x111214);lead.mode='ai';lead.ai=a;lead.driver=true;lead.v0=mr(8.5,10.5);lead.speed=5;a.stopT=0;a.lastStop=-1;lead.lfOwn=true;S.lead=lead;S.cars.push(lead);
  S.fol=[];const ty=[['logan',0xf4f4f2],['yaris',0x1f1f22],['suv',0xe8e8e6],['logan',0x8d9298]];
  for(let k=0;k<3+(Math.random()<.5?1:0);k++){const p=lf_trailAt(T,(k+1)*8.4);const v=makeVehicle(ty[k][0],p.x,p.z,p.h,ty[k][1]);v.mode='lf';v.driver=true;S.cars.push(v);S.fol.push(v);}
  S.bal=S.cars.map(()=>{const m=new THREE.Mesh(lf_balG,VC);scene.add(m);S.props.push(m);return m;});S.hornT=1;S.lx=a.x;S.lz=a.z;
  S.upd=(dt,P,d)=>{const L=S.lead;if(!vehicles.includes(L)||L.mode!=='ai'||Math.hypot(L.x-S.lx,L.z-S.lz)>25){S.done=true;return;}S.lx=L.x;S.lz=L.z;S.x=L.x;S.z=L.z;
    lf_trailPush(S.trail,L.x,L.z,60);
    S.fol.forEach((v,k)=>{if(v.mode!=='lf')return;const p=lf_trailAt(S.trail,(k+1)*8.4);v.speed=Math.hypot(p.x-v.x,p.z-v.z)/Math.max(dt,1e-3);v.speed=Math.min(v.speed,L.speed+2);v.x=p.x;v.z=p.z;v.h=lerpAng(v.h,p.h,1-Math.exp(-6*dt));v.y=surfaceY(v.x,v.z,v.y,Math.sin(v.h),Math.cos(v.h));});
    const t=performance.now()/1000;S.cars.forEach((v,i)=>{const m=S.bal[i];if(!vehicles.includes(v)||v.mode==='player'){m.visible=false;return;}m.visible=true;m.position.set(v.x,v.y,v.z);m.rotation.set(Math.sin(t*2+i)*.05,v.h,Math.cos(t*1.7+i)*.05);});
    S.hornT-=dt;if(S.hornT<=0&&d<170){S.hornT=mr(1.3,3);const v=mpick(S.cars);if(vehicles.includes(v))lf_horn(v.x,v.z,Math.random()<.5?[[0,.12],[.2,.12],[.4,.5]]:[[0,.35],[.45,.35]],mpick([392,440,494]));}
    if(d<22&&S.talkT<=0){if(lf_say('Nuntașii',mpick(LF_L_WED),1.05,'#ffe08a'))S.talkT=40;}};
  return S;}
// trolleybus with its poles off the wire: stops, the driver pulls the ropes behind the bus
function lf_evTrolley(P){let best=null;for(const v of vehicles){if(v.type!=='trolley'||v.mode!=='ai'||!v.ai)continue;const d=Math.hypot(v.x-P.x,v.z-P.z);if(d>50&&d<240&&(!best||d<best.d))best={v,d};}
  if(!best)return null;const v=best.v,fx=Math.sin(v.h),fz=Math.cos(v.h),rx=-fz,rz=fx;v.mode='parked';v.speed=0;
  const S=lf_scene('trolley',v.x,v.z,v.h);S.bus=v;S.life=mr(35,55);
  const dr=lf_add('man',v.x-fx*(v.spec.len/2+1.3),v.z-fz*(v.spec.len/2+1.3),v.h,{top:0x3a4a6a,bot:0x2a2e36,armL:0});if(dr){dr.lookTo=0;dr.st.wave=true;S.people.push(dr);S.dr=dr;}
  for(let k=0;k<3;k++){const o=v.spec.wid/2+1.6,x=v.x+rx*o+fx*(2-k*2.2),z=v.z+rz*o+fz*(2-k*2.2);if(!lf_free(x,z,.4))continue;const p=lf_add(mpick(['granny','office','student','woman']),x,z,v.h+Math.PI/2*(Math.random()<.5?1:-1));if(p){p.solid=true;p.lookAt=v;S.people.push(p);}}
  S.li=0;
  S.upd=(dt,P,d)=>{if(v.mode!=='parked'||!vehicles.includes(v)){S.done=true;return;}if(S.dr)S.dr.lookTo=-.2;
    if(S.t>S.life){if(v.ai){v.mode='ai';v.ai.stopT=0;v.stuck=0;}S.done=true;return;}
    if(d<26&&S.talkT<=0&&S.li<3){if(lf_say(S.li<2?'Șoferul de troleibuz':'O pasageră',LF_L_TROL[S.li],S.li<2?.95:1.25,S.li<2?'#9fd8ff':'#ffb3d1')){S.li++;S.talkT=4;}}};
  S.end=()=>{if(v.mode==='parked'&&v.ai&&vehicles.includes(v)){v.mode='ai';v.ai.stopT=0;v.stuck=0;}};
  return S;}
// road works: cones, barrier, LUCRĂRI / OCOLIRE signs, workers, a van blocking the lane
function lf_evWorks(P){const e=lf_aheadEdge(P.x,P.z,e=>e.w>=9&&e.len>60&&!e.tw);if(!e)return null;const dir=mpick(dirsFor(e,'car')),k=e.nPer-1;
  const Pt=edgePath(e,dir,laneOff(e,'car',k)),L=lf_len(Pt),C=lf_along(Pt,L*mr(.45,.65));if(!lf_free(C.x,C.z,1.8)||vehicles.some(v=>Math.hypot(v.x-C.x,v.z-C.z)<16))return null;
  const S=lf_scene('works',C.x,C.z,C.h);S.life=240;const R=-1.6; // local -x = curb side
  lf_mesh(S,b=>{for(let i=0;i<5;i++)lf_cone(b,R+.3+i*.72,-18+i*2.2);for(let z=-6;z<=14;z+=3)lf_cone(b,1.55,z);
    for(let i=0;i<6;i++)b.add(BOX(.5,.22,.08),M(-1.25+i*.5,.85,-8),i%2?0xf2f2f2:0xd02020);for(const x of[-1.4,1.4]){b.add(BOX(.06,.85,.06),M(x,.42,-8),0x444444);b.add(BOX(.4,.05,.3),M(x,.03,-8),0x333333);}
    b.add(BOX(2.6,.04,8),M(0,.02,6),0x1c1c1e);b.add(CYL(.2,1.1,.7,8),M(-.6,.35,11.5),0x2a2724);
    b.add(BOX(1.1,.9,1.5),M(.4,.95,3),0xf2b705);b.add(CYL(.45,.45,1.1,12),M(.4,.45,2.2,0,0,Math.PI/2),0x5a5a5a);b.add(CYL(.45,.45,1.1,12),M(.4,.45,3.9,0,0,Math.PI/2),0x5a5a5a);b.add(BOX(.9,.06,.9),M(.4,1.62,3.2),0x222222);
    b.add(BOX(.06,1.6,.06),M(-2.5,.8,-18),0x777777);b.add(BOX(.06,1.4,.06),M(1.7,.7,-8.2),0x777777);});
  lf_sign(S,'⚠ LUCRĂRI',-2.5,1.75,-18.05,Math.PI,.95,.6,'#f7d117','#111');
  lf_sign(S,'← OCOLIRE',0,1.25,-8.1,Math.PI,1.3,.36,'#1f5fbf','#fff');
  const van=makeVehicle('rutiera',...lf_W(S,0,-3.5),C.h,0xf0f0ec);S.cars.push(van);
  for(const [lx,lz,ry,pose] of[[-.6,6,Math.PI,'work'],[.6,8.5,Math.PI*.8,'work'],[-1.4,10,Math.PI/2,'idle'],[-2.6,0,Math.PI/2,'phone']]){const [x,z]=lf_W(S,lx,lz);const p=lf_add('worker',x,z,S.a+ry);if(!p)continue;
    if(pose==='work')p.st.work=1;else p.solid=true;if(pose==='phone')p.phone=true;S.people.push(p);}
  S.upd=(dt,P,d)=>{if(d<14&&S.talkT<=0){if(lf_say('Muncitorul',mpick(LF_L_WORK),.92,'#ffb36a'))S.talkT=25;}S.cars=S.cars.filter(v=>v.mode==='parked');};
  return S;}
// funeral procession: walking slowly in the curb lane behind a cross and a wreath, a dark van following
const lf_crossG=(()=>{const b=new Bk(VC);b.add(BOX(.07,1.7,.05),M(0,0,0),0x3a2414);b.add(BOX(.6,.07,.05),M(0,.45,0),0x3a2414);const g=b.geo();g.userData.shared=true;return g;})();
const lf_wreathG=(()=>{const b=new Bk(VC);b.add(new THREE.TorusGeometry(.42,.1,6,16),M(0,0,0),0x1f4a26);for(let i=0;i<8;i++){const an=i/8*TAU;b.add(new THREE.SphereGeometry(.06,6,4),M(Math.cos(an)*.42,Math.sin(an)*.42,.06),i%2?0xf0f0f0:0xb01020);}
  b.add(BOX(.12,.5,.02),M(.15,-.5,.05,0,0,.2),0x111111);b.add(BOX(.12,.5,.02),M(-.15,-.5,.05,0,0,-.2),0x111111);const g=b.geo();g.userData.shared=true;return g;})();
function lf_evFuneral(P){const e=lf_aheadEdge(P.x,P.z,e=>e.w>=6&&e.w<=12&&!e.ow&&e.len>70&&!e.tw);if(!e)return null;
  const a={kind:'car'};placeAgent(a,e,mpick([1,-1]),mr(.5,.75));a.k=e.nPer-1;a.path=edgePath(e,a.dir,laneOff(e,'car',a.k));
  const s=lf_len(a.path)*mr(.5,.75),pt=lf_along(a.path,s);
  // put the agent exactly at that point of the curb-lane path
  let acc=0;for(let i=1;i<a.path.length;i++){const l=Math.hypot(a.path[i][0]-a.path[i-1][0],a.path[i][1]-a.path[i-1][1]);if(acc+l>=s){a.seg=i-1;break;}acc+=l;}a.x=pt.x;a.z=pt.z;a.hx=pt.ux;a.hz=pt.uz;
  const T=a.path.slice(0,a.seg+1).concat([[a.x,a.z]]);if(lf_len(T)<24||!lf_free(a.x,a.z,1)||vehicles.some(v=>Math.hypot(v.x-a.x,v.z-a.z)<16))return null;
  const S=lf_scene('funeral',a.x,a.z,0);S.ag=a;S.trail=T;S.life=1e9;S.v=1.0;
  const slots=[[0,0]];slots.push([1.6,-.55],[1.6,.55]);for(let r=0;r<4;r++)slots.push([3.4+r*1.3,-.55],[3.4+r*1.3,.55]);
  slots.forEach(([back,lat],i)=>{const q=lf_trailAt(T,back);const p=lf_add('mourner',q.x,q.z,q.h,i===0?{top:0x111111,bot:0x111111,mask:ppl_F.hair|ppl_F.hairS|ppl_F.beard|ppl_F.coat|ppl_F.sleeves|ppl_F.pants}:null);if(p){p.mv=true;p.back=back;p.lat=lat;p.o.v=S.v;S.people.push(p);}});
  S.cross=new THREE.Mesh(lf_crossG,VC);S.wr=new THREE.Mesh(lf_wreathG,VC);scene.add(S.cross,S.wr);S.props.push(S.cross,S.wr);
  const q=lf_trailAt(T,14);if(lf_free(q.x,q.z,1.2)){const van=makeVehicle('rutiera',q.x,q.z,q.h,0x15161a);van.mode='lf';van.driver=true;S.cars.push(van);S.van=van;}
  S.upd=(dt,P,d)=>{const stop=S.people.some(p=>p.down>0)||(P.mode==='foot'&&Math.hypot(P.x-a.x,P.z-a.z)<1.5);agentStep(a,stop?0:S.v*dt);if(a.dead){S.done=true;return;}S.x=a.x;S.z=a.z;lf_trailPush(S.trail,a.x,a.z,40);
    for(const p of S.people){if(p.down>0){p.sp=0;continue;}const q=lf_trailAt(S.trail,p.back),rx=Math.cos(q.h),rz=-Math.sin(q.h);p.x=q.x+rx*p.lat;p.z=q.z+rz*p.lat;p.h=lerpAng(p.h,q.h,1-Math.exp(-5*dt));p.sp=stop?0:S.v;}
    const p0=S.people[0];if(p0){S.cross.position.set(p0.x+Math.sin(p0.h)*.35,(p0.y||0)+1.35,p0.z+Math.cos(p0.h)*.35);S.cross.rotation.y=p0.h;}
    const w1=S.people[1],w2=S.people[2];if(w1&&w2){S.wr.position.set((w1.x+w2.x)/2+Math.sin(w1.h)*.4,(w1.y||0)+1.25,(w1.z+w2.z)/2+Math.cos(w1.h)*.4);S.wr.rotation.y=w1.h;}
    if(S.van&&S.van.mode==='lf'){const v=S.van,q=lf_trailAt(S.trail,14);v.speed=stop?0:S.v;v.x=q.x;v.z=q.z;v.h=lerpAng(v.h,q.h,1-Math.exp(-4*dt));v.y=surfaceY(v.x,v.z,v.y,Math.sin(v.h),Math.cos(v.h));}
    if(d<18&&S.talkT<=0){if(lf_say('Un bătrân',mpick(LF_L_FUN),.85,'#c8c8c8'))S.talkT=45;}};
  return S;}
// police checkpoint: two cars on the kerb, an officer waving traffic through
function lf_evPolice(P){const e=lf_aheadEdge(P.x,P.z,e=>e.w>=8&&e.len>50&&!e.tw,90,240);if(!e)return null;
  let dir=dirsFor(e,'car').find(d=>{const[ux,uz]=edgeDir(e,d,false);return (e.mid[0]-P.x)*ux+(e.mid[1]-P.z)*uz>0;});if(dir==null)dir=mpick(dirsFor(e,'car'));
  const Pt=edgePath(e,dir,laneOff(e,'car',e.nPer-1)),C=lf_along(Pt,lf_len(Pt)*mr(.45,.65));
  const S=lf_scene('police',C.x,C.z,C.h);S.life=240;const rx=-C.uz,rz=C.ux;
  for(const [fw,ang] of[[0,.28],[9,.2]]){const x=C.x+C.ux*fw+rx*2.2,z=C.z+C.uz*fw+rz*2.2;if(!lf_free(x,z,1.2))continue;const v=makeVehicle('police',x,z,C.h+ang);S.cars.push(v);}
  if(!S.cars.length){lf_kill(S);return null;}
  const o1=lf_add('police',...lf_W(S,.2,-5),C.h+Math.PI),o2=lf_add('police',...lf_W(S,-3.3,2.5),C.h-Math.PI/2);if(o1){o1.solid=true;o1.st.wave=true;o1.lookAt=gtcApi.player;S.people.push(o1);}if(o2){o2.solid=true;o2.lookAt=gtcApi.player;S.people.push(o2);}
  lf_mesh(S,b=>{for(let i=0;i<4;i++)lf_cone(b,-1.6+i*.6,-12+i*1.6);b.add(BOX(.05,1.5,.05),M(-2.4,.75,-14),0x777777);});
  lf_sign(S,'STOP\nPOLIȚIA',-2.4,1.6,-14.05,Math.PI,.62,.62,'#d01818','#fff');
  S.upd=(dt,P,d)=>{const st=gtcApi.stars;
    if(st>0&&d<70&&!S.alarm){S.alarm=true;for(const v of S.cars)if(v.mode==='parked'){v.mode='chase';v.driver=true;v.ai=null;}lf_sayT=0;lf_say('Polițistul',LF_L_POL[3],.95,'#9fb7ff');}
    if(S.alarm)S.cars=S.cars.filter(v=>v.mode==='parked');
    if(o1){o1.st.wave=Math.sin(performance.now()/400)>-.3;const dO=Math.hypot(P.x-o1.x,P.z-o1.z);
      if(P.mode==='car'&&dO<15&&!S.passed&&st===0){S.passed=true;lf_sayT=0;const fast=Math.abs(P.car.speed)>14;lf_say('Polițistul',fast?LF_L_POL[2]:LF_L_POL[1],.95,'#9fb7ff');if(fast)gtcApi.addStar(1);}
      if(P.mode==='foot'&&dO<4&&S.talkT<=0){if(lf_say('Polițistul',LF_L_POL[0],.95,'#9fb7ff'))S.talkT=30;}
      if(dO>40)S.passed=false;}};
  return S;}
const LF_EVENTS={crash:[3,lf_evCrash],wedding:[2,lf_evWedding],trolley:[2,lf_evTrolley],works:[3,lf_evWorks],funeral:[1,lf_evFuneral],police:[2,lf_evPolice]};
function lf_evStart(P,kind){let k=kind;if(!k){let tot=0;for(const n in LF_EVENTS)if(n!==lf_evLast)tot+=LF_EVENTS[n][0];let r=Math.random()*tot;for(const n in LF_EVENTS){if(n===lf_evLast)continue;r-=LF_EVENTS[n][0];if(r<=0){k=n;break;}}}
  const S=LF_EVENTS[k]&&LF_EVENTS[k][1](P);if(!S)return null;S.ev=true;lf_ev=S;lf_evLast=k;return S;}

// ================= ambient manager =================
const lf_grps=new Map(); // spawned groups near fixed places: key → anchor
const lf_poi=re=>{const p=D.pois.find(p=>re.test(p[0]));return p?{x:p[1],z:p[2]}:null;};
let LF_PLACES=null;
function lf_places(){if(LF_PLACES)return LF_PLACES;const L=[];const add=(key,re,fn,r)=>{const p=re.x!=null?re:lf_poi(re);if(p)L.push({key,x:p.x,z:p.z,fn,r:r||400});};
  add('market',/^Piața Centrală$/,lf_spawnMarket,450);
  add('usm',/^USM$/,lf_spawnStudents);add('asem',{x:520,z:-700},lf_spawnStudents);add('utm',/^Technical University of Moldova$/,lf_spawnStudents);
  add('vm',/^Lacul Valea Morilor$/,lf_spawnValea,500);
  for(const re of[/^Grădina Publică/,/^Parcul Zaikin$/,/^Parcul Dendrariu$/,/^Parcul Râșcani$/,/^Parcul „?La Izvor/,/^Parcul memorial/])add('park'+re.source,re,lf_spawnParkChess);
  return LF_PLACES=L;}
function lf_spawnMarket(G){const nv=lf_weekend?10:6;let n=0;
  for(let t=0;t<60&&n<nv;t++){const sp=lf_edgeSpot(G.x,G.z,0,170,e=>e.w<=16,e=>e.w/2+3);if(!sp||!lf_free(sp.x,sp.z,1.2)||lf_taken(sp.x,sp.z,4))continue;lf_vendor(sp.x,sp.z,sp.a,mpick(['flori','seminte','muraturi','muraturi']),G.key);n++;}
  const nc=lf_weekend?3:1;for(let k=0,t=0;k<nc&&t<30;t++){const sp=lf_edgeSpot(G.x,G.z,0,150,e=>e.w<=16,e=>e.w/2+3.4);if(!sp||!lf_free(sp.x,sp.z,1)||lf_taken(sp.x,sp.z,10))continue;lf_crowd(sp,G.key,lf_weekend?7:5);k++;}}
function lf_spawnStudents(G){const n=lf_weekend?1:3;for(let k=0,t=0;k<n&&t<30;t++){const sp=lf_edgeSpot(G.x,G.z,0,150,null,e=>e.w/2+3.2);if(!sp||!lf_free(sp.x,sp.z,1.6)||lf_taken(sp.x,sp.z,10))continue;lf_students(sp.x,sp.z,sp.a,G.key);k++;}}
function lf_spawnValea(G){const nf=lf_weekend?5:2;for(let k=0,t=0;k<nf&&t<30;t++){const e=randEdgeNear(G.x,G.z,0,380,edges,30);if(!e||e.w>12)continue;if(lf_family(e,G.key))k++;}
  for(let t=0;t<20;t++){const sp=lf_edgeSpot(G.x,G.z,0,300,e=>e.w<=9,e=>e.w/2+3.4);if(sp&&lf_free(sp.x,sp.z,1.5)&&!lf_taken(sp.x,sp.z,10)){lf_chess(sp.x,sp.z,sp.a,G.key);break;}}
  for(let t=0;t<20;t++){const sp=lf_edgeSpot(G.x,G.z,0,300,null,e=>e.w/2+3);if(sp&&lf_free(sp.x,sp.z,1.2)&&!lf_taken(sp.x,sp.z,10)){lf_vendor(sp.x,sp.z,sp.a,'seminte',G.key);break;}}}
function lf_spawnParkChess(G){const n=lf_weekend?2:1;for(let k=0,t=0;k<n&&t<30;t++){const sp=lf_edgeSpot(G.x,G.z,0,220,e=>e.w<=10,e=>e.w/2+3.4);if(!sp||!lf_free(sp.x,sp.z,1.5)||lf_taken(sp.x,sp.z,12))continue;lf_chess(sp.x,sp.z,sp.a,G.key);k++;}}
// generic, anywhere: vendors at some bus stops, a chess table on a quiet street, sidewalk-parked cars
const lf_stopVend=s=>((s.i*7919)%100)<30;
function lf_manage(P){
  for(const S of lf_scenes.slice()){const d=Math.hypot(S.x-P.x,S.z-P.z);
    if(S.done||(S.ev&&(d>400||(S.t>S.life&&d>130)))||(!S.ev&&!S.grp&&d>380)){lf_kill(S);if(S.ev)lf_evT=mr(60,130);}}
  for(const G of lf_places()){const d=Math.hypot(G.x-P.x,G.z-P.z);
    if(lf_grps.has(G.key)){if(d>G.r+80){lf_grps.delete(G.key);for(const S of lf_scenes.slice())if(S.grp===G.key)lf_kill(S);}}
    else if(d<G.r&&worldReadyAt(G.x,G.z)){lf_grps.set(G.key,G);G.fn(G);}}
  const near=k=>lf_scenes.filter(S=>S.kind===k&&!S.grp).length;
  if(near('vend')<3)for(const s of stops){if(!lf_stopVend(s))continue;const d=Math.hypot(s.px-P.x,s.pz-P.z);if(d<70||d>240||lf_taken(s.px,s.pz,14))continue;
    const ns=nearestSeg(s.px,s.pz,30);if(!ns)continue;const dx=s.px-ns.qx,dz=s.pz-ns.qz,l=Math.hypot(dx,dz)||1,ux=ns.s.b[0]-ns.s.a[0],uz=ns.s.b[1]-ns.s.a[1],ul=Math.hypot(ux,uz)||1;
    const x=s.px+ux/ul*5+dx/l*.9,z=s.pz+uz/ul*5+dz/l*.9;if(!lf_free(x,z,1.1))continue;lf_vendor(x,z,Math.atan2(-dx,-dz),mpick(['flori','seminte','muraturi']));break;}
  if(near('chess')<1&&Math.random()<.3){const sp=lf_edgeSpot(P.x,P.z,80,240,e=>e.w<=8,e=>e.w/2+3.4);if(sp&&lf_free(sp.x,sp.z,1.5)&&!lf_taken(sp.x,sp.z,40))lf_chess(sp.x,sp.z,sp.a);}
  if(near('spark')<5)lf_sidePark(P.x,P.z,70,250);}

// ================= interaction hint (E) =================
let lf_hintEl=null,lf_cur=null;
function lf_hint(S){if(!lf_hintEl){lf_hintEl=document.createElement('div');lf_hintEl.style.cssText='position:fixed;left:50%;bottom:19%;transform:translateX(-50%);z-index:14;font:800 15px Inter,Arial,sans-serif;color:#fff;background:rgba(0,0,0,.6);padding:7px 14px;border-radius:9px;pointer-events:none;display:none';document.body.appendChild(lf_hintEl);}
  lf_cur=S;if(S){lf_hintEl.textContent=S.hint;lf_hintEl.style.display='';}else lf_hintEl.style.display='none';}
function lifeAction(){if(!lf_cur||!lf_cur.act)return false;try{lf_cur.act();}catch(e){console.error('[life]',e);}return true;}

// ================= per frame =================
let lf_mgrT=1,lf_dead=false;
function lf_update(dt,P){lf_sayT-=dt;
  const busy=typeof introBusy==='function'&&introBusy();
  lf_mgrT-=dt;if(lf_mgrT<=0&&!busy&&lf_init()){lf_mgrT=1.5;lf_manage(P);}
  if(!busy&&!lf_ev){lf_evT-=dt;if(lf_evT<=0){lf_evT=lf_evStart(P)?mr(60,130):6;}}
  let hint=null,hd=2.6;const car=P.mode==='car'?P.car:null;
  for(const S of lf_scenes){S.t+=dt;S.talkT-=dt;const d=Math.hypot(S.x-P.x,S.z-P.z);if(S.upd)S.upd(dt,P,d);
    if(S.act&&P.mode==='foot'){const dd=Math.hypot(S.ax-P.x,S.az-P.z);if(dd<hd){hd=dd;hint=S;}}}
  if(hint!==lf_cur)lf_hint(hint);
  // the player's car knocks people over; on foot you can't walk through standing people
  for(const p of lf_P){if(!p)continue;
    if(car){if(p.down>0||p.noHit||Math.abs(car.speed)<3.5||Math.abs(car.x-p.x)>8||Math.abs(car.z-p.z)>8)continue;
      if(lf_segD(car,p.x,p.z)<car.spec.wid/2+.45){p.down=4;gtcApi.addStar(1);gtcApi.shake=.2;if(typeof fxEvent==='function')fxEvent('knockdown',{x:p.x,z:p.z,p});}}
    else if(P.mode==='foot'&&(p.solid||p.st.sit)&&p.down<=0){const dx=P.x-p.x,dz=P.z-p.z,d=Math.hypot(dx,dz);if(d<.7&&d>1e-4){P.x+=dx/d*(.7-d);P.z+=dz/d*(.7-d);}}}
  lf_dogUpdate(dt,P);lf_courUpdate(dt,P);lf_render(dt);}
function lifeUpdate(dt,P){if(lf_dead||!P)return;try{lf_update(dt,P);}catch(e){console.error('[life] disabled',e);lf_dead=true;try{for(const S of lf_scenes.slice())lf_kill(S);}catch(e2){}if(lf_hintEl)lf_hintEl.style.display='none';}}
window.__life={get scenes(){return lf_scenes},get current(){return lf_ev},get weekend(){return lf_weekend},set weekend(v){lf_weekend=!!v;},
  event:k=>{const P=gtcApi.player;if(lf_ev)lf_kill(lf_ev);return !!lf_evStart(P,k);},dogs:()=>{lf_packSpawn(gtcApi.player);return lf_dogs.length;},off:()=>{lf_dead=true;for(const S of lf_scenes.slice())lf_kill(S);}};
