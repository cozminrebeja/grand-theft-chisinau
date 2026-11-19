'use strict';
// Music + car radio.
// - Theme song (local mp3) plays on the loading/title screen and on foot; it starts somewhere in the middle of the track.
// - In a vehicle the car radio plays the selected station: the theme song, or live internet streams
//   (Hit FM Moldova, Kiss FM România, Radio Record). Q switches station while driving.
// - R turns all music on/off (also in the pause menu). Choices are remembered in localStorage.
const RADIO_THEME={name:'MAC — Centru',src:'assets/music/mac-centru.mp3'};
const RADIO_STATIONS=[
  {name:'MAC — Centru',theme:true},
  {name:'Hit FM',sub:'101.7 Chișinău',src:'https://stream.dixi.md:9443/HitFM',alt:'https://radio3.dixi.md/listen/hit_fm_hot_hits/hitfm_hothits128.aac'},
  {name:'Kiss FM',sub:'România',src:'https://live.kissfm.ro/kissfm.aacp'},
  {name:'Radio Record',sub:'Russia',src:'https://radiorecord.hostingradio.ru/rr_main96.aacp',alt:'https://air.unmixed.ru/record320'},
];
const RADIO_VOL=.55;
let radio_on=true,radio_st=1,radio_inCar=false,radio_unlocked=false,radio_cur=null; // radio_cur: 'theme' | station index | null
try{radio_on=localStorage.getItem('gtc_radio')!=='0';const s=+localStorage.getItem('gtc_station');if(s>=0&&s<RADIO_STATIONS.length)radio_st=s;}catch(e){}

const radio_theme=new Audio(RADIO_THEME.src);radio_theme.preload='auto';radio_theme.loop=true;radio_theme.volume=RADIO_VOL;
radio_theme.addEventListener('loadedmetadata',()=>{if(isFinite(radio_theme.duration))radio_theme.currentTime=radio_theme.duration*(.35+Math.random()*.25);},{once:true});
const radio_live=new Audio();radio_live.preload='none';radio_live.volume=RADIO_VOL;
radio_live.addEventListener('error',()=>{const s=RADIO_STATIONS[radio_cur];if(!s||!radio_live.getAttribute('src'))return;
  if(s.alt&&radio_live.src!==s.alt){radio_live.src=s.alt;radio_live.play().catch(()=>{});}else radio_toast('📻 '+s.name+' — fără semnal (Q următorul post)');});

function radio_toast(t){if(typeof fx_toast==='function')fx_toast(t);}
function radio_label(s){return s.name+(s.sub?' · '+s.sub:'');}
function radio_stopLive(){radio_live.pause();radio_live.removeAttribute('src');radio_live.load();}
// what should be playing right now
function radio_want(){if(!radio_on)return null;if(!radio_inCar)return 'theme';return RADIO_STATIONS[radio_st].theme?'theme':radio_st;}
function radio_apply(){const w=radio_want();if(w===radio_cur&&(w===null||!radio_unlocked||!(w==='theme'?radio_theme:radio_live).paused))return;
  if(w!=='theme')radio_theme.pause();
  if(typeof w!=='number'&&radio_cur!==null&&typeof radio_cur==='number')radio_stopLive();
  radio_cur=w;if(w===null)return;
  if(w==='theme'){radio_theme.play().then(()=>{radio_unlocked=true;}).catch(()=>{});}
  else{const s=RADIO_STATIONS[w];if(radio_live.getAttribute('src')!==s.src)radio_live.src=s.src;radio_live.play().then(()=>{radio_unlocked=true;}).catch(()=>{});}}
function radio_set(on){radio_on=on;try{localStorage.setItem('gtc_radio',on?'1':'0');}catch(e){}radio_sync();radio_apply();
  radio_toast(on?'📻 Muzică pornită (R)':'📻 Muzică oprită (R)');}
function radio_next(d){radio_st=(radio_st+d+RADIO_STATIONS.length)%RADIO_STATIONS.length;try{localStorage.setItem('gtc_station',radio_st);}catch(e){}
  if(!radio_on)radio_set(true);else radio_apply();radio_toast('📻 '+radio_label(RADIO_STATIONS[radio_st])+'  (Q)');}
function radio_sync(){const a=$('pmRadOn'),b=$('pmRadOff');if(a)a.classList.toggle('on',radio_on);if(b)b.classList.toggle('on',!radio_on);}

// browsers block audio until a user gesture: try right away, then on every click/key/touch until something plays
const radio_gest=()=>{if(!radio_unlocked){radio_cur=undefined;radio_apply();}};
for(const ev of['pointerdown','keydown','touchstart'])addEventListener(ev,radio_gest,true);
radio_apply();

// follow the player in and out of vehicles (game.js publishes window.gtcPlayer every frame)
setInterval(()=>{const p=window.gtcPlayer,c=!!(p&&p.car);if(c===radio_inCar)return;radio_inCar=c;radio_apply();
  if(c&&radio_on)radio_toast('📻 '+radio_label(RADIO_STATIONS[radio_st])+'  (Q schimbă postul)');},200);

addEventListener('keydown',e=>{if(e.repeat)return;if(e.code==='KeyR')radio_set(!radio_on);else if(e.code==='KeyQ'&&radio_inCar)radio_next(e.shiftKey?-1:1);});
{const a=$('pmRadOn'),b=$('pmRadOff');if(a)a.addEventListener('click',()=>radio_set(true));if(b)b.addEventListener('click',()=>radio_set(false));radio_sync();}
