'use strict';
// Gameplay, AI, input, HUD, minimap, main loop. Owner: integrator/gameplay.
// optional hooks implemented by other modules (env/fx/...). Missing hooks are ignored.
function hook(name,...a){const f=window[name]||(typeof globalThis[name]==='function'?globalThis[name]:null);try{if(typeof f==='function')return f(...a);}catch(e){console.error('hook '+name,e);}}
// steering value for vehicle animation: player uses input, AI derives from heading change
async function main(){
await progress('SE ÎNCARCĂ HARTA…');
initMap(await (await fetch(WORLD.base+'world.json',{cache:'no-cache'})).json());
if(D.attribution){const o=$('osm');if(o)o.innerHTML='Hartă: '+D.attribution.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace('OpenStreetMap contributors','<a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>');}
await initHeight();
await progress('CONSTRUIM ORAȘUL…');
{const __t=performance.now();await worldInitialLoad((a,b)=>{playBtn.textContent='SE ÎNCARCĂ ORAȘUL… '+Math.round(a/b*100)+'%';},D.special.arc[0],D.special.arc[1]);(window.__lt=window.__lt||{}).world=Math.round(performance.now()-__t);}
for(const b of buckets.values())scene.add(b.mesh());scene.add(SB.mesh());
{const __t=performance.now();hook('envPostBuild');(window.__lt=window.__lt||{})['envPostBuild']=Math.round(performance.now()-__t);}hook('fxInit');
await progress('PARCĂM MAȘINILE…');
const arcP=D.special.arc;
const SPAWN=(()=>{const ns=nearestSeg(arcP[0],arcP[1],200,s=>/Ștefan cel Mare/.test(s.r.name));const s=ns.s;const dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1],l=Math.hypot(dx,dz);const ux=dx/l,uz=dz/l;let nx=-uz,nz=ux;
  if((arcP[0]-ns.qx)*nx+(arcP[1]-ns.qz)*nz<0){nx=-nx;nz=-nz;}const o=s.r.w/2+2.2;const qx=ns.qx-ux*16,qz=ns.qz-uz*16;return {x:qx+nx*o,z:qz+nz*o,h:Math.atan2(-nx,-nz),ux,uz,nx,nz,w:s.r.w,qx,qz};})();
const player={mode:'foot',x:SPAWN.x,z:SPAWN.z,h:SPAWN.h,speed:0,car:null,ph:0};
player.m=makePersonGroup(0xff7a1a,0x2b3a5c,0xe8c3a0);
// ================= autosave (browser localStorage) =================
const SAVE_K='gtc_save';
const SAVE=(()=>{try{const s=JSON.parse(localStorage.getItem(SAVE_K)||'null');
  if(s&&s.v===1&&isFinite(s.x)&&isFinite(s.z)&&s.x>=BX0&&s.x<=BX1&&s.z>=BZ0&&s.z<=BZ1)return s;}catch(e){}return null;})();
if(SAVE){player.x=SAVE.x;player.z=SAVE.z;player.h=isFinite(SAVE.h)?SAVE.h:0;
  if(WORLD.mode==='stream'){await progress('REVENIM UNDE AI RĂMAS…');await worldLoadAround(player.x,player.z,WORLD.startR,1000,(a,b)=>{playBtn.textContent='REVENIM UNDE AI RĂMAS… '+Math.round(a/b*100)+'%';});}}
const starter=(()=>{const sgn=(-SPAWN.uz*SPAWN.nx+SPAWN.ux*SPAWN.nz)>0?1:-1;const dx=SPAWN.ux*sgn,dz=SPAWN.uz*sgn;const o=SPAWN.w/2-1.15;
  return makeVehicle('taxi',SPAWN.qx+SPAWN.nx*o+SPAWN.ux*4,SPAWN.qz+SPAWN.nz*o+SPAWN.uz*4,Math.atan2(dx,dz),0xf2c318);})();
for(const p of peds)spawnPedAgent(p,{x:player.x,z:player.z,min:0,max:260});
function spawnAI(type,kind,near){const list=kind==='trolley'?wiredEdges:edges;if(!list.length)return null;
  const e=(near?randEdgeNear(near.x,near.z,near.min,near.max,list):null)||(WORLD.mode==='stream'?null:list[Math.floor(Math.random()*list.length)]);if(!e)return null;const ds=dirsFor(e,kind);if(!ds.length)return null;
  const a={kind};placeAgent(a,e,mpick(ds),Math.random()*.8+.1);const v=makeVehicle(type,a.x,a.z,Math.atan2(a.hx,a.hz));if(!v)return null;
  v.mode='ai';v.ai=a;v.driver=true;v.v0=type==='trolley'?9.5:type==='rutiera'?mr(12,15):mr(10.5,15);v.speed=v.v0*.6;a.stopT=0;a.lastStop=-1;return v;}
function respawnAI(v){v.rcd=(v.rcd||0);if(performance.now()<v.rcd)return;v.rcd=performance.now()+1500;const kind=v.ai.kind,list=kind==='trolley'?wiredEdges:edges;const e=randEdgeNear(player.x,player.z,160,420,list,60);if(!e)return;const ds=dirsFor(e,kind);if(!ds.length)return;
  placeAgent(v.ai,e,mpick(ds),Math.random()*.8+.1);v.x=v.ai.x;v.z=v.ai.z;v.h=Math.atan2(v.ai.hx,v.ai.hz);v.speed=v.v0*.5;v.ai.dead=false;v.stuck=0;}
const near0={x:player.x,z:player.z,min:20,max:500};
const MIX=[['taxi',10],['yaris',4],['logan',7],['lada',6],['suv',4],['rutiera',6],['police',2]]; // ponytail: thinned traffic, map accuracy over density
for(const [t,n] of MIX)for(let i=0;i<n;i++)spawnAI(t,'car',near0);
for(let i=0;i<7;i++)spawnAI('trolley','trolley',{x:player.x,z:player.z,min:30,max:900});
// parked cars (half on the kerb, Chișinău style) — kept around the player, recycled as you move through the city
if(SAVE&&SAVE.car&&SPEC[SAVE.car]){const v=makeVehicle(SAVE.car,player.x,player.z,player.h,SAVE.paint);
  if(v){v.mode='player';v.ai=null;v.driver=false;player.car=v;player.mode='car';player.m.visible=false;}}
const PARK_N=40;
function parkSpawn(minR,maxR){const e=randEdgeNear(player.x,player.z,minR,maxR,edges,20);if(!e||e.w>12||e.len<25)return false;const P=e.pts;const s=Math.floor(Math.random()*(P.length-1));
  const a=P[s],b=P[s+1],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);if(l<12)return false;const t=mr(.25,.75),side=Math.random()<.5?1:-1;const nx=-dz/l*side,nz=dx/l*side;const o=e.w/2+.55;
  const x=a[0]+dx*t+nx*o,z=a[1]+dz*t+nz*o;if(pushOut(x,z,2.2)||vehicles.some(v=>Math.abs(v.x-x)<6&&Math.abs(v.z-z)<6))return false;
  const r=Math.random();const type=r<.28?'taxi':r<.45?'yaris':r<.68?'logan':r<.86?'lada':r<.95?'suv':'rutiera';const v=makeVehicle(type,x,z,Math.atan2(dx,dz)+(side<0&&Math.random()<.5?Math.PI:0));if(v)v.parkedAuto=true;return !!v;}
function updParked(){let n=0;for(const v of vehicles.slice()){if(!v.parkedAuto)continue;if(v.mode!=='parked'){v.parkedAuto=false;continue;}
    if(Math.hypot(v.x-player.x,v.z-player.z)>480){removeVehicle(v);continue;}n++;}
  for(let k=0;k<14&&n<PARK_N;k++)if(parkSpawn(150,400))n++;}
{let n=0,tries=0;while(n<PARK_N&&tries++<2500)if(parkSpawn(10,380))n++;}

// ================= collision helpers =================
function circles(v){const sp=v.spec,r=sp.wid*.55,n=Math.max(1,Math.round(sp.len/sp.wid)),fx=Math.sin(v.h),fz=Math.cos(v.h),out=[];
  for(let i=0;i<n;i++){const t=n===1?0:-1+2*i/(n-1),o=t*(sp.len/2-r);out.push([v.x+fx*o,v.z+fz*o,r]);}return out;}
function segDist(v,px,pz){const fx=Math.sin(v.h),fz=Math.cos(v.h),L=v.spec.len/2-v.spec.wid/2;const t=clamp((px-v.x)*fx+(pz-v.z)*fz,-L,L);return Math.hypot(px-(v.x+fx*t),pz-(v.z+fz*t));}
let shake=0;
function collideVehicle(v){let tx=0,tz=0,hit=false,other=null,wall=false;const cs=circles(v);
  for(const [x,z,r] of cs){const p=pushOut(x,z,r);if(p){tx+=p.x;tz+=p.z;hit=true;wall=true;}}
  for(const o of vehicles){if(o===v)continue;const lim=(v.spec.len+o.spec.len)/2+1;if(Math.abs(o.x-v.x)>lim||Math.abs(o.z-v.z)>lim)continue;
    for(const [x,z,r] of cs)for(const [ox,oz,orr] of circles(o)){const dx=x-ox,dz=z-oz,d=Math.hypot(dx,dz),m=r+orr;
      if(d<m&&d>1e-4){const k=(m-d)/d;if(o.mode==='chase'||(o.mode==='parked'&&o.spec.len<7)){tx+=dx*k*.5;tz+=dz*k*.5;o.x-=dx*k*.5;o.z-=dz*k*.5;}else{tx+=dx*k;tz+=dz*k;}hit=true;other=o;}}}
  if(hit){v.x+=tx;v.z+=tz;const imp=Math.abs(v.speed),newCar=!wall&&other!==v.lastHit; // car contact: -10% once per new contact, not per substep/frame while overlapping
    if(wall||newCar){if(wall)v.speed*=imp>4?.7:.925;else v.speed*=.9;if(imp>4&&v===player.car){shake=Math.min(1,imp/(wall?25:40));if(imp>9)crashSnd(imp);hook('fxEvent','crash',{x:v.x,z:v.z,imp,v});hook('carcareCrash',v,imp);}}}
  v.lastHit=other;
  v.x=clamp(v.x,BX0,BX1);v.z=clamp(v.z,BZ0,BZ1);return other;}

// ================= input =================
const keys={};let lookOff=0,camYaw=player.h,camMode=0,started=false;
// ---- mouse look (pointer lock) + pause menu ----
let paused=false,camPitch=.12,mouseT=0,suppressMenu=false;
const LS=(k,d)=>{try{const v=localStorage.getItem(k);return v==null?d:v;}catch(e){return d;}},LSset=(k,v)=>{try{localStorage.setItem(k,v);}catch(e){}};
let mouseSens=+LS('gtc_sens',1),invertY=LS('gtc_inv','0')==='1';
const locked=()=>document.pointerLockElement===canvas;
function lockMouse(){if(isTouch||!started)return;try{const p=canvas.requestPointerLock();if(p&&p.catch)p.catch(()=>{});}catch(e){}}
addEventListener('keydown',e=>{keys[e.code]=true;if(!started)return;if(e.code==='KeyE'||e.code==='KeyF')toggleCar();if(e.code==='KeyH')horn();if(e.code==='KeyC')camMode=(camMode+1)%4;if(e.code==='Space'||e.code.startsWith('Arrow'))e.preventDefault();});
addEventListener('keyup',e=>{keys[e.code]=false;});
let drag=null;
canvas.addEventListener('pointerdown',e=>{if(!isTouch&&started&&!paused){if(!locked())lockMouse();return;}drag={id:e.pointerId,x:e.clientX};});
addEventListener('mousemove',e=>{if(!locked()||paused)return;const k=.0022*mouseSens,dx=e.movementX||0,dy=e.movementY||0;
  if(player.mode==='foot')camYaw-=dx*k;else{lookOff=clamp(lookOff-dx*k,-Math.PI,Math.PI);mouseT=performance.now();}
  camPitch=clamp(camPitch+(invertY?-dy:dy)*k*.8,-.35,.95);});
addEventListener('pointermove',e=>{if(drag&&e.pointerId===drag.id){const dx=e.clientX-drag.x;drag.x=e.clientX;if(player.mode==='foot')camYaw-=dx*.008;else lookOff=clamp(lookOff-dx*.008,-Math.PI,Math.PI);}});
addEventListener('pointerup',e=>{if(drag&&e.pointerId===drag.id)drag=null;});
const joy={x:0,y:0,id:null},joyEl=$('joy'),knob=$('knob');
function joyMove(e){const r=joyEl.getBoundingClientRect();let dx=(e.clientX-(r.left+r.width/2))/(r.width/2),dy=(e.clientY-(r.top+r.height/2))/(r.height/2);const l=Math.hypot(dx,dy);if(l>1){dx/=l;dy/=l;}joy.x=dx;joy.y=-dy;knob.style.transform=`translate(${dx*40}px,${dy*40}px)`;}
joyEl.addEventListener('pointerdown',e=>{joy.id=e.pointerId;joyEl.setPointerCapture(e.pointerId);joyMove(e);e.stopPropagation();});
joyEl.addEventListener('pointermove',e=>{if(e.pointerId===joy.id)joyMove(e);});
const joyEnd=e=>{if(e.pointerId===joy.id){joy.id=null;joy.x=joy.y=0;knob.style.transform='';}};joyEl.addEventListener('pointerup',joyEnd);joyEl.addEventListener('pointercancel',joyEnd);
const btn={brake:false};
function bindBtn(id,down,up){const el=$(id);el.addEventListener('pointerdown',e=>{e.stopPropagation();el.classList.add('on');down&&down();});const u=()=>{el.classList.remove('on');up&&up();};el.addEventListener('pointerup',u);el.addEventListener('pointercancel',u);el.addEventListener('pointerleave',u);}
bindBtn('bEnter',()=>toggleCar());bindBtn('bBrake',()=>btn.brake=true,()=>btn.brake=false);bindBtn('bHorn',()=>horn());bindBtn('bCam',()=>camMode=(camMode+1)%4);
function input(){const k=keys;const t=(k.KeyW||k.ArrowUp?1:0)-(k.KeyS||k.ArrowDown?1:0)+joy.y,s=(k.KeyD||k.ArrowRight?1:0)-(k.KeyA||k.ArrowLeft?1:0)+joy.x;
  return{t:clamp(t,-1,1),s:clamp(s,-1,1),hb:!!k.Space||btn.brake,run:!!(k.ShiftLeft||k.ShiftRight)||Math.hypot(joy.x,joy.y)>.92};}

// ================= audio =================
let AC=null;const ac=()=>{if(!AC){try{AC=new (window.AudioContext||window.webkitAudioContext)();}catch(e){}}return AC;};
function horn(){hook('fxEvent','horn',{x:player.x,z:player.z});const a=ac();if(!a)return;const g=a.createGain();g.connect(a.destination);const t=a.currentTime;g.gain.setValueAtTime(.07,t);g.gain.setValueAtTime(.07,t+.32);g.gain.linearRampToValueAtTime(0,t+.4);
  for(const f of player.car&&player.car.type==='trolley'?[330,415]:[440,554]){const o=a.createOscillator();o.type='square';o.frequency.value=f;o.connect(g);o.start(t);o.stop(t+.4);}
  for(const p of peds)if(Math.hypot(p.x-player.x,p.z-player.z)<16)p.flee=1.6;}
let lastCrash=0;
function crashSnd(imp){const a=ac();if(!a||performance.now()-lastCrash<300)return;lastCrash=performance.now();const len=a.sampleRate*.25|0,buf=a.createBuffer(1,len,a.sampleRate),d=buf.getChannelData(0);
  for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2.5);const s=a.createBufferSource();s.buffer=buf;const g=a.createGain();g.gain.value=Math.min(.35,imp/60);const f=a.createBiquadFilter();f.type='lowpass';f.frequency.value=900;s.connect(f);f.connect(g);g.connect(a.destination);s.start();}
let eng=null;
function engineInit(){const a=ac();if(!a||eng)return;const o=a.createOscillator();o.type='sawtooth';const f=a.createBiquadFilter();f.type='lowpass';f.frequency.value=380;const g=a.createGain();g.gain.value=0;o.connect(f);f.connect(g);g.connect(a.destination);o.start();eng={o,g};}
function engineUpdate(){if(!eng)return;const v=player.car,t=AC.currentTime;if(!v){eng.g.gain.setTargetAtTime(0,t,.1);return;}const sp=Math.abs(v.speed)/v.spec.max;
  if(v.type==='trolley'){eng.o.type='sine';eng.o.frequency.setTargetAtTime(180+sp*620,t,.1);eng.g.gain.setTargetAtTime(.018+sp*.02,t,.1);}
  else{eng.o.type='sawtooth';eng.o.frequency.setTargetAtTime(48+((sp*4)%1)*70+sp*40,t,.08);eng.g.gain.setTargetAtTime(.032,t,.1);}}

// ================= game state =================
let money=50,stars=0,starCool=0,bustT=0,bustShow=0,mission=null,missionCD=2,lastStation=-1,msgT=0;
if(SAVE&&isFinite(SAVE.money))money=Math.max(0,Math.round(SAVE.money));
let saveOff=false,saveT=4;
function saveGame(){if(saveOff||!started)return;const v=player.car,sp=hook('storeSavePos')||hook('airportSavePos')||player;
  try{localStorage.setItem(SAVE_K,JSON.stringify({v:1,x:+sp.x.toFixed(1),z:+sp.z.toFixed(1),h:+sp.h.toFixed(3),money,car:v?v.type:null,paint:v&&v.paint!=null?v.paint:null,t:Date.now()}));}catch(e){}}
addEventListener('pagehide',saveGame);document.addEventListener('visibilitychange',()=>{if(document.hidden)saveGame();});
function say(t,sub='',dur=2.6,color='#fff'){const m=$('msg');m.innerHTML=t+(sub?`<small>${sub}</small>`:'');m.style.color=color;m.style.opacity=1;msgT=dur;}
function addStar(n=1){if(window.__dbg&&__dbg.noPolice)return;const was=stars;stars=Math.min(4,stars+n);starCool=0;if(stars!==was)hook('fxEvent','wanted',{stars});if(stars>was)say(stars===1?'Ești căutat!':'Nivel căutare: '+stars,'Poliția te urmărește',2,'#ffd23f');}
function makeMarker(color){const g=new THREE.Group();const c=new THREE.Mesh(new THREE.CylinderGeometry(2.4,2.4,40,24,1,true),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.28,depthWrite:false,side:THREE.DoubleSide}));c.position.y=20;
  const r=new THREE.Mesh(new THREE.RingGeometry(2,2.6,32).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.85,side:THREE.DoubleSide}));r.position.y=.3;g.add(c,r);g.visible=false;scene.add(g);return g;}
const mkP=makeMarker(0x3cff6e),mkD=makeMarker(0xffd23f);
const DESTS=D.pois.map(([name,x,z])=>{const ns=nearestSeg(x,z,250);if(!ns)return null;const s=ns.s;const dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1],l=Math.hypot(dx,dz);let nx=-dz/l,nz=dx/l;if((x-ns.qx)*nx+(z-ns.qz)*nz<0){nx=-nx;nz=-nz;}
  const o=s.r.w/2+1.8;return {name,x:ns.qx+nx*o,z:ns.qz+nz*o,cx:x,cz:z};}).filter(Boolean);
let paxMesh=null;
function startMission(){for(let t=0;t<40;t++){const e=randEdgeNear(player.x,player.z,70,300);if(!e)continue;const a={kind:'ped'};placeAgent(a,e,mpick([1,-1]),Math.random());
    const x=a.x,z=a.z;if(pushOut(x,z,.5))continue;mission={stage:'pickup',x,z};mkP.position.set(x,surfaceY(x,z),z);mkP.visible=true;
    if(paxMesh)scene.remove(paxMesh);paxMesh=makePersonGroup(mpick(SHIRTS),mpick(PANTS),mpick(SKIN));paxMesh.position.set(x,surfaceY(x,z),z);say('Client nou!','Urmărește marcajul verde de pe hartă',2.4,'#7dff8a');return;}}
function endMission(){mission=null;mkP.visible=mkD.visible=false;if(paxMesh){scene.remove(paxMesh);paxMesh=null;}missionCD=4;}
function updMission(dt){const v=player.car;
  if(!v||v.type!=='taxi'){if(mission){if(mission.stage==='drop')say('Cursă anulată','Clientul a coborât',2,'#ff8a65');endMission();}return;}
  if(!mission){missionCD-=dt;if(missionCD<=0)startMission();return;}
  const d=Math.hypot(mission.x-v.x,mission.z-v.z);if(paxMesh)paxMesh.rotation.y=Math.atan2(v.x-mission.x,v.z-mission.z);
  if(mission.stage==='pickup'){if(d<8&&Math.abs(v.speed)<3){const opts=DESTS.filter(D=>{const k=Math.hypot(D.x-v.x,D.z-v.z);return k>400&&k<2500;});const T=mpick(opts.length?opts:DESTS);const dist=Math.hypot(T.x-v.x,T.z-v.z);
      mission={stage:'drop',x:T.x,z:T.z,name:T.name,fare:Math.round(25+dist*.05),t:Math.round(dist*1.35/10+25)};mkP.visible=false;mkD.position.set(T.x,surfaceY(T.x,T.z),T.z);mkD.visible=true;if(paxMesh){scene.remove(paxMesh);paxMesh=null;}
      say('„La '+T.name+', vă rog!”','Tarif: '+mission.fare+' lei',3,'#ffd23f');}}
  else{mission.t-=dt;if(d<9&&Math.abs(v.speed)<3){const tip=Math.max(0,Math.round(mission.t*.4));money+=mission.fare+tip;say('+'+(mission.fare+tip)+' lei',tip?'Bacșiș: '+tip+' lei — mersi, șefu’!':'Cursă terminată',2.6,'#7dff8a');endMission();}
    else if(mission.t<=0){say('Prea încet!','Clientul a plecat fără să plătească',2.6,'#ff8a65');endMission();}}}

// ================= map: tile canvases (0.5 px/m) shared by minimap + full map =================
const MAPPX=250,MAP_BG='#5d6650',mapTiles=new Map(),mapRoadBins=new Map();let mapBudget=3;
for(const r of roads){if(r.kind>2)continue;let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;for(const p of r.pts){if(p[0]<x0)x0=p[0];if(p[0]>x1)x1=p[0];if(p[1]<z0)z0=p[1];if(p[1]>z1)z1=p[1];}
  const T=WORLD.T,m=r.w;for(let i=Math.floor((x0-m)/T);i<=Math.floor((x1+m)/T);i++)for(let j=Math.floor((z0-m)/T);j<=Math.floor((z1+m)/T);j++){const k=i+'_'+j;let a=mapRoadBins.get(k);if(!a){a=[];mapRoadBins.set(k,a);}a.push(r);}}
function mapTile(key){let m=mapTiles.get(key);const wt=WORLD.tiles.get(key),det=!!(wt&&wt.state==='ready'&&wt.data);
  if(m&&(m.detail||!det)){m.used=performance.now();return m.c;}
  if(mapBudget<=0)return m?m.c:null;mapBudget--;
  const T=WORLD.T,[i,j]=key.split('_').map(Number),k=MAPPX/T,X=x=>(x-i*T)*k,Z=z=>(z-j*T)*k;
  const c=m?m.c:document.createElement('canvas');c.width=c.height=MAPPX;const g=c.getContext('2d');g.fillStyle=MAP_BG;g.fillRect(0,0,MAPPX,MAPPX);
  const fillPoly=(rings,col)=>{g.fillStyle=col;g.beginPath();for(const r of rings){r.forEach((p,n)=>n?g.lineTo(X(p[0]),Z(p[1])):g.moveTo(X(p[0]),Z(p[1])));g.closePath();}g.fill('evenodd');};
  if(det){for(const [kind,ring,holes] of wt.data.a||[])fillPoly([dec(ring),...holes.map(dec)],kind==='park'?'#4b7a37':kind==='water'?'#3f86b0':kind==='plaza'?'#a49d8f':'#55565a');}
  g.lineCap='round';g.lineJoin='round';const rs=mapRoadBins.get(key)||[];
  for(const r of rs){g.strokeStyle=r.kind===0?'#e9e6dc':'#b9b5ac';g.lineWidth=Math.max(1.2,r.w*k*(r.kind===0?1.25:1));g.beginPath();r.pts.forEach((p,n)=>n?g.lineTo(X(p[0]),Z(p[1])):g.moveTo(X(p[0]),Z(p[1])));g.stroke();}
  for(const r of rs){if(!r.tw)continue;g.strokeStyle='rgba(60,130,255,.55)';g.lineWidth=1.2;g.beginPath();r.pts.forEach((p,n)=>n?g.lineTo(X(p[0]),Z(p[1])):g.moveTo(X(p[0]),Z(p[1])));g.stroke();}
  if(det)for(const b of wt.data.b||[])fillPoly([dec(b[4]),...(b[5]||[]).map(dec)],'#7a7770');
  mapTiles.set(key,{c,detail:det,used:performance.now()});
  if(mapTiles.size>220){let ok=null,ou=1e18;for(const [kk,mm] of mapTiles)if(mm.used<ou){ou=mm.used;ok=kk;}mapTiles.delete(ok);}
  return c;}
// draw map tiles covering world rect around (cx,cz) half-size hs into ctx whose transform maps world metres → px via scale sc centred at origin
function mapDrawTiles(g,cx,cz,hs,sc){const T=WORLD.T;for(let i=Math.floor((cx-hs)/T);i<=Math.floor((cx+hs)/T);i++)for(let j=Math.floor((cz-hs)/T);j<=Math.floor((cz+hs)/T);j++){
  const c=mapTile(i+'_'+j);if(c)g.drawImage(c,(i*T-cx)*sc,(j*T-cz)*sc,T*sc+.6,T*sc+.6);}}
const mapC=$('map'),mg=mapC.getContext('2d');
function drawMap(){mapBudget=3;const W=mapC.width,rad=210,sc=W/(rad*2);mg.save();mg.fillStyle=MAP_BG;mg.fillRect(0,0,W,W);mg.translate(W/2,W/2);mg.rotate(camYaw+Math.PI);
  mapDrawTiles(mg,player.x,player.z,rad*1.45,sc);
  const P=(x,z)=>[(x-player.x)*sc,(z-player.z)*sc];
  const dot=(x,z,c,r=5,edge=false)=>{let [dx,dz]=P(x,z);const l=Math.hypot(dx,dz),lim=W/2-9;if(l>lim){if(!edge)return;dx*=lim/l;dz*=lim/l;}mg.fillStyle=c;mg.beginPath();mg.arc(dx,dz,r,0,TAU);mg.fill();mg.strokeStyle='#000';mg.lineWidth=1.5;mg.stroke();};
  if(gps){gpsStroke(mg,P,gps.k+1,(rad*1.6)**2);mg.strokeStyle='rgba(0,0,0,.55)';mg.lineWidth=9;mg.stroke();mg.strokeStyle=GPS_COL;mg.lineWidth=5.5;mg.stroke();dot(gps.x,gps.z,GPS_COL,7,true);}
  for(const v of vehicles)if(v.mode==='chase')dot(v.x,v.z,(performance.now()/250|0)%2?'#ff3030':'#3070ff',5,true);
  if(player.car&&player.car.type==='trolley')for(const s of stops)if(s.i!==lastStation&&Math.abs(s.px-player.x)<400&&Math.abs(s.pz-player.z)<400)dot(s.px,s.pz,'#57a0ff',4.5);
  hook('mapIcons',mg,P,'mini',{R:W/2-9,rot:camYaw+Math.PI,sc});
  if(mission)dot(mission.x,mission.z,mission.stage==='pickup'?'#3cff6e':'#ffd23f',8,true);
  mg.restore();
  mg.save();mg.translate(W/2,W/2);mg.rotate(-(player.h-camYaw));mg.fillStyle='#fff';mg.beginPath();mg.moveTo(0,-11);mg.lineTo(8,9);mg.lineTo(0,4);mg.lineTo(-8,9);mg.closePath();mg.fill();mg.strokeStyle='#000';mg.lineWidth=2;mg.stroke();mg.restore();
  mg.save();mg.translate(W/2,W/2);mg.rotate(camYaw+Math.PI);mg.fillStyle='#fff';mg.font='900 20px Inter';mg.textAlign='center';mg.textBaseline='middle';const nr=W/2-16;mg.translate(0,-nr);mg.rotate(-(camYaw+Math.PI));mg.lineWidth=3;mg.strokeStyle='#000';mg.strokeText('N',0,0);mg.fillText('N',0,0);mg.restore();
  if(gps){const t='GPS '+gpsFmt(gpsLeft());mg.font='800 17px Inter';mg.textAlign='center';mg.textBaseline='middle';mg.lineWidth=4;mg.strokeStyle='#000';mg.fillStyle=GPS_COL;mg.strokeText(t,W/2,W-22);mg.fillText(t,W/2,W-22);}}
// districts (sector / neighbourhood polygons) for HUD + full map
const DISTRICTS=(D.districts||[]).map(([name,flat])=>{const ring=dec(flat);let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9,sx=0,sz=0;for(const p of ring){x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);z0=Math.min(z0,p[1]);z1=Math.max(z1,p[1]);sx+=p[0];sz+=p[1];}
  return {name,ring,x0,x1,z0,z1,cx:sx/ring.length,cz:sz/ring.length,area:(x1-x0)*(z1-z0)};}).sort((a,b)=>a.area-b.area);
function districtAt(x,z){for(const d of DISTRICTS)if(x>=d.x0&&x<=d.x1&&z>=d.z0&&z<=d.z1&&pip(x,z,d.ring))return d.name;return null;}

// ================= enter / exit =================
function toggleCar(){if(hook('carcareAction'))return;if(hook('storeInside')||hook('airportInside')||hook('bemolBusy'))return;
  if(player.mode==='foot'){let best=null,bd=1e9;for(const v of vehicles){if(Math.abs(v.x-player.x)>10||Math.abs(v.z-player.z)>10)continue;const d=segDist(v,player.x,player.z)-v.spec.wid/2;if(d<bd){bd=d;best=v;}}
    if(!best||bd>2.6)return;const v=best;
    if(v.driver){const p=peds.reduce((a,b)=>Math.hypot(b.x-player.x,b.z-player.z)>Math.hypot(a.x-player.x,a.z-player.z)?b:a);p.a.x=v.x+Math.cos(v.h)*2;p.a.z=v.z-Math.sin(v.h)*2;p.x=p.a.x;p.z=p.a.z;p.flee=4;
      addStar(v.type==='police'?2:1);say(v.type==='trolley'?'Ai deturnat un troleibuz!':'Mașină furată!',v.spec.name,2,'#ffd23f');}
    v.mode='player';v.ai=null;v.driver=false;player.car=v;player.mode='car';player.m.visible=false;lookOff=0;camYaw=v.h;engineInit();if(v.type==='taxi')missionCD=1.5;}
  else{const v=player.car;v.mode='parked';v.speed*=.3;player.mode='foot';player.car=null;player.m.visible=true;
    const lx=Math.cos(v.h),lz=-Math.sin(v.h);player.x=v.x+lx*(v.spec.wid/2+.8);player.z=v.z+lz*(v.spec.wid/2+.8);player.h=v.h;camYaw=v.h;}}

// ================= updates =================
function wireInfo(v){const ns=nearestSeg(v.x,v.z,14,s=>s.r.tw);if(!ns)return false;const s=ns.s,dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1],l=Math.hypot(dx,dz);
  if(Math.abs(Math.sin(v.h)*dx/l+Math.cos(v.h)*dz/l)<.8)return false;const nPer=s.r.ow?Math.max(1,Math.round(s.r.w/3.3)):Math.max(1,Math.floor(s.r.w/2/3));
  const o=s.r.ow?Math.abs(-s.r.w/2+(nPer-.5)*s.r.w/nPer):(nPer-.5)*(s.r.w/2)/nPer;return Math.abs(ns.d-o)<2.2;}
function drive(v,dt,inp){const sp=v.spec;let max=sp.max;if(v.type==='trolley'){v.wire=wireInfo(v);if(!v.wire)max*=.5;}const cm=hook('carcareDrive',v,dt,inp);if(cm)max*=cm.max;const t=inp.t*(cm?cm.t:1);
  if(t>.05){if(v.speed<-.5)v.speed+=sp.brake*t*dt;else v.speed+=sp.acc*t*dt*Math.max(0,1-Math.max(0,v.speed)/max);}
  else if(t<-.05){if(v.speed>.5)v.speed+=sp.brake*t*dt;else v.speed+=sp.acc*.7*t*dt*Math.max(0,1-Math.max(0,-v.speed)/(max*.35));}
  else v.speed-=Math.sign(v.speed)*Math.min(Math.abs(v.speed),(Math.abs(v.speed)<1.5&&Math.abs(v.grade||0)<.045?3:.45+.0012*v.speed*v.speed)*dt); // rolling resistance + air drag; parked-ish on gentle slopes
  {// gravity along the slope (heavier vehicles feel it more); grade = rise/run along the heading
   const fx=Math.sin(v.h),fz=Math.cos(v.h),L=Math.max(2,v.spec.len*.5);if(v.y==null)v.y=surfaceY(v.x,v.z,null,fx,fz);v.grade=(surfaceY(v.x+fx*L,v.z+fz*L,v.y,fx,fz)-surfaceY(v.x-fx*L,v.z-fz*L,v.y,fx,fz))/(2*L);
   const k=v.type==='trolley'||v.type==='rutiera'?1.0:.85;v.speed-=9.81*v.grade*k*dt;}
  if(v.speed>max&&t>.05)v.speed-=Math.min(v.speed-max,6*dt);else if(v.speed>max)v.speed-=Math.min(v.speed-max,1.4*dt); // throttle can't exceed max; coasting downhill may (air drag)
  if(v.speed<-max*.5)v.speed+=Math.min(-max*.5-v.speed,6*dt);if(inp.hb)v.speed-=Math.sign(v.speed)*Math.min(Math.abs(v.speed),(Math.abs(v.speed)>8?3.5:13)*dt); // drifting bleeds speed slowly; below ~30 km/h Space still brakes to a stop
  const turn=sp.turn*Math.min(1,Math.abs(v.speed)/4)*(inp.hb?1.8:1)/(1+Math.abs(v.speed)/32);v.h-=inp.s*turn*dt*(v.speed<0?-1:1);
  // drift: travel direction v.mh trails the body heading v.h; Space drops grip so the tail swings out
  if(v.mh==null||Math.abs(v.speed)<1)v.mh=v.h;v.mh=lerpAng(v.mh,v.h,1-Math.exp(-(inp.hb?3:9)*dt));v.speed*=1-Math.abs(Math.sin(v.h-v.mh))*.35*dt;
  const steps=Math.max(1,Math.ceil(Math.abs(v.speed)*dt/.7));for(let i=0;i<steps;i++){v.x+=Math.sin(v.mh)*v.speed*dt/steps;v.z+=Math.cos(v.mh)*v.speed*dt/steps;const o=collideVehicle(v);if(o&&Math.abs(v.speed)>3&&o.type==='police')addStar(1);}v.y=surfaceY(v.x,v.z,v.y,Math.sin(v.h),Math.cos(v.h));}
function updAI(v,dt){const a=v.ai;let target=Math.min(v.v0,a.e.vmax+(v.type==='taxi'?2:0));
  if(a.stopT>0){a.stopT-=dt;target=0;}
  if(a.kind==='trolley'){const rx=-Math.cos(v.h),rz=Math.sin(v.h);for(const s of stops){const dx=s.px-v.x,dz=s.pz-v.z;if(dx*dx+dz*dz<70&&dx*rx+dz*rz>0&&a.lastStop!==s.i){a.stopT=3.5;a.lastStop=s.i;target=0;}}}
  if(a.turn>.55&&a.rem<16)target=Math.min(target,a.turn>1.2?5.5:8);
  const fx=Math.sin(v.h),fz=Math.cos(v.h),look=v.spec.len/2+10;
  const chk=(ox,oz,olen,owid)=>{const rx=ox-v.x,rz=oz-v.z,ah=rx*fx+rz*fz;if(ah<=0||ah>look+olen/2)return;if(Math.abs(rx*fz-rz*fx)>(v.spec.wid+owid)/2+.1)return;const gap=ah-v.spec.len/2-olen/2;target=Math.min(target,gap<2?0:(gap-2)*1.6);};
  for(const o of vehicles){if(o===v||Math.abs(o.x-v.x)>30||Math.abs(o.z-v.z)>30)continue;if(o.mode==='ai'&&Math.sin(o.h)*fx+Math.cos(o.h)*fz<.3)continue;chk(o.x,o.z,o.spec.len,o.spec.wid);}
  if(player.mode==='foot')chk(player.x,player.z,.5,.6);
  v.speed+=clamp(target-v.speed,-16*dt,4.5*dt);agentStep(a,Math.max(0,v.speed)*dt);
  if(a.dead){respawnAI(v);return;}
  v.x=a.x;v.z=a.z;v.h=lerpAng(v.h,Math.atan2(a.hx,a.hz),1-Math.exp(-7*dt));v.y=surfaceY(v.x,v.z,v.y,a.hx,a.hz);
  v.stuck=v.speed<.4&&a.stopT<=0?v.stuck+dt:0;
  const dp=Math.hypot(v.x-player.x,v.z-player.z);if(dp>(a.kind==='trolley'?900:520)||(v.stuck>14&&dp>70))respawnAI(v);}
function updChase(v,dt){
  const dx=player.x-v.x,dz=player.z-v.z,dist=Math.hypot(dx,dz);let tx=player.x,tz=player.z;
  v.repath=(v.repath||0)-dt;
  const los=dist<60&&(()=>{for(let t=.1;t<1;t+=4/dist){{const qx=v.x+dx*t,qz=v.z+dz*t;if(solidAtAbs(qx,qz,groundY(qx,qz)+1.2))return false;}}return true;})();
  if(!los){if(v.repath<=0||!v.path||!v.path.length){v.repath=1.4;const p=astar(nodeNear(v.x,v.z),nodeNear(player.x,player.z));v.path=p?p.slice(1):null;}
    if(v.path&&v.path.length){let np=nodePos[v.path[0]];if(Math.hypot(np[0]-v.x,np[1]-v.z)<9){v.path.shift();if(v.path.length)np=nodePos[v.path[0]];}if(np){tx=np[0];tz=np[1];}}}
  const des=Math.atan2(tx-v.x,tz-v.z),da=angDiff(des,v.h);
  if(v.rev>0){v.rev-=dt;v.speed=Math.max(v.speed-22*dt,-9);v.h-=Math.sign(da)*1.4*dt;}
  else{v.h+=clamp(da,-2.4*dt,2.4*dt)*Math.min(1,Math.abs(v.speed)/4+.2);let target=los&&dist<14?Math.max(0,(dist-5)*2):30;if(Math.abs(da)>1.1)target=Math.min(target,9);
    v.speed+=clamp(target-v.speed,-26*dt,11*dt);if(Math.abs(v.speed)<1.5&&dist>10){v.stuck+=dt;if(v.stuck>1.1){v.rev=1.1;v.stuck=0;}}else v.stuck=0;}
  const steps=Math.max(1,Math.ceil(Math.abs(v.speed)*dt/.7));
  for(let i=0;i<steps;i++){v.x+=Math.sin(v.h)*v.speed*dt/steps;v.z+=Math.cos(v.h)*v.speed*dt/steps;let tx2=0,tz2=0,hit=false;
    for(const [x,z,r] of circles(v)){const p=pushOut(x,z,r);if(p){tx2+=p.x;tz2+=p.z;hit=true;}}
    for(const o of vehicles){if(o===v||o===player.car||Math.abs(o.x-v.x)>6||Math.abs(o.z-v.z)>6)continue;const ddx=v.x-o.x,ddz=v.z-o.z,d=Math.hypot(ddx,ddz);if(d<2.6&&d>1e-4){tx2+=ddx/d*(2.6-d)*.5;tz2+=ddz/d*(2.6-d)*.5;hit=true;}}
    if(hit){v.x+=tx2;v.z+=tz2;v.speed*=.9;}}v.y=surfaceY(v.x,v.z,v.y,Math.sin(v.h),Math.cos(v.h));}
function spawnChaser(){for(let t=0;t<30;t++){const e=randEdgeNear(player.x,player.z,110,200);if(!e)continue;const p=e.pts[0];if(pushOut(p[0],p[1],1.5))continue;
  const v=makeVehicle('police',p[0],p[1],Math.atan2(player.x-p[0],player.z-p[1]));if(!v)return;v.mode='chase';v.speed=10;return;}}
function updWanted(dt){const chasers=vehicles.filter(v=>v.mode==='chase');
  if(stars>0){for(const v of vehicles)if(v.mode==='ai'&&v.type==='police'&&Math.hypot(v.x-player.x,v.z-player.z)<130){v.mode='chase';v.ai=null;v.driver=true;}
    if(chasers.length<stars*2&&Math.random()<dt*.8)spawnChaser();
    const near=chasers.some(v=>Math.hypot(v.x-player.x,v.z-player.z)<60);starCool=near?0:starCool+dt;
    if(starCool>14){stars--;starCool=0;hook('fxEvent','wanted',{stars});say(stars?'Nivel căutare: '+stars:'Ai scăpat!',stars?'':'Poliția a pierdut urma',2,'#7dff8a');}
    const slow=player.mode==='foot'||Math.abs(player.car.speed)<2.5;const close=chasers.some(v=>(player.car?segDist(player.car,v.x,v.z):Math.hypot(v.x-player.x,v.z-player.z))<4.6);
    bustT=slow&&close&&!hook('storeInside')&&!hook('airportInside')?bustT+dt:Math.max(0,bustT-dt);if(bustT>2.4)busted();}
  else{for(const v of chasers){v.mode='parked';v.speed=0;}
    for(const v of vehicles.slice())if(v.type==='police'&&v.mode==='parked'&&Math.hypot(v.x-player.x,v.z-player.z)>200)removeVehicle(v);}}
// arrest respawn points: Arc + well-known POIs spread across the city (≥1.3 km apart); you're released at the nearest one
let RESPAWNS=null;
function respawnPoints(){if(RESPAWNS)return RESPAWNS;RESPAWNS=[{name:'Arcul de Triumf',x:SPAWN.x,z:SPAWN.z,h:SPAWN.h}];
  for(const d of DESTS){if(RESPAWNS.length>=16)break;if(!districtAt(d.cx,d.cz))continue;if(RESPAWNS.some(p=>Math.hypot(p.x-d.x,p.z-d.z)<1300))continue;
    RESPAWNS.push({name:d.name,x:d.x,z:d.z,h:Math.atan2(d.x-d.cx,d.z-d.cz)});}
  return RESPAWNS;}
function busted(){hook('fxEvent','busted',{x:player.x,z:player.z});const bx=player.x,bz=player.z;let R=null,rd=1e18;for(const p of respawnPoints()){const d=(p.x-bx)**2+(p.z-bz)**2;if(d<rd){rd=d;R=p;}}const fine=Math.round(money*.25);money-=fine;stars=0;bustT=0;bustShow=3;$('busted').style.opacity=1;
  if(player.car){player.car.mode='parked';player.car.speed=0;player.car=null;}player.mode='foot';player.m.visible=true;player.x=R.x;player.z=R.z;player.h=R.h;camYaw=R.h;camPos.set(R.x-Math.sin(R.h)*6,groundY(R.x,R.z)+4,R.z-Math.cos(R.h)*6);endMission();
  for(const v of vehicles)if(v.mode==='chase'){v.mode='parked';v.speed=0;}setTimeout(()=>say('Amendă: '+fine+' lei',(R.name==='Arcul de Triumf'?'Te-au lăsat la Arcul de Triumf':'Te-au lăsat lângă '+R.name),3,'#ff8a65'),1200);}
function updPeds(dt){
  for(const p of peds){const d=Math.hypot(p.x-player.x,p.z-player.z);if(d>300)spawnPedAgent(p,{x:player.x,z:player.z,min:120,max:280});
    let fall=0;
    if(p.down>0){p.down-=dt;fall=1;}
    else{const v=player.car;
      if(v&&Math.abs(v.speed)>3.5&&Math.abs(v.x-p.x)<9&&Math.abs(v.z-p.z)<9&&segDist(v,p.x,p.z)<v.spec.wid/2+.45){p.down=3.5;addStar(1);crashSnd(8);hook('fxEvent','knockdown',{x:p.x,z:p.z,p});}
      let sp=p.v;if(p.flee>0){p.flee-=dt;sp=4.2;}agentStep(p.a,sp*dt);if(p.a.dead)spawnPedAgent(p,{x:player.x,z:player.z,min:60,max:250});
      p.x=p.a.x;p.z=p.a.z;p.h=lerpAng(p.h,Math.atan2(p.a.hx,p.a.hz),1-Math.exp(-8*dt));p.ph+=dt*sp*4.2;}
    p.fall=fall;p.moveSpeed=fall?0:(p.flee>0?4.2:p.v);renderPed(p,dt);}
  renderPedsCommit();}
function updFoot(dt,inp){const fx=Math.sin(camYaw),fz=Math.cos(camYaw),rx=-fz,rz=fx;let mx=fx*inp.t+rx*inp.s,mz=fz*inp.t+rz*inp.s;const l=Math.hypot(mx,mz);const sp=inp.run?8.5:4.6;
  if(l>.08){mx/=Math.max(1,l);mz/=Math.max(1,l);player.x+=mx*sp*dt;player.z+=mz*sp*dt;player.h=lerpAng(player.h,Math.atan2(mx,mz),1-Math.exp(-12*dt));player.ph+=dt*sp*2.3*Math.min(1,l);}else player.ph*=.8;
  const p=pushOut(player.x,player.z,.4);if(p){player.x+=p.x;player.z+=p.z;}
  for(const v of vehicles){if(Math.abs(v.x-player.x)>8||Math.abs(v.z-player.z)>8)continue;for(const [x,z,r] of circles(v)){const dx=player.x-x,dz=player.z-z,d=Math.hypot(dx,dz);if(d<r+.4&&d>1e-4){player.x+=dx/d*(r+.4-d);player.z+=dz/d*(r+.4-d);}}}
  player.x=clamp(player.x,BX0,BX1);player.z=clamp(player.z,BZ0,BZ1);
  {const ns=nearestSeg(player.x,player.z,20);const tgt=ns&&ns.d<ns.s.r.w/2?-.17:0;player.yo=(player.yo||0)+(tgt-(player.yo||0))*Math.min(1,dt*12);}player.y=surfaceY(player.x,player.z,player.y,Math.sin(player.h),Math.cos(player.h));player.m.position.set(player.x,player.y+player.yo,player.z);player.m.rotation.y=player.h;animatePlayer(player.m,player.ph,l>.08?(inp.run?8.5:4.6):0,dt);}
const camPos=new THREE.Vector3(SPAWN.x,groundY(SPAWN.x,SPAWN.z)+40,SPAWN.z),camTgt=new THREE.Vector3();
function updCamera(dt){let tx,ty,tz,dist,h;
  if(player.car&&camMode===3){ // bumper cam: rigid, just ahead of the front bumper, looking down the road (mouse still looks around)
    const v=player.car,y0=v.y!=null?v.y:groundY(v.x,v.z),o=v.spec.len/2+.15,bx=v.x+Math.sin(v.h)*o,bz=v.z+Math.cos(v.h)*o;
    if(!drag&&performance.now()-mouseT>1500)lookOff*=Math.exp(-1.6*dt);camYaw=v.h+lookOff;const ax=bx+Math.sin(camYaw)*20,az=bz+Math.cos(camYaw)*20;
    camPos.set(bx,y0+.75,bz);camTgt.set(ax,surfaceY(ax,az,y0)+.75,az);camera.position.copy(camPos);}
  else{
  if(player.car){const v=player.car;tx=v.x;tz=v.z;ty=(v.y!=null?v.y:groundY(tx,tz))+(v.type==='trolley'?2.6:1.3);if(!drag&&performance.now()-mouseT>1500){lookOff*=Math.exp(-1.6*dt);camPitch+=(.12-camPitch)*(1-Math.exp(-1.2*dt));}camYaw=lerpAng(camYaw,v.h+lookOff+(v.speed<-3?Math.PI:0),1-Math.exp(-4*dt));
    dist=v.spec.cam*[1,1.5,.72][camMode%3];h=v.spec.camH*[1,1.7,.72][camMode%3];}
  else{tx=player.x;tz=player.z;ty=(player.y!=null?player.y:groundY(tx,tz))+(player.yo||0)+1.6;dist=[6.5,10,4][camMode%3];h=[2.4,4.5,1.4][camMode%3];}
  h=Math.max(.5,h+camPitch*dist*.9-.12*dist*.9);dist*=1-Math.max(0,camPitch-.5)*.35;
  const fx=Math.sin(camYaw),fz=Math.cos(camYaw);let dx=-fx*dist,dz=-fz*dist;
  for(let k=1;k<=10;k++){if(solidAtAbs(tx+dx*k/10,tz+dz*k/10,ty+h*k/10)){const f=Math.max(.15,(k-1.5)/10);dx*=f;dz*=f;break;}}
  // terrain: keep the whole camera arm above the ground (raise rather than shorten) and lift the camera a little on uphill/downhill
  let cy=ty+h;for(let k=1;k<=8;k++){const px=tx+dx*k/8,pz=tz+dz*k/8;const gy=groundY(px,pz)+1.1;const lineY=ty+h*k/8;if(gy>lineY)cy=Math.max(cy,ty+(gy-ty)*8/k);}
  cy=Math.max(cy,groundY(tx+dx,tz+dz)+1.2);
  const ahead=surfaceY(tx+fx*8,tz+fz*8,ty)-surfaceY(tx,tz,ty); // look a bit up/down the slope ahead
  const lead=player.car?player.car.speed/10:0; // ponytail: cancels the lerp's steady-state lag (v/k); without it the camera drifts ~4 m further back at 135 km/h
  camPos.lerp(_pos.set(tx+dx+Math.sin(player.car?player.car.mh:0)*lead,cy,tz+dz+Math.cos(player.car?player.car.mh:0)*lead),1-Math.exp(-10*dt));{const gmin=Math.max(groundY(camPos.x,camPos.z),surfaceY(camPos.x,camPos.z,camPos.y))+.9;if(camPos.y<gmin)camPos.y=gmin;}camTgt.set(tx+fx*2,ty+clamp(ahead,-6,6)*.35,tz+fz*2);camera.position.copy(camPos);}
  if(shake>0){camera.position.x+=(Math.random()-.5)*shake;camera.position.y+=(Math.random()-.5)*shake;shake=Math.max(0,shake-dt*2.5);}
  camera.lookAt(camTgt);if(window.__dbg&&__dbg.camOverride){const o=__dbg.camOverride;camera.position.set(o[0],o[1],o[2]);camera.lookAt(o[3],o[4],o[5]);}const spd=player.car?Math.abs(player.car.speed):0,fov=62+Math.min(20,spd*.5);if(Math.abs(camera.fov-fov)>.1){camera.fov+=(fov-camera.fov)*(1-Math.exp(-6*dt));camera.updateProjectionMatrix();} // 60 km/h → 70°, 135 km/h → 81°
  envUpdate(dt);}
let hudCache={},streetT=0;
const setH=(id,v)=>{if(hudCache[id]!==v){hudCache[id]=v;$(id).innerHTML=v;}};
let gameMin=17*60+30,zoneName='',zoneT=0;
function showZone(n){zoneName=n;const z=$('zone');z.textContent=n;z.style.opacity=1;zoneT=3.2;}
function updHUD(dt){gameMin+=dt*(60/60);const hh=Math.floor(gameMin/60)%24,mm=Math.floor(gameMin%60);setH('clock',String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0'));
  setH('money',money+' lei');setH('stars',[0,1,2,3].map(i=>i<stars?'★':'<span class="off">★</span>').join(''));
  $('stars').classList.toggle('flash',stars>0&&starCool<1);
  const x=player.x,z=player.z;streetT-=dt;
  if(zoneT>0){zoneT-=dt;if(zoneT<=0)$('zone').style.opacity=0;}
  if(streetT<=0){streetT=.4;const ns=nearestSeg(x,z,14,s=>s.r.name);setH('street',ns?ns.s.r.name:'');let bp=null,bd=170;for(const p of D.pois){const d=Math.hypot(p[1]-x,p[2]-z);if(d<bd){bd=d;bp=p[0];}}
    const zn=bp||districtAt(x,z)||(ns&&/Ștefan cel Mare/.test(ns.s.r.name)?'Bulevardul Ștefan cel Mare':'Chișinău');if(zn!==zoneName&&started)showZone(zn);}
  const v=player.car;setH('vname',v?v.spec.name:'');setH('speed',v?Math.round(Math.abs(v.speed)*3.6)+'<small>km/h</small>':'');
  setH('batt',v&&v.type==='trolley'?(v.wire?'⚡ Sub fire':'🔋 Mod baterie — întoarce-te sub fire'):'');
  if(mission&&mission.stage==='drop')setH('mission',`<div>Destinație</div><div class="t">${mission.name}</div><div>${Math.round(Math.hypot(mission.x-x,mission.z-z))} m · ⏱ ${Math.max(0,Math.ceil(mission.t))}s · ${mission.fare} lei</div>`);
  else if(mission)setH('mission',`<div>Client în așteptare</div><div class="t">${Math.round(Math.hypot(mission.x-x,mission.z-z))} m</div>`);
  else if(v&&v.type==='trolley')setH('mission','<div>Oprește în stațiile albastre</div><div>+4 lei / stație</div>');else setH('mission','');
  let hint='';if(player.mode==='foot'){let bd=9;for(const o of vehicles){if(Math.abs(o.x-x)>10||Math.abs(o.z-z)>10)continue;const d=segDist(o,x,z)-o.spec.wid/2;if(d<bd)bd=d;}if(bd<2.6)hint=(isTouch?'Apasă INTRĂ':'Apasă E')+' ca să urci';}
  const he=$('hint');if(he.textContent!==hint)he.textContent=hint;he.style.opacity=hint?1:0;setH('bEnter',player.mode==='foot'?'Intră':'Ieși');}
// full-screen map: drag to pan, wheel to zoom; Tab / Esc / ✕ to close
const bigEl=$('bigmap'),bigC=$('bigc');const FM={cx:0,cz:0,s:.25,on:false,drag:null,down:null,raf:0,ov:null};
// ================= GPS: click the big map to set a waypoint; route follows the road graph (one-ways respected when driving) =================
let gps=null;const mkG=makeMarker(0xc77dff);const GPS_COL='#c77dff';
function gpsRoute(sx,sz,tx,tz,oneway){const s=nodeNear(sx,sz,300),g=nodeNear(tx,tz,500);if(s==null||g==null)return null;
  const pts=[[sx,sz]];
  if(s!==g){const gp=nodePos[g],gs=new Map([[s,0]]),came=new Map(),closed=new Set(),H=[];
    const push=(f,n)=>{H.push([f,n]);let i=H.length-1;while(i>0){const q=(i-1)>>1;if(H[q][0]<=H[i][0])break;[H[q],H[i]]=[H[i],H[q]];i=q;}};
    const pop=()=>{const top=H[0],last=H.pop();if(H.length){H[0]=last;let i=0;for(;;){const l=2*i+1,r=l+1;let m=i;if(l<H.length&&H[l][0]<H[m][0])m=l;if(r<H.length&&H[r][0]<H[m][0])m=r;if(m===i)break;[H[m],H[i]]=[H[i],H[m]];i=m;}}return top;};
    push(0,s);let it=0,found=false;
    while(H.length&&it++<120000){const n=pop()[1];if(n===g){found=true;break;}if(closed.has(n))continue;closed.add(n);
      for(const e of adj.get(n)||[]){const fwd=e.a===n,m=fwd?e.b:e.a;if(closed.has(m))continue;if(oneway&&e.ow&&((fwd&&e.ow===-1)||(!fwd&&e.ow===1)))continue;
        const ng=gs.get(n)+e.len;if(ng<(gs.has(m)?gs.get(m):1e18)){gs.set(m,ng);came.set(m,[n,e,fwd]);const p=nodePos[m];push(ng+Math.hypot(p[0]-gp[0],p[1]-gp[1]),m);}}}
    if(!found)return oneway?gpsRoute(sx,sz,tx,tz,false):null;
    const segs=[];let c=g;while(came.has(c)){const [n,e,fwd]=came.get(c);segs.push(fwd?e.pts:e.pts.slice().reverse());c=n;}
    for(let i=segs.length-1;i>=0;i--)for(const p of segs[i])pts.push(p);}
  else pts.push(nodePos[s]);
  pts.push([tx,tz]);const cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
  return {pts,cum};}
function gpsSet(x,z){const r=gpsRoute(player.x,player.z,x,z,!!player.car);if(!r){say('GPS','Nu găsesc drum până acolo',1.8,'#ff8a65');return;}
  gps={x,z,pts:r.pts,cum:r.cum,k:0,chk:1,car:!!player.car};mkG.position.set(x,surfaceY(x,z),z);mkG.visible=true;say('GPS activat',gpsFmt(gpsLeft()),1.8,GPS_COL);}
function gpsClear(msg){gps=null;mkG.visible=false;if(msg)say(msg,'',1.8,GPS_COL);}
function gpsLeft(){if(!gps)return 0;const p=gps.pts,k=Math.min(gps.k+1,p.length-1);return gps.cum[p.length-1]-gps.cum[k]+Math.hypot(p[k][0]-player.x,p[k][1]-player.z);}
const gpsFmt=m=>m>=1000?(m/1000).toFixed(1)+' km':Math.round(m/10)*10+' m';
function gpsUpdate(dt){if(!gps)return;const p=gps.pts;
  // progress: nearest route segment a little ahead of the last one
  let bk=gps.k,bd=1e18;for(let i=Math.max(0,gps.k-2);i<Math.min(p.length-1,gps.k+80);i++){const a=p[i],b=p[i+1],dx=b[0]-a[0],dz=b[1]-a[1],l2=dx*dx+dz*dz||1e-9;
    let t=((player.x-a[0])*dx+(player.z-a[1])*dz)/l2;t=t<0?0:t>1?1:t;const d=(a[0]+dx*t-player.x)**2+(a[1]+dz*t-player.z)**2;if(d<bd){bd=d;bk=i;}}
  gps.k=bk;
  if(Math.hypot(gps.x-player.x,gps.z-player.z)<22){gpsClear('Ai ajuns la destinație');return;}
  // off-route or switched car/foot → recalculate (at most once a second)
  gps.chk-=dt;if(gps.chk<=0){gps.chk=1;if(bd>40*40||gps.car!==!!player.car){const r=gpsRoute(player.x,player.z,gps.x,gps.z,!!player.car);if(r){gps.pts=r.pts;gps.cum=r.cum;gps.k=0;gps.car=!!player.car;}}}}
function gpsStroke(g,P,from,maxR2){const p=gps.pts;let [x,y]=P(player.x,player.z);g.beginPath();g.moveTo(x,y);
  for(let i=from;i<p.length;i++){[x,y]=P(p[i][0],p[i][1]);g.lineTo(x,y);if(maxR2){const dx=p[i][0]-player.x,dz=p[i][1]-player.z;if(dx*dx+dz*dz>maxR2)break;}}
  g.lineCap='round';g.lineJoin='round';}
function fmOverview(){if(FM.ov)return FM.ov;
  if(D.map&&D.map.image){const img=new Image();FM.ov={img,mpp:D.map.mpp,x0:D.map.x0,z0:D.map.z0,ok:false};img.onload=()=>{FM.ov.ok=true;fmDraw();};img.src=D.map.image.replace(/^world\//,WORLD.base);return FM.ov;}
  const span=Math.max(BX1-BX0,BZ1-BZ0),mpp=Math.max(1,span/3200),c=document.createElement('canvas');c.width=Math.ceil((BX1-BX0)/mpp);c.height=Math.ceil((BZ1-BZ0)/mpp);
  const g=c.getContext('2d');g.fillStyle=MAP_BG;g.fillRect(0,0,c.width,c.height);g.lineCap='round';g.lineJoin='round';
  for(const pass of[1,0])for(const r of roads){if(r.kind>2||(pass===1)!==(r.kind!==0))continue;g.strokeStyle=r.kind===0?'#e9e6dc':'#a9a59c';g.lineWidth=Math.max(r.kind===0?1:.6,r.w/mpp);g.beginPath();r.pts.forEach((p,n)=>n?g.lineTo((p[0]-BX0)/mpp,(p[1]-BZ0)/mpp):g.moveTo((p[0]-BX0)/mpp,(p[1]-BZ0)/mpp));g.stroke();}
  return FM.ov={img:c,mpp,x0:BX0,z0:BZ0,ok:true};}
function fmDraw(){if(!FM.on)return;const dpr=devicePixelRatio||1,W=innerWidth,H=innerHeight;if(bigC.width!==W*dpr||bigC.height!==H*dpr){bigC.width=W*dpr;bigC.height=H*dpr;}
  const g=bigC.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.fillStyle=MAP_BG;g.fillRect(0,0,W,H);
  const sc=FM.s,ox=W/2,oy=H/2,P=(x,z)=>[ox+(x-FM.cx)*sc,oy+(z-FM.cz)*sc];
  const ov=fmOverview();
  if(ov.ok){const [ix,iz]=P(ov.x0,ov.z0);g.imageSmoothingEnabled=true;g.drawImage(ov.img,ix,iz,ov.img.width*ov.mpp*sc,ov.img.height*ov.mpp*sc);}
  let missing=false;
  if(sc>=.3){mapBudget=10;g.save();g.translate(ox,oy);const hs=Math.max(W,H)/2/sc;const T=WORLD.T;
    for(let i=Math.floor((FM.cx-hs)/T);i<=Math.floor((FM.cx+hs)/T);i++)for(let j=Math.floor((FM.cz-hs)/T);j<=Math.floor((FM.cz+hs)/T);j++){const c=mapTile(i+'_'+j);if(c)g.drawImage(c,(i*T-FM.cx)*sc,(j*T-FM.cz)*sc,T*sc+.6,T*sc+.6);else missing=true;}
    g.restore();}
  g.textAlign='center';g.textBaseline='middle';
  for(const d of DISTRICTS){const [px,pz]=P(d.cx,d.cz);if(px<-200||px>W+200||pz<-50||pz>H+50)continue;g.font=`400 ${Math.max(18,Math.min(44,Math.sqrt(d.area)*sc*.08))}px 'Pirata One',serif`;g.lineWidth=4;g.strokeStyle='rgba(0,0,0,.7)';g.fillStyle='rgba(255,255,255,.92)';g.strokeText(d.name,px,pz);g.fillText(d.name,px,pz);}
  if(sc>.12){g.font='700 11px Inter';for(const p of D.pois){const [px,pz]=P(p[1],p[2]);if(px<0||px>W||pz<0||pz>H)continue;g.fillStyle='#ffd23f';g.beginPath();g.arc(px,pz,3.5,0,TAU);g.fill();if(sc>.35){g.fillStyle='#fff';g.strokeStyle='#000';g.lineWidth=3;g.strokeText(p[0],px,pz-9);g.fillText(p[0],px,pz-9);}}}
  hook('mapIcons',g,P,'big',{W,H,sc});
  if(gps){gpsStroke(g,P,gps.k+1,0);g.strokeStyle='rgba(0,0,0,.6)';g.lineWidth=8;g.stroke();g.strokeStyle=GPS_COL;g.lineWidth=4.5;g.stroke();
    const [gx,gz]=P(gps.x,gps.z);g.fillStyle=GPS_COL;g.strokeStyle='#000';g.lineWidth=2;g.beginPath();g.moveTo(gx,gz);g.lineTo(gx-9,gz-22);g.lineTo(gx+9,gz-22);g.closePath();g.fill();g.stroke();g.beginPath();g.arc(gx,gz-24,9,0,TAU);g.fill();g.stroke();
    g.font='800 13px Inter';g.textAlign='center';g.lineWidth=3;g.strokeStyle='#000';g.fillStyle='#fff';g.strokeText(gpsFmt(gpsLeft()),gx,gz-42);g.fillText(gpsFmt(gpsLeft()),gx,gz-42);}
  if(mission){const [mx,mz]=P(mission.x,mission.z);g.fillStyle=mission.stage==='pickup'?'#3cff6e':'#ffd23f';g.strokeStyle='#000';g.lineWidth=2;g.beginPath();g.arc(mx,mz,8,0,TAU);g.fill();g.stroke();}
  const [qx,qz]=P(player.x,player.z);g.save();g.translate(qx,qz);g.rotate(-player.h+Math.PI);g.fillStyle='#fff';g.strokeStyle='#000';g.lineWidth=2;g.beginPath();g.moveTo(0,-12);g.lineTo(8,10);g.lineTo(0,5);g.lineTo(-8,10);g.closePath();g.fill();g.stroke();g.restore();
  g.font='600 11px Inter';g.fillStyle='rgba(255,255,255,.75)';g.textAlign='left';g.fillText('Click: GPS (click pe steag îl șterge) · Trage pentru a muta · rotița pentru zoom · Tab / Esc închide',14,H-14);
  if(missing&&!FM.raf)FM.raf=requestAnimationFrame(()=>{FM.raf=0;fmDraw();});}
function openBigMap(){FM.on=true;FM.cx=player.x;FM.cz=player.z;FM.s=.35;bigEl.classList.add('on');fmDraw();}
function closeBigMap(){FM.on=false;bigEl.classList.remove('on');}
$('mapwrap').addEventListener('pointerdown',e=>{e.stopPropagation();openBigMap();});
bigC.addEventListener('pointerdown',e=>{e.stopPropagation();FM.drag={x:e.clientX,y:e.clientY};FM.down={x:e.clientX,y:e.clientY};bigC.setPointerCapture(e.pointerId);});
bigC.addEventListener('pointermove',e=>{if(!FM.drag)return;FM.cx-=(e.clientX-FM.drag.x)/FM.s;FM.cz-=(e.clientY-FM.drag.y)/FM.s;FM.drag={x:e.clientX,y:e.clientY};fmDraw();});
bigC.addEventListener('pointerup',e=>{FM.drag=null;const d=FM.down;FM.down=null;if(!d||Math.hypot(e.clientX-d.x,e.clientY-d.y)>6)return;   // a click, not a drag
  const x=FM.cx+(e.clientX-innerWidth/2)/FM.s,z=FM.cz+(e.clientY-innerHeight/2)/FM.s;
  const fd=gps?Math.min(Math.hypot((x-gps.x)*FM.s,(z-gps.z)*FM.s+24),Math.hypot((x-gps.x)*FM.s,(z-gps.z)*FM.s)):1e9;   // flag head / tip
  if(fd<18)gpsClear('GPS oprit');
  else if(x>=BX0&&x<=BX1&&z>=BZ0&&z<=BZ1)gpsSet(x,z);
  fmDraw();});
bigC.addEventListener('wheel',e=>{e.preventDefault();const k=Math.exp(-e.deltaY*.0015),ns=clamp(FM.s*k,.02,2.5);const mx=e.clientX-innerWidth/2,my=e.clientY-innerHeight/2;
  FM.cx+=mx/FM.s-mx/ns;FM.cz+=my/FM.s-my/ns;FM.s=ns;fmDraw();},{passive:false});
$('bigx').addEventListener('pointerdown',e=>{e.stopPropagation();closeBigMap();lockMouse();});
addEventListener('keydown',e=>{if(!started)return;
  if(e.code==='Tab'){e.preventDefault();if(paused)return;if(FM.on){closeBigMap();lockMouse();}else{suppressMenu=true;if(locked())document.exitPointerLock();openBigMap();}}
  else if(e.code==='Escape'){e.preventDefault();if(FM.on){closeBigMap();return;}if(paused)resumeGame();else if(locked())document.exitPointerLock();else openMenu();}});
// pause menu
const pmEl=$('pause');
function openMenu(){if(paused)return;paused=true;pmEl.classList.add('on');$('lockhint').style.display='none';try{if(AC)AC.suspend();if(typeof fx_AC!=='undefined'&&fx_AC)fx_AC.suspend();}catch(e){}pmSync();}
function resumeGame(){paused=false;pmEl.classList.remove('on');try{if(AC)AC.resume();if(typeof fx_AC!=='undefined'&&fx_AC)fx_AC.resume();}catch(e){}last=performance.now();lockMouse();}
document.addEventListener('pointerlockchange',()=>{if(locked()){$('lockhint').style.display='none';return;}
  if(suppressMenu){suppressMenu=false;return;}if(started&&!paused&&!FM.on&&!isTouch)openMenu();});
document.addEventListener('pointerlockerror',()=>{if(started&&!paused&&!isTouch)$('lockhint').style.display='block';});
function pmSync(){$('pmSens').value=mouseSens;$('pmSensV').textContent=mouseSens.toFixed(2);$('pmInv').checked=invertY;
  const muted=typeof fx_muted!=='undefined'&&fx_muted;$('pmSndOn').classList.toggle('on',!muted);$('pmSndOff').classList.toggle('on',muted);
  for(const b of $('pmQ').querySelectorAll('button'))b.classList.toggle('on',b.dataset.q===GTC_Q);
  for(const b of $('pmFps').querySelectorAll('button'))b.classList.toggle('on',+b.dataset.f===fpsCap);}
for(const b of $('pmFps').querySelectorAll('button'))b.addEventListener('click',()=>{fpsCap=+b.dataset.f;LSset('gtc_fps',fpsCap);pmSync();});
$('pmResume').addEventListener('click',resumeGame);
$('pmMap').addEventListener('click',()=>{pmEl.classList.remove('on');paused=false;suppressMenu=true;openBigMap();});
$('pmSetBtn').addEventListener('click',()=>$('pmSet').classList.toggle('on'));
$('pmKeysBtn').addEventListener('click',()=>$('pmKeys').classList.toggle('on'));
$('pmSens').addEventListener('input',e=>{mouseSens=+e.target.value;LSset('gtc_sens',mouseSens);$('pmSensV').textContent=mouseSens.toFixed(2);});
$('pmInv').addEventListener('change',e=>{invertY=e.target.checked;LSset('gtc_inv',invertY?'1':'0');});
$('pmSndOn').addEventListener('click',()=>{if(typeof fx_setMute==='function')fx_setMute(false);pmSync();});
$('pmSndOff').addEventListener('click',()=>{if(typeof fx_setMute==='function')fx_setMute(true);pmSync();});
for(const b of $('pmQ').querySelectorAll('button'))b.addEventListener('click',()=>{LSset('gtc_q',b.dataset.q);location.hash=b.dataset.q;location.reload();});
$('pmRestart').addEventListener('click',()=>{saveOff=true;try{localStorage.removeItem(SAVE_K);}catch(e){}location.reload();});
addEventListener('resize',()=>{if(FM.on)fmDraw();});
function updPoles(v,dt){const up=v.mode==='ai'||(v.mode==='player'?v.wire:false);for(const p of v.poles)p.rotation.x+=((up?.33:.04)-p.rotation.x)*Math.min(1,dt*4);}
function updTrolleyStation(){const v=player.car;if(!v||v.type!=='trolley'||Math.abs(v.speed)>1.5)return;
  for(const s of stops){if(Math.hypot(v.x-s.px,v.z-s.pz)<8&&lastStation!==s.i){lastStation=s.i;money+=4;say('+4 lei','Stația '+s.name,1.8,'#7dff8a');}}}

function v_steerTrack(dt,inp){for(const v of vehicles){if(v===player.car)v.steer=inp.s;else{const h0=v._ph==null?v.h:v._ph;v.steer=clamp(-angDiff(v.h,h0)/Math.max(dt,1e-3)/1.5,-1,1);}v._ph=v.h;}}
// ================= main loop =================
// small API for side modules (Linella store interior)
window.gtcApi={player,camPos,addStar,say,get camYaw(){return camYaw},set camYaw(v){camYaw=v},get camPitch(){return camPitch},get money(){return money},set money(v){money=v},set shake(v){shake=Math.max(shake,v)}};
await progress('JOACĂ');playBtn.disabled=false;
let last=performance.now(),titleT=0,parkT=0,mapT=0;
// frame cap (pause menu → Setări): renders at most fpsCap frames/s; 0 = unlimited (monitor refresh rate)
let fpsCap=+LS('gtc_fps',60);const fpsEl=/[?&]fps/.test(location.search)?Object.assign(document.body.appendChild(document.createElement('div')),{style:'position:fixed;left:8px;bottom:8px;z-index:40;font:700 12px monospace;color:#7dff8a;background:rgba(0,0,0,.6);padding:3px 7px;border-radius:5px;pointer-events:none'}):null;let fpsN=0,fpsT=0,fpsWorst=0;
function frame(now){requestAnimationFrame(frame);if(fpsCap>0&&now-last<1000/fpsCap*.8)return;const dt=Math.min(.1,(now-last)/1000); // ponytail: clamp only stalls; at .05 anything under 20 fps ran in slow motion while the speedo read true
  if(fpsEl){fpsN++;fpsT+=now-last;fpsWorst=Math.max(fpsWorst,now-last);if(fpsT>=500){const r=__dbg.renderer.info.render;fpsEl.textContent=Math.round(fpsN*1000/fpsT)+' fps · worst '+Math.round(fpsWorst)+' ms · '+r.calls+' draws · '+Math.round(r.triangles/1000)+'k tris';fpsN=fpsT=fpsWorst=0;}}
  last=now;
  if(!paused){for(const v of vehicles)if(v.mode==='ai')updAI(v,dt);
  updPeds(dt);}
  if(paused){}
  else if(!started){titleT+=dt*.06;const cx=SAVE?player.x:arcP[0]+60,cz=SAVE?player.z:arcP[1]-60;{const ox=cx+Math.sin(titleT)*260,oz=cz+Math.cos(titleT)*260;camera.position.set(ox,Math.max(groundY(ox,oz),groundY(cx,cz))+140,oz);camera.lookAt(cx,groundY(cx,cz)+10,cz);}envUpdate(dt);worldUpdate(dt,player.x,player.z);}
  else{const inp=input();window.gtcInput=inp;const inStore=(player.mode==='foot'&&hook('storeUpdate',dt,inp))||hook('airportUpdate',dt,inp);const seated=!inStore&&player.mode==='foot'&&hook('bemolSeat');if(inStore||seated){}else if(player.mode==='foot')updFoot(dt,inp);else{drive(player.car,dt,inp);player.x=player.car.x;player.z=player.car.z;player.h=player.car.h;}
    for(const v of vehicles)if(v.mode==='chase')updChase(v,dt);
    window.gtcPlayer=player;worldUpdate(dt,player.x,player.z);parkT-=dt;if(parkT<=0){parkT=1;updParked();}v_steerTrack(dt,inp);updWanted(dt);updMission(dt);gpsUpdate(dt);hook('bemolUpdate',dt,player,say);hook('carcareUpdate',dt,player);hook('linellaUpdate');hook('fxUpdate',dt);saveT-=dt;if(saveT<=0){saveT=4;saveGame();}updTrolleyStation();if(!inStore)updCamera(dt);updHUD(dt);mapT-=dt;if(mapT<=0){mapT=1/30;drawMap();}engineUpdate();
    if(msgT>0){msgT-=dt;if(msgT<=0)$('msg').style.opacity=0;}if(bustShow>0){bustShow-=dt;if(bustShow<=0)$('busted').style.opacity=0;}
    if(mission){const mk=mission.stage==='pickup'?mkP:mkD;mk.children[0].material.opacity=.22+Math.sin(now/200)*.08;}}
  for(const v of vehicles)if(v.poles)updPoles(v,dt);
  renderVehicles(dt);envRender(dt);}
requestAnimationFrame(frame);
playBtn.addEventListener('click',()=>{started=true;setTimeout(lockMouse,0);$('title').style.display='none';document.body.classList.remove('pre');ac();if(AC&&AC.state==='suspended')AC.resume();
  if(isTouch&&document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().catch(()=>{});
  camPos.set(player.x-Math.sin(camYaw)*6,groundY(player.x,player.z)+4,player.z-Math.cos(camYaw)*6);if(player.car)engineInit();
  if(SAVE)say('Bine ai revenit!','Continui de unde ai rămas · '+money+' lei',3.6,'#ffd23f');else say('Bun venit în Chișinău!','Taxiul galben de pe Ștefan cel Mare e liber — urcă',3.6,'#ffd23f');});
window.__dbg={scene,player,renderer,camera,vehicles,peds,edges,toggleCar,keys,get stars(){return stars},set stars(v){stars=v;starCool=0;bustT=0;},noPolice:false,SPAWN,stops,DESTS,WORLD,
  teleport(x,z){if(player.car){player.car.x=x;player.car.z=z;player.car.speed=0;}player.x=x;player.z=z;camPos.set(x,groundY(x,z)+20,z);}};
}
main().catch(e=>{console.error(e);window.__err=e&&e.stack;const b=document.getElementById('play');b.textContent='Eroare: '+e.message;});
