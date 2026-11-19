'use strict';
// Music + car radio with a radio wheel.
// - Theme song (MAC — Centru) loops on the loading/title screen, starting somewhere in the middle. On foot: no music.
// - In a vehicle the car radio plays the selected station: local tracks (assets/music) or live internet streams.
// - Hold Q in a vehicle: radio wheel. Move the mouse (or scroll) to pick a station, release Q to tune in.
//   Tap Q: next station, Shift+Q: previous. R turns all music on/off (also in the pause menu).
// - Station badges are drawn in CSS. To use a real logo, drop an image in assets/radio/ and set `logo` on the station.
const RADIO_STATIONS=[
  {id:'off',name:'Radio oprit',off:true,c1:'#2a2a2a',c2:'#555',t:'OFF'},
  {id:'mac',name:'MAC — Centru',sub:'Melodie',local:'assets/music/mac-centru.mp3',c1:'#111',c2:'#ff7a1a',t:'MAC',t2:'CENTRU'},
  {id:'spice',name:'Spiceboys Online',sub:'Золотая коллекция',local:'assets/music/spiceboys-zolotaya-kolektsiya.mp3',c1:'#ff3fa4',c2:'#ffd23f',t:'SPICE',t2:'BOYS'},
  {id:'vb',name:'Vocea Basarabiei',sub:'Chișinău',src:'https://stream.noroc.tv/radiovb_aac',c1:'#0b3d91',c2:'#ffd200',t:'VB',t2:'VOCEA'},
  {id:'noroc',name:'Radio Noroc',sub:'Muzică moldovenească',src:'https://stream.noroc.tv/radionoroc_aac',c1:'#c8102e',c2:'#fff',t:'NOROC'},
  {id:'hit',name:'Hit FM',sub:'101.7 Chișinău',src:'https://stream.dixi.md:9443/HitFM',alt:'https://radio3.dixi.md/listen/hit_fm_hot_hits/hitfm_hothits128.aac',c1:'#e30613',c2:'#fff',t:'HIT',t2:'FM'},
  {id:'kissmd',name:'Kiss FM',sub:'Moldova',src:'https://live.kissfm.md/kissfm.chisinau',alt:'https://dc.digi.live.kissfm.ro/kissfm.chisinau',c1:'#e5007e',c2:'#fff',t:'KISS',t2:'MD'},
  {id:'kissro',name:'Kiss FM',sub:'România',src:'https://live.kissfm.ro/kissfm.aacp',c1:'#7a0046',c2:'#ff9ad5',t:'KISS',t2:'RO'},
  {id:'jurnal',name:'Jurnal FM',sub:'Chișinău',src:'https://audio.jurnalfm.md/hq',c1:'#f39200',c2:'#1d1d1b',t:'JURNAL',t2:'FM'},
  {id:'retro',name:'Retro FM',sub:'Moldova',src:'https://efir.retrofm.md:8000/retro',c1:'#2b1a5a',c2:'#ff5fd2',t:'RETRO',t2:'FM'},
  {id:'muz',name:'Muz FM',sub:'Moldova',src:'https://live.muzfm.md/muzfm',c1:'#00a19a',c2:'#fff',t:'MUZ',t2:'FM'},
  {id:'zum',name:'Radio ZUM',sub:'Moldova',src:'https://streams.radiozum.md/listen/zum1/ZUM1',c1:'#ffde00',c2:'#111',t:'ZUM'},
  {id:'mega',name:'Megapolis FM',sub:'88.6 Chișinău',src:'https://megapolisfm.md:8443/886',c1:'#1b1464',c2:'#29abe2',t:'MEGA',t2:'POLIS'},
  {id:'plai',name:'Radio Plai',sub:'Folclor & populară',src:'https://stream.radioplai.md/live',c1:'#2e7d32',c2:'#ffeb3b',t:'PLAI'},
  {id:'city',name:'City FM',sub:'Chișinău',src:'https://live.cityfm.md:8001/cityfm',c1:'#00b4e6',c2:'#fff',t:'CITY',t2:'FM'},
  {id:'roks',name:'Radio ROKS',sub:'Rock · Moldova',src:'https://stream.dixi.md:9443/Roks',c1:'#111',c2:'#e10600',t:'ROKS'},
  {id:'record',name:'Radio Record',sub:'Dance',src:'https://radiorecord.hostingradio.ru/rr_main96.aacp',alt:'https://air.unmixed.ru/record320',c1:'#f7941d',c2:'#111',t:'RECORD'},
];
const RADIO_THEME=1,RADIO_N=RADIO_STATIONS.length;
let radio_vol=.75;try{const v=parseFloat(localStorage.getItem('gtc_radio_vol'));if(v>=0&&v<=1)radio_vol=v;}catch(e){}
let radio_ingame=false,radio_on=true,radio_st=5,radio_inCar=false,radio_unlocked=false,radio_cur=null;
try{radio_on=localStorage.getItem('gtc_radio')!=='0';const s=RADIO_STATIONS.findIndex(x=>x.id===localStorage.getItem('gtc_station'));if(s>=0)radio_st=s;}catch(e){}

// ---------- audio ----------
// one <audio> per local track (keeps its position while you switch around), one shared element for live streams
const radio_local=new Map();
function radio_localEl(i){let a=radio_local.get(i);if(a)return a;const s=RADIO_STATIONS[i];a=new Audio(s.local);a.preload=i===RADIO_THEME?'auto':'metadata';a.loop=true;a.volume=radio_gain();
  // start somewhere in the middle, not from the beginning
  a.addEventListener('loadedmetadata',()=>{if(isFinite(a.duration))a.currentTime=a.duration*(.35+Math.random()*.25);},{once:true});radio_local.set(i,a);return a;}
radio_localEl(RADIO_THEME);
const radio_live=new Audio();radio_live.preload='none';radio_live.volume=radio_gain();
radio_live.addEventListener('error',()=>{const s=RADIO_STATIONS[radio_cur];if(!s||!s.src||!radio_live.getAttribute('src'))return;
  if(s.alt&&radio_live.src!==s.alt){radio_live.src=s.alt;radio_live.play().catch(()=>{});}else radio_toast('📻 '+s.name+' — fără semnal');});

function radio_toast(t){if(typeof fx_toast==='function')fx_toast(t);}
function radio_label(s){return s.name+(s.sub?' · '+s.sub:'');}
function radio_elFor(i){const s=RADIO_STATIONS[i];return !s||s.off?null:s.local?radio_localEl(i):radio_live;}
// index of what should be playing right now (null = silence)
function radio_want(){if(!radio_on)return null;if(!radio_ingame)return RADIO_THEME;if(!radio_inCar)return null;return RADIO_STATIONS[radio_st].off?null:radio_st;}
function radio_apply(force){const w=radio_want();const el=w===null?null:radio_elFor(w);
  if(!force&&w===radio_cur&&(!el||!el.paused))return;
  for(const [i,a] of radio_local)if(i!==w)a.pause();
  if(w===null||RADIO_STATIONS[w].local){if(radio_live.getAttribute('src')){radio_live.pause();radio_live.removeAttribute('src');radio_live.load();}}
  radio_cur=w;if(!el)return;
  if(el===radio_live){const s=RADIO_STATIONS[w];if(radio_live.getAttribute('src')!==s.src&&radio_live.src!==s.alt)radio_live.src=s.src;}
  el.play().then(()=>{radio_unlocked=true;}).catch(()=>{});}
function radio_set(on){radio_on=on;try{localStorage.setItem('gtc_radio',on?'1':'0');}catch(e){}radio_sync();radio_apply();radio_toast(on?'📻 Muzică pornită (R)':'📻 Muzică oprită (R)');}
function radio_tune(i,quiet){radio_st=(i+RADIO_N)%RADIO_N;try{localStorage.setItem('gtc_station',RADIO_STATIONS[radio_st].id);}catch(e){}
  if(!radio_on&&!RADIO_STATIONS[radio_st].off){radio_on=true;try{localStorage.setItem('gtc_radio','1');}catch(e){}radio_sync();}
  radio_apply();radio_now();}
function radio_sync(){const a=$('pmRadOn'),b=$('pmRadOff');if(a)a.classList.toggle('on',radio_on);if(b)b.classList.toggle('on',!radio_on);}

// ---------- "now playing" card (top centre, shows the badge for a few seconds) ----------
const radio_css=document.createElement('style');radio_css.textContent=`
.rdBadge{position:relative;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;
  font-family:Anton,Impact,system-ui,sans-serif;line-height:.92;text-align:center;letter-spacing:.5px;box-shadow:inset 0 0 0 3px rgba(255,255,255,.18),0 4px 14px rgba(0,0,0,.5)}
.rdBadge img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.rdBadge .t2{font-size:.55em;opacity:.95;margin-top:.08em}
#rdWheel{position:fixed;inset:0;z-index:30;display:none;align-items:center;justify-content:center;pointer-events:none;background:radial-gradient(circle,rgba(0,0,0,.35),rgba(0,0,0,.6))}
#rdWheel.open{display:flex}
#rdRing{position:relative;width:var(--D);height:var(--D)}
#rdRing .slot{position:absolute;left:50%;top:50%;transition:transform .12s,filter .12s;filter:saturate(.55) brightness(.7);pointer-events:auto;cursor:pointer}
#rdRing .slot.cur::after{content:'';position:absolute;inset:-5px;border-radius:50%;border:2px dashed rgba(255,255,255,.55)}
#rdRing .slot.sel{filter:none;z-index:2}
#rdRing .slot.sel .rdBadge{box-shadow:0 0 0 4px #fff,0 0 26px rgba(255,255,255,.55)}
#rdCenter{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:calc(var(--D)*.44);text-align:center;color:#fff;font-family:Inter,system-ui,sans-serif}
#rdCenter b{display:block;font:400 clamp(18px,3.4vmin,30px) Anton,Impact,sans-serif;letter-spacing:1px;text-shadow:0 2px 8px #000}
#rdCenter small{display:block;font-size:clamp(11px,1.6vmin,14px);opacity:.8;margin-top:4px}
#rdCenter i{display:block;font-style:normal;font-size:11px;opacity:.55;margin-top:10px;letter-spacing:.5px}
#rdNow{position:fixed;left:50%;top:calc(14px + env(safe-area-inset-top));max-width:calc(100vw - 340px);z-index:21;display:flex;align-items:center;gap:10px;padding:6px 14px 6px 6px;border-radius:40px;
  background:rgba(0,0,0,.55);color:#fff;font-family:Inter,system-ui,sans-serif;pointer-events:none;opacity:0;transform:translate(-50%,-12px);transition:opacity .3s,transform .3s}
#rdNow.show{opacity:1;transform:translate(-50%,0)}
@media (max-width:620px){#rdNow{top:calc(176px + env(safe-area-inset-top));max-width:calc(100vw - 32px)}}
#rdNow b{display:block;font:400 18px Anton,Impact,sans-serif;letter-spacing:.6px}#rdNow small{font-size:11px;opacity:.75}`;
document.head.appendChild(radio_css);
function radio_badge(s,px){const d=document.createElement('div');d.className='rdBadge';d.style.cssText=`width:${px}px;height:${px}px;background:radial-gradient(circle at 35% 30%,${s.c1}ee,${s.c1} 70%);color:${s.c2};font-size:${px*(s.t.length>4?.2:.3)}px`;
  d.innerHTML=s.off?`<span style="font-size:1.4em">⏻</span><span class="t2">OFF</span>`:`<span>${s.t}</span>${s.t2?`<span class="t2">${s.t2}</span>`:''}`;
  if(s.logo){const im=new Image();im.src=s.logo;im.alt='';im.onerror=()=>im.remove();d.appendChild(im);}return d;}
const radio_nowEl=document.createElement('div');radio_nowEl.id='rdNow';document.body.appendChild(radio_nowEl);let radio_nowT=0;
function radio_now(){const s=RADIO_STATIONS[radio_st];radio_nowEl.innerHTML='';radio_nowEl.appendChild(radio_badge(s,46));
  const tx=document.createElement('div');tx.innerHTML=`<b>${s.name}</b><small>${s.off?'Apasă Q pentru radio':(s.sub||'')+(s.src?' · LIVE':'')}</small>`;radio_nowEl.appendChild(tx);
  radio_nowEl.classList.add('show');clearTimeout(radio_nowT);radio_nowT=setTimeout(()=>radio_nowEl.classList.remove('show'),3200);}

// ---------- radio wheel ----------
const radio_wh=document.createElement('div');radio_wh.id='rdWheel';radio_wh.innerHTML='<div id="rdRing"><div id="rdCenter"></div></div>';document.body.appendChild(radio_wh);
const radio_ring=radio_wh.querySelector('#rdRing'),radio_center=radio_wh.querySelector('#rdCenter');let radio_slots=[];
let radio_open=false,radio_sel=0,radio_vx=0,radio_vy=0,radio_qT=0,radio_moved=false;
function radio_build(){radio_ring.querySelectorAll('.slot').forEach(e=>e.remove());radio_slots=[];
  const D=Math.min(innerWidth,innerHeight)*.84,R=D*.4,B=Math.max(44,Math.min(84,2*Math.PI*R/RADIO_N*.8));radio_ring.style.setProperty('--D',D+'px');
  RADIO_STATIONS.forEach((s,i)=>{const a=i/RADIO_N*Math.PI*2,x=Math.sin(a)*R,y=-Math.cos(a)*R;const sl=document.createElement('div');sl.className='slot';sl.dataset.x=x;sl.dataset.y=y;sl.dataset.b=B;
    sl.appendChild(radio_badge(s,B));sl.addEventListener('pointerenter',()=>radio_hl(i));sl.addEventListener('click',()=>{radio_hl(i);radio_close(true);});radio_ring.appendChild(sl);radio_slots.push(sl);});
  radio_hl(radio_sel);}
function radio_hl(i){radio_sel=(i+RADIO_N)%RADIO_N;radio_slots.forEach((sl,j)=>{const b=+sl.dataset.b,k=j===radio_sel?1.22:1;sl.style.transform=`translate(${+sl.dataset.x-b/2}px,${+sl.dataset.y-b/2}px) scale(${k})`;
    sl.classList.toggle('sel',j===radio_sel);sl.classList.toggle('cur',j===radio_st);});
  const s=RADIO_STATIONS[radio_sel];radio_center.innerHTML=`<b>${s.name}</b><small>${s.off?'Fără muzică':(s.sub||'')+(s.src?' · LIVE':'')}</small><i>Mouse / rotiță · eliberează Q</i>`;}
function radio_openWheel(){radio_open=true;radio_moved=false;radio_vx=radio_vy=0;radio_sel=radio_st;radio_build();radio_wh.classList.add('open');}
function radio_close(apply){if(!radio_open)return;radio_open=false;radio_wh.classList.remove('open');if(apply&&radio_sel!==radio_st)radio_tune(radio_sel);else if(apply)radio_now();}
addEventListener('resize',()=>{if(radio_open)radio_build();});
// while the wheel is open, the mouse picks a station instead of turning the camera
addEventListener('mousemove',e=>{if(!radio_open)return;e.stopImmediatePropagation();
  radio_vx+=e.movementX||0;radio_vy+=e.movementY||0;const l=Math.hypot(radio_vx,radio_vy);if(l>140){radio_vx*=140/l;radio_vy*=140/l;}
  if(l>35){radio_moved=true;let a=Math.atan2(radio_vx,-radio_vy);if(a<0)a+=Math.PI*2;radio_hl(Math.round(a/(Math.PI*2)*RADIO_N)%RADIO_N);}},true);
addEventListener('wheel',e=>{if(!radio_open)return;e.stopImmediatePropagation();e.preventDefault();radio_moved=true;radio_hl(radio_sel+(e.deltaY>0?1:-1));},{capture:true,passive:false});
addEventListener('keydown',e=>{
  if(e.code==='KeyR'&&!e.repeat){radio_set(!radio_on);return;}
  if(e.code==='KeyQ'){e.preventDefault();if(e.repeat||!radio_inCar)return;radio_qT=performance.now();radio_qShift=e.shiftKey;
    radio_qHold=setTimeout(()=>{if(radio_inCar)radio_openWheel();},170);return;}
  if(radio_open&&e.code==='Escape'){e.stopImmediatePropagation();radio_close(false);}
  if(radio_open&&(e.code==='ArrowLeft'||e.code==='ArrowRight')){e.stopImmediatePropagation();radio_hl(radio_sel+(e.code==='ArrowRight'?1:-1));}},true);
let radio_qHold=0,radio_qShift=false;
addEventListener('keyup',e=>{if(e.code!=='KeyQ')return;clearTimeout(radio_qHold);
  if(radio_open)radio_close(true);else if(radio_inCar&&performance.now()-radio_qT<170)radio_tune(radio_st+(radio_qShift?-1:1));},true);

// ---------- volume: pause-menu slider, -/+ keys (also numpad). Perceived loudness ~ square of the slider. ----------
function radio_gain(){return radio_vol*radio_vol;}
function radio_setVol(v,toast){radio_vol=Math.max(0,Math.min(1,Math.round(v*100)/100));try{localStorage.setItem('gtc_radio_vol',radio_vol);}catch(e){}
  const g=radio_gain();radio_live.volume=g;for(const a of radio_local.values())a.volume=g;
  const sl=$('pmRadVol'),sv=$('pmRadVolV');if(sl)sl.value=Math.round(radio_vol*100);if(sv)sv.textContent=Math.round(radio_vol*100)+'%';
  if(toast)radio_toast((radio_vol===0?'🔇':radio_vol<.5?'🔉':'🔊')+' Volum muzică '+Math.round(radio_vol*100)+'%  (−/+)');}
addEventListener('keydown',e=>{const c=e.code;const d=c==='Minus'||c==='NumpadSubtract'?-1:c==='Equal'||c==='NumpadAdd'?1:0;if(!d)return;
  if(e.target&&/INPUT|TEXTAREA/.test(e.target.tagName))return;e.preventDefault();radio_setVol(radio_vol+d*.1,true);});
{const sl=$('pmRadVol');if(sl)sl.addEventListener('input',()=>radio_setVol(sl.value/100,false));}
radio_setVol(radio_vol,false);

// ---------- start-up + following the player ----------
// browsers block audio until a user gesture: try right away, then on every click/key/touch until something plays
const radio_gest=()=>{if(!radio_unlocked)radio_apply(true);};
for(const ev of['pointerdown','keydown','touchstart'])addEventListener(ev,radio_gest,true);
radio_apply(true);
// theme song only loops on the title screen; once the game starts, music comes from the car radio
playBtn.addEventListener('click',()=>{radio_ingame=true;radio_apply();});
// in/out of vehicles (game.js publishes window.gtcPlayer every frame)
setInterval(()=>{const p=window.gtcPlayer,c=!!(p&&p.car);if(c===radio_inCar)return;radio_inCar=c;if(!c)radio_close(false);radio_apply();if(c&&radio_on)radio_now();},200);
{const a=$('pmRadOn'),b=$('pmRadOff');if(a)a.addEventListener('click',()=>radio_set(true));if(b)b.addEventListener('click',()=>radio_set(false));radio_sync();}
