'use strict';
// Bemol terraces: every station gets a small BEMOL shop, a wooden deck with coffee tables and belot tables (instanced for all
// stations). Seated NPCs (a small pool of people) are placed only at the nearest station. Belot tables with 2-3 players invite
// you; E sits you down and the game is simulated with table talk in the subtitles; E again stands up.
// Called from bemol.js (bemol_buildTerraces, bemol_terraceUpdate); game.js hooks: bemolSeat(), bemolBusy().
// Layout in station-local metres (next to the canopy, which spans x ±4.5): shop at (9,-3), wooden deck z 1.5..9,
// coffee tables (round) at z 3, belot tables (square) at z 6.9. Each station picks one of 4 mirrored placements
// (s.sd = ±1 on x, s.zf = ±1 on z) whose footprint is clear of buildings and roads; built lazily near the player.
const BEMOL_COFFEE=[[7.8,3.0],[10.2,3.0]],BEMOL_BELOT=[[7.8,6.9],[10.2,6.9]];
const BEMOL_CSEAT=[[-.7,0],[.7,0]],BEMOL_BSEAT=[[0,-.75],[.75,0],[0,.75],[-.75,0]];
const BEMOL_NAMES=['Tolea','Valera','Jora','Vitea','Sanea','Mișa','Petrică','Ghena','Vasea','Costică','Grișa','Fedea'];
const BEMOL_PHRASES=['4 valeți!','Oo, bizon!','Blefofșic!','Hai dă cărțile!','-10','Arunc la -10','Naciala!','Belot!','Rebelot!','Terță!','Cine dă?','Iar ai luat tu?!'];
const BEMOL_INVITE=['Hai la o belotă!','Ne trebuie încă unul, vii?','Ia loc, facem o partidă!','Știi belot? Hai, stai jos!'];
const BEMOL_WIN=301;
let bemol_pool=[],bemol_act=null,bemol_seat=null,bemol_game=null,bemol_hintEl=null,bemol_prompt=null,bemol_cards=null;const bemol_inviteT={};
const bemol_W=(s,lx,lz)=>{const c=Math.cos(s.a),n=Math.sin(s.a),X=lx*s.sd,Z=lz*(s.zf||1);return [s.x+X*c+Z*n,s.z-X*n+Z*c];};
const bemol_yaw=(s,y)=>s.a+Math.atan2(s.sd*Math.sin(y),(s.zf||1)*Math.cos(y));   // local yaw → world yaw (mirrored with the layout)
const bemol_tq=new THREE.Quaternion(),bemol_tp=new THREE.Vector3(),bemol_ts=new THREE.Vector3(),bemol_ty=new THREE.Vector3(0,1,0);
function bemol_M(s,lx,ly,lz,yaw,sx,sy,sz){const [wx,wz]=bemol_W(s,lx,lz);bemol_tq.setFromAxisAngle(bemol_ty,bemol_yaw(s,yaw||0));
  return new THREE.Matrix4().compose(bemol_tp.set(wx,groundY(wx,wz)+ly,wz),bemol_tq,bemol_ts.set(sx||1,sy||1,sz||1));}
function bemol_inst(grp,geo,mat,list,shadow){if(!list.length)return;const im=new THREE.InstancedMesh(geo,mat,list.length);list.forEach((m,i)=>im.setMatrixAt(i,m));
  im.instanceMatrix.needsUpdate=true;im.castShadow=!!shadow;im.receiveShadow=true;im.frustumCulled=false;grp.add(im);}
// per-station table occupancy (deterministic): 2-4 belot players per table, 0-2 coffee drinkers per table
function bemol_cfg(s){if(s.cfg)return s.cfg;const r=k=>{const v=Math.sin(s.i*12.9898+k*78.233)*43758.5453;return v-Math.floor(v);};
  const nm=BEMOL_NAMES.slice();for(let i=nm.length-1;i>0;i--){const j=Math.floor(r(20+i)*(i+1));[nm[i],nm[j]]=[nm[j],nm[i]];}   // distinct names
  return s.cfg={coffee:[1+(r(1)<.6?1:0),r(2)<.7?1+(r(3)<.5?1:0):0],belot:[2+Math.floor(r(4)*3),2+Math.floor(r(5)*3)],names:nm.slice(0,8)};}
let bemol_TA=null,bemol_scanT=0;
function bemol_buildTerraces(){   // shared materials/geometry; the terraces themselves are built per station when you get close
  const wood=new THREE.MeshLambertMaterial({color:0x8a5a34}),white=new THREE.MeshLambertMaterial({color:0xf2f0ea}),metal=new THREE.MeshLambertMaterial({color:0x3a3d40});
  const bandT=bemol_tex(512,96,(g,w,h)=>{g.fillStyle='#0a8a43';g.fillRect(0,0,w,h);g.fillStyle='#ffd400';g.fillRect(0,h*.84,w,h*.16);g.fillStyle='#fff';g.textAlign='center';g.textBaseline='middle';
    g.font='900 54px Anton, Impact, Arial Black, sans-serif';g.fillText('BEMOL',w*.3,h*.44);g.font='800 30px Inter, Arial, sans-serif';g.fillText('CAFEA · MARKET',w*.72,h*.46);});
  const bandM=new THREE.MeshLambertMaterial({map:bandT,emissive:0x00260e});
  bemol_TA={wood,white,metal,bandM,green:new THREE.MeshLambertMaterial({color:0x0a8a43}),chair:new THREE.MeshLambertMaterial({color:0x1f6b3a}),
    card:new THREE.MeshLambertMaterial({color:0xfafafa}),glass:new THREE.MeshLambertMaterial({color:0xbfe3d0,emissive:0x3a5a48}),
    box:new THREE.BoxGeometry(1,1,1),cyl:new THREE.CylinderGeometry(1,1,1,14),cone:new THREE.ConeGeometry(1.45,.55,8)};}
// pick a placement: 4 mirrored variants, count sample points that hit a building or a road; null = map not loaded yet, false = no room
function bemol_place(s,pd){if(pd>45&&!polysNear(s.x,s.z,70,()=>true))return null;
  const sd0=s.sd||1;let best=null,bc=1e9;
  for(const [sd,zf] of [[sd0,1],[sd0,-1],[-sd0,1],[-sd0,-1]]){const t={x:s.x,z:s.z,a:s.a,sd,zf};let c=0;
    for(let lx=6.6;lx<=11.5;lx+=1.2)for(let lz=-6.6;lz<=9.2;lz+=1.3){const [wx,wz]=bemol_W(t,lx,lz);
      if(polysNear(wx,wz,0,P=>(P.h||0)>2&&insidePoly(P,wx,wz)))c++;else{const ns=nearestSeg(wx,wz,10);if(ns&&ns.d<ns.s.r.w/2+.4)c++;}}
    if(c<bc){bc=c;best=[sd,zf];}if(c===0)break;}
  if(bc>8)return false;s.sd=best[0];s.zf=best[1];return true;}
function bemol_buildTerrace(s){const T=bemol_TA,C=bemol_cfg(s),grp=new THREE.Group();
  const A={body:[],band:[],door:[],deck:[],rtop:[],sqtop:[],leg:[],seat:[],back:[],pole:[],umb:[],cup:[],card:[]};
  const chairs=(tx,tz,seats)=>{for(const [sx,sz] of seats){const yaw=Math.atan2(-sx,-sz);A.seat.push(bemol_M(s,tx+sx,.55,tz+sz,yaw,.42,.05,.42));
    A.back.push(bemol_M(s,tx+sx-Math.sin(yaw)*.2,.8,tz+sz-Math.cos(yaw)*.2,yaw,.42,.45,.05));}};
  A.body.push(bemol_M(s,9,1.6,-3,0,5,3.2,8));A.band.push(bemol_M(s,9,3.5,-3,0,5.1,.7,8.1));A.door.push(bemol_M(s,9,1.1,1.02,0,1.7,2.2,.06));
  A.deck.push(bemol_M(s,9,.05,5.25,0,5,.1,7.5));
  BEMOL_COFFEE.forEach(([tx,tz],ti)=>{A.rtop.push(bemol_M(s,tx,.86,tz,0,.42,.04,.42));A.leg.push(bemol_M(s,tx,.48,tz,0,.035,.76,.035));
    A.pole.push(bemol_M(s,tx,1.6,tz,0,.03,2.4,.03));A.umb.push(bemol_M(s,tx,2.85,tz,0));
    for(let k=0;k<C.coffee[ti];k++)A.cup.push(bemol_M(s,tx+BEMOL_CSEAT[k][0]*.45,.92,tz,0,.04,.08,.04));chairs(tx,tz,BEMOL_CSEAT);});
  BEMOL_BELOT.forEach(([tx,tz])=>{A.sqtop.push(bemol_M(s,tx,.86,tz,0,.9,.04,.9));A.leg.push(bemol_M(s,tx,.48,tz,0,.05,.76,.05));
    A.pole.push(bemol_M(s,tx,1.6,tz,0,.03,2.4,.03));A.umb.push(bemol_M(s,tx,2.85,tz,0));
    for(let k=0;k<3;k++)A.card.push(bemol_M(s,tx-.2+k*.012,.885+k*.004,tz+.22,k*.2,.07,.004,.1));chairs(tx,tz,BEMOL_BSEAT);});
  bemol_inst(grp,T.box,T.white,A.body,true);bemol_inst(grp,T.box,[T.bandM,T.bandM,T.white,T.white,T.bandM,T.bandM],A.band,true);bemol_inst(grp,T.box,T.glass,A.door);bemol_inst(grp,T.box,T.wood,A.deck);
  bemol_inst(grp,T.cyl,T.white,A.rtop);bemol_inst(grp,T.box,T.white,A.sqtop);bemol_inst(grp,T.cyl,T.metal,A.leg);bemol_inst(grp,T.box,T.chair,A.seat);bemol_inst(grp,T.box,T.chair,A.back);
  bemol_inst(grp,T.cyl,T.metal,A.pole);bemol_inst(grp,T.cone,T.green,A.umb,true);bemol_inst(grp,T.cyl,T.white,A.cup);bemol_inst(grp,T.box,T.card,A.card);
  scene.add(grp);
  if(!s.col){s.col=true;const [wx,wz]=bemol_W(s,9,-3);addRect(wx,wz,5,8,s.a,3.4);   // collisions once per station
    for(const [tx,tz] of BEMOL_COFFEE.concat(BEMOL_BELOT)){const [x,z]=bemol_W(s,tx,tz);addRect(x,z,.9,.9,s.a,.9);}}
  return grp;}
function bemol_terraces(player){const now=performance.now();if(now<bemol_scanT)return;bemol_scanT=now+400;
  for(const s of bemol_list){const d=Math.hypot(s.x-player.x,s.z-player.z);
    if(d<260&&s.placed===undefined&&!(s.placeT>now)){const r=bemol_place(s,d);if(r===null)s.placeT=now+1500;else s.placed=r;}
    if(s.placed&&d<260&&!s.grp)s.grp=bemol_buildTerrace(s);else if(s.grp&&d>380){scene.remove(s.grp);s.grp=null;}}}

// ---- seated NPCs: a small pool of people, placed only at the nearest station ----
function bemol_person(i){if(!bemol_pool[i]){const g=makePersonGroup(0xffffff,0x222222,mpick([0xe0b896,0xd8a982,0xc99a74]));g.userData.own=true;g.visible=false;bemol_pool[i]={g,ph:Math.random()*9};}return bemol_pool[i];}
function bemol_activate(s){bemol_act=s;const C=bemol_cfg(s);let n=0;s.npc=[];
  const sit=(tx,tz,seat,kind,tbl,k)=>{const P=bemol_person(n++);const [wx,wz]=bemol_W(s,tx+seat[0],tz+seat[1]);const h=bemol_yaw(s,Math.atan2(-seat[0],-seat[1]));
    P.g.visible=true;P.g.position.set(wx,groundY(wx,wz)+.1,wz);P.g.rotation.y=h;P.kind=kind;P.tbl=tbl;P.seat=k;P.name=C.names[(tbl*4+k)%8];s.npc.push(P);};
  BEMOL_COFFEE.forEach(([tx,tz],ti)=>{for(let k=0;k<C.coffee[ti];k++)sit(tx,tz,BEMOL_CSEAT[k],'coffee',ti,k);});
  BEMOL_BELOT.forEach(([tx,tz],ti)=>{for(let k=0;k<C.belot[ti];k++)sit(tx,tz,BEMOL_BSEAT[k],'belot',ti,k);});
  for(let i=n;i<bemol_pool.length;i++)bemol_pool[i].g.visible=false;}
function bemol_deactivate(){for(const P of bemol_pool)P.g.visible=false;bemol_act=null;}
const BEMOL_KEY='<b style="background:#ffd400;color:#1a1305;padding:1px 7px;border-radius:5px;margin-right:6px">E</b>';
function bemol_hint(h){if(!bemol_hintEl){bemol_hintEl=document.createElement('div');bemol_hintEl.style.cssText='position:fixed;left:50%;bottom:18%;transform:translateX(-50%);font:700 15px Inter,Arial,sans-serif;color:#fff;background:rgba(0,0,0,.55);padding:8px 14px;border-radius:10px;display:none;z-index:12;text-align:center';document.body.appendChild(bemol_hintEl);}
  if(bemol_hintEl._h!==h){bemol_hintEl._h=h;bemol_hintEl.innerHTML=h;bemol_hintEl.style.display=h?'block':'none';}}
function bemol_talk(name,text,col){subtitle(name,text,col||'#7dffa8');if(name!=='Tu'&&typeof lst_speak==='function')lst_speak(text.replace('-10','minus zece'),.85+Math.random()*.3,1.1);}

function bemol_terraceUpdate(dt,player,s,dManh){bemol_terraces(player);
  if(!bemol_seat){if(dManh<110&&s.grp){if(bemol_act!==s)bemol_activate(s);}else if(bemol_act)bemol_deactivate();}
  const S=bemol_act;bemol_prompt=null;if(!S){bemol_hint('');return;}
  const time=performance.now()/1000,C=bemol_cfg(S);
  for(const P of S.npc){const sip=P.kind==='coffee'?Math.pow(Math.max(0,Math.sin(time*.45+P.ph)),12):0;
    const look=P.kind==='belot'?Math.sin(time*.7+P.ph)*.35:Math.sin(time*.3+P.ph)*.5;
    ppl_poseGroup(P.g,{t:0,k:0,run:0,fall:0,time,look,phoneL:false,wave:false,sit:1,cards:P.kind==='belot',sip});}
  if(bemol_seat){bemol_play(dt,player,S);return;}
  // invite + prompt near a belot table with a free seat
  if(player.mode==='foot'){for(let ti=0;ti<2;ti++){const n=C.belot[ti];if(n>=4)continue;const [tx,tz]=BEMOL_BELOT[ti],[wx,wz]=bemol_W(S,tx,tz),d=Math.hypot(player.x-wx,player.z-wz);
    if(d<6){const key=S.i+'_'+ti;if(!(bemol_inviteT[key]>time)){bemol_inviteT[key]=time+25;const P=S.npc.find(p=>p.kind==='belot'&&p.tbl===ti);if(P)bemol_talk(P.name,mpick(BEMOL_INVITE));}}
    if(d<2.6)bemol_prompt={ti,n};}}
  bemol_hint(bemol_prompt?BEMOL_KEY+'Joacă belot cu ei':'');}

// ---- belot: sit at the free seat, simulate the game ----
function bemol_sit(){const S=bemol_act,pr=bemol_prompt;if(!S||!pr)return;const api=window.gtcApi,P=api.player;const [tx,tz]=BEMOL_BELOT[pr.ti],seat=BEMOL_BSEAT[pr.n];
  const [wx,wz]=bemol_W(S,tx+seat[0],tz+seat[1]),h=bemol_yaw(S,Math.atan2(-seat[0],-seat[1]));
  bemol_seat={S,ti:pr.ti,k:pr.n,x:wx,z:wz,h};P.x=wx;P.z=wz;P.h=h;api.camYaw=h;bemol_prompt=null;
  const players=S.npc.filter(p=>p.kind==='belot'&&p.tbl===pr.ti);
  bemol_game={players,score:[0,0],roundT:mr(10,16),lineT:1.6,trick:0};
  bemol_talk(players[0].name,mpick(['Bravo! Eu dau.','Hai, naciala!','Tăiem?']));}
function bemol_cardsHide(){if(bemol_cards)for(const c of bemol_cards)c.visible=false;}
function bemol_stand(talk){const st=bemol_seat;if(!st)return;const api=window.gtcApi,P=api.player;const [tx,tz]=BEMOL_BELOT[st.ti],[cx,cz]=bemol_W(st.S,tx,tz);
  const dx=st.x-cx,dz=st.z-cz,l=Math.hypot(dx,dz)||1;P.x=st.x+dx/l*.8;P.z=st.z+dz/l*.8;P.h=Math.atan2(dx,dz);api.camYaw=P.h;
  if(talk&&bemol_game&&bemol_game.players[0])bemol_talk(bemol_game.players[0].name,mpick(['Unde fugi?! Abia am început!','Na, s-a speriat.','Lasă, data viitoare.']));
  bemol_seat=null;bemol_game=null;bemol_cardsHide();bemol_hint('');}
function bemol_play(dt,player,S){const G=bemol_game,api=window.gtcApi,st=bemol_seat;
  if(player.mode!=='foot'||Math.hypot(player.x-st.x,player.z-st.z)>1.5){bemol_seat=null;bemol_game=null;bemol_cardsHide();bemol_hint('');return;}  // moved away (busted, teleport…)
  const time=performance.now()/1000;player.x=st.x;player.z=st.z;player.h=st.h;player.y=groundY(st.x,st.z)+.1;
  player.m.visible=true;player.m.position.set(st.x,player.y,st.z);player.m.rotation.y=st.h;ppl_poseGroup(player.m,{t:0,k:0,run:0,fall:0,time,look:Math.sin(time*.5)*.3,phoneL:false,wave:false,sit:1,cards:true,sip:0});
  if(!bemol_cards){const g=new THREE.BoxGeometry(.07,.004,.1);bemol_cards=[0,1,2,3].map(()=>{const m=new THREE.Mesh(g,new THREE.MeshLambertMaterial({color:0xfafafa}));m.visible=false;scene.add(m);return m;});}
  // table talk + a card played to the middle each time
  G.lineT-=dt;if(G.lineT<=0){G.lineT=mr(1.8,3.4);const who=Math.floor(Math.random()*(G.players.length+1)),line=mpick(BEMOL_PHRASES);
    if(who===G.players.length)bemol_talk('Tu',line,'#ffd23f');else bemol_talk(G.players[who].name,line);
    const [tx,tz]=BEMOL_BELOT[st.ti],k=G.trick%4,ang=k*Math.PI/2+.3*Math.random(),[wx,wz]=bemol_W(S,tx+Math.sin(ang)*.12,tz+Math.cos(ang)*.12);
    if(k===0)bemol_cardsHide();const c=bemol_cards[k];c.position.set(wx,groundY(wx,wz)+.985+k*.003,wz);c.rotation.y=Math.random()*3;c.visible=true;G.trick++;}
  // a round every 10-16 s: 162 points split between the teams; first to BEMOL_WIN wins money
  G.roundT-=dt;if(G.roundT<=0){G.roundT=mr(10,16);const a=Math.round(mr(2,14))*10+(Math.random()<.25?20:0);G.score[0]+=a;G.score[1]+=Math.max(0,162-a);
    if(G.score[0]>=BEMOL_WIN||G.score[1]>=BEMOL_WIN){const win=G.score[0]>=G.score[1],sc=G.score[0]+' — '+G.score[1];
      if(win){api.money+=40;api.say('Ați câștigat la belot!','+40 lei · '+sc,2.8,'#7dff8a');}else{const f=Math.min(api.money,20);api.money-=f;api.say('Ați pierdut la belot','-'+f+' lei · '+sc,2.8,'#ff8a65');}
      if(typeof missionEvent==='function')missionEvent('belot_end',{win});G.score=[0,0];bemol_talk(G.players[0].name,win?'Oo, bizon! Încă o partidă?':'Hai, revanșa!');}}
  bemol_hint('Belot · Noi <b>'+G.score[0]+'</b> — Ei <b>'+G.score[1]+'</b> (până la '+BEMOL_WIN+') · '+BEMOL_KEY+'ridică-te');}
// game.js hooks
function bemolSeat(){return !!bemol_seat;}
function bemolBusy(){return !!(bemol_seat||bemol_prompt);}
addEventListener('keydown',e=>{if(e.code!=='KeyE'||e.repeat||!window.gtcApi)return;if(bemol_seat)bemol_stand(true);else if(bemol_prompt&&gtcApi.player.mode==='foot')bemol_sit();});
