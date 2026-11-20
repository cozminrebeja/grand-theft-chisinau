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
  'Jora':{av:'🧑‍🔧',col:'#9dff8a',pitch:.95},'Vasea':{av:'🔧',col:'#f59e0b',pitch:.9},'Tolea':{av:'🃏',col:'#c7a2ff',pitch:1.05},'Necunoscut':{av:'❓',col:'#d0d0d0',pitch:.85}};
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
function ph_end(){const m=ph_m;if(m&&m.def.cleanup)try{m.def.cleanup(m);}catch(e){}if(m&&m.npc)scene.remove(m.npc);if(m&&m.car&&ph_P().car!==m.car)m.car.parkedAuto=true;
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
function ph_answer(yes){if(ph_state!=='ringing')return;ph_ui.call.style.display='none';const d=ph_call;ph_call=null;
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
