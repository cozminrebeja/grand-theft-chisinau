'use strict';
// Ambient sound per place (owner: ambience), all synthesized with WebAudio through fx.js's master gain (M mutes):
//  market murmur + chatter at Piața Centrală (day), muffled music from bars in the centre (night), jackhammer + clanks at
//  road works (life.js event), birds in parks and pigeons on the squares (day), dogs barking far away (night), and the
//  hum + motor whine of trolleybuses passing close. Volume and stereo pan follow the camera.
// Hook: ambUpdate(dt,player). Debug: window.__amb.
let amb_dead=false,amb_ready=false,amb_noise=null,amb_brown=null;
const amb_v=new THREE.Vector3();
const amb_hour=()=>typeof env_gameMin!=='undefined'?(env_gameMin/60)%24:12;
const amb_fall=(d,r)=>{const k=clamp(1-d/r,0,1);return k*k;};
const amb_ctx=()=>typeof fx_AC!=='undefined'&&fx_AC&&typeof fx_master!=='undefined'&&fx_master&&fx_AC.state==='running'?fx_AC:null;
// smooth 0..1 window of the day: on from h0 to h1 (wraps midnight), 1 h fades
function amb_win(h,h0,h1){const inn=h0<h1?(h>=h0&&h<h1):(h>=h0||h<h1);if(!inn)return 0;
  const d0=(h-h0+24)%24,d1=(h1-h+24)%24;return clamp(Math.min(d0,d1),0,1);}
// positional bus: input → gain → stereo pan → master
function amb_bus(a){const g=a.createGain();g.gain.value=0;let pn=null;if(a.createStereoPanner){pn=a.createStereoPanner();g.connect(pn);pn.connect(fx_master);}else g.connect(fx_master);return {g,pn};}
function amb_set(a,b,x,z,vol,tc){const dx=x-camera.position.x,dz=z-camera.position.z,d=Math.hypot(dx,dz);
  if(b.pn){camera.getWorldDirection(amb_v);b.pn.pan.setTargetAtTime(clamp((dx*-amb_v.z+dz*amb_v.x)/(d+1),-1,1)*.75,a.currentTime,.1);}
  b.g.gain.setTargetAtTime(vol,a.currentTime,tc||.3);return d;}
function amb_loop(a,buf,rate){const s=a.createBufferSource();s.buffer=buf;s.loop=true;s.playbackRate.value=rate||1;s.start();return s;}
// one-shot through a temporary positional bus
function amb_shot(a,x,z,gain,fn){const dx=x-camera.position.x,dz=z-camera.position.z,d=Math.hypot(dx,dz),v=gain/(1+d*.05);if(v<.002)return;
  const g=a.createGain();g.gain.value=0;let out=g;if(a.createStereoPanner){const pn=a.createStereoPanner();camera.getWorldDirection(amb_v);pn.pan.value=clamp((dx*-amb_v.z+dz*amb_v.x)/(d+1),-1,1)*.75;g.connect(pn);out=pn;}
  out.connect(fx_master);fn(a,g,v,a.currentTime);}

// ================= sources =================
const amb={market:null,bar:null,works:null,hum:[]};
function amb_init(a){amb_ready=true;
  const sr=a.sampleRate,n=sr*3|0;amb_noise=a.createBuffer(1,n,sr);amb_brown=a.createBuffer(1,n,sr);const w=amb_noise.getChannelData(0),b=amb_brown.getChannelData(0);let l=0;
  for(let i=0;i<n;i++){w[i]=Math.random()*2-1;l=(l+.02*w[i])/1.02;b[i]=l*3.5;}for(let i=0;i<2000;i++){const k=i/2000;for(const d of[w,b]){d[i]*=k;d[n-1-i]*=k;}}
  // market: murmur bed (band-passed brown + pink-ish noise, slowly swelling)
  {const B=amb_bus(a),bp=a.createBiquadFilter();bp.type='bandpass';bp.frequency.value=520;bp.Q.value=.6;const mg=a.createGain();mg.gain.value=.8;
    amb_loop(a,amb_brown,1.6).connect(bp);bp.connect(mg);mg.connect(B.g);const bp2=a.createBiquadFilter();bp2.type='bandpass';bp2.frequency.value=1400;bp2.Q.value=1.2;const g2=a.createGain();g2.gain.value=.12;amb_loop(a,amb_noise,.5).connect(bp2);bp2.connect(g2);g2.connect(B.g);
    amb.market={B,mg,chatT:0};}
  // bar music: muffled through a low-pass that opens as you get closer
  {const B=amb_bus(a),lp=a.createBiquadFilter();lp.type='lowpass';lp.frequency.value=600;lp.Q.value=.8;lp.connect(B.g);amb.bar={B,lp,next:0,step:0,bar:0,spot:null};}
  // road works: jackhammer (gated noise) + compressor rumble
  {const B=amb_bus(a),bp=a.createBiquadFilter();bp.type='bandpass';bp.frequency.value=1300;bp.Q.value=.9;const gate=a.createGain();gate.gain.value=0;amb_loop(a,amb_noise,1).connect(bp);bp.connect(gate);gate.connect(B.g);
    const lfo=a.createOscillator();lfo.type='square';lfo.frequency.value=19;const lg=a.createGain();lg.gain.value=.5;lfo.connect(lg);lg.connect(gate.gain);lfo.start();
    const on=a.createGain();on.gain.value=0;gate.disconnect();gate.connect(on);on.connect(B.g);
    const lp=a.createBiquadFilter();lp.type='lowpass';lp.frequency.value=160;const rg=a.createGain();rg.gain.value=.9;amb_loop(a,amb_brown,.7).connect(lp);lp.connect(rg);rg.connect(B.g);
    amb.works={B,on,burst:0,next:1,clankT:0};}
  // trolleybus hum voices (two nearest)
  for(let k=0;k<2;k++){const B=amb_bus(a),o=a.createOscillator();o.type='sawtooth';o.frequency.value=100;const lp=a.createBiquadFilter();lp.type='lowpass';lp.frequency.value=260;const hg=a.createGain();hg.gain.value=.6;o.connect(lp);lp.connect(hg);hg.connect(B.g);
    const w=a.createOscillator();w.type='sine';w.frequency.value=300;const wg=a.createGain();wg.gain.value=0;w.connect(wg);wg.connect(B.g);o.start();w.start();amb.hum.push({B,w,wg,v:null});}}

// ---- market chatter: little formant "voices" ----
const AMB_VOW=[[700,1200],[400,2000],[300,2300],[500,900],[350,800]];
function amb_voice(a,dest,vol){const t=a.currentTime,o=a.createOscillator();o.type='sawtooth';const f0=mr(120,290);o.frequency.setValueAtTime(f0,t);o.frequency.linearRampToValueAtTime(f0*mr(.85,1.2),t+.3);
  const V=mpick(AMB_VOW),g=a.createGain();g.gain.value=0;for(const f of V){const bp=a.createBiquadFilter();bp.type='bandpass';bp.frequency.value=f*mr(.9,1.1);bp.Q.value=7;o.connect(bp);bp.connect(g);}
  const n=1+Math.floor(Math.random()*3),L=mr(.08,.18);for(let i=0;i<n;i++){const t0=t+i*(L+.05);g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(vol,t0+.02);g.gain.linearRampToValueAtTime(0,t0+L);}
  g.connect(dest);o.start(t);o.stop(t+n*(L+.05)+.05);}

// ---- bar music: tiny step sequencer (kick, bass, hats, off-beat stab), 122 bpm ----
const AMB_BASS=[[55,0,55,0,65.4,0,55,0,49,0,55,0,73.4,0,65.4,0],[73.4,0,73.4,0,87.3,0,73.4,0,65.4,0,73.4,0,98,0,87.3,0]];
function amb_seqNote(a,dest,step,t,song){const s=step%16;
  if(s%4===0){const o=a.createOscillator(),g=a.createGain();o.frequency.setValueAtTime(130,t);o.frequency.exponentialRampToValueAtTime(45,t+.12);g.gain.setValueAtTime(.9,t);g.gain.exponentialRampToValueAtTime(.001,t+.25);o.connect(g);g.connect(dest);o.start(t);o.stop(t+.26);}
  const f=AMB_BASS[song][s];if(f){const o=a.createOscillator(),lp=a.createBiquadFilter(),g=a.createGain();o.type='sawtooth';o.frequency.value=f;lp.type='lowpass';lp.frequency.value=400;g.gain.setValueAtTime(.32,t);g.gain.exponentialRampToValueAtTime(.001,t+.2);o.connect(lp);lp.connect(g);g.connect(dest);o.start(t);o.stop(t+.21);}
  if(s%4===2){const src=a.createBufferSource();src.buffer=amb_noise;const hp=a.createBiquadFilter(),g=a.createGain();hp.type='highpass';hp.frequency.value=7000;g.gain.setValueAtTime(.18,t);g.gain.exponentialRampToValueAtTime(.001,t+.07);src.connect(hp);hp.connect(g);g.connect(dest);src.start(t,Math.random()*2,.08);}
  if(s===6||s===14){const g=a.createGain();g.gain.setValueAtTime(.09,t);g.gain.exponentialRampToValueAtTime(.001,t+.18);g.connect(dest);for(const m of[4,5,6]){const o=a.createOscillator();o.type='square';o.frequency.value=AMB_BASS[song][0]*m;o.connect(g);o.start(t);o.stop(t+.19);}}}
let AMB_BARS=null;
function amb_bars(){if(AMB_BARS)return AMB_BARS;AMB_BARS=[];const re=/31 August|Pușkin|Bănulescu-Bodoni|Vlaicu Pârcălab|București|Alexandru cel Bun/;
  for(const e of edges){if(!re.test(e.name||'')||Math.hypot(e.mid[0],e.mid[1])>1700||e.len<30)continue;if(AMB_BARS.some(b=>Math.hypot(b.x-e.mid[0],b.z-e.mid[1])<220))continue;
    const P=e.pts,a=P[0],b=P[P.length-1],l=Math.hypot(b[0]-a[0],b[1]-a[1])||1,s=(e.i%2)?1:-1;AMB_BARS.push({x:e.mid[0]-(b[1]-a[1])/l*(e.w/2+5)*s,z:e.mid[1]+(b[0]-a[0])/l*(e.w/2+5)*s,song:e.i%2});if(AMB_BARS.length>=6)break;}
  return AMB_BARS;}
let AMB_PARKS=null;
function amb_parks(){if(AMB_PARKS)return AMB_PARKS;AMB_PARKS=(D.pois||[]).filter(p=>/Parc|Grădin|Valea Morilor|Dendrariu|Scuar|Lac/.test(p[0])).map(p=>({x:p[1],z:p[2]}));return AMB_PARKS;}
const AMB_SQUARES=[[0,0],[834,646]]; // PMAN / Arc, Piața Centrală: pigeons

function amb_bird(a,x,z){amb_shot(a,x,z,.05,(a,g,v,t)=>{const o=a.createOscillator();o.type='sine';o.connect(g);const n=2+Math.random()*4|0,f0=2400+Math.random()*2000;let tt=t;
  for(let i=0;i<n;i++){const d=.04+Math.random()*.08;o.frequency.setValueAtTime(f0*(.9+Math.random()*.2),tt);o.frequency.exponentialRampToValueAtTime(f0*(1.2+Math.random()*.35),tt+d);g.gain.setValueAtTime(0,tt);g.gain.linearRampToValueAtTime(v,tt+.01);g.gain.linearRampToValueAtTime(0,tt+d);tt+=d+.03+Math.random()*.09;}
  o.start(t);o.stop(tt+.05);});}
function amb_coo(a,x,z){amb_shot(a,x,z,.05,(a,g,v,t)=>{const o=a.createOscillator();o.type='sine';o.frequency.setValueAtTime(330,t);o.frequency.linearRampToValueAtTime(390,t+.25);o.frequency.linearRampToValueAtTime(300,t+.7);
  const tr=a.createOscillator(),tg=a.createGain();tr.frequency.value=14;tg.gain.value=v*.5;tr.connect(tg);tg.connect(g.gain);o.connect(g);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(v*.6,t+.1);g.gain.linearRampToValueAtTime(0,t+.75);o.start(t);tr.start(t);o.stop(t+.8);tr.stop(t+.8);});}
function amb_clank(a,x,z){amb_shot(a,x,z,.06,(a,g,v,t)=>{const bp=a.createBiquadFilter();bp.type='bandpass';bp.frequency.value=mr(1800,3200);bp.Q.value=8;bp.connect(g);
  for(const f of[1,2.76]){const o=a.createOscillator();o.type='triangle';o.frequency.value=mr(900,1400)*f;o.connect(bp);o.start(t);o.stop(t+.25);}g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.0005,t+.22);});}
function amb_farBark(P){const an=Math.random()*TAU,r=mr(140,380),x=P.x+Math.cos(an)*r,z=P.z+Math.sin(an)*r;
  if(typeof lf_bark==='function')lf_bark(x,z,mr(.8,1.25));else{const a=amb_ctx();if(a)amb_shot(a,x,z,.12,(a,g,v,t)=>{const o=a.createOscillator();o.type='sawtooth';o.frequency.setValueAtTime(380,t);o.frequency.exponentialRampToValueAtTime(190,t+.14);o.connect(g);g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.0005,t+.16);o.start(t);o.stop(t+.17);});}
  return {x,z};}

// ================= per frame =================
let amb_birdT=1,amb_cooT=3,amb_dogT=6;
function amb_update(dt,P){const a=amb_ctx();if(!a)return;if(!amb_ready)amb_init(a);const h=amb_hour(),day=amb_win(h,6,20),night=amb_win(h,21.5,5),wk=typeof lf_weekend!=='undefined'&&lf_weekend;
  // market
  {const M=amb.market,pc=amb_pcPoi();const vol=pc?.11*amb_fall(Math.hypot(pc.x-camera.position.x,pc.z-camera.position.z),260)*amb_win(h,6,19)*(wk?1.3:1):0;
    if(pc){amb_set(a,M.B,pc.x,pc.z,vol);M.mg.gain.setTargetAtTime(.6+.4*Math.sin(performance.now()/2300),a.currentTime,.5);
      M.chatT-=dt;if(vol>.008&&M.chatT<=0){M.chatT=mr(.12,.45);amb_voice(a,M.B.g,mr(.25,.6));}}}
  // bar music (nearest bar, at night)
  {const B=amb.bar;let best=null,bd=1e9;if(night>0)for(const s of amb_bars()){const d=Math.hypot(s.x-camera.position.x,s.z-camera.position.z);if(d<bd){bd=d;best=s;}}
    const vol=best?.16*amb_fall(bd,170)*night:0;if(best){amb_set(a,B.B,best.x,best.z,vol,.5);B.lp.frequency.setTargetAtTime(bd<18?2600:bd<45?1100:550,a.currentTime,.3);}else B.B.g.gain.setTargetAtTime(0,a.currentTime,.5);
    if(vol>.004){const spb=60/122/4;if(B.next<a.currentTime)B.next=a.currentTime+.05;while(B.next<a.currentTime+.25){amb_seqNote(a,B.lp,B.step,B.next,(best.song+(B.bar>>3))%2);B.next+=spb;B.step++;if(B.step%16===0)B.bar++;}}}
  // road works (life.js event)
  {const W=amb.works,ev=typeof lf_ev!=='undefined'?lf_ev:null,on=ev&&ev.kind==='works';
    const vol=on?.12*amb_fall(Math.hypot(ev.x-camera.position.x,ev.z-camera.position.z),170)*(h>=6&&h<22?1:.3):0;
    if(on)amb_set(a,W.B,ev.x,ev.z,vol);else W.B.g.gain.setTargetAtTime(0,a.currentTime,.3);
    W.next-=dt;if(vol>.004&&W.next<=0){W.burst=W.burst>0?0:mr(1.2,3.5);W.next=W.burst>0?W.burst:mr(1.5,4);W.on.gain.setTargetAtTime(W.burst>0?.9:0,a.currentTime,.03);}
    W.clankT-=dt;if(on&&vol>.004&&W.clankT<=0){W.clankT=Math.random()<.3?mr(.25,.45):mr(1,3);amb_clank(a,ev.x+mr(-3,3),ev.z+mr(-3,3));}}
  // birds in parks, pigeons on squares (day)
  amb_birdT-=dt;if(amb_birdT<=0){amb_birdT=mr(.6,1.8);if(day>0)for(const p of amb_parks()){const d=Math.hypot(p.x-P.x,p.z-P.z);if(d<260&&Math.random()<(1-d/260)*day*.9)amb_bird(a,p.x+mr(-60,60),p.z+mr(-60,60));}}
  amb_cooT-=dt;if(amb_cooT<=0){amb_cooT=mr(2,6);if(day>0)for(const [x,z] of AMB_SQUARES)if(Math.hypot(x-P.x,z-P.z)<120)amb_coo(a,x+mr(-25,25),z+mr(-25,25));}
  // dogs barking far away at night, sometimes answered
  amb_dogT-=dt;if(amb_dogT<=0){amb_dogT=mr(4,13);if(night>.3){amb_farBark(P);if(Math.random()<.45)setTimeout(()=>amb_farBark(P),mr(500,1500));}}
  // trolleybus hum: the two nearest trolleybuses within 80 m
  {const T=[];for(const v of vehicles){if(v.type!=='trolley')continue;const d=Math.hypot(v.x-camera.position.x,v.z-camera.position.z);if(d<80)T.push([d,v]);}T.sort((p,q)=>p[0]-q[0]);
    amb.hum.forEach((H,k)=>{const e=T[k];if(!e){H.B.g.gain.setTargetAtTime(0,a.currentTime,.3);return;}const [d,v]=e,sp=Math.abs(v.speed||0),wire=v.mode!=='parked';
      amb_set(a,H.B,v.x,v.z,.07*amb_fall(d,80)*(wire?1:.35),.2);H.w.frequency.setTargetAtTime(240+sp*55,a.currentTime,.2);H.wg.gain.setTargetAtTime(wire?Math.min(.5,sp*.06):0,a.currentTime,.2);});}}
let amb_pc=undefined;
function amb_pcPoi(){if(amb_pc===undefined){const p=(D.pois||[]).find(p=>p[0]==='Piața Centrală');amb_pc=p?{x:p[1],z:p[2]}:null;}return amb_pc;}
function ambUpdate(dt,P){if(amb_dead||!P)return;try{amb_update(dt,P);}catch(e){console.error('[ambience] disabled',e);amb_dead=true;}}
window.__amb={get bars(){return amb_bars()},off:()=>{amb_dead=true;if(amb_ready)for(const k of['market','bar','works'])amb[k].B.g.gain.value=0;for(const H of amb.hum)H.B.g.gain.value=0;}};
