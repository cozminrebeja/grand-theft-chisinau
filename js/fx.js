'use strict';
// Particles, skid marks, sparks, police glow, siren + ambient audio. Owner: FX agent.
// Hooks called by game.js: fxInit() once after world build; fxUpdate(dt) every frame; fxEvent(name,data) for 'crash','knockdown','horn','busted'.
// Reads: window.gtcPlayer, vehicles, camera, renderer, scene, isTouch, keys.

// ---------------- particle systems (pooled THREE.Points) ----------------
const fx_LOW=typeof isTouch!=='undefined'&&isTouch;
function fx_tex(draw){const c=document.createElement('canvas');c.width=c.height=64;draw(c.getContext('2d'));const t=new THREE.CanvasTexture(c);return t;}
const fx_smokeTex=fx_tex(g=>{for(let i=0;i<7;i++){const x=22+Math.random()*20,y=22+Math.random()*20,r=14+Math.random()*12;const gr=g.createRadialGradient(x,y,0,x,y,r);gr.addColorStop(0,'rgba(255,255,255,.55)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(0,0,64,64);}
  const gr=g.createRadialGradient(32,32,0,32,32,32);gr.addColorStop(0,'rgba(255,255,255,.6)');gr.addColorStop(.7,'rgba(255,255,255,.2)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(0,0,64,64);});
const fx_glowTex=fx_tex(g=>{const gr=g.createRadialGradient(32,32,0,32,32,32);gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(.18,'rgba(255,255,255,.85)');gr.addColorStop(.45,'rgba(255,255,255,.25)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(0,0,64,64);});
const fx_VS=`attribute float aSize;attribute float aAlpha;attribute vec3 aColor;uniform float uScale;varying float vA;varying vec3 vC;
void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mv;gl_PointSize=min(512.0,aSize*uScale/max(0.2,-mv.z));vA=aAlpha;vC=aColor;}`;
const fx_FS=`uniform sampler2D uTex;varying float vA;varying vec3 vC;void main(){vec4 t=texture2D(uTex,gl_PointCoord);float a=t.a*vA;if(a<0.004)discard;gl_FragColor=vec4(vC*t.rgb,a);}`;
class fx_System{
  constructor(n,tex,additive){this.n=n;this.i=0;
    this.p=new Float32Array(n*3);this.v=new Float32Array(n*3);this.col=new Float32Array(n*3);this.sz=new Float32Array(n);this.al=new Float32Array(n);
    this.life=new Float32Array(n);this.max=new Float32Array(n);this.s0=new Float32Array(n);this.s1=new Float32Array(n);this.a0=new Float32Array(n);this.gr=new Float32Array(n);this.dr=new Float32Array(n);this.kind=new Uint8Array(n);this.fl=new Float32Array(n);
    const g=new THREE.BufferGeometry();
    this.ap=new THREE.BufferAttribute(this.p,3);this.ac=new THREE.BufferAttribute(this.col,3);this.as=new THREE.BufferAttribute(this.sz,1);this.aa=new THREE.BufferAttribute(this.al,1);
    for(const a of[this.ap,this.ac,this.as,this.aa])a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position',this.ap);g.setAttribute('aColor',this.ac);g.setAttribute('aSize',this.as);g.setAttribute('aAlpha',this.aa);
    this.mat=new THREE.ShaderMaterial({uniforms:{uTex:{value:tex},uScale:{value:500}},vertexShader:fx_VS,fragmentShader:fx_FS,transparent:true,depthWrite:false,
      blending:additive?THREE.AdditiveBlending:THREE.NormalBlending});
    this.pts=new THREE.Points(g,this.mat);this.pts.frustumCulled=false;this.pts.renderOrder=5;this.active=0;}
  // kind 0 = smoke (grow+fade, rises), 1 = spark/debris (gravity + bounce, shrink)
  emit(x,y,z,vx,vy,vz,life,s0,s1,r,g,b,a0,grav,drag,kind){const i=this.i;this.i=(i+1)%this.n;const k=i*3;
    this.p[k]=x;this.p[k+1]=y;this.p[k+2]=z;this.v[k]=vx;this.v[k+1]=vy;this.v[k+2]=vz;this.col[k]=r;this.col[k+1]=g;this.col[k+2]=b;
    this.fl[i]=fx_sy(x,z,y);this.life[i]=0;this.max[i]=life;this.s0[i]=s0;this.s1[i]=s1;this.a0[i]=a0;this.gr[i]=grav;this.dr[i]=drag;this.kind[i]=kind;this.active=Math.min(this.n,this.active+1);}
  update(dt){const n=this.n;let any=false;
    for(let i=0;i<n;i++){const m=this.max[i];if(m<=0)continue;let l=this.life[i]+dt;if(l>=m){this.max[i]=0;this.al[i]=0;this.sz[i]=0;any=true;continue;}this.life[i]=l;any=true;
      const k=i*3,t=l/m,dr=Math.exp(-this.dr[i]*dt);this.v[k]*=dr;this.v[k+2]*=dr;this.v[k+1]=this.v[k+1]*dr-this.gr[i]*dt;
      this.p[k]+=this.v[k]*dt;this.p[k+1]+=this.v[k+1]*dt;this.p[k+2]+=this.v[k+2]*dt;
      if(this.kind[i]===1&&this.p[k+1]<this.fl[i]+0.06&&this.v[k+1]<0){this.p[k+1]=this.fl[i]+0.06;this.v[k+1]*=-0.32;this.v[k]*=0.55;this.v[k+2]*=0.55;}
      if(this.kind[i]===0){this.sz[i]=this.s0[i]+(this.s1[i]-this.s0[i])*Math.sqrt(t);this.al[i]=this.a0[i]*Math.min(1,t*7)*(1-t)*(1-t);}
      else{this.sz[i]=this.s0[i]*(1-t*.6);this.al[i]=this.a0[i]*(t<.7?1:(1-t)/.3);}}
    if(any){this.ap.needsUpdate=this.ac.needsUpdate=this.as.needsUpdate=this.aa.needsUpdate=true;}}
}
const fx_gy=(x,z)=>typeof groundY==='function'?groundY(x,z):0;
// ground height under a vehicle (rendered y from vehicles.js when available)
// road surface incl. bridge decks; r = reference height (previous y) so effects can be under a bridge too
const fx_sy=(x,z,r,hx,hz)=>typeof surfaceY==='function'?surfaceY(x,z,r,hx,hz):fx_gy(x,z);
const fx_vy=o=>o&&typeof o.y==='number'?o.y:(o?fx_gy(o.x,o.z):0);
const fx_smoke=new fx_System(fx_LOW?360:1500,fx_smokeTex,false);
const fx_sparks=new fx_System(fx_LOW?200:700,fx_glowTex,true);
const fx_debris=new fx_System(fx_LOW?120:420,fx_glowTex,false);
// spark streaks: a line per spark slot, from position back along velocity (additive)
const fx_stPos=new Float32Array(fx_sparks.n*6),fx_stCol=new Float32Array(fx_sparks.n*6);
const fx_stGeo=new THREE.BufferGeometry();const fx_stAP=new THREE.BufferAttribute(fx_stPos,3).setUsage(THREE.DynamicDrawUsage),fx_stAC=new THREE.BufferAttribute(fx_stCol,3).setUsage(THREE.DynamicDrawUsage);
fx_stGeo.setAttribute('position',fx_stAP);fx_stGeo.setAttribute('color',fx_stAC);
const fx_streaks=new THREE.LineSegments(fx_stGeo,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,fog:false}));fx_streaks.frustumCulled=false;fx_streaks.renderOrder=6;
function fx_updStreaks(){const S=fx_sparks;let any=false;
  for(let i=0;i<S.n;i++){const k=i*3,o=i*6;if(S.max[i]<=0||S.kind[i]!==1){if(fx_stCol[o]!==0||fx_stCol[o+3]!==0){fx_stCol.fill(0,o,o+6);any=true;}continue;}
    const a=S.al[i];fx_stPos[o]=S.p[k];fx_stPos[o+1]=S.p[k+1];fx_stPos[o+2]=S.p[k+2];fx_stPos[o+3]=S.p[k]-S.v[k]*.045;fx_stPos[o+4]=S.p[k+1]-S.v[k+1]*.045;fx_stPos[o+5]=S.p[k+2]-S.v[k+2]*.045;
    fx_stCol[o]=S.col[k]*a;fx_stCol[o+1]=S.col[k+1]*a;fx_stCol[o+2]=S.col[k+2]*a;fx_stCol[o+3]=S.col[k]*a*.15;fx_stCol[o+4]=S.col[k+1]*a*.1;fx_stCol[o+5]=0;any=true;}
  if(any){fx_stAP.needsUpdate=fx_stAC.needsUpdate=true;}}
// police glow: fixed slots, 2 per chaser
const fx_GLOWN=16;
const fx_glow=new fx_System(fx_GLOWN*2,fx_glowTex,true);

// ---------------- skid marks (ring buffer of quads, fading in shader) ----------------
const fx_SKN=fx_LOW?300:700;
const fx_skPos=new Float32Array(fx_SKN*4*3),fx_skBirth=new Float32Array(fx_SKN*4).fill(-1e4),fx_skStr=new Float32Array(fx_SKN*4);
let fx_skI=0,fx_time=0;
const fx_skGeo=new THREE.BufferGeometry();
{const idx=new Uint32Array(fx_SKN*6);for(let q=0;q<fx_SKN;q++){const b=q*4;idx.set([b,b+1,b+2,b,b+2,b+3],q*6);}fx_skGeo.setIndex(new THREE.BufferAttribute(idx,1));}
const fx_skAP=new THREE.BufferAttribute(fx_skPos,3).setUsage(THREE.DynamicDrawUsage),fx_skAB=new THREE.BufferAttribute(fx_skBirth,1).setUsage(THREE.DynamicDrawUsage),fx_skAS=new THREE.BufferAttribute(fx_skStr,1).setUsage(THREE.DynamicDrawUsage);
fx_skGeo.setAttribute('position',fx_skAP);fx_skGeo.setAttribute('aBirth',fx_skAB);fx_skGeo.setAttribute('aStr',fx_skAS);
const fx_skMat=new THREE.ShaderMaterial({uniforms:{uTime:{value:0},uFade:{value:45}},transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4,
  vertexShader:`attribute float aBirth;attribute float aStr;uniform float uTime;uniform float uFade;varying float vA;void main(){float age=uTime-aBirth;vA=aStr*clamp(1.0-age/uFade,0.0,1.0);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader:`varying float vA;void main(){if(vA<0.003)discard;gl_FragColor=vec4(0.03,0.028,0.026,vA*0.78);}`});
const fx_skMesh=new THREE.Mesh(fx_skGeo,fx_skMat);fx_skMesh.frustumCulled=false;fx_skMesh.renderOrder=2;
const fx_wheelLast=[null,null,null,null];
function fx_skidSeg(w,x,z,dirx,dirz,str){const last=fx_wheelLast[w];
  if(!last){fx_wheelLast[w]=[x,z,0];return;}
  const dx=x-last[0],dz=z-last[1],d=Math.hypot(dx,dz);if(d<0.35)return;if(d>4){fx_wheelLast[w]=[x,z,0];return;}
  const nx=-dz/d*0.13,nz=dx/d*0.13,y=0.142,q=fx_skI,ry=fx_vy(fx_pl.car),y0=y+fx_sy(last[0],last[1],ry,dirx,dirz),y1=y+fx_sy(x,z,ry,dirx,dirz);fx_skI=(fx_skI+1)%fx_SKN;const b=q*12;
  fx_skPos[b]=last[0]+nx;fx_skPos[b+1]=y0;fx_skPos[b+2]=last[1]+nz;fx_skPos[b+3]=last[0]-nx;fx_skPos[b+4]=y0;fx_skPos[b+5]=last[1]-nz;
  fx_skPos[b+6]=x-nx;fx_skPos[b+7]=y1;fx_skPos[b+8]=z-nz;fx_skPos[b+9]=x+nx;fx_skPos[b+10]=y1;fx_skPos[b+11]=z+nz;
  for(let k=0;k<4;k++){fx_skBirth[q*4+k]=fx_time;fx_skStr[q*4+k]=k<2?last[2]:str;}
  fx_skAP.needsUpdate=fx_skAB.needsUpdate=fx_skAS.needsUpdate=true;fx_wheelLast[w]=[x,z,str];}
function fx_skidBreak(){for(let i=0;i<4;i++)fx_wheelLast[i]=null;}

// ---------------- audio: siren + ambient bed ----------------
let fx_AC=null,fx_master=null,fx_siren=null,fx_amb=null,fx_muted=false,fx_audioTried=false;
try{fx_muted=localStorage.getItem('gtc_mute')==='1';}catch(e){}
function fx_audioInit(){if(fx_audioTried)return;fx_audioTried=true;
  try{fx_AC=new (window.AudioContext||window.webkitAudioContext)();}catch(e){fx_AC=null;return;}
  try{const a=fx_AC;fx_master=a.createGain();fx_master.gain.value=fx_muted?0:1;fx_master.connect(a.destination);
    // siren: square wail through bandpass, panned
    const o=a.createOscillator();o.type='square';const lfo=a.createOscillator();lfo.type='sine';lfo.frequency.value=0.32;const lg=a.createGain();lg.gain.value=380;lfo.connect(lg);lg.connect(o.frequency);o.frequency.value=1000;
    const bp=a.createBiquadFilter();bp.type='bandpass';bp.frequency.value=1100;bp.Q.value=0.8;const g=a.createGain();g.gain.value=0;
    let out=g;let pan=null;if(a.createStereoPanner){pan=a.createStereoPanner();g.connect(pan);out=pan;}out.connect(fx_master);o.connect(bp);bp.connect(g);o.start();lfo.start();
    fx_siren={g,pan};
    // ambient: looping brown noise -> lowpass, slowly modulated
    const len=a.sampleRate*4|0,buf=a.createBuffer(1,len,a.sampleRate),d=buf.getChannelData(0);let last=0;
    for(let i=0;i<len;i++){last=(last+0.02*(Math.random()*2-1))/1.02;d[i]=last*3.2;}
    const fade=2000;for(let i=0;i<fade;i++){const k=i/fade;d[i]*=k;d[len-1-i]*=k;}
    const src=a.createBufferSource();src.buffer=buf;src.loop=true;const lp=a.createBiquadFilter();lp.type='lowpass';lp.frequency.value=320;const ag=a.createGain();ag.gain.value=0;
    src.connect(lp);lp.connect(ag);ag.connect(fx_master);src.start();
    const hum=a.createBufferSource();hum.buffer=buf;hum.loop=true;hum.playbackRate.value=1.7;const bp2=a.createBiquadFilter();bp2.type='bandpass';bp2.frequency.value=700;bp2.Q.value=1.2;const hg=a.createGain();hg.gain.value=0;
    hum.connect(bp2);bp2.connect(hg);hg.connect(fx_master);hum.start(a.currentTime+1.3);
    fx_amb={ag,hg,lp};
    // white noise for screech + wind
    const wl=a.sampleRate*2|0,wb=a.createBuffer(1,wl,a.sampleRate),wd=wb.getChannelData(0);for(let i=0;i<wl;i++)wd[i]=Math.random()*2-1;
    const sc=a.createBufferSource();sc.buffer=wb;sc.loop=true;const sbp=a.createBiquadFilter();sbp.type='bandpass';sbp.frequency.value=2100;sbp.Q.value=7;const sbp2=a.createBiquadFilter();sbp2.type='bandpass';sbp2.frequency.value=3300;sbp2.Q.value=9;
    const sg=a.createGain();sg.gain.value=0;sc.connect(sbp);sc.connect(sbp2);sbp.connect(sg);sbp2.connect(sg);sg.connect(fx_master);sc.start();
    const wn=a.createBufferSource();wn.buffer=wb;wn.loop=true;wn.playbackRate.value=.6;const hp=a.createBiquadFilter();hp.type='highpass';hp.frequency.value=500;const wlp=a.createBiquadFilter();wlp.type='lowpass';wlp.frequency.value=2400;
    const wg=a.createGain();wg.gain.value=0;wn.connect(hp);hp.connect(wlp);wlp.connect(wg);wg.connect(fx_master);wn.start();
    fx_amb.sg=sg;fx_amb.sbp=sbp;fx_amb.wg=wg;fx_amb.next={horn:4+Math.random()*6,bird:2+Math.random()*3};
  }catch(e){fx_siren=null;fx_amb=null;}}
// one-shot ambient sounds (distant horns, birds)
function fx_oneShotHorn(){const a=fx_AC;if(!a)return;const t=a.currentTime,g=a.createGain(),lp=a.createBiquadFilter();lp.type='lowpass';lp.frequency.value=1100;g.gain.value=0;
  let out=g;if(a.createStereoPanner){const pn=a.createStereoPanner();pn.pan.value=Math.random()*1.6-.8;g.connect(pn);out=pn;}out.connect(fx_master);
  const base=[392,440,466,523][Math.random()*4|0],dur=.18+Math.random()*.45,v=.006+Math.random()*.008,rep=Math.random()<.35?2:1;
  for(let r=0;r<rep;r++){const t0=t+r*(dur+.12);g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(v,t0+.02);g.gain.setValueAtTime(v,t0+dur);g.gain.linearRampToValueAtTime(0,t0+dur+.05);}
  for(const f of[base,base*1.26]){const o=a.createOscillator();o.type='square';o.frequency.value=f;o.connect(lp);o.start(t);o.stop(t+rep*(dur+.12)+.1);}lp.connect(g);}
function fx_oneShotBird(){const a=fx_AC;if(!a)return;const t=a.currentTime,g=a.createGain();g.gain.value=0;let out=g;if(a.createStereoPanner){const pn=a.createStereoPanner();pn.pan.value=Math.random()*1.4-.7;g.connect(pn);out=pn;}out.connect(fx_master);
  const o=a.createOscillator();o.type='sine';o.connect(g);const n=2+Math.random()*4|0,f0=2600+Math.random()*1800;let tt=t;
  for(let i=0;i<n;i++){const d=.05+Math.random()*.07;o.frequency.setValueAtTime(f0*(.9+Math.random()*.2),tt);o.frequency.exponentialRampToValueAtTime(f0*(1.25+Math.random()*.3),tt+d);g.gain.setValueAtTime(0,tt);g.gain.linearRampToValueAtTime(.007,tt+.01);g.gain.linearRampToValueAtTime(0,tt+d);tt+=d+.04+Math.random()*.08;}
  o.start(t);o.stop(tt+.05);}
const fx_resume=()=>{if(fx_AC&&fx_AC.state==='suspended')fx_AC.resume().catch(()=>{});};
addEventListener('pointerdown',fx_resume);addEventListener('keydown',fx_resume);
// mute toggle (M) + tiny toast
let fx_toastEl=null,fx_toastT=0;
function fx_toast(t){if(!fx_toastEl){fx_toastEl=document.createElement('div');fx_toastEl.style.cssText='position:fixed;top:calc(64px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:20;font:800 13px Inter,system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.55);padding:6px 14px;border-radius:16px;pointer-events:none;transition:opacity .3s;opacity:0;letter-spacing:.5px';document.body.appendChild(fx_toastEl);}
  fx_toastEl.textContent=t;fx_toastEl.style.opacity=1;fx_toastT=1.4;}
function fx_setMute(m){fx_muted=m;try{localStorage.setItem('gtc_mute',m?'1':'0');}catch(e){}if(fx_master&&fx_AC)fx_master.gain.setTargetAtTime(m?0:1,fx_AC.currentTime,.05);fx_toast(m?'🔇 Sunet ambiental oprit (M)':'🔊 Sunet ambiental pornit (M)');}
let fx_hb=false;addEventListener('keydown',e=>{if(e.code==='Space')fx_hb=true;});addEventListener('keyup',e=>{if(e.code==='Space')fx_hb=false;});
addEventListener('keydown',e=>{if(e.code==='KeyM'&&!e.repeat&&window.gtcPlayer)fx_setMute(!fx_muted);});

// ---------------- hooks ----------------
let fx_ready=false;
function fxInit(){if(fx_ready)return;fx_ready=true;scene.add(fx_skMesh,fx_smoke.pts,fx_debris.pts,fx_sparks.pts,fx_streaks,fx_glow.pts);}
const fx_pl={prevSpeed:0,prevH:0,smokeAcc:0,car:null};
const fx_tmpV=new THREE.Vector3();
function fx_puff(x,y,z,n,spread,size,shade,alpha,life,up){for(let i=0;i<n;i++){const a=Math.random()*6.283,s=Math.random()*spread;
  fx_smoke.emit(x+Math.cos(a)*s*.3,y,z+Math.sin(a)*s*.3,Math.cos(a)*s,up*(0.6+Math.random()*.6),Math.sin(a)*s,life*(.7+Math.random()*.6),size*.5,size*(1.6+Math.random()*.8),shade,shade,shade*.98,alpha,-0.25,1.6,0);}}
function fxEvent(name,d){if(!fx_ready)return;
  if(name==='crash'){const v=d.v,imp=d.imp||10;let x=d.x,z=d.z;if(v){const fx=Math.sin(v.h),fz=Math.cos(v.h),s=v.speed>=0?1:-1;x+=fx*v.spec.len*.5*s;z+=fz*v.spec.len*.5*s;}const gy=v?fx_sy(x,z,fx_vy(v),Math.sin(v.h),Math.cos(v.h)):fx_sy(x,z,null);
    fx_sparks.emit(x,gy+.8,z,0,0,0,.14,Math.min(6,1.5+imp*.15),0,1,.7,.35,1,0,0,1);
    const n=Math.min(fx_LOW?30:110,Math.round(imp*3));
    for(let i=0;i<n;i++){const a=Math.random()*6.283,sp=2+Math.random()*imp*.35;const hot=Math.random();
      fx_sparks.emit(x,gy+0.5+Math.random()*.6,z,Math.cos(a)*sp,1.5+Math.random()*4,Math.sin(a)*sp,.35+Math.random()*.5,.14+Math.random()*.12,0,1,.42+hot*.4,.08+hot*.22,1,9.8,.6,1);}
    if(imp>11){const m=Math.min(fx_LOW?18:60,Math.round(imp*1.6));for(let i=0;i<m;i++){const a=Math.random()*6.283,sp=1+Math.random()*imp*.22,glass=Math.random()<.55;
      fx_debris.emit(x,gy+0.7+Math.random()*.5,z,Math.cos(a)*sp,1+Math.random()*3.5,Math.sin(a)*sp,1.2+Math.random()*1.4,glass?.09:.13,0,glass?.75:.18,glass?.88:.18,glass?.95:.2,glass?.9:1,9.8,.4,1);}}
    fx_puff(x,gy+0.5,z,Math.min(10,3+imp*.3|0),2.2,1.4,.62,.38,1.8,1.2);}
  else if(name==='knockdown'){fx_puff(d.x,(d.p&&d.p.y!=null?d.p.y:fx_sy(d.x,d.z,null))+0.47,d.z,8,1.6,.9,.72,.32,1.2,.8);}
  else if(name==='busted'){fx_skidBreak();}
  else if(name==='horn'){fx_audioInit();fx_resume();}
  else if(name==='wanted'){fx_audioInit();fx_resume();const st=d.stars|0,up=st>fx_lastStars;fx_lastStars=st;fx_wantedCue(up,st);}}
let fx_lastStars=0;
function fx_wantedCue(up,st){const a=fx_AC;if(!a)return;try{const t=a.currentTime,g=a.createGain();g.gain.value=0;g.connect(a.destination);
  const notes=up?[523,659,784+st*40]:[659,523,392];const tri=a.createOscillator();tri.type=up?'square':'triangle';const lp=a.createBiquadFilter();lp.type='lowpass';lp.frequency.value=up?2200:1400;tri.connect(lp);lp.connect(g);
  notes.forEach((f,i)=>{const t0=t+i*.11;tri.frequency.setValueAtTime(f,t0);g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(up?.05:.04,t0+.012);g.gain.linearRampToValueAtTime(up?.025:.02,t0+.09);});
  g.gain.linearRampToValueAtTime(0,t+notes.length*.11+.12);tri.start(t);tri.stop(t+notes.length*.11+.15);}catch(e){}}
function fxUpdate(dt){if(!fx_ready||!(dt>0))return;fx_time+=dt;fx_skMat.uniforms.uTime.value=fx_time;
  if(!fx_audioTried)fx_audioInit();
  const P=window.gtcPlayer;
  // point size scale from camera projection + drawing buffer height
  const sc=(renderer.domElement.height||innerHeight)*camera.projectionMatrix.elements[5]*0.5;
  for(const s of[fx_smoke,fx_sparks,fx_debris,fx_glow])s.mat.uniforms.uScale.value=sc;
  // ---- player tyres ----
  const v=P&&P.car;
  if(v!==fx_pl.car){fx_pl.car=v;fx_skidBreak();if(v){fx_pl.prevSpeed=v.speed;fx_pl.prevH=v.h;}}
  if(v){const sp=v.speed,as=Math.abs(sp),acc=(sp-fx_pl.prevSpeed)/dt,yaw=angDiff(v.h,fx_pl.prevH)/dt;fx_pl.prevSpeed=sp;fx_pl.prevH=v.h;
    const GI=window.gtcInput,hb=GI?!!GI.hb:fx_hb,thr=GI?GI.t:0;
    let slip=0;
    if(hb&&as>4)slip=Math.min(1,as/14);
    if(Math.abs(yaw)*as>15)slip=Math.max(slip,Math.min(1,(Math.abs(yaw)*as-15)/14));
    if(acc>4.5&&as<10&&sp>0.3&&v.type!=='trolley')slip=Math.max(slip,.75*Math.min(1,(acc-4.5)/4));
    if(GI&&thr>.7&&sp>.2&&sp<7&&v.type!=='trolley'&&v.type!=='rutiera')slip=Math.max(slip,.7*(1-sp/7)+.15);
    if(GI&&thr<-.6&&sp>7)slip=Math.max(slip,Math.min(1,(sp-7)/18+.3));
    if(acc<-14&&as>5)slip=Math.max(slip,Math.min(1,(-acc-14)/10));
    const fx=Math.sin(v.h),fz=Math.cos(v.h),rx=Math.cos(v.h),rz=-Math.sin(v.h),L=v.spec.len,W=v.spec.wid;
    const wheels=[[W/2-.18,-L/2+L*.2],[-(W/2-.18),-L/2+L*.2],[W/2-.18,L/2-L*.2],[-(W/2-.18),L/2-L*.2]];
    if(slip>.08){const braking=acc<-14;fx_pl.smokeAcc+=dt*(fx_LOW?18:34)*slip;
      for(let w=0;w<(braking?4:2);w++){const [ox,oz]=wheels[w];const wx=v.x+rx*ox+fx*oz,wz=v.z+rz*ox+fz*oz;fx_skidSeg(w,wx,wz,fx,fz,Math.min(1,.55+slip*.6));}
      while(fx_pl.smokeAcc>=1){fx_pl.smokeAcc-=1;const w=Math.random()<.5?0:1;const [ox,oz]=wheels[w];const wx=v.x+rx*ox+fx*oz,wz=v.z+rz*ox+fz*oz;
        const sh=.78+Math.random()*.12;fx_smoke.emit(wx,fx_sy(wx,wz,fx_vy(v),fx,fz)+.35,wz,-fx*sp*.12+(Math.random()-.5)*1.2,.4+Math.random()*.7,-fz*sp*.12+(Math.random()-.5)*1.2,1.6+Math.random()*1.4,.7,2.6+slip*2.2,sh,sh,sh,.42*slip+.12,-.2,1.3,0);}}
    else fx_skidBreak();
    fx_pl.slip=slip;
    // dust when off the asphalt (grass, sidewalks, parks)
    fx_pl.offT=(fx_pl.offT||0)-dt;if(fx_pl.offT<=0){fx_pl.offT=.12;let off=false;if(typeof nearestSeg==='function'){const ns=nearestSeg(v.x,v.z,14);off=!ns||ns.d>ns.s.r.w/2+.4;}fx_pl.off=off;}
    if(fx_pl.off&&as>4&&v.type!=='trolley'){fx_pl.dustAcc=(fx_pl.dustAcc||0)+dt*as*.9;while(fx_pl.dustAcc>=1){fx_pl.dustAcc-=1;const w=Math.random()*4|0;const [ox,oz]=wheels[w];const wx=v.x+rx*ox+fx*oz,wz=v.z+rz*ox+fz*oz;
      fx_smoke.emit(wx,fx_sy(wx,wz,fx_vy(v),fx,fz)+.42,wz,-fx*sp*.15+(Math.random()-.5),.3+Math.random()*.5,-fz*sp*.15+(Math.random()-.5),1.2+Math.random(),.5,2+Math.random()*1.4,.62,.55,.42,.32,-.1,1.4,0);}}
  } else fx_pl.slip=0;
  // ---- exhaust puffs near camera ----
  const cx=camera.position.x,cz=camera.position.z,EX=fx_LOW?28:45;
  for(const o of vehicles){if(o.type==='trolley')continue;const dx=o.x-cx,dz=o.z-cz;if(dx*dx+dz*dz>EX*EX)continue;
    o.fx_ex=(o.fx_ex||Math.random()*.4)-dt;if(o.fx_ex>0)continue;const moving=Math.abs(o.speed)>.5||o.mode==='player'||o.mode==='ai'||o.mode==='chase';if(!moving){o.fx_ex=1;continue;}
    o.fx_ex=(fx_LOW?.55:.3)+Math.random()*.2;const fx=Math.sin(o.h),fz=Math.cos(o.h),bx=o.x-fx*(o.spec.len/2+.1)+Math.cos(o.h)*o.spec.wid*.28,bz=o.z-fz*(o.spec.len/2+.1)-Math.sin(o.h)*o.spec.wid*.28;
    const k=o.type==='lada'||o.type==='rutiera'?1.6:1;const sh=.55+Math.random()*.1;
    fx_smoke.emit(bx,fx_vy(o)+.32,bz,-fx*(1+Math.random())+o.speed*fx*.6,.25+Math.random()*.3,-fz*(1+Math.random())+o.speed*fz*.6,.9+Math.random()*.6,.18,.9*k,sh,sh,sh,.13*k,-.15,2.2,0);}
  // ---- police glow + siren ----
  const blink=(fx_time*5.8|0)%2;let gi=0,nearD=1e9,nearV=null;
  for(const o of vehicles){if(o.mode!=='chase')continue;const d=Math.hypot(o.x-(P?P.x:cx),o.z-(P?P.z:cz));if(d<nearD){nearD=d;nearV=o;}
    if(gi>=fx_GLOWN)continue;const rx=Math.cos(o.h),rz=-Math.sin(o.h),fx=Math.sin(o.h),fz=Math.cos(o.h),bx=o.x-fx*.2,bz=o.z-fz*.2;
    for(let s=0;s<2;s++){const i=gi*2+s,k=i*3,on=(s===0)===!!blink;const ox=(s?.32:-.32);
      fx_glow.p[k]=bx+rx*ox;fx_glow.p[k+1]=fx_vy(o)+1.72;fx_glow.p[k+2]=bz+rz*ox;
      if(s===0){fx_glow.col[k]=1;fx_glow.col[k+1]=.12;fx_glow.col[k+2]=.1;}else{fx_glow.col[k]=.15;fx_glow.col[k+1]=.35;fx_glow.col[k+2]=1;}
      fx_glow.sz[i]=on?3.4:1.1;fx_glow.al[i]=on?.95:.25;}gi++;}
  for(let i=gi*2;i<fx_GLOWN*2;i++){fx_glow.al[i]=0;fx_glow.sz[i]=0;}
  fx_glow.ap.needsUpdate=fx_glow.ac.needsUpdate=fx_glow.as.needsUpdate=fx_glow.aa.needsUpdate=true;
  if(fx_AC&&fx_siren){const t=fx_AC.currentTime,vol=nearV?.075*Math.pow(Math.max(0,1-nearD/230),1.6):0;fx_siren.g.gain.setTargetAtTime(vol,t,.15);
    if(fx_siren.pan&&nearV){const ang=Math.atan2(nearV.x-cx,nearV.z-cz),cy=Math.atan2(camera.getWorldDirection(fx_tmpV).x,fx_tmpV.z);fx_siren.pan.pan.setTargetAtTime(clamp(-Math.sin(ang-cy),-.85,.85),t,.1);}}
  if(fx_AC&&fx_amb){const t=fx_AC.currentTime;const inCar=!!v;fx_amb.ag.gain.setTargetAtTime(inCar?.05:.075,t,.5);fx_amb.hg.gain.setTargetAtTime(.012+.006*Math.sin(fx_time*.21),t,.5);fx_amb.lp.frequency.setTargetAtTime(260+80*Math.sin(fx_time*.13),t,.5);
    const sl=fx_pl.slip||0,spd=v?Math.abs(v.speed):0;fx_amb.sg.gain.setTargetAtTime(sl>.08?.05+sl*.09:0,t,.04);fx_amb.sbp.frequency.setTargetAtTime(1900+sl*500+Math.sin(fx_time*23)*120,t,.03);
    fx_amb.wg.gain.setTargetAtTime(Math.min(.05,Math.pow(spd/40,2)*.05),t,.2);
    const nx=fx_amb.next;nx.horn-=dt;nx.bird-=dt;if(nx.horn<=0){nx.horn=6+Math.random()*12;if(!fx_muted)fx_oneShotHorn();}
    if(nx.bird<=0){nx.bird=1.5+Math.random()*4;if(!fx_muted&&!v)fx_oneShotBird();}}
  // ---- step particle systems ----
  fx_smoke.update(dt);fx_sparks.update(dt);fx_debris.update(dt);fx_updStreaks();
  if(fx_toastT>0){fx_toastT-=dt;if(fx_toastT<=0&&fx_toastEl)fx_toastEl.style.opacity=0;}
}

window.__fx={get skids(){return fx_skI},get smoke(){return fx_smoke.active},get sparks(){return fx_sparks.active}};
