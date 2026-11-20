'use strict';
// New-game intro: you arrive in Chișinău on a rutieră from Căușeni at the Autogara Centrală, next to Piața Centrală.
// game.js calls introPlan() before the world streams in (where you start, where the yellow taxi waits),
// introStart() on JOACĂ, introBusy() (true while the cutscene runs: no player input, no E) and introUpdate(dt) each frame.
// Space / Enter / Esc skips. Spoken lines go through intro_say(who,'…') so tools/gen_piper.py can pre-render them.
const INTRO_STREET=/Varlaam/,INTRO_NEAR=/Piața Centrală/,INTRO_LEN=23;
let intro_plan_=null,intro_on=false,intro_t=0,intro_bus=null,intro_ui=null,intro_done={},intro_grp=null,intro_npcs=[],intro_sign=null,intro_ac=null;

// ---------- where: a street next to Piața Centrală; the bus drives along it and stops with the platform on its right ----------
function intro_at(p,s){const P=p.P,c=p.cum;s=Math.max(0,Math.min(c[c.length-1],s));let i=1;while(i<P.length-1&&c[i]<s)i++;const a=P[i-1],b=P[i],l=c[i]-c[i-1]||1,f=(s-c[i-1])/l;
  const tx=(b[0]-a[0])/l*p.d,tz=(b[1]-a[1])/l*p.d;return {x:a[0]+(b[0]-a[0])*f,z:a[1]+(b[1]-a[1])*f,tx,tz,rx:-tz,rz:tx};}   // centre, travel dir, right
const intro_off=(q,o,fwd)=>[q.x+q.rx*o+q.tx*(fwd||0),q.z+q.rz*o+q.tz*(fwd||0)];
function introPlan(){try{
  const poi=(D.pois||[]).find(p=>INTRO_NEAR.test(p[0])),cx=poi?poi[1]:834,cz=poi?poi[2]:646;
  const ns=nearestSeg(cx,cz,350,s=>INTRO_STREET.test(s.r.name||''))||nearestSeg(cx,cz,250,s=>s.r.w>=7&&s.r.w<=16);if(!ns)return null;
  const r=ns.s.r,P=r.pts;let k=0,bd=1e18;for(let i=0;i<P.length;i++){const d=(P[i][0]-ns.s.a[0])**2+(P[i][1]-ns.s.a[1])**2;if(d<bd){bd=d;k=i;}}
  const cum=[0];for(let i=1;i<P.length;i++)cum.push(cum[i-1]+Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]));const L=cum[cum.length-1];
  const s0=cum[k]+Math.hypot(ns.qx-P[k][0],ns.qz-P[k][1]);
  const p={P,cum,w:r.w,name:r.name,d:1};const q=intro_at(p,s0);if((cx-q.x)*q.rx+(cz-q.z)*q.rz<0)p.d=-1;   // platform on the POI side
  p.stop=s0;p.start=p.d>0?Math.max(0,s0-150):Math.min(L,s0+150);p.end=p.d>0?Math.min(L,s0+110):Math.max(0,s0-110);
  if(Math.abs(p.stop-p.start)<50)return null;
  const Q=intro_at(p,s0),so=r.w/2+2.4;let [ex,ez]=intro_off(Q,so,0);if(typeof pushOut==='function'&&pushOut(ex,ez,.5))[ex,ez]=intro_off(Q,r.w/2+1.3,0);
  const [tx,tz]=intro_off(intro_at(p,s0+p.d*20),r.w/2-1.15,0);
  p.ex=ex;p.ez=ez;p.h=Math.atan2(Q.tx,Q.tz);p.taxi={x:tx,z:tz,h:Math.atan2(Q.tx,Q.tz)};intro_plan_=p;
  return {x:ex,z:ez,h:p.h,taxi:p.taxi};}catch(e){console.error('[intro] plan',e);return null;}}

// ---------- the Autogara: platform canopy, big sign, benches, people waiting, a second taxi ----------
function intro_tex(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);t.anisotropy=4;return t;}
function intro_build(){const p=intro_plan_,Q=intro_at(p,p.stop-p.d*2),a=Math.atan2(Q.tx,Q.tz),g=new THREE.Group();
  const [cx,cz]=intro_off(Q,p.w/2+5,0),y=groundY(cx,cz);g.position.set(cx,y,cz);g.rotation.y=a;   // local +z = travel dir, local -x = road side
  const roof=new THREE.MeshLambertMaterial({color:0x2f5d8a}),post=new THREE.MeshLambertMaterial({color:0x9aa3ab}),bench=new THREE.MeshLambertMaterial({color:0x6b4a2b}),floor=new THREE.MeshLambertMaterial({color:0x9d9a92});
  const B=(w,h,d,x,yy,z,m)=>{const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,yy,z);o.castShadow=o.receiveShadow=true;g.add(o);return o;};
  B(5,.25,18,0,.12,0,floor);B(5.4,.18,18.4,0,3.3,0,roof);for(const z of [-8,-2.7,2.7,8])for(const x of [-2.1,2.1])B(.14,3.2,.14,x,1.7,z,post);
  for(const z of [-5,0,5]){B(.45,.08,2.2,1.3,.55,z,bench);B(.08,.45,2.2,1.55,.8,z,bench);}
  const sign=new THREE.MeshLambertMaterial({map:intro_tex(1024,160,(c,w,h)=>{c.fillStyle='#163a63';c.fillRect(0,0,w,h);c.fillStyle='#ffd23f';c.fillRect(0,h*.84,w,h*.16);
    c.fillStyle='#fff';c.textAlign='center';c.textBaseline='middle';c.font='900 86px Anton, Impact, Arial Black, sans-serif';c.fillText('AUTOGARA CENTRALĂ',w/2,h*.44);}),emissive:0x111a26});
  const sg=new THREE.Mesh(new THREE.BoxGeometry(.15,1.5,9.5),[sign,sign,post,post,post,post]);sg.position.set(-2.3,4.3,0);g.add(sg);
  const peron=new THREE.MeshLambertMaterial({map:intro_tex(256,128,(c,w,h)=>{c.fillStyle='#fff';c.fillRect(0,0,w,h);c.fillStyle='#163a63';c.textAlign='center';c.textBaseline='middle';
    c.font='900 46px Inter, Arial, sans-serif';c.fillText('PERON 3',w/2,h*.36);c.font='700 26px Inter, Arial';c.fillText('Căușeni · Ștefan Vodă',w/2,h*.74);})});
  const pr=new THREE.Mesh(new THREE.BoxGeometry(.08,.7,1.4),[peron,peron,post,post,post,post]);pr.position.set(-2.4,2.6,-6);g.add(pr);
  scene.add(g);intro_grp=g;
  // people waiting under the canopy + a taxi driver by his car + a seed seller
  const W=(lx,lz,shirt,face)=>{const wx=cx+lx*Math.cos(a)+lz*Math.sin(a),wz=cz-lx*Math.sin(a)+lz*Math.cos(a);if(typeof makePersonGroup!=='function')return null;
    const m=makePersonGroup(shirt,0x2b2f3a,0xd9a77f);m.userData.own=true;m.position.set(wx,groundY(wx,wz),wz);m.rotation.y=a+face;scene.add(m);intro_npcs.push(m);return m;};
  W(1,-4,0x7a3b3b,-Math.PI/2);W(1.2,1,0x3b5a7a,-Math.PI/2.4);W(.6,4.5,0x5a7a3b,-Math.PI/2);
  const [dx,dz]=intro_off(intro_at(p,p.stop+p.d*20),p.w/2+1.2,0);if(typeof makePersonGroup==='function'){const m=makePersonGroup(0x1e1e1e,0x2b2f3a,0xc99a72);m.userData.own=true;m.position.set(dx,groundY(dx,dz),dz);m.rotation.y=Math.atan2(-Q.tx,-Q.tz);scene.add(m);intro_npcs.push(m);}
  const [sx,sz]=intro_off(intro_at(p,p.stop-p.d*12),p.w/2+3,0);if(typeof makePersonGroup==='function'){const m=makePersonGroup(0x8a5a8a,0x3a2a2a,0xd9a77f);m.userData.own=true;m.position.set(sx,groundY(sx,sz),sz);m.rotation.y=a-Math.PI/2;scene.add(m);intro_npcs.push(m);}
  const [t2x,t2z]=intro_off(intro_at(p,p.stop+p.d*27),p.w/2-1.15,0);const t2=makeVehicle('taxi',t2x,t2z,a,0xf4f4f2);if(t2)t2.parkedAuto=true;}

// ---------- the rutieră + its destination board ----------
function intro_busAt(s){const p=intro_plan_,q=intro_at(p,s),[x,z]=intro_off(q,p.w/2-1.7,0);const v=intro_bus;v.x=x;v.z=z;v.h=Math.atan2(q.tx,q.tz);
  if(intro_sign){const L=v.spec.len/2+.02,y=(v.y!=null?v.y:groundY(x,z));intro_sign.position.set(x+q.tx*L,y+2.05,z+q.tz*L);intro_sign.rotation.y=v.h;}}
function intro_makeBus(){const p=intro_plan_,q=intro_at(p,p.start);intro_bus=makeVehicle('rutiera',q.x,q.z,Math.atan2(q.tx,q.tz),0xf4f4f2);
  const m=new THREE.MeshBasicMaterial({map:intro_tex(512,96,(c,w,h)=>{c.fillStyle='#0b0b0b';c.fillRect(0,0,w,h);c.fillStyle='#ffb000';c.textAlign='center';c.textBaseline='middle';
    c.font='800 50px Inter, Arial, sans-serif';c.fillText('CĂUȘENI – CHIȘINĂU',w/2,h/2+2);})});
  intro_sign=new THREE.Mesh(new THREE.PlaneGeometry(1.5,.28),m);scene.add(intro_sign);intro_busAt(p.start);}

// ---------- UI: black fade, letterbox, titles, skip hint ----------
function intro_uiInit(){if(intro_ui)return;const css=document.createElement('style');css.textContent=
  'body.intro .hud,body.intro .ph_box,body.intro #cc_hint{visibility:hidden!important}'+
  '.intro_bar{position:fixed;left:0;right:0;height:11vh;background:#000;z-index:40;transition:transform .8s ease}#intro_top{top:0;transform:translateY(-100%)}#intro_bot{bottom:0;transform:translateY(100%)}'+
  'body.intro #intro_top,body.intro #intro_bot{transform:none}'+
  '#intro_fade{position:fixed;inset:0;background:#000;z-index:41;pointer-events:none;opacity:0;transition:opacity .9s}'+
  '#intro_title{position:fixed;left:6vw;bottom:15vh;z-index:42;color:#fff;font:400 54px/1 Anton,Impact,sans-serif;letter-spacing:1px;text-shadow:0 3px 14px rgba(0,0,0,.7);opacity:0;transition:opacity 1s}'+
  '#intro_title small{display:block;font:700 18px Inter,Arial,sans-serif;letter-spacing:2px;margin-top:8px;color:#ffd23f}'+
  '#intro_skip{position:fixed;right:3vw;bottom:3.5vh;z-index:42;color:#bbb;font:700 12px Inter,Arial,sans-serif;letter-spacing:1px}';document.head.appendChild(css);
  const d=(id,cls,html)=>{const e=document.createElement('div');e.id=id;if(cls)e.className=cls;if(html)e.innerHTML=html;document.body.appendChild(e);return e;};
  d('intro_top','intro_bar');d('intro_bot','intro_bar');intro_ui={fade:d('intro_fade'),title:d('intro_title'),skip:d('intro_skip','','SPACE — sari peste')};}
function intro_title(html){intro_ui.title.innerHTML=html;intro_ui.title.style.opacity=html?1:0;}
function intro_say(who,text){subtitle(who,text,'#ffd23f');if(typeof lst_speak==='function')lst_speak(text,1,1.05);}
function intro_pssh(){try{if(typeof fx_muted!=='undefined'&&fx_muted)return;if(!intro_ac)intro_ac=new (window.AudioContext||window.webkitAudioContext)();const a=intro_ac,len=a.sampleRate*.7|0,b=a.createBuffer(1,len,a.sampleRate),d=b.getChannelData(0);
  for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,1.6)*.5;const s=a.createBufferSource(),f=a.createBiquadFilter(),g=a.createGain();f.type='highpass';f.frequency.value=1800;g.gain.value=.5;s.buffer=b;s.connect(f).connect(g).connect(a.destination);s.start();}catch(e){}}

// ---------- timeline ----------
const intro_ease=u=>u<0?0:u>1?1:u*u*(3-2*u);
function introStart(){if(!intro_plan_){gtcApi.say('Bun venit în Chișinău!','Taxiul galben e liber — urcă',3.6,'#ffd23f');return;}
  intro_uiInit();intro_build();intro_makeBus();intro_on=true;intro_t=0;intro_done={};document.body.classList.add('intro');intro_ui.fade.style.transition='none';intro_ui.fade.style.opacity=1;
  requestAnimationFrame(()=>{intro_ui.fade.style.transition='opacity 1.4s';intro_ui.fade.style.opacity=0;});const P=gtcApi.player;P.m.visible=false;}
function introBusy(){return intro_on;}
function intro_cam(px,py,pz,tx,ty,tz){if(window.__dbg)__dbg.camOverride=[px,py,pz,tx,ty,tz];}
function intro_once(k,f){if(!intro_done[k]){intro_done[k]=true;f();}}
function intro_step(dt){if(!intro_on){for(const m of intro_npcs)if(m.parent)animatePlayer(m,0,0,dt);return;}
  const p=intro_plan_,t=(intro_t+=dt),P=gtcApi.player,Q=intro_at(p,p.stop),gy=groundY(Q.x,Q.z);for(const m of intro_npcs)animatePlayer(m,0,0,dt);
  // 1) aerial over the city (0-5 s)
  if(t<5){const u=intro_ease(t/5),ang=1.9+u*.7,R=320-u*170,H=170-u*95;intro_cam(Q.x+Math.cos(ang)*R,gy+H,Q.z+Math.sin(ang)*R,Q.x,gy+5,Q.z);
    intro_once('t1',()=>intro_title('Chișinău<small>AUTOGARA CENTRALĂ · DIMINEAȚA</small>'));if(t>4.2)intro_once('t1x',()=>intro_title(''));}
  // 2) the rutieră from Căușeni pulls in (5-12.5 s)
  const drive=Math.max(0,Math.min(1,(t-5)/7.5)),sNow=t<12.5?p.start+(p.stop-p.start)*(1-Math.pow(1-drive,2)):p.stop;
  if(t<19.5){intro_busAt(sNow);intro_bus.speed=t>5&&t<12.5?Math.abs(p.stop-p.start)/7.5*2*(1-drive):0;}
  if(t>=5&&t<12.5){const [cx,cz]=intro_off(intro_at(p,p.stop+p.d*24),p.w/2+6,0);intro_cam(cx,gy+3.2,cz,intro_bus.x,gy+1.6,intro_bus.z);}
  intro_once('bus',()=>{});if(t>=12.4)intro_once('door',()=>{intro_pssh();});if(t>=12.8)intro_once('ann',()=>intro_say('Anunț','Rutiera Căușeni – Chișinău a sosit la peronul trei.'));
  // 3) you step out of the door and walk onto the platform (12.5-16 s)
  const bq=intro_at(p,p.stop),door=intro_off(bq,p.w/2-1.7+1.25,intro_bus.spec.len/2-1.6);
  if(t>=12.5&&t<16){const u=intro_ease((t-13.6)/2.2);if(t>=13.6){P.m.visible=true;const x=door[0]+(p.ex-door[0])*u,z=door[1]+(p.ez-door[1])*u;P.x=x;P.z=z;P.h=u<.95?Math.atan2(p.ex-door[0],p.ez-door[1]):p.h;
      P.m.position.set(x,groundY(x,z),z);P.m.rotation.y=P.h;animatePlayer(P.m,t*6,u<1?2.2:0,dt);}
    const [cx,cz]=intro_off(bq,p.w/2+3.2,-7);intro_cam(cx,gy+1.7,cz,door[0],gy+1.3,door[1]);}
  // 4) the taxi rank calls out (16-19.5 s)
  if(t>=16&&t<19.5){P.x=p.ex;P.z=p.ez;P.h=p.h;P.m.position.set(p.ex,groundY(p.ex,p.ez),p.ez);P.m.rotation.y=p.h;animatePlayer(P.m,0,0,dt);
    const [cx,cz]=intro_off(bq,p.w/2+3.6,-4.5);intro_cam(cx,gy+2.3,cz,p.taxi.x,gy+1,p.taxi.z);
    intro_once('taxi',()=>intro_say('Taximetrist','Taxi? Taxi, frate? Ieftin, ca pentru tine!'));if(t>=17.9)intro_once('seminte',()=>intro_say('Vânzătoare','Semințe, semințe! Prăjite, calde!'));}
  // 5) the bus leaves, the camera settles behind you, title (19.5-23 s)
  if(t>=19.5){const u=Math.min(1,(t-19.5)/3);intro_busAt(p.stop+(p.end-p.stop)*u*u);intro_bus.speed=8*u;
    P.m.position.set(p.ex,groundY(p.ex,p.ez),p.ez);P.m.rotation.y=p.h;animatePlayer(P.m,0,0,dt);
    const fx=Math.sin(p.h),fz=Math.cos(p.h),e=intro_ease(u),[ax,az]=intro_off(bq,p.w/2+3.6,-4.5),bx=p.ex-fx*6,bz=p.ez-fz*6;
    intro_cam(ax+(bx-ax)*e,gy+2.3+(1.8-.4)*e,az+(bz-az)*e,p.ex+fx*4,gy+1.4,p.ez+fz*4);intro_once('t2',()=>intro_title('GRAND THEFT CHIȘINĂU<small>BINE AI VENIT ACASĂ</small>'));}
  if(t>=INTRO_LEN)intro_finish(false);}
function intro_finish(skipped){if(!intro_on)return;intro_on=false;const p=intro_plan_,P=gtcApi.player;
  if(intro_bus){removeVehicle(intro_bus);intro_bus=null;}if(intro_sign){scene.remove(intro_sign);intro_sign=null;}
  P.x=p.ex;P.z=p.ez;P.h=p.h;P.mode='foot';P.m.visible=true;P.m.position.set(p.ex,groundY(p.ex,p.ez),p.ez);P.m.rotation.y=p.h;
  if(window.__dbg)__dbg.camOverride=null;gtcApi.camYaw=p.h;gtcApi.camPos.set(p.ex-Math.sin(p.h)*6,groundY(p.ex,p.ez)+2.5,p.ez-Math.cos(p.h)*6);
  intro_title('');document.body.classList.remove('intro');
  gtcApi.say('Bun venit în Chișinău!','Taxiul galben de lângă autogară e liber — urcă (E)',4,'#ffd23f');
  if(typeof ph_cd!=='undefined'){window.ph_force='mama';ph_cd=Math.min(ph_cd,12);}}
// safety net: an error mid-cutscene ends it instead of leaving the player frozen
function introUpdate(dt){try{intro_step(dt);}catch(e){console.error('[intro]',e);try{intro_finish(true);}catch(e2){intro_on=false;document.body.classList.remove('intro');if(window.__dbg)__dbg.camOverride=null;}}}
addEventListener('keydown',e=>{if(!intro_on)return;if(e.code==='Space'||e.code==='Enter'||e.code==='Escape'){e.preventDefault();e.stopImmediatePropagation();intro_finish(true);}},true);
