'use strict';
// Phone missions: now and then the phone rings (Mama, Mișa, Șeful…). Y accept / N decline, P opens the phone (X abandons).
// One mission at a time (taxi fares pause meanwhile). Missions live in PH_MISSIONS: add an entry to add a mission.
// Hooks from game.js: phoneUpdate(dt,player) per frame, phoneBusy() (blocks taxi fares), missionAction() on E/F/INTRĂ (true = handled),
// missionEvent(name,data) from other modules: 'store_exit' {name,paid} (linella_store), 'belot_end' {win} (bemol_terrace), 'busted' (game).
// Every spoken line is a literal in sms:'…' / ph_say(who,'…') / ph_done(m,lei,'…') / ph_fail(m,'…') so tools/gen_piper.py can pre-render it.

const PH_HOME_AT={x:350,z:-450};          // home ("acasă"): snapped to the nearest street at runtime
const PH_FIRST=45,PH_GAP=[120,240],PH_RING=15;   // seconds: first call, gap between calls, ring time
let ph_state='idle',ph_cd=PH_FIRST,ph_ringT=0,ph_call=null,ph_m=null,ph_last=null,ph_ui=null,ph_log=[],ph_home=null,ph_uiT=0,ph_ringBeep=0,ph_ac=null;
const PH_HOME_ICON=[];

// ---------------- helpers ----------------
const ph_api=()=>window.gtcApi;
const ph_P=()=>gtcApi.player;
function ph_say(who,text){const d=PH_WHO[who]||{};subtitle(who,text,d.col||'#9fd8ff');if(typeof lst_speak==='function')lst_speak(text,d.pitch||1,1.05);ph_sms(who,text);}
function ph_sms(who,text){ph_log.push({who,text});if(ph_log.length>8)ph_log.shift();ph_uiInit();const d=PH_WHO[who]||{};const b=ph_ui.sms;
  b.innerHTML=`<div class="n" style="color:${d.col||'#9fd8ff'}">${d.av||'💬'} ${who}</div><div>${text}</div>`;b.style.display='block';b.style.opacity=1;clearTimeout(b._t);b._t=setTimeout(()=>{b.style.opacity=0;setTimeout(()=>b.style.display='none',400);},7000);}
const PH_WHO={'Mama':{av:'👩',col:'#ff9ecb',pitch:1.15},'Mișa':{av:'🧔',col:'#7dd3ff',pitch:1},'Șeful':{av:'👔',col:'#ffb347',pitch:.88},
  'Jora':{av:'🧑‍🔧',col:'#9dff8a',pitch:.95},'Vasea':{av:'🔧',col:'#f59e0b',pitch:.9},'Tolea':{av:'🃏',col:'#c7a2ff',pitch:1.05},'Necunoscut':{av:'❓',col:'#d0d0d0',pitch:.85},
  'Bunica':{av:'👵',col:'#ffc1e3',pitch:1.18},'Vitea':{av:'🎓',col:'#7dffb0',pitch:1.08},'Valentina':{av:'🍦',col:'#ff8ab3',pitch:1.15},'Grișa':{av:'🧑‍🌾',col:'#d9b38c',pitch:.92},
  'Fedea':{av:'🚕',col:'#ffd23f',pitch:.95},'Paznicul Ion':{av:'🦺',col:'#ff8a65',pitch:.8},'Nașul':{av:'🤵',col:'#e6c27a',pitch:.85},'Sanea':{av:'🚐',col:'#7fb2ff',pitch:1},'Pasager':{av:'🧍',col:'#cfd8dc',pitch:1.05}};
function ph_spot(px,pz,dmin,dmax,park){for(let t=0;t<60;t++){const e=randEdgeNear(px,pz,dmin,dmax,edges,30);if(!e||e.w>13||e.len<20||e.tw)continue;const P=e.pts,s=Math.floor(Math.random()*(P.length-1)),a=P[s],b=P[s+1];
    const dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);if(l<8)continue;const f=.3+Math.random()*.4,side=Math.random()<.5?1:-1,nx=-dz/l*side,nz=dx/l*side,o=e.w/2+(park?.55:1.5);
    const x=a[0]+dx*f+nx*o,z=a[1]+dz*f+nz*o;if(pushOut(x,z,park?2:.6))continue;if(park&&vehicles.some(v=>Math.abs(v.x-x)<6&&Math.abs(v.z-z)<6))continue;
    return {x,z,h:Math.atan2(dx,dz),fx:-nx,fz:-nz};}return null;}
function ph_poi(re,dmin,dmax){const P=ph_P();let L=D.pois.filter(p=>!re||re.test(p[0]));if(!re)L=L.filter(p=>{const d=Math.hypot(p[1]-P.x,p[2]-P.z);return d>dmin&&d<dmax;});
  if(!L.length)return null;const p=re?L.sort((a,b)=>Math.hypot(a[1]-P.x,a[2]-P.z)-Math.hypot(b[1]-P.x,b[2]-P.z))[0]:L[Math.floor(Math.random()*L.length)];
  const ns=nearestSeg(p[1],p[2],250);if(!ns)return null;const s=ns.s,dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1],l=Math.hypot(dx,dz)||1;let nx=-dz/l,nz=dx/l;if((p[1]-ns.qx)*nx+(p[2]-ns.qz)*nz<0){nx=-nx;nz=-nz;}
  const o=s.r.w/2+1.8;return {name:p[0],x:ns.qx+nx*o,z:ns.qz+nz*o};}
function ph_nearest(list,filter){const P=ph_P();let b=null,bd=1e18;for(const s of list||[]){if(filter&&!filter(s))continue;const d=(s.x-P.x)**2+(s.z-P.z)**2;if(d<bd){bd=d;b=s;}}return b;}
function ph_getHome(){if(ph_home)return ph_home;let best=null,bd=1e18;for(const e of edges){if(e.w<6||e.w>12||e.tw)continue;const d=(e.mid[0]-PH_HOME_AT.x)**2+(e.mid[1]-PH_HOME_AT.z)**2;if(d<bd){bd=d;best=e;}}
  if(!best)return ph_home={x:PH_HOME_AT.x,z:PH_HOME_AT.z};const P=best.pts,k=Math.max(0,Math.floor(P.length/2)-1),a=P[k],b=P[k+1]||P[k],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz)||1,o=best.w/2+1.5;
  ph_home={x:(a[0]+b[0])/2-dz/l*o,z:(a[1]+b[1])/2+dx/l*o,name:'Acasă'};PH_HOME_ICON.push(ph_home);return ph_home;}
function ph_npc(x,z,shirt,face){if(typeof makePersonGroup!=='function')return null;const g=makePersonGroup(shirt,0x2b2f3a,0xd9a77f);g.userData.own=true;g.position.set(x,groundY(x,z),z);if(face!=null)g.rotation.y=face;scene.add(g);return g;}
function ph_car(type,sp,paint){const v=makeVehicle(type,sp.x,sp.z,sp.h,paint);if(v&&typeof cc_state==='function'){const c=cc_state(v);c.hp=100;c.fuel=Math.max(c.fuel,15);}return v;}
// roadside point (sidewalk) on the street nearest to (x,z)
function ph_snap(x,z,w0,w1,re){let best=null,bd=1e18;for(const e of edges){if(e.w<(w0||4)||e.w>(w1||14)||e.tw&&!re||re&&!re.test(e.name||''))continue;const d=(e.mid[0]-x)**2+(e.mid[1]-z)**2;if(d<bd){bd=d;best=e;}}
  if(!best)return {x,z};const P=best.pts,k=Math.max(0,Math.floor(P.length/2)-1),a=P[k],b=P[k+1]||P[k],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz)||1,o=best.w/2+1.5;
  return {x:(a[0]+b[0])/2-dz/l*o,z:(a[1]+b[1])/2+dx/l*o,e:best};}
// passenger missions: someone waits on the pavement, you stop next to them in a car and they get in
function ph_pickup(m,dmin,dmax,shirt,text){const P=ph_P(),s=ph_spot(P.x,P.z,dmin,dmax,false);if(!s)return false;if(m.npc)scene.remove(m.npc);
  m.npc=ph_npc(s.x,s.z,shirt,Math.atan2(s.fx,s.fz));m.stage='pickup';ph_goal(m,s.x,s.z,text,{r:9});return true;}
function ph_board(m,dt){if(m.npc)animatePlayer(m.npc,0,0,dt);if(ph_at(m,true)){if(m.npc)scene.remove(m.npc);m.npc=null;return true;}return false;}
function ph_away(m,dt,lim){if(ph_P().car){m.out=0;return false;}m.out=(m.out||0)+dt;return m.out>(lim||8);}   // true = left the car too long
// a vehicle to point at: the nearest one matching ok(v) within 400 m, else a parked one spawned nearby
function ph_findCar(m,ok,type,paint){const now=performance.now();if(m.scanT>now&&m.goal)return;m.scanT=now+2500;const P=ph_P();let b=null,bd=400*400;
  for(const v of vehicles){if(!ok(v)||v===P.car)continue;const d=(v.x-P.x)**2+(v.z-P.z)**2;if(d<bd){bd=d;b=v;}}
  if(!b){const s=ph_spot(P.x,P.z,30,180,true);if(s){b=ph_car(type,s,paint);m.spawned=b;}}if(b)ph_goal(m,b.x,b.z,m.carText,{r:5,follow:b});}
// a thief that runs away along the street graph
function ph_cum(e){if(e._cum)return e._cum;const P=e.pts,c=[0];for(let i=1;i<P.length;i++)c.push(c[i-1]+Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]));return e._cum=c;}
function ph_along(e,d,lat){const P=e.pts,c=ph_cum(e);let i=1;while(i<P.length-1&&c[i]<d)i++;const a=P[i-1],b=P[i],l=c[i]-c[i-1]||1,f=Math.max(0,Math.min(1,(d-c[i-1])/l)),dx=(b[0]-a[0])/l,dz=(b[1]-a[1])/l;
  return [a[0]+(b[0]-a[0])*f-dz*lat,a[1]+(b[1]-a[1])*f+dx*lat,dx,dz];}
function ph_thiefMove(T,dt,px,pz){const e=T.e,L=ph_cum(e)[e.pts.length-1];T.d+=T.dir*T.sp*dt;
  if(T.d>L||T.d<0){const node=T.dir>0?e.b:e.a;let best=null,bs=-1;const nb=adj.get(node)||[];
    for(const ne of nb){if(ne===e&&nb.length>1)continue;const far=ne.a===node?ne.b:ne.a,fp=nodePos[far];const sc=Math.hypot(fp[0]-px,fp[1]-pz)+Math.random()*30;if(sc>bs){bs=sc;best=ne;}}
    if(!best)best=e;T.e=best;const NL=ph_cum(best)[best.pts.length-1];if(best.a===node){T.d=0;T.dir=1;}else{T.d=NL;T.dir=-1;}T.lat=(best.w/2+1.2)*T.side;}
  const [x,z,dx,dz]=ph_along(T.e,T.d,T.lat);T.x=x;T.z=z;T.h=Math.atan2(dx*T.dir,dz*T.dir);}
function ph_stopNext(m){const P=ph_P();let b=null,bd=1e18;for(const s of stops){if(m.seen.has(s.i))continue;const d=Math.hypot(s.px-P.x,s.pz-P.z);if(d<250||d>900)continue;if(d<bd){bd=d;b=s;}}
  if(!b)for(const s of stops){if(m.seen.has(s.i))continue;const d=Math.hypot(s.px-P.x,s.pz-P.z);if(d>60&&d<bd){bd=d;b=s;}}return b;}
function ph_fare(m){const P=ph_P(),s=ph_spot(P.x,P.z,100,400,false);if(!s)return;if(m.npc)scene.remove(m.npc);m.npc=ph_npc(s.x,s.z,mpick([0x9c2f2f,0x2f5d9c,0x3c7a3c,0x777777]),Math.atan2(s.fx,s.fz));
  m.stage='pickup';m.t=null;ph_goal(m,s.x,s.z,'Client '+(m.n+1)+'/3: ia-l din stradă',{r:9});}
// mission markers: a tall translucent beam + ground ring; follows m.goal (or a car)
let ph_mk=null;
function ph_marker(){if(ph_mk)return ph_mk;const g=new THREE.Group();const mat=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.28,depthWrite:false,side:THREE.DoubleSide});
  const beam=new THREE.Mesh(new THREE.CylinderGeometry(1.2,1.2,40,16,1,true),mat);beam.position.y=20;const ring=new THREE.Mesh(new THREE.RingGeometry(2.4,3,32).rotateX(-Math.PI/2),mat.clone());ring.material.opacity=.8;ring.position.y=.25;
  g.add(beam,ring);g.visible=false;scene.add(g);return ph_mk={g,beam,ring};}
function ph_goal(m,x,z,text,o){o=o||{};m.goal={x,z,text,r:o.r||8,car:o.car||null,follow:o.follow||null};const M=ph_marker(),c=new THREE.Color((PH_WHO[m.def.from]||{}).col||'#ffd23f');
  M.beam.material.color.copy(c);M.ring.material.color.copy(c);M.g.visible=true;if(ph_api().gps)ph_api().gps(x,z);}
function ph_at(m,needCar){const g=m.goal,P=ph_P();if(!g)return false;const v=P.car;if(needCar&&!v)return false;const x=v?v.x:P.x,z=v?v.z:P.z;return Math.hypot(g.x-x,g.z-z)<g.r&&(!v||Math.abs(v.speed)<3);}
function ph_done(m,lei,text){ph_say(m.def.from,text);const api=ph_api();api.money+=lei;api.say('Misiune îndeplinită','+'+lei+' lei · '+m.def.title,3,'#7dff8a');ph_end();}
function ph_fail(m,text){ph_say(m.def.from,text);ph_api().say('Misiune eșuată',m.def.title,3,'#ff8a65');ph_end();}
function ph_end(){const m=ph_m;if(m&&m.def.cleanup)try{m.def.cleanup(m);}catch(e){}if(m&&m.npc)scene.remove(m.npc);for(const c of [m&&m.car,m&&m.spawned])if(c&&ph_P().car!==c)c.parkedAuto=true;
  ph_m=null;ph_state='idle';ph_cd=PH_GAP[0]+Math.random()*(PH_GAP[1]-PH_GAP[0]);if(ph_mk)ph_mk.g.visible=false;if(ph_api().gpsOff)ph_api().gpsOff();if(ph_ui)ph_ui.track.style.display='none';}

// ---------------- the missions ----------------
const PH_MISSIONS=[
  {id:'mama',from:'Mama',title:'Pâine pentru mama',sms:'Puiule, ia-mi te rog o pâine de la Linella și adu-o acasă.',
   can:()=>typeof linella_list!=='undefined'&&linella_list&&linella_list.length,
   start(m){const L=ph_nearest(linella_list);m.stage='buy';ph_goal(m,L.x,L.z,'Cumpără o pâine de la Linella',{r:30});},
   ev(m,n,d){if(n!=='store_exit'||m.stage!=='buy')return;
     if(!/Pâine|Franzelă/.test(d.name)){ph_say('Mama','Am zis pâine, nu altceva!');return;}
     m.stage='home';const H=ph_getHome();ph_goal(m,H.x,H.z,'Du pâinea acasă',{r:5});if(!d.paid)ph_say('Mama','Sper că ai plătit-o, da?');},
   update(m){if(m.stage==='home'&&ph_at(m))ph_done(m,40,'Mulțumesc, puiule! Uite 40 de lei.');}},

  {id:'misa',from:'Mișa',title:'Mișa la piață',sms:'Frate, poți să mă iei? Mergem la Piața Centrală.',
   start(m){const s=ph_spot(ph_P().x,ph_P().z,250,700,false);if(!s)return false;m.npc=ph_npc(s.x,s.z,0x3b6fb6,Math.atan2(s.fx,s.fz));m.stage='pickup';ph_goal(m,s.x,s.z,'Ia-l pe Mișa cu mașina',{r:9});},
   update(m,dt){const P=ph_P();
     if(m.stage==='pickup'){if(m.npc)animatePlayer(m.npc,0,0,dt);if(ph_at(m,true)){scene.remove(m.npc);m.npc=null;m.stage='drop';
         const T=ph_poi(/Piața Centrală/i)||ph_poi(null,700,2500);ph_goal(m,T.x,T.z,'Du-l pe Mișa la '+T.name,{r:10});ph_say('Mișa','Salut! Hai, la Piața Centrală.');}}
     else{if(!P.car){m.out=(m.out||0)+dt;if(m.out>8)ph_fail(m,'Unde fugi, frate? Mă duc pe jos.');}else m.out=0;
       if(ph_at(m,true))ph_done(m,70,'Mersi, frate! Uite 70 de lei de benzină.');}}},

  {id:'sef',from:'Șeful',title:'Întârzii la lucru',sms:'Unde ești? Întârzii la lucru! Ai trei minute!',
   start(m){const T=ph_poi(null,900,1700);if(!T)return false;m.t=180;m.stage='go';ph_goal(m,T.x,T.z,'Ajungi la lucru: '+T.name,{r:10});},
   update(m,dt){m.t-=dt;if(ph_at(m))ph_done(m,90,'Bine că ai venit. Azi te iert.');else if(m.t<=0)ph_fail(m,'Iar ai întârziat! Ți-am tăiat din salariu.');}},

  {id:'jora',from:'Jora',title:'Canistra lui Jora',sms:'Frate, am rămas fără benzină. Ia o canistră de la Bemol și adu-mi-o!',
   can:()=>typeof bemol_list!=='undefined'&&bemol_list&&bemol_list.length,
   start(m){const s=ph_spot(ph_P().x,ph_P().z,500,1200,true);if(!s)return false;m.car=ph_car('lada',s,0x8a1c1c);m.jora={x:s.x,z:s.z};
     const fx=Math.cos(s.h),fz=-Math.sin(s.h),jx=s.x-s.fx*2.2,jz=s.z-s.fz*2.2;m.npc=ph_npc(jx,jz,0x4f7a2e,Math.atan2(s.fx,s.fz));
     m.stage='buy';const B=ph_nearest(bemol_list);m.bemol=B;ph_goal(m,B.x,B.z,'Cumpără o canistră la Bemol (E lângă pompe) · 100 lei',{r:12});},
   action(m){if(m.stage!=='buy')return false;const P=ph_P(),v=P.car,x=v?v.x:P.x,z=v?v.z:P.z;if(v&&Math.abs(v.speed)>1.5)return false;
     const B=ph_nearest(bemol_list);if(!B||Math.hypot(B.x-x,B.z-z)>12)return false;const api=ph_api();
     if(api.money<100){api.say('Canistra: 100 lei','Nu ai destui bani',2,'#ff8a65');return true;}
     api.money-=100;api.say('⛽ Canistră cumpărată','-100 lei',2,'#7dffa8');m.stage='deliver';ph_goal(m,m.jora.x,m.jora.z,'Du canistra la Jora',{r:7});return true;},
   update(m,dt){if(m.npc)animatePlayer(m.npc,0,0,dt);if(m.stage==='deliver'&&ph_at(m))ph_done(m,220,'Mersi, frate! Uite 220 de lei, ai meritat.');}},

  {id:'vasea',from:'Vasea',title:'Mașina clientului',sms:'Am terminat o mașină. Du-o la client, dar fără zgârieturi!',
   can:()=>typeof cc_gList!=='undefined'&&cc_gList&&cc_gList.length,
   start(m){const G=ph_nearest(cc_gList);m.G=G;m.stage='go';ph_goal(m,G.x,G.z,'Mergi la '+G.G.name,{r:40});},
   update(m,dt){const P=ph_P(),G=m.G;
     if(m.stage==='go'){if(m.goal&&(m.goal.x!==G.x||m.goal.z!==G.z))ph_goal(m,G.x,G.z,'Mergi la '+G.G.name,{r:40});   // garage snapped to its street
       if(Math.hypot(G.x-P.x,G.z-P.z)<140&&(G.placed||G.placed===false)){let sp;
         if(G.placed){const [x,z]=cc_W(G.placed,3,-5.8);sp={x,z,h:G.placed.a+Math.PI/2};}else sp=ph_spot(G.x,G.z,0,80,true);if(!sp)return;
         m.car=ph_car(Math.random()<.5?'suv':'logan',sp,Math.random()<.5?0x1d2c4f:0xc8ccd0);m.stage='get';ph_goal(m,sp.x,sp.z,'Urcă în mașina clientului',{r:5,follow:m.car});}}
     else if(m.stage==='get'){if(P.car===m.car){const T=ph_poi(null,700,1800);m.stage='deliver';ph_goal(m,T.x,T.z,'Du mașina la client: '+T.name+' · fără zgârieturi!',{r:10});}}
     else{if(P.car!==m.car){m.out=(m.out||0)+dt;if(m.out>15)ph_fail(m,'Unde ai lăsat mașina clientului?!');}else m.out=0;
       if(P.car===m.car&&ph_at(m,true)){const hp=typeof cc_state==='function'?cc_state(m.car).hp:100;
         if(hp>=90)ph_done(m,150,'Clientul e mulțumit. Uite 150 de lei!');else ph_done(m,40,'Ai zgâriat-o! Îți dau doar 40 de lei.');}}}},

  {id:'tolea',from:'Tolea',title:'O belotă cu Tolea',sms:'Hai la belot la Bemol, ne trebuie al patrulea!',
   can:()=>typeof bemol_list!=='undefined'&&bemol_list&&bemol_list.length&&typeof bemol_cfg==='function',
   start(m){const B=ph_nearest(bemol_list,s=>s.placed!==false&&bemol_cfg(s).belot.some(n=>n<4));if(!B)return false;m.stage='play';
     ph_goal(m,B.x,B.z,'Joacă o partidă de belot la Bemol (ia loc la o masă cu E)',{r:25});},
   ev(m,n,d){if(n!=='belot_end')return;if(d.win)ph_done(m,120,'Bravo! Ai câștigat, uite 120 de lei.');else ph_done(m,40,'Ai pierdut, dar ai jucat frumos. Uite 40 de lei.');}},

  {id:'necunoscut',from:'Necunoscut',title:'O treabă murdară',sms:'Am o treabă pentru tine. Un SUV alb e parcat aproape. Du-l la vulcanizare și primești 350 de lei.',
   can:()=>typeof cc_gList!=='undefined'&&cc_gList&&cc_gList.length,
   start(m){const s=ph_spot(ph_P().x,ph_P().z,300,700,true);if(!s)return false;m.car=ph_car('suv',s,0xf4f4f2);m.stage='steal';ph_goal(m,s.x,s.z,'Fură SUV-ul alb',{r:5,follow:m.car});},
   ev(m,n){if(n==='busted')ph_fail(m,'Te-au prins. Nu mă mai suna.');},
   update(m,dt){const P=ph_P();
     if(m.stage==='steal'){if(P.car===m.car){ph_api().addStar(2);const G=ph_nearest(cc_gList);m.G=G;m.stage='deliver';ph_goal(m,G.x,G.z,'Du SUV-ul la '+G.G.name,{r:12});}}
     else{if(m.goal.x!==m.G.x||m.goal.z!==m.G.z){m.goal.x=m.G.x;m.goal.z=m.G.z;}if(P.car===m.car&&ph_at(m,true))ph_done(m,350,'Bună treabă. Banii sunt la tine. Uită de mine.');}}},
  {id:'bunica',from:'Bunica',title:'Ouăle bunicii',sms:'Puiule, du-mă la Piața Centrală, dar încet, că mi se varsă ouăle!',
   start(m){return ph_pickup(m,200,600,0x6b4c7a,'Ia-o pe bunica cu mașina');},
   update(m,dt){const P=ph_P();
     if(m.stage==='pickup'){if(ph_board(m,dt)){m.stage='drop';m.eggs=0;m.over=0;const T=ph_poi(/Piața Centrală/i)||ph_poi(null,700,2500);ph_goal(m,T.x,T.z,'',{r:10});ph_say('Bunica','Încet, puiule, încet!');}return;}
     if(ph_away(m,dt)){ph_fail(m,'Mă duc pe jos, că tu nu știi să conduci!');return;}
     if(P.car&&Math.abs(P.car.speed)>11.2){m.over+=dt;if(m.over>1.5){m.over=0;m.eggs++;ph_say('Bunica','Vai, ouăle! Mai încet!');}}else m.over=Math.max(0,m.over-dt);
     m.goal.text='Du bunica la Piața Centrală · max 40 km/h · ouă sparte: '+m.eggs;
     if(ph_at(m,true)){const lei=Math.max(20,80-m.eggs*15);if(m.eggs===0)ph_done(m,80,'Toate ouăle întregi! Ești băiat de aur.');else ph_done(m,lei,'Mi-ai spart ouăle, dar mersi că m-ai adus.');}}},

  {id:'vitea',from:'Vitea',title:'Examenul lui Vitea',sms:'Frate, am adormit! Am examen la USM în patru minute, vino după mine!',
   start(m){return ph_pickup(m,150,500,0x2e8b57,'Ia-l pe Vitea cu mașina');},
   update(m,dt){const P=ph_P();
     if(m.stage==='pickup'){if(ph_board(m,dt)){m.stage='drop';const T=ph_poi(/^USM$/)||ph_poi(null,900,2500);m.t=Math.max(150,Math.round(Math.hypot(T.x-P.x,T.z-P.z)/10+40));
         ph_goal(m,T.x,T.z,'Du-l pe Vitea la USM',{r:12});ph_say('Vitea','Hai, apasă, că mă pică!');}return;}
     m.t-=dt;if(ph_away(m,dt)){ph_fail(m,'Las-o, iau troleibuzul.');return;}
     if(ph_at(m,true))ph_done(m,90,'Am ajuns! Mersi, frate, îți dau o bere după sesiune.');else if(m.t<=0)ph_fail(m,'Gata, am întârziat. Mă pică sigur.');}},

  {id:'valentina',from:'Valentina',title:'Înghețata se topește',sms:'S-a defectat frigiderul! Ia înghețata de la noi și du-o la alt Linella, repede, că se topește!',
   can:()=>typeof linella_list!=='undefined'&&linella_list&&linella_list.length>1,
   start(m){const A=ph_nearest(linella_list),B=linella_list.filter(s=>s!==A&&Math.hypot(s.x-A.x,s.z-A.z)>500).sort((a,b)=>Math.hypot(a.x-A.x,a.z-A.z)-Math.hypot(b.x-A.x,b.z-A.z))[0];
     if(!B)return false;m.A=A;m.B=B;m.stage='get';ph_goal(m,A.x,A.z,'Ia înghețata de la Linella',{r:25});},
   update(m,dt){if(m.stage==='get'){if(ph_at(m)){m.stage='go';m.t=Math.round(Math.max(90,Math.hypot(m.B.x-m.A.x,m.B.z-m.A.z)/8+30));ph_goal(m,m.B.x,m.B.z,'Du înghețata la celălalt Linella',{r:25});ph_say('Valentina','Fugi, fugi, că se topește!');}return;}
     m.t-=dt;if(ph_at(m))ph_done(m,120,'Ai salvat înghețata! Mulțumim frumos.');else if(m.t<=0)ph_fail(m,'S-a topit tot. Lasă, nu-i nimic.');}},

  {id:'grisa',from:'Grișa',title:'Cursa cu Grișa',sms:'Vecine, mi-a rămas mașina în Durlești. Mă duci s-o iau?',
   start(m){return ph_pickup(m,150,500,0x8b5a2b,'Ia-l pe vecinul Grișa cu mașina');},
   update(m,dt){const P=ph_P();
     if(m.stage==='pickup'){if(ph_board(m,dt)){m.stage='drop';const T=ph_snap(-5300,250);ph_goal(m,T.x,T.z,'Du-l pe Grișa la Durlești',{r:14});ph_say('Grișa','Hai, la Durlești! Pe urmă facem o cursă înapoi.');}return;}
     if(m.stage==='drop'){if(ph_away(m,dt)){ph_fail(m,'Bine, iau un taxi.');return;}
       if(ph_at(m,true)){m.stage='race';const H=ph_getHome();m.t=Math.round(Math.hypot(H.x-P.x,H.z-P.z)/11+25);ph_goal(m,H.x,H.z,'Cursă cu Grișa: ajungi primul acasă!',{r:8});ph_say('Grișa','Cine ajunge primul acasă? Start!');}return;}
     m.t-=dt;if(ph_at(m))ph_done(m,100,'Ai câștigat! Data viitoare te bat eu.');else if(m.t<=0)ph_fail(m,'Ha! Am ajuns primul. Mai exersează.');}},

  {id:'fedea',from:'Fedea',title:'Clienții lui Fedea',sms:'M-a amendat poliția, nu pot lucra azi. Ia tu trei clienți de-ai mei cu taxiul!',
   start(m){m.n=0;m.stage='taxi';m.carText='Urcă într-un taxi';},
   update(m,dt){const P=ph_P(),v=P.car,inTaxi=!!(v&&v.type==='taxi');
     if(m.stage==='taxi'){if(inTaxi)ph_fare(m);else ph_findCar(m,o=>o.type==='taxi','taxi');return;}
     if(!inTaxi){m.out=(m.out||0)+dt;if(m.out>10)ph_fail(m,'Ai lăsat taxiul? Lasă, mă descurc singur.');return;}m.out=0;
     if(m.stage==='pickup'){if(ph_board(m,dt)){const T=ph_poi(null,400,1500);const d=Math.hypot(T.x-P.x,T.z-P.z);m.fare=Math.round(25+d*.05);m.t=Math.round(d*1.35/10+25);m.stage='drop';
         ph_goal(m,T.x,T.z,'Client '+(m.n+1)+'/3: '+T.name,{r:10});ph_say('Pasager','La colț, vă rog!');}return;}
     m.t-=dt;if(ph_at(m,true)){m.n++;const api=ph_api();api.money+=m.fare;api.say('+'+m.fare+' lei','Client '+m.n+'/3',1.8,'#7dff8a');
       if(m.n>=3)ph_done(m,100,'Mersi, frate! Uite 100 de lei bonus.');else ph_fare(m);}
     else if(m.t<=0)ph_fail(m,'Clientul a plecat. Mi-ai stricat reputația!');}},

  {id:'hot',from:'Paznicul Ion',title:'Prinde hoțul',sms:'Ăla care a furat de la noi, l-am văzut pe Ștefan cel Mare! Prinde-l!',
   start(m){const P=ph_P(),S=ph_snap(P.x,P.z,4,40,/Ștefan cel Mare/);if(!S.e)return false;m.S=S;m.stage='go';ph_goal(m,S.x,S.z,'Mergi pe bulevardul Ștefan cel Mare',{r:70});},
   update(m,dt){const P=ph_P(),v=P.car,px=v?v.x:P.x,pz=v?v.z:P.z;
     if(m.stage==='go'){if(Math.hypot(m.S.x-px,m.S.z-pz)<70&&worldReadyAt(m.S.x,m.S.z)){const e=m.S.e,L=ph_cum(e)[e.pts.length-1];
         const T={e,d:L/2,dir:1,side:Math.random()<.5?1:-1,sp:6.4,x:0,z:0,h:0};T.lat=(e.w/2+1.2)*T.side;
         const [ax,az]=ph_along(e,Math.max(0,T.d-10),T.lat),[bx,bz]=ph_along(e,Math.min(L,T.d+10),T.lat);T.dir=Math.hypot(ax-px,az-pz)>Math.hypot(bx-px,bz-pz)?-1:1;   // run away from you
         ph_thiefMove(T,0,px,pz);m.T=T;m.npc=ph_npc(T.x,T.z,0xc0262c,T.h);m.stage='chase';m.t=80;ph_goal(m,T.x,T.z,'Prinde hoțul în geacă roșie!',{r:2});ph_say('Paznicul Ion','Uite-l! Ăla în geacă roșie!');}return;}
     const T=m.T;m.t-=dt;ph_thiefMove(T,dt,px,pz);if(m.npc){m.npc.position.set(T.x,groundY(T.x,T.z),T.z);m.npc.rotation.y=T.h;m.phase=(m.phase||0)+dt*T.sp*1.6;animatePlayer(m.npc,m.phase,T.sp,dt);}
     m.goal.x=T.x;m.goal.z=T.z;const d=Math.hypot(T.x-px,T.z-pz);
     if(d<(v?3.2:1.5))ph_done(m,150,'L-ai prins! Bravo, mulțumesc!');else if(m.t<=0||d>260)ph_fail(m,'A fugit. Lasă, îl prind eu data viitoare.');}},

  {id:'nasul',from:'Nașul',title:'Nunta',sms:'Nuntă la restaurant! Adu-l pe mire de acasă, dar cu o mașină frumoasă, nu cu o rablă!',
   start(m){m.stage='car';m.carText='Găsește o mașină frumoasă: SUV sau Logan, minim 80%';},
   update(m,dt){const P=ph_P(),v=P.car,hp=o=>typeof cc_state==='function'?cc_state(o).hp:100,nice=o=>!!o&&(o.type==='suv'||o.type==='logan')&&hp(o)>=80;
     if(m.stage==='car'){if(nice(v)){m.wed=v;if(ph_pickup(m,200,600,0xf4f4f4,'Ia mirele (în cămașă albă)'))ph_say('Nașul','Asta da mașină! Acum ia mirele.');}else ph_findCar(m,nice,'suv',0xf4f4f2);return;}
     if(m.stage==='pickup'){if(v!==m.wed){m.stage='car';m.scanT=0;return;}if(ph_board(m,dt)){m.stage='drop';const T=ph_poi(/Restaurant/i)||ph_poi(null,600,2000);
         ph_goal(m,T.x,T.z,'Du mirele la restaurant · fără zgârieturi',{r:12});ph_say('Nașul','Hai, că ne așteaptă lăutarii!');}return;}
     if(v!==m.wed){m.out=(m.out||0)+dt;if(m.out>10)ph_fail(m,'Unde e mirele?! Nunta s-a stricat!');return;}m.out=0;
     if(ph_at(m,true)){if(hp(v)>=80)ph_done(m,300,'Ce nuntă! Uite 300 de lei, ai fost ca un fin adevărat.');else ph_done(m,150,'Mașina e zgâriată, dar mirele a ajuns. Uite 150 de lei.');}}},

  {id:'sanea',from:'Sanea',title:'Rutiera 125',sms:'Sunt bolnav, frate. Ia tu rutiera pe 125 și oprește în stații!',
   can:()=>typeof stops!=='undefined'&&stops.length>5,
   start(m){const P=ph_P(),s=ph_spot(P.x,P.z,30,200,true);if(!s)return false;m.car=ph_car('rutiera',s,0xf4f4f2);m.seen=new Set();m.n=0;m.stage='get';
     ph_goal(m,s.x,s.z,'Urcă în rutiera 125',{r:5,follow:m.car});},
   update(m,dt){const P=ph_P();
     if(m.stage==='get'){if(P.car===m.car){m.stage='route';m.stop=null;}else return;}
     if(P.car!==m.car){m.out=(m.out||0)+dt;if(m.out>12)ph_fail(m,'Ai lăsat rutiera?! Mă dai afară din serviciu!');return;}m.out=0;
     if(!m.stop){m.stop=ph_stopNext(m);if(!m.stop)return;ph_goal(m,m.stop.px,m.stop.pz,'Stația '+(m.n+1)+'/5: '+m.stop.name,{r:10});return;}
     if(ph_at(m,true)&&Math.abs(P.car.speed)<2){m.seen.add(m.stop.i);m.n++;const api=ph_api();api.money+=15;api.say('+15 lei','Stația '+m.stop.name,1.6,'#7dff8a');
       const r=Math.random();if(r<.33)ph_say('Pasager','Transmiteți banii, vă rog!');else if(r<.66)ph_say('Pasager','Opriți la stație, vă rog!');else ph_say('Pasager','Mai încet, șofer, nu duci cartofi!');
       m.stop=null;if(m.n>=5)ph_done(m,25,'Mersi, frate! Mâine iar ies eu pe traseu.');}}},
];

// ---------------- phone UI ----------------
function ph_uiInit(){if(ph_ui)return;const css=document.createElement('style');css.textContent=
  '.ph_box{position:fixed;right:16px;z-index:14;font:600 13px Inter,Arial,sans-serif;color:#fff;background:rgba(14,16,22,.92);border:1px solid rgba(255,255,255,.14);border-radius:16px;box-shadow:0 8px 28px rgba(0,0,0,.45)}'+
  '#ph_call{top:38%;width:240px;padding:14px;display:none;text-align:center;animation:ph_shake .6s infinite}'+
  '@keyframes ph_shake{0%,100%{transform:rotate(0)}10%{transform:rotate(-2deg)}20%{transform:rotate(2deg)}30%{transform:rotate(-1deg)}40%{transform:rotate(0)}}'+
  '#ph_call .av{font-size:38px;width:62px;height:62px;line-height:62px;margin:0 auto 6px;border-radius:50%;background:rgba(255,255,255,.08)}'+
  '#ph_call .nm{font:400 22px Anton,Impact,sans-serif;letter-spacing:.5px}#ph_call .st{opacity:.7;margin-bottom:12px}'+
  '.ph_btns{display:flex;gap:10px;justify-content:center}.ph_btn{flex:1;border:0;border-radius:12px;padding:9px 0;font:700 13px Inter,Arial;color:#fff;cursor:pointer}'+
  '.ph_ok{background:#1fa64a}.ph_no{background:#d33a2c}.ph_btn kbd{opacity:.75;font:700 11px Inter;margin-left:4px}'+
  '#ph_sms{top:calc(38% + 180px);width:250px;padding:10px 12px;display:none;transition:opacity .4s;line-height:1.35}#ph_sms .n{font-weight:800;margin-bottom:3px}'+
  '#ph_track{top:calc(200px + env(safe-area-inset-top));max-width:240px;padding:9px 12px;display:none;text-align:right;line-height:1.35}'+
  '#ph_track .w{font-weight:800}#ph_track .t{font:400 17px Anton,Impact,sans-serif;color:#ffd23f;letter-spacing:.3px}#ph_track .d{opacity:.8;font-size:12px}'+
  '#ph_panel{top:22%;width:270px;padding:14px;display:none}#ph_panel h3{margin:0 0 8px;font:400 20px Anton,Impact,sans-serif;letter-spacing:.5px}'+
  '#ph_panel .msg{background:rgba(255,255,255,.06);border-radius:10px;padding:6px 9px;margin:5px 0;font-size:12px;line-height:1.3}#ph_panel .cur{margin:8px 0 10px;color:#ffd23f}';
  document.head.appendChild(css);
  const mk=(id,html)=>{const d=document.createElement('div');d.id=id;d.className='ph_box';d.innerHTML=html||'';document.body.appendChild(d);return d;};
  const call=mk('ph_call','<div class="av"></div><div class="nm"></div><div class="st">te sună…</div><div class="ph_btns"><button class="ph_btn ph_ok">Răspunde<kbd>Y</kbd></button><button class="ph_btn ph_no">Respinge<kbd>N</kbd></button></div>');
  call.querySelector('.ph_ok').onclick=()=>ph_answer(true);call.querySelector('.ph_no').onclick=()=>ph_answer(false);
  const panel=mk('ph_panel');ph_ui={call,sms:mk('ph_sms'),track:mk('ph_track'),panel};}
function ph_panelDraw(){const p=ph_ui.panel,cur=ph_m?`<div class="cur">▶ ${ph_m.def.title}<br><span style="color:#fff;opacity:.8">${ph_m.goal?ph_m.goal.text:''}</span></div>`:'<div class="cur" style="color:#aaa">Nicio misiune activă</div>';
  p.innerHTML='<h3>📱 Telefon</h3>'+cur+(ph_log.slice(-5).reverse().map(l=>`<div class="msg"><b style="color:${(PH_WHO[l.who]||{}).col||'#9fd8ff'}">${l.who}:</b> ${l.text}</div>`).join('')||'<div class="msg">Niciun mesaj</div>')+
    `<div class="ph_btns" style="margin-top:10px">${ph_m?'<button class="ph_btn ph_no" id="ph_quit">Renunță<kbd>X</kbd></button>':''}<button class="ph_btn" style="background:#3a3f4b" id="ph_close">Închide<kbd>P</kbd></button></div>`;
  const q=document.getElementById('ph_quit');if(q)q.onclick=ph_quit;document.getElementById('ph_close').onclick=()=>{p.style.display='none';};}
function ph_quit(){if(!ph_m)return;ph_api().say('Ai renunțat',ph_m.def.title,2,'#ffb347');ph_end();if(ph_ui)ph_ui.panel.style.display='none';}
function ph_trackDraw(){const m=ph_m,T=ph_ui.track;if(!m||!m.goal){T.style.display='none';return;}const P=ph_P(),v=P.car,x=v?v.x:P.x,z=v?v.z:P.z,d=Math.round(Math.hypot(m.goal.x-x,m.goal.z-z));
  const w=PH_WHO[m.def.from]||{};T.style.display='block';
  T.innerHTML=`<div class="w" style="color:${w.col||'#fff'}">${w.av||''} ${m.def.from} · ${m.def.title}</div><div class="t">${m.goal.text}</div><div class="d">${d>=1000?(d/1000).toFixed(1)+' km':d+' m'}${m.t!=null?' · ⏱ '+Math.max(0,Math.ceil(m.t))+' s':''}</div>`;}

// ---------------- ringing / answering ----------------
function ph_beep(){try{if(typeof fx_muted!=='undefined'&&fx_muted)return;if(!ph_ac)ph_ac=new (window.AudioContext||window.webkitAudioContext)();const a=ph_ac,t=a.currentTime;
  for(let i=0;i<2;i++){const o=a.createOscillator(),g=a.createGain();o.type='triangle';o.frequency.value=i?1320:988;g.gain.setValueAtTime(0,t+i*.16);g.gain.linearRampToValueAtTime(.12,t+i*.16+.02);g.gain.linearRampToValueAtTime(0,t+i*.16+.14);o.connect(g).connect(a.destination);o.start(t+i*.16);o.stop(t+i*.16+.15);}}catch(e){}}
function ph_canRing(){const api=ph_api();if(!api||document.body.classList.contains('pre'))return false;
  if(typeof storeInside==='function'&&storeInside()||typeof airportInside==='function'&&airportInside()||typeof bemolBusy==='function'&&bemolBusy())return false;
  return !api.taxiMission&&!api.stars;}
function ph_ring(){const ok=PH_MISSIONS.filter(d=>(!d.can||d.can())&&d!==ph_last);if(!ok.length){ph_cd=30;return;}ph_call=ok[Math.floor(Math.random()*ok.length)];
  ph_state='ringing';ph_ringT=PH_RING;ph_uiInit();const w=PH_WHO[ph_call.from]||{};ph_ui.call.querySelector('.av').textContent=w.av||'📞';ph_ui.call.querySelector('.nm').textContent=ph_call.from;ph_ui.call.style.display='block';ph_ringBeep=0;}
function ph_answer(yes){if(ph_state!=='ringing')return;ph_uiInit();ph_ui.call.style.display='none';const d=ph_call;ph_call=null;
  if(!yes){ph_state='idle';ph_cd=PH_GAP[0];return;}
  if(ph_api().cancelTaxi)ph_api().cancelTaxi();const m={def:d,stage:null,goal:null};ph_m=m;ph_state='active';ph_last=d;ph_say(d.from,d.sms);
  let ok;try{ok=d.start(m);}catch(e){console.error('[phone] start',e);ok=false;}if(ok===false){ph_api().say('Apel întrerupt','Încearcă mai târziu',2,'#aaa');ph_end();ph_cd=40;}}

// ---------------- hooks ----------------
function phoneBusy(){return ph_state!=='idle';}
function missionAction(){const m=ph_m;if(!m||!m.def.action)return false;try{return !!m.def.action(m);}catch(e){console.error('[phone] action',e);return false;}}
function missionEvent(n,d){const m=ph_m;if(!m||!m.def.ev)return;try{m.def.ev(m,n,d||{});}catch(e){console.error('[phone] event',e);}}
function phoneUpdate(dt,player){if(typeof edges==='undefined'||!edges.length)return;ph_getHome();
  if(ph_state==='idle'){ph_cd-=dt;if(ph_cd<=0){if(ph_canRing())ph_ring();else ph_cd=10;}}
  else if(ph_state==='ringing'){ph_ringT-=dt;ph_ringBeep-=dt;if(ph_ringBeep<=0){ph_ringBeep=1.1;ph_beep();}if(ph_ringT<=0){ph_ui.call.style.display='none';ph_call=null;ph_state='idle';ph_cd=90;}}
  else if(ph_m){const m=ph_m;try{if(m.def.update)m.def.update(m,dt);}catch(e){console.error('[phone] update',e);ph_end();return;}
    if(ph_m&&m.goal){if(m.goal.follow){m.goal.x=m.goal.follow.x;m.goal.z=m.goal.follow.z;}const M=ph_marker();M.g.position.set(m.goal.x,surfaceY(m.goal.x,m.goal.z,null),m.goal.z);
      M.ring.material.opacity=.55+Math.sin(performance.now()/220)*.25;M.g.visible=!(m.goal.follow&&player.car===m.goal.follow);}}
  ph_uiT-=dt;if(ph_uiT<=0&&ph_ui){ph_uiT=.25;ph_trackDraw();if(ph_ui.panel.style.display==='block')ph_panelDraw();}}
addEventListener('keydown',e=>{if(e.repeat||document.body.classList.contains('pre'))return;
  if(ph_state==='ringing'&&(e.code==='KeyY'||e.code==='KeyN')){ph_answer(e.code==='KeyY');return;}
  if(e.code==='KeyP'){ph_uiInit();const p=ph_ui.panel;if(p.style.display==='block')p.style.display='none';else{ph_panelDraw();p.style.display='block';}return;}
  if(e.code==='KeyX'&&ph_ui&&ph_ui.panel.style.display==='block')ph_quit();});
