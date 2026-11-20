'use strict';
// Car care: fuel (refuel under a Bemol canopy), damage (crashes + potholes), potholes ("gropi") on the streets,
// and roadside garages ("Vulcanizare la Vasea"…) that repair the car for lei.
// Hooks called by game.js: carcareDrive(v,dt,inp) -> {t,max} throttle / top-speed factors for the player's car,
// carcareAction() on E/F/INTRĂ (true = handled, don't leave the car), carcareCrash(v,imp), carcareUpdate(dt,player).
// vehicles.js lifts the body by v.bump (pothole bounce). Per-car state lives on the vehicle: v.cc={fuel,hp}.

const CC_TANK=30,CC_PRICE=24.9,CC_LPM=1/1000;           // litres, lei per litre, litres per metre (a full tank ≈ 30 km)
const CC_HOLE_DMG=1;                                     // % of condition lost per pothole
const CC_REPAIR=2.5;                                      // lei per % of damage
const CC_FILL=5;                                          // litres per second at the pump
const CC_MECH_HI=['Ce-ai făcut cu mașina, mă?','Iar ai prins o groapă?','Hai, că o facem ca nouă.'];
const CC_MECH_DONE=['Gata, ca nouă!','Merge ca ceasul acum.'];
const CC_MECH_OK=['Mașina-i în regulă, n-ai ce repara.'];
const CC_MECH_BROKE=['Fără bani nu se poate, frate.'];
const CC_PUMP=['Plinul?','Drum bun!'];
// garages: one per sector, snapped at runtime to a street near (x,z) (true-scale metres from the Arc)
const CC_GARAGES=[
  {name:'Vulcanizare la Vasea',sub:'Ciocana',mech:'Vasea',x:3975,z:-1147},
  {name:'Vulcanizare 24/24',sub:'Botanica',mech:'Jora',x:1700,z:3863},
  {name:'Service Auto la Tolea',sub:'Buiucani',mech:'Tolea',x:-2852,z:-1700},
  {name:'Vulcanizare Gheorghe',sub:'Râșcani',mech:'Gheorghe',x:1700,z:-1703},
  {name:'Vulcanizare & Spălătorie',sub:'Telecentru',mech:'Sanea',x:-1340,z:2197},
  {name:'Vulcanizare la Mișa',sub:'Centru',mech:'Mișa',x:941,z:806},
  {name:'Vulcanizare Durlești',sub:'Durlești',mech:'Ghena',x:-5508,z:194},
  {name:'Service Auto Sculeni',sub:'Sculeni',mech:'Grișa',x:-3611,z:-2149},
  {name:'Vulcanizare Poșta Veche',sub:'Poșta Veche',mech:'Fedea',x:1916,z:-3480},
  {name:'Vulcanizare Aeroport',sub:'Aeroport',mech:'Petrică',x:6631,z:9986},
];

let cc_holes=null,cc_hgrid=new Map(),cc_holeMesh=null,cc_hcx=1e9,cc_hcz=1e9,cc_hT=0;
let cc_ui=null,cc_uiT=0,cc_busy=null,cc_gT=0,cc_smokeT=0,cc_ac=null,cc_mat=null;
const cc_rnd=(i,k)=>{const v=Math.sin(i*12.9898+k*78.233)*43758.5453;return v-Math.floor(v);};
const cc_HC=64,cc_hk=(i,j)=>i*100003+j;
const cc_say=(who,t,col)=>{subtitle(who,t,col||'#ffb347');if(typeof lst_speak==='function')lst_speak(t,.9+Math.random()*.15,1.05);};
const cc_pick=a=>a[Math.floor(Math.random()*a.length)];

// ---------------- per-car state ----------------
function cc_state(v){if(!v.cc){const r=Math.random();v.cc={fuel:CC_TANK*(.15+r*.45),hp:v.mode==='ai'||v.parkedAuto?75+Math.random()*25:100};}return v.cc;}
const cc_electric=v=>v.type==='trolley';
const cc_thirst=v=>v.type==='bus'||v.type==='rutiera'?1.8:v.type==='police'?1.2:1;

function cc_carcareDrive_(v,dt,inp){const c=cc_state(v);let t=1,max=1;
  if(!cc_electric(v)){const d=Math.abs(v.speed)*dt;c.fuel=Math.max(0,c.fuel-(d*CC_LPM*(.55+.45*Math.abs(inp.t))+.002*dt)*cc_thirst(v));
    if(c.fuel<=0){t=0;if(!c.dry){c.dry=true;gtcApi.say('Ai rămas fără benzină!','Mergi pe jos până la un Bemol sau ia altă mașină',3,'#ff8a65');}}else c.dry=false;
    if(c.fuel>0&&c.fuel<2.5&&!c.low){c.low=true;gtcApi.say('Rezervor aproape gol','Alimentează la Bemol',2.4,'#ffb347');}else if(c.fuel>4)c.low=false;}
  if(c.hp<50)max*=.55+.45*c.hp/50;if(c.hp<=0){max*=.45;t*=.6;}
  if(cc_busy&&cc_busy.v===v)t=0;   // pump / lift running: engine off
  return {t,max};}

function cc_damage(v,n,why){const c=cc_state(v),was=c.hp;c.hp=Math.max(0,c.hp-n);
  if(was>0&&c.hp<=0)gtcApi.say('Motorul s-a stricat!','Du mașina la o vulcanizare (🔧 pe hartă)',3,'#ff8a65');
  else if(was>=30&&c.hp<30)gtcApi.say('Mașina e grav avariată','Repar-o la o vulcanizare (🔧 pe hartă)',2.6,'#ffb347');}
function cc_carcareCrash_(v,imp){if(imp>4)cc_damage(v,(imp-4)*1.6);}

// ---------------- potholes ----------------
function cc_buildHoles(){cc_holes=[];
  for(const e of edges){if(e.len<12||e.tw&&e.w>=14)continue;const r=cc_rnd(e.i,1),p=e.w>=14?.12:e.w>=9?.3:.5;if(r>p)continue;
    const n=1+Math.floor(cc_rnd(e.i,2)*Math.min(4,e.len/45));
    // cumulative length along the polyline
    const P=e.pts,cum=[0];for(let i=1;i<P.length;i++)cum.push(cum[i-1]+Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]));const L=cum[cum.length-1];
    for(let k=0;k<n;k++){const s=L*(.1+.8*cc_rnd(e.i,10+k));let i=1;while(i<P.length-1&&cum[i]<s)i++;const a=P[i-1],b=P[i],sl=cum[i]-cum[i-1]||1,f=(s-cum[i-1])/sl;
      const dx=(b[0]-a[0])/sl,dz=(b[1]-a[1])/sl,lat=(cc_rnd(e.i,20+k)*2-1)*Math.max(.5,e.w/2-1.2);
      const h={x:a[0]+(b[0]-a[0])*f-dz*lat,z:a[1]+(b[1]-a[1])*f+dx*lat,r:.45+cc_rnd(e.i,30+k)*.6,rot:cc_rnd(e.i,40+k)*6.28,y:null,hit:0};
      cc_holes.push(h);const key=cc_hk(Math.floor(h.x/cc_HC),Math.floor(h.z/cc_HC));let c=cc_hgrid.get(key);if(!c)cc_hgrid.set(key,c=[]);c.push(h);}}
  // pothole decal: dark broken asphalt with a soft ragged edge
  const cv=document.createElement('canvas');cv.width=cv.height=128;const g=cv.getContext('2d');
  const gr=g.createRadialGradient(64,64,8,64,64,62);gr.addColorStop(0,'rgba(18,17,16,1)');gr.addColorStop(.55,'rgba(32,30,28,.95)');gr.addColorStop(.8,'rgba(60,57,52,.7)');gr.addColorStop(1,'rgba(60,57,52,0)');
  g.fillStyle=gr;g.beginPath();for(let i=0;i<=24;i++){const a=i/24*6.283,rr=46+Math.sin(i*2.7)*9+Math.cos(i*1.3)*7;g.lineTo(64+Math.cos(a)*rr,64+Math.sin(a)*rr);}g.fill();
  for(let i=0;i<40;i++){g.fillStyle=`rgba(${70+Math.random()*40|0},${66+Math.random()*36|0},${60+Math.random()*30|0},${.5+Math.random()*.4})`;const a=Math.random()*6.283,rr=10+Math.random()*34;g.fillRect(64+Math.cos(a)*rr,64+Math.sin(a)*rr,2+Math.random()*4,2+Math.random()*3);}
  const tex=new THREE.CanvasTexture(cv);
  const mat=new THREE.MeshLambertMaterial({map:tex,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4});
  const geo=new THREE.PlaneGeometry(2,2);geo.rotateX(-Math.PI/2);
  cc_holeMesh=new THREE.InstancedMesh(geo,mat,500);cc_holeMesh.count=0;cc_holeMesh.frustumCulled=false;cc_holeMesh.receiveShadow=true;cc_holeMesh.renderOrder=1;scene.add(cc_holeMesh);}
const cc_m4=new THREE.Matrix4(),cc_q=new THREE.Quaternion(),cc_p=new THREE.Vector3(),cc_s=new THREE.Vector3(),cc_up=new THREE.Vector3(0,1,0);
function cc_holeY(h){if(h.y===null){if(typeof onBridge==='function'&&onBridge(h.x,h.z))h.y=false;else h.y=groundY(h.x,h.z)+.095;}return h.y;}
function cc_refreshHoles(px,pz){let n=0;const R=230,i0=Math.floor((px-R)/cc_HC),i1=Math.floor((px+R)/cc_HC),j0=Math.floor((pz-R)/cc_HC),j1=Math.floor((pz+R)/cc_HC);
  for(let i=i0;i<=i1&&n<500;i++)for(let j=j0;j<=j1&&n<500;j++){const c=cc_hgrid.get(cc_hk(i,j));if(!c)continue;
    for(const h of c){if(n>=500)break;if(!worldReadyAt(h.x,h.z))continue;const y=cc_holeY(h);if(y===false)continue;
      cc_q.setFromAxisAngle(cc_up,h.rot);cc_m4.compose(cc_p.set(h.x,y,h.z),cc_q,cc_s.set(h.r,1,h.r*.8));cc_holeMesh.setMatrixAt(n++,cc_m4);}}
  cc_holeMesh.count=n;cc_holeMesh.instanceMatrix.needsUpdate=true;cc_hcx=px;cc_hcz=pz;}
function cc_thud(k){try{if(typeof fx_muted!=='undefined'&&fx_muted)return;if(!cc_ac)cc_ac=new (window.AudioContext||window.webkitAudioContext)();const a=cc_ac,t=a.currentTime;
    const o=a.createOscillator(),g=a.createGain();o.type='sine';o.frequency.setValueAtTime(90,t);o.frequency.exponentialRampToValueAtTime(38,t+.18);g.gain.setValueAtTime(Math.min(.9,.25+k*.05),t);g.gain.exponentialRampToValueAtTime(.001,t+.25);
    o.connect(g).connect(a.destination);o.start(t);o.stop(t+.26);
    const len=a.sampleRate*.12|0,buf=a.createBuffer(1,len,a.sampleRate),d=buf.getChannelData(0);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*(1-i/len)**2;
    const s=a.createBufferSource(),g2=a.createGain(),f=a.createBiquadFilter();f.type='lowpass';f.frequency.value=900;g2.gain.value=Math.min(.6,.15+k*.03);s.buffer=buf;s.connect(f).connect(g2).connect(a.destination);s.start(t);}catch(e){}}
function cc_holeHits(v,dt,now){const sp=Math.abs(v.speed);
  // spring for the body bounce
  v.bumpV=(v.bumpV||0)+(-90*(v.bump||0)-11*(v.bumpV||0))*dt;v.bump=(v.bump||0)+v.bumpV*dt;if(Math.abs(v.bump)<1e-4&&Math.abs(v.bumpV)<1e-3){v.bump=0;v.bumpV=0;}
  if(sp<2.5)return;const fx=Math.sin(v.h),fz=Math.cos(v.h),L=v.spec.len/2,W=v.spec.wid/2,ci=Math.floor(v.x/cc_HC),cj=Math.floor(v.z/cc_HC);
  for(let i=ci-1;i<=ci+1;i++)for(let j=cj-1;j<=cj+1;j++){const c=cc_hgrid.get(cc_hk(i,j));if(!c)continue;
    for(const h of c){const dx=h.x-v.x,dz=h.z-v.z;if(Math.abs(dx)>8||Math.abs(dz)>8)continue;const lon=dx*fx+dz*fz,lat=dx*fz-dz*fx;
      // a wheel track (≈ the outer 0.7 m each side) crosses the hole
      if(Math.abs(lon)>L+h.r*.6||Math.abs(lat)>W+h.r*.5||Math.abs(lat)<W-.8-h.r*.5)continue;if(now<h.hit)continue;if(cc_holeY(h)===false)continue;
      h.hit=now+1500;const k=Math.min(1,sp/16);v.bumpV-=1.2+2.8*k;v.speed*=1-.06*k;cc_thud(sp);gtcApi.shake=.15+.5*k;
      cc_damage(v,CC_HOLE_DMG);gtcApi.say('Groapă!','Mașina: '+Math.round(cc_state(v).hp)+'%',1.2,'#ff8a65');}}}

// ---------------- garages ----------------
let cc_gList=null;   // map icon list (x,z; moves to the snapped spot once placed)
function cc_initGarages(){cc_gList=CC_GARAGES.map((G,i)=>{
    // street candidates near the target: mid-size roads, closest first
    const cand=edges.filter(e=>e.w>=6&&e.w<=13&&e.len>25&&!e.tw&&Math.hypot(e.mid[0]-G.x,e.mid[1]-G.z)<650)
      .sort((a,b)=>Math.hypot(a.mid[0]-G.x,a.mid[1]-G.z)-Math.hypot(b.mid[0]-G.x,b.mid[1]-G.z)).slice(0,40);
    const c0=cand[0];return {G,i,cand,x:c0?c0.mid[0]:G.x,z:c0?c0.mid[1]:G.z,placed:null,grp:null,mech:null,greet:0};});}
function cc_W(s,lx,lz){const c=Math.cos(s.a),n=Math.sin(s.a);return [s.x+lx*c+lz*n,s.z-lx*n+lz*c];}
function cc_tryPlace(g){
  for(const e of g.cand){const P=e.pts;for(const f of [.5,.3,.7])for(const side of [1,-1]){
      const k=Math.min(P.length-2,Math.max(0,Math.floor((P.length-1)*f))),a=P[k],b=P[k+1],l=Math.hypot(b[0]-a[0],b[1]-a[1])||1,dx=(b[0]-a[0])/l,dz=(b[1]-a[1])/l;
      const qx=(a[0]+b[0])/2,qz=(a[1]+b[1])/2,nx=-dz*side,nz=dx*side,off=e.w/2+8;
      const s={x:qx+nx*off,z:qz+nz*off,a:Math.atan2(nx,nz),w:e.w};if(!worldReadyAt(s.x,s.z))return null;
      let bad=0,ymin=1e9,ymax=-1e9;
      for(let lx=-5;lx<=5&&bad<1;lx+=1.25)for(let lz=-6;lz<=4.5&&bad<1;lz+=1.5){const [wx,wz]=cc_W(s,lx,lz);
        if(polysNear(wx,wz,0,P=>insidePoly(P,wx,wz)))bad++;else if(lz>-3.6){const ns=nearestSeg(wx,wz,15);if(ns&&ns.d<ns.s.r.w/2+.6)bad++;}
        const y=groundY(wx,wz);ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);}
      if(!bad&&ymax-ymin<1.6&&!(typeof onBridge==='function'&&onBridge(s.x,s.z)))return s;}}
  return false;}
function cc_tex(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);t.anisotropy=4;return t;}
function cc_mats(){if(cc_mat)return cc_mat;
  const wall=cc_tex(256,128,(g,w,h)=>{g.fillStyle='#8f9aa3';g.fillRect(0,0,w,h);for(let x=0;x<w;x+=8){g.fillStyle=x%16?'#7d8891':'#a3adb5';g.fillRect(x,0,4,h);}
    g.fillStyle='rgba(120,70,30,.25)';for(let i=0;i<14;i++)g.fillRect(Math.random()*w,h*.6+Math.random()*h*.4,6+Math.random()*20,4+Math.random()*30);});
  const front=cc_tex(256,128,(g,w,h)=>{g.fillStyle='#8f9aa3';g.fillRect(0,0,w,h);g.fillStyle='#16181a';g.fillRect(w*.12,h*.22,w*.76,h*.78);
    g.fillStyle='#5b6670';for(let y=h*.22;y<h*.42;y+=4)g.fillRect(w*.12,y,w*.76,2.5);   // half-open roll-up shutter
    g.fillStyle='#2a2d30';for(let i=0;i<3;i++){g.beginPath();g.ellipse(w*(.25+i*.08),h*.86,10,13,0,0,6.3);g.fill();}g.fillStyle='#3a3020';g.fillRect(w*.62,h*.62,w*.18,h*.38);});
  const sign=G=>cc_tex(512,128,(g,w,h)=>{g.fillStyle='#f4f1e6';g.fillRect(0,0,w,h);g.strokeStyle='#c0261f';g.lineWidth=8;g.strokeRect(6,6,w-12,h-12);
    const big=/vulcanizare/i.test(G.name),t1=big?'VULCANIZARE':'SERVICE AUTO',t2=G.name.replace(/^(Vulcanizare|Service Auto)\s*/i,'');
    g.fillStyle='#c0261f';g.textAlign='center';g.textBaseline='middle';g.font='900 62px Anton, Impact, Arial Black, sans-serif';g.fillText(t1,w/2,h*.4);
    g.fillStyle='#1d3b8a';g.font='800 30px Inter, Arial, sans-serif';g.fillText((t2||'24/24')+'  ·  ☎ 069 '+(100+G.mech.length*137%900)+' '+(10+G.name.length*7%90),w/2,h*.8);});
  return cc_mat={wall:new THREE.MeshLambertMaterial({map:wall}),front:new THREE.MeshLambertMaterial({map:front}),roof:new THREE.MeshLambertMaterial({color:0x5a6168}),
    floor:new THREE.MeshLambertMaterial({color:0x8d8a84}),tire:new THREE.MeshLambertMaterial({color:0x1b1b1c}),pole:new THREE.MeshLambertMaterial({color:0x3a3d40}),
    ring:new THREE.MeshBasicMaterial({color:0xff9f1c,transparent:true,opacity:.5,depthWrite:false,side:THREE.DoubleSide}),sign};}
function cc_buildGarage(g){const s=g.placed,M=cc_mats(),grp=new THREE.Group(),y=groundY(s.x,s.z);grp.position.set(s.x,y,s.z);grp.rotation.y=s.a;
  // shed: local -z faces the street
  const body=new THREE.Mesh(new THREE.BoxGeometry(8,3.6,7),[M.wall,M.wall,M.roof,M.floor,M.wall,M.front]);body.position.set(0,1.8,0);body.castShadow=body.receiveShadow=true;grp.add(body);
  const roof=new THREE.Mesh(new THREE.BoxGeometry(8.6,.15,8.2),M.roof);roof.position.set(0,3.7,-.4);roof.castShadow=true;grp.add(roof);
  const apron=new THREE.Mesh(new THREE.BoxGeometry(9,.3,4.2),M.floor);apron.position.set(0,0,-5.6);apron.receiveShadow=true;grp.add(apron);
  const sm=new THREE.MeshLambertMaterial({map:M.sign(g.G),emissive:0x2a2a26});const sign=new THREE.Mesh(new THREE.BoxGeometry(7,1.4,.12),[M.pole,M.pole,M.pole,M.pole,M.pole,sm]);sign.position.set(0,4.55,-3.4);grp.add(sign);
  // tyre stacks + one tyre hung on a pole by the road ("vulcanizare" landmark)
  const tg=new THREE.TorusGeometry(.32,.13,6,14);tg.rotateX(Math.PI/2);const spots=[[-3.4,-4.2,4],[3.5,-4.4,3],[3.6,-2.2,5],[-3.8,4.2,2]];let n=0;spots.forEach(p=>n+=p[2]);
  const ti=new THREE.InstancedMesh(tg,M.tire,n+1);let k=0;const m=new THREE.Matrix4();for(const [x,z,c] of spots)for(let j=0;j<c;j++){m.makeTranslation(x+Math.sin(j*1.7)*.04,.14+j*.26,z);ti.setMatrixAt(k++,m);}
  m.makeRotationX(Math.PI/2).setPosition(-4.4,2.1,-7.3);ti.setMatrixAt(k++,m);ti.castShadow=true;grp.add(ti);
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,2.7,6),M.pole);pole.position.set(-4.4,1.35,-7.05);grp.add(pole);
  const ring=new THREE.Mesh(new THREE.RingGeometry(2.3,2.7,32),M.ring);ring.rotation.x=-Math.PI/2;ring.position.set(0,.2,-5.8);grp.add(ring);g.ring=ring;
  scene.add(grp);g.grp=grp;g.y=y;
  if(!g.col){g.col=true;addRect(s.x,s.z,8,7,s.a,3.6);}
  // the mechanic, idling by the door
  if(typeof makePersonGroup==='function'){const p=makePersonGroup(0x1f3a6b,0x1f3a6b,0xd9a77f),u=p.userData;u.own=true;if(u.o){u.o.top=0x1f3a6b;u.o.bot=0x1f3a6b;if(typeof ppl_applyLook==='function')ppl_applyLook(u.ims,0,1,u.o);}
    const [mx,mz]=cc_W(s,2.2,-4);p.position.set(mx,groundY(mx,mz),mz);p.rotation.y=s.a+Math.PI+.4;scene.add(p);g.mech=p;}}
function cc_dropGarage(g){if(g.grp){scene.remove(g.grp);g.grp=null;}if(g.mech){scene.remove(g.mech);g.mech=null;}}
function cc_garages(player,dt,now){if(now>cc_gT){cc_gT=now+500;
    for(const g of cc_gList){const d=Math.hypot(g.x-player.x,g.z-player.z);
      if(g.placed===null&&d<420){const r=cc_tryPlace(g);if(r){g.placed=r;g.x=r.x;g.z=r.z;}else if(r===false)g.placed=false;}
      if(g.placed&&d<380&&!g.grp)cc_buildGarage(g);else if(g.grp&&d>520)cc_dropGarage(g);}}
  for(const g of cc_gList){if(!g.grp)continue;if(g.mech)animatePlayer(g.mech,0,0,dt);g.ring.material.opacity=.35+Math.sin(now/220)*.15;}}
function cc_zone(player){if(player.mode!=='car'&&!player.car)return null;const v=player.car;if(!v||Math.abs(v.speed)>1.2)return null;
  if(cc_gList)for(const g of cc_gList){if(!g.placed||!g.grp)continue;const [zx,zz]=cc_W(g.placed,0,-5.8);if(Math.hypot(v.x-zx,v.z-zz)<4.2)return {kind:'garage',g,v};}
  if(!cc_electric(v)&&typeof bemol_list!=='undefined'&&bemol_list)for(const s of bemol_list)if(Math.abs(s.x-v.x)<9&&Math.abs(s.z-v.z)<9&&Math.hypot(s.x-v.x,s.z-v.z)<7.5)return {kind:'pump',s,v};
  return null;}

// ---------------- actions (E at a pump / garage) ----------------
function cc_carcareAction_(){const P=gtcApi.player;
  if(cc_busy){cc_finish(true);return true;}
  const z=cc_zone(P);if(!z)return false;const c=cc_state(z.v),api=gtcApi;
  if(z.kind==='pump'){const need=CC_TANK-c.fuel;if(need<.5)return false;if(api.money<CC_PRICE*.5){api.say('Nu ai bani de benzină','Litrul: '+CC_PRICE+' lei',2.2,'#ff8a65');return true;}
    cc_busy={kind:'pump',v:z.v,paid:0,l:0,cost:0,m0:api.money};cc_say('Bemol',CC_PUMP[0],'#7dffa8');return true;}
  const dmg=100-c.hp;if(dmg<1){cc_say(z.g.G.mech,CC_MECH_OK[0]);return false;}
  const cost=Math.ceil(dmg*CC_REPAIR);if(api.money<Math.min(cost,25)){cc_say(z.g.G.mech,CC_MECH_BROKE[0]);api.say('Reparația: '+cost+' lei','Nu ai destui bani',2.2,'#ff8a65');return true;}
  cc_busy={kind:'garage',v:z.v,g:z.g,t:0,dur:1.2+dmg*.03,from:c.hp,paid:0,m0:api.money};cc_say(z.g.G.mech,cc_pick(CC_MECH_HI));return true;}
function cc_finish(stopped){const b=cc_busy;cc_busy=null;if(!b)return;const api=gtcApi;
  if(b.kind==='pump'){api.say('⛽ +'+b.l.toFixed(1)+' L','-'+Math.round(b.paid)+' lei · Bemol',2.2,'#7dffa8');if(!stopped)cc_say('Bemol',CC_PUMP[1],'#7dffa8');}
  else{api.say('🔧 Mașina: '+Math.round(cc_state(b.v).hp)+'%','-'+Math.round(b.paid)+' lei · '+b.g.G.name,2.4,'#ffb347');if(!stopped)cc_say(b.g.G.mech,cc_pick(CC_MECH_DONE));}}
function cc_work(dt,player){const b=cc_busy;if(!b)return;const api=gtcApi,c=cc_state(b.v);
  if(player.car!==b.v||Math.abs(b.v.speed)>1.2){cc_finish(true);return;}
  // charge whole lei: money = what you had - ceil(cost so far)
  if(b.kind==='pump'){let l=Math.min(CC_FILL*dt,CC_TANK-c.fuel);if(Math.ceil((b.cost+l)*CC_PRICE)>b.m0)l=Math.max(0,b.m0/CC_PRICE-b.cost);
    c.fuel+=l;b.l+=l;b.cost+=l;b.paid=Math.ceil(b.cost*CC_PRICE);api.money=b.m0-b.paid;
    if(c.fuel>=CC_TANK-.01||l<=1e-6)cc_finish(false);}
  else{b.t+=dt;const f=Math.min(1,b.t/b.dur),hp=b.from+(100-b.from)*f,cost=Math.ceil((hp-b.from)*CC_REPAIR);if(cost>b.m0){cc_finish(true);return;}
    c.hp=hp;b.paid=cost;api.money=b.m0-cost;if(f>=1){c.hp=100;cc_finish(false);}}}

// ---------------- HUD ----------------
function cc_uiInit(){const css=document.createElement('style');css.textContent=
  '#cc_gauges{font:700 11px Inter,Arial,sans-serif;color:#fff;text-shadow:0 1px 2px #000;margin-top:2px;display:none}'+
  '#cc_gauges .r{display:flex;align-items:center;justify-content:flex-end;gap:6px;margin-top:3px}'+
  '#cc_gauges .b{width:84px;height:7px;border-radius:4px;background:rgba(0,0,0,.55);overflow:hidden;box-shadow:0 0 0 1px rgba(255,255,255,.25)}'+
  '#cc_gauges .b i{display:block;height:100%;border-radius:4px}'+
  '#cc_hint{position:fixed;left:50%;bottom:24%;transform:translateX(-50%);font:700 15px Inter,Arial,sans-serif;color:#fff;background:rgba(0,0,0,.6);padding:8px 14px;border-radius:10px;display:none;z-index:12;text-align:center}'+
  '#cc_hint b{background:#ffd23f;color:#1a1305;padding:1px 7px;border-radius:5px;margin-right:6px}';document.head.appendChild(css);
  const g=document.createElement('div');g.id='cc_gauges';g.innerHTML='<div class="r"><span id="cc_fl"></span><span>⛽</span><div class="b"><i id="cc_fb"></i></div></div><div class="r"><span id="cc_hl"></span><span>🔧</span><div class="b"><i id="cc_hb"></i></div></div>';
  const veh=document.getElementById('veh');(veh||document.body).appendChild(g);const h=document.createElement('div');h.id='cc_hint';document.body.appendChild(h);
  cc_ui={g,fl:document.getElementById('cc_fl'),fb:document.getElementById('cc_fb'),hl:document.getElementById('cc_hl'),hb:document.getElementById('cc_hb'),hint:h,last:''};}
function cc_hud(player){if(!cc_ui)cc_uiInit();const v=player.car,U=cc_ui;
  if(!v){U.g.style.display='none';}else{const c=cc_state(v);U.g.style.display='block';const el=cc_electric(v);
    U.fl.textContent=el?'electric':c.fuel.toFixed(1)+' L';const ff=el?1:c.fuel/CC_TANK;U.fb.style.width=(ff*100)+'%';U.fb.style.background=el?'#5fb4ff':ff<.12?'#ff4d4d':ff<.3?'#ffb347':'#7dff8a';
    U.hl.textContent=Math.round(c.hp)+'%';U.hb.style.width=c.hp+'%';U.hb.style.background=c.hp<30?'#ff4d4d':c.hp<60?'#ffb347':'#7dff8a';}
  let t='';const key=(typeof isTouch!=='undefined'&&isTouch)||matchMedia('(pointer:coarse)').matches?'INTRĂ':'E';
  if(cc_busy){const c=cc_state(cc_busy.v);t=cc_busy.kind==='pump'?`⛽ Alimentare… ${c.fuel.toFixed(1)} / ${CC_TANK} L · ${Math.round(cc_busy.paid)} lei — <b>${key}</b>stop`:`🔧 ${cc_busy.g.G.mech} repară… ${Math.round(c.hp)}%`;}
  else{const z=cc_zone(player);if(z){const c=cc_state(z.v);
    if(z.kind==='pump'){const need=CC_TANK-c.fuel;if(need>=.5)t=`<b>${key}</b>Alimentează plinul — ${need.toFixed(1)} L · ${Math.round(need*CC_PRICE)} lei`;}
    else{const dmg=100-c.hp;t=dmg>=1?`<b>${key}</b>${z.g.G.name}: repară — ${Math.ceil(dmg*CC_REPAIR)} lei`:`${z.g.G.name} · mașina e în regulă`;}}}
  if(t!==U.last){U.last=t;U.hint.innerHTML=t;U.hint.style.display=t?'block':'none';}}

// ---------------- per frame ----------------
function cc_carcareUpdate_(dt,player){if(typeof edges==='undefined'||!edges.length||typeof gtcApi==='undefined')return;
  const now=performance.now();if(!cc_holes){cc_buildHoles();cc_initGarages();}
  if(Math.abs(player.x-cc_hcx)+Math.abs(player.z-cc_hcz)>30||now>cc_hT){cc_hT=now+2000;cc_refreshHoles(player.x,player.z);}
  const v=player.car;if(v){cc_holeHits(v,dt,now);const c=cc_state(v);
    if(c.hp<30&&typeof fx_puff==='function'&&now>cc_smokeT){cc_smokeT=now+(c.hp<=0?120:260);const fx=Math.sin(v.h),fz=Math.cos(v.h),L=v.spec.len*.38;
      try{fx_puff(v.x+fx*L,(v.y||groundY(v.x,v.z))+1.1,v.z+fz*L,1,.3,.7,c.hp<=0?.18:.45,.32,1.6,1.4);}catch(e){}}}
  for(const o of vehicles)if(o!==v&&o.bump){o.bump=0;o.bumpV=0;}
  cc_garages(player,dt,now);cc_work(dt,player);cc_uiT-=dt;if(cc_uiT<=0||cc_busy){cc_uiT=.15;cc_hud(player);}}
const CC_ICON=()=>cc_gList;

// safety net: an error in car care disables the module (logged once) instead of breaking the frame loop
let cc_off=false;const cc_safe=(f,d)=>function(...a){if(cc_off)return d;try{return f(...a);}catch(e){cc_off=true;console.error('[carcare] disabled:',e);if(cc_ui){cc_ui.g.style.display='none';cc_ui.hint.style.display='none';}cc_busy=null;return d;}};
window.carcareDrive=cc_safe(cc_carcareDrive_,null);window.carcareAction=cc_safe(cc_carcareAction_,false);window.carcareCrash=cc_safe(cc_carcareCrash_);window.carcareUpdate=cc_safe(cc_carcareUpdate_);
