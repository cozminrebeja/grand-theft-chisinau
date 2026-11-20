'use strict';
// Renderer, camera, lights, sky, fog, shadows, colour grade. Owner: ENV agent.
// Look: warm, hazy golden afternoon (classic San Andreas mood), tuned to stay cheap on phones.

// ================= colour grade (free: injected into every material's tone-mapping step) =================
// Applied per-fragment by three.js when renderer.toneMapping===CustomToneMapping (no extra render pass).
THREE.ShaderChunk.tonemapping_pars_fragment=THREE.ShaderChunk.tonemapping_pars_fragment.replace(
  'vec3 CustomToneMapping( vec3 color ) { return color; }',
  `vec3 CustomToneMapping( vec3 color ) {
    color *= toneMappingExposure;
    color = color / ( 1.0 + color * 0.16 ) * 1.13;           // soft highlight shoulder
    float l = dot( color, vec3( 0.299, 0.587, 0.114 ) );
    color = mix( vec3( l ), color, 1.05 );                     // a touch more saturation
    color = ( color - 0.5 ) * 1.09 + 0.5;                      // gentle contrast
    color *= vec3( 1.04, 1.0, 0.94 );                         // warm SA smog tint
    color += vec3( 0.012, 0.008, 0.0 ) * ( 1.0 - l );          // warm-lifted shadows
    return clamp( color, 0.0, 1.0 );
  }`);

// ================= renderer =================
const canvas=$('gl');
const renderer=new THREE.WebGLRenderer({canvas,antialias:!isTouch||devicePixelRatio<2,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,isTouch?1.5:1.75));
renderer.setSize(innerWidth,innerHeight);
renderer.toneMapping=THREE.CustomToneMapping;
renderer.toneMappingExposure=1.0;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=GTC_Q==='med'?THREE.PCFShadowMap:THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate=false;   // re-rendered every env_SHN frames in envRender (ultra: every frame)
const env_SHN=GTC_Q==='ultra'?1:2;let env_shF=0;
renderer.info.autoReset=false;      // info accumulates over the whole frame (shadow + post passes); reset in envRender
const scene=new THREE.Scene();
const FOGC=0xd6d3c6;                      // warm haze; sky horizon uses the same colour
scene.fog=new THREE.Fog(FOGC,170,700);
scene.background=new THREE.Color(FOGC);
const camera=new THREE.PerspectiveCamera(62,innerWidth/innerHeight,0.8,900);

// ================= lights =================
// direction TOWARD the sun: afternoon, south-west, ~30° elevation (x=east, z=south)
const env_sunDir=new THREE.Vector3(-0.62,0.52,0.58).normalize();
const env_hemi=new THREE.HemisphereLight(0xc2d6ee,0x7d705a,0.50);scene.add(env_hemi);
const env_amb=new THREE.AmbientLight(0xffe9cc,0.05);scene.add(env_amb);
const sun=new THREE.DirectionalLight(0xffdcaa,0.86);
sun.castShadow=true;
const env_SR=isTouch?62:150;                // half-size of shadow box (m)
const env_SMAP=isTouch?1024:GTC_Q==='ultra'?4096:2048;
sun.shadow.mapSize.set(env_SMAP,env_SMAP);
{const c=sun.shadow.camera;c.left=-env_SR;c.right=env_SR;c.top=env_SR;c.bottom=-env_SR;c.near=10;c.far=900;c.updateProjectionMatrix();}
sun.shadow.bias=-0.00035;sun.shadow.normalBias=0.035;sun.shadow.radius=1.5;
scene.add(sun);scene.add(sun.target);

// ================= sky (shader dome: gradient + sun + glow + drifting clouds) =================
const env_skyU={uSun:{value:env_sunDir.clone()},uTime:{value:0},uNight:{value:0},uCloud:{value:new THREE.Color(0xffffff)},uHor:{value:new THREE.Color(FOGC)},uZen:{value:new THREE.Color(0x5a8fd0)},uMid:{value:new THREE.Color(0x9bbde0)}};
const env_skyMat=new THREE.ShaderMaterial({uniforms:env_skyU,side:THREE.BackSide,depthWrite:false,fog:false,toneMapped:false,
  vertexShader:`varying vec3 vDir;void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader:`
  precision mediump float;
  uniform vec3 uSun,uHor,uZen,uMid,uCloud;uniform float uTime,uNight;varying vec3 vDir;
  float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
  float fbm(vec2 p){float s=0.0,a=0.5;for(int i=0;i<${isTouch?3:5};i++){s+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=0.5;}return s;}
  void main(){
    vec3 d=normalize(vDir);float y=d.y;
    float t=clamp(y,0.0,1.0);
    vec3 c=mix(uHor,uMid,smoothstep(0.0,0.18,t));c=mix(c,uZen,smoothstep(0.15,0.75,t));
    if(y<0.0)c=uHor*0.97;
    float sd=max(dot(d,uSun),0.0),sk=smoothstep(-0.12,0.02,uSun.y);
    c+=vec3(1.0,0.66,0.36)*pow(sd,8.0)*0.24*sk;          // broad warm glow
    c+=vec3(1.0,0.80,0.55)*pow(sd,64.0)*0.30*sk;         // halo
    c+=vec3(1.0,0.97,0.88)*smoothstep(0.9993,0.9997,sd)*1.15*smoothstep(-0.03,0.01,uSun.y); // disc
    if(uNight>0.0&&y>0.0){                              // stars + moon (opposite the sun)
      vec3 sp=floor(d*190.0);c+=vec3(0.85,0.9,1.0)*step(0.9972,h(sp.xy+sp.z*1.73))*uNight*smoothstep(0.02,0.25,y);
      float md=max(dot(d,-uSun),0.0);c+=vec3(0.92,0.94,1.0)*(smoothstep(0.99955,0.99975,md)*0.9+pow(md,200.0)*0.12)*uNight;}
    // clouds on a virtual plane
    if(y>0.02){
      vec2 uv=d.xz/(y+0.08)*1.35+vec2(uTime*0.004,uTime*0.0015);
      float cl=fbm(uv);cl=smoothstep(0.52,0.82,cl)*smoothstep(0.02,0.22,y);
      vec3 cc=mix(vec3(0.98,0.95,0.90),vec3(1.0,0.88,0.70),pow(sd,4.0));
      cc*=(0.88+0.12*fbm(uv*2.0+3.0))*uCloud;
      c=mix(c,cc,cl*0.85);
    }
    c=mix(c,uHor,smoothstep(0.10,0.0,abs(y))*0.55);   // horizon haze band
    gl_FragColor=vec4(c,1.0);
  }`});
const env_sky=new THREE.Mesh(new THREE.SphereGeometry(850,32,16),env_skyMat);env_sky.renderOrder=-2;env_sky.frustumCulled=false;scene.add(env_sky);
window.__sky=env_sky;

// distant hills ring (Chișinău sits on hills) — fog-free silhouette that follows the camera
const env_hills=(()=>{const N=160,R=800,pos=[],col=[],idx=[];const near=new THREE.Color(0xa9a99a),far=new THREE.Color(0xc4c3b6);
  for(let i=0;i<=N;i++){const a=i/N*Math.PI*2;
    const hh=18+14*Math.sin(a*3.1+1.3)+9*Math.sin(a*7.3+.4)+5*Math.sin(a*17.0)+ (Math.sin(a*1.0-0.6)>0.3?16:0)*Math.sin(a*1.0-0.6);
    const hh2=hh*0.55+10*Math.sin(a*5.2+2.0)+6;
    for(const [r,y,c] of [[R,-5,far],[R,hh,far],[R*.97,-5,near],[R*.97,hh2,near]]){pos.push(Math.cos(a)*r,y,Math.sin(a)*r);col.push(c.r,c.g,c.b);}}
  for(let i=0;i<N;i++){const b=i*4,n=(i+1)*4;idx.push(b,n,b+1,b+1,n,n+1, b+2,n+2,b+3,b+3,n+2,n+3);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.setIndex(idx);
  const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({vertexColors:true,fog:false,side:THREE.DoubleSide,toneMapped:false,depthWrite:false}));m.renderOrder=-1;m.frustumCulled=false;scene.add(m);return m;})();

// cheap vignette overlay (DOM, composited once — no GPU pass)
const env_vig=(()=>{const v=document.createElement('div');v.style.cssText='position:fixed;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 46%,rgba(0,0,0,0) 58%,rgba(40,24,8,.26) 100%)';canvas.insertAdjacentElement('afterend',v);return v;})();

addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();if(env_post)env_post.resize();});

// ================= post-processing (desktop): MSAA scene -> SSAO-lite -> bloom -> final (vignette, sharpen) =================
// Scripts are vendored (three r128 examples/js, MIT) under assets/env/ so this also works with no network.
let env_post=null;
const env_SSAO=GTC_Q==='ultra'&&!/[?&]nossao/.test(location.search);
const env_POST_FILES=['CopyShader','LuminosityHighPassShader','SSAOShader','SimplexNoise','EffectComposer','RenderPass','ShaderPass','UnrealBloomPass','SSAOPass'];
function env_loadScripts(list,done,fail){let i=0;const next=()=>{if(i>=list.length)return done();const s=document.createElement('script');s.src='assets/env/'+list[i++]+'.js';s.onload=next;s.onerror=fail;document.head.appendChild(s);};next();}
const env_FinalShader={uniforms:{tDiffuse:{value:null},uRes:{value:new THREE.Vector2(1,1)},uVig:{value:0.30},uSharp:{value:0.22}},
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:`uniform sampler2D tDiffuse;uniform vec2 uRes;uniform float uVig,uSharp;varying vec2 vUv;
  void main(){vec2 px=1.0/uRes;vec3 c=texture2D(tDiffuse,vUv).rgb;
    vec3 b=(texture2D(tDiffuse,vUv+vec2(px.x,0.)).rgb+texture2D(tDiffuse,vUv-vec2(px.x,0.)).rgb+texture2D(tDiffuse,vUv+vec2(0.,px.y)).rgb+texture2D(tDiffuse,vUv-vec2(0.,px.y)).rgb)*.25;
    c=clamp(c+(c-b)*uSharp,0.,1.);
    vec2 q=vUv-0.5;q.x*=uRes.x/uRes.y*0.8;float v=smoothstep(0.85,0.25,length(q));c*=mix(1.0-uVig,1.0,v);c=mix(c,c*vec3(1.03,0.98,0.9),1.0-v);
    gl_FragColor=vec4(c,1.0);}`};
function env_buildPost(){
  const W=innerWidth,H=innerHeight,pr=renderer.getPixelRatio();
  const msaa=renderer.capabilities.isWebGL2&&!!THREE.WebGLMultisampleRenderTarget;
  const mkMS=()=>{const t=new THREE.WebGLMultisampleRenderTarget(W*pr,H*pr,{format:THREE.RGBAFormat});t.samples=4;return t;};
  let composer,ssao=null;
  if(env_SSAO&&THREE.SSAOPass){
    composer=new THREE.EffectComposer(renderer);
    ssao=new THREE.SSAOPass(scene,camera,W*pr,H*pr);
    ssao.kernelRadius=1.6;ssao.minDistance=0.00025;ssao.maxDistance=0.004;
    if(msaa){ssao.beautyRenderTarget.dispose();ssao.beautyRenderTarget=mkMS();}
    ssao.overrideVisibility=function(){const sc=this.scene,c=this._visibilityCache;sc.traverse(o=>{c.set(o,o.visible);if(o.isPoints||o.isLine||o===env_sky||o===env_hills||(o.material&&o.material.transparent))o.visible=false;});};
    composer.addPass(ssao);
  }else{
    composer=msaa?new THREE.EffectComposer(renderer,mkMS()):new THREE.EffectComposer(renderer);
    composer.addPass(new THREE.RenderPass(scene,camera));
  }
  const bloom=new THREE.UnrealBloomPass(new THREE.Vector2(W,H),0.26,0.5,0.9);composer.addPass(bloom);
  const fin=new THREE.ShaderPass(env_FinalShader);fin.uniforms.uRes.value.set(W*pr,H*pr);composer.addPass(fin);
  env_vig.style.display='none';
  return {composer,bloom,fin,ssao,resize(){const pr=renderer.getPixelRatio();composer.setSize(innerWidth,innerHeight);fin.uniforms.uRes.value.set(innerWidth*pr,innerHeight*pr);}};
}
if(!isTouch)env_loadScripts(env_POST_FILES,()=>{try{env_post=env_buildPost();}catch(e){console.warn('post disabled',e);env_post=null;}},()=>{env_post=null;});

// ================= shadow setup on built world =================
const env_tmpBox=new THREE.Box3();
function env_tagMesh(o){
  if(o.userData.env_done)return;o.userData.env_done=true;
  if(o===env_sky||o===env_hills)return;
  if(!(o.isMesh||o.isInstancedMesh))return;
  const mats=Array.isArray(o.material)?o.material:[o.material];
  if(mats.some(m=>m.transparent))return;                 // blobs, markers, particles
  if(o.geometry&&o.geometry.parameters&&o.geometry.parameters.width>=1000){o.receiveShadow=true;return;} // ground plane
  if(mats.every(m=>m.isMeshBasicMaterial||m.isShaderMaterial))return; // signs, lights, sky-like
  if(o.isInstancedMesh){o.castShadow=true;o.receiveShadow=true;return;}
  const g=o.geometry;if(!g.boundingBox)g.computeBoundingBox();
  const bb=g.boundingBox;
  if(bb.max.y-bb.min.y<0.6){o.receiveShadow=true;o.castShadow=false;return;}   // roads, sidewalks, parks, water
  o.castShadow=true;o.receiveShadow=true;
}
function env_scan(){scene.traverse(env_tagMesh);}
function envPostBuild(){env_scan();}
let env_scanT=0;

// ================= day / night cycle (driven by game.js gameMin, 1 game minute per real second) =================
// Sun from a simple solar model for Chișinău (lat 47°, declination 12°: sunrise ~5:35, sunset ~19:25, noon 55° high).
// Palette keyed by sun height e (sin elevation). Each stop: [e, fog/horizon, zenith, mid sky, hemi sky, hemi ground, hemi I, light colour, light I, clouds].
// Light below the horizon is the moon (opposite the sun). The 'day' stop is the original fixed afternoon look.
const env_TOD=[
  [-0.30,0x0f1522,0x02050e,0x0a1226,0x4a5c88,0x1e1e26,0.42,0x9fb4ff,0.26,0x141a28],
  [-0.06,0x3a3a50,0x15204a,0x3e4270,0x8088b4,0x40383c,0.40,0x9fb4ff,0.00,0x4a4660],
  [ 0.00,0xc98d70,0x34589a,0xb89892,0xb0a8c4,0x6a5848,0.44,0xff8040,0.00,0xf0a088],
  [ 0.10,0xdcc2a4,0x4c7cc2,0xb6c0d2,0xc0cce0,0x7d6a52,0.48,0xffb46e,0.72,0xffe6cc],
  [ 0.35,FOGC,    0x5a8fd0,0x9bbde0,0xc2d6ee,0x7d705a,0.50,0xffdcaa,0.86,0xffffff]].map(r=>r.map((v,i)=>[1,2,3,4,5,7,9].includes(i)?new THREE.Color(v):v));
const env_LAT=47*Math.PI/180,env_DEC=12*Math.PI/180,env_FOG0=new THREE.Color(FOGC),env_tc=new THREE.Color();
const env_nightU={value:0},env_dayU={value:1},env_lightsU={value:0},env_litU={value:.5}; // env_litU: share of lit windows at night (follows the hour)
const env_LIT=[[0,.32],[1.5,.2],[3,.1],[5,.12],[6.5,.35],[8,.2],[17,.4],[19,.62],[22,.55],[23.5,.4],[24,.32]]; // env_lightsU: street lamps / headlights on (0..1), from sunset // shared with facades (lit windows) / vehicles (reflections)
let env_hour=-1,env_gameMin=17.5*60; // game.js updHUD writes the clock here (its gameMin is local to main())
function env_tod(hour){
  const H=(hour-12.5)/12*Math.PI,cl=Math.cos(env_LAT),sl=Math.sin(env_LAT),cd=Math.cos(env_DEC),sdc=Math.sin(env_DEC);
  const up=sl*sdc+cl*cd*Math.cos(H),east=-cd*Math.sin(H),north=cl*sdc-sl*cd*Math.cos(H);
  const sd=new THREE.Vector3(east,up,-north).normalize(),e=sd.y;env_skyU.uSun.value.copy(sd);
  let k=0;while(k<env_TOD.length-2&&e>env_TOD[k+1][0])k++;const A=env_TOD[k],B=env_TOD[k+1],f=clamp((e-A[0])/(B[0]-A[0]),0,1);
  const L=(i,out)=>out.copy(A[i]).lerp(B[i],f),N=i=>A[i]+(B[i]-A[i])*f;
  L(1,scene.fog.color);scene.background.copy(scene.fog.color);env_skyU.uHor.value.copy(scene.fog.color);
  L(2,env_skyU.uZen.value);L(3,env_skyU.uMid.value);L(9,env_skyU.uCloud.value);
  L(4,env_hemi.color);L(5,env_hemi.groundColor);env_hemi.intensity=N(6);L(7,sun.color);sun.intensity=N(8);
  env_amb.intensity=0.05*clamp(e*4+1,0.3,1);
  const fc=scene.fog.color;env_hills.material.color.setRGB(fc.r/env_FOG0.r,fc.g/env_FOG0.g,fc.b/env_FOG0.b);
  env_sunDir.copy(e>=0?sd:sd.negate());if(env_sunDir.y<0.08){env_sunDir.y=0.08;env_sunDir.normalize();} // light never from below
  env_U.crossVectors(env_sunDir,new THREE.Vector3(0,1,0)).normalize();env_V.crossVectors(env_U,env_sunDir).normalize();
  for(let i=1;i<env_LIT.length;i++)if(hour<=env_LIT[i][0]){const [h0,a]=env_LIT[i-1],[h1,b]=env_LIT[i];env_litU.value=a+(b-a)*(hour-h0)/(h1-h0);break;}
  env_nightU.value=env_skyU.uNight.value=clamp((0.02-e)/0.2,0,1);env_lightsU.value=clamp((0.04-e)/0.1,0,1);env_dayU.value=clamp((e+0.1)/0.3,0.08,1);
  if(typeof st_poolMat!=='undefined'&&st_poolMat){st_poolMat.visible=env_lightsU.value>0.01;st_poolMat.color.setRGB(.42,.33,.18).multiplyScalar(env_lightsU.value);}
  if(typeof veh_MATS!=='undefined')for(const m of veh_MATS.values())m.envMapIntensity=0.45*env_dayU.value;
}

// ================= per-frame =================
const env_fwd=new THREE.Vector3(),env_U=new THREE.Vector3(),env_V=new THREE.Vector3(),env_T=new THREE.Vector3();
env_U.crossVectors(env_sunDir,new THREE.Vector3(0,1,0)).normalize();env_V.crossVectors(env_U,env_sunDir).normalize();
let env_time=0;
function envUpdate(dt){
  env_time+=dt||0;env_skyU.uTime.value=env_time;
  {const h=(env_gameMin/60)%24;if(Math.abs(h-env_hour)>0.02){env_hour=h;env_tod(h);}} // ~every 1.2 game min
  env_sky.position.set(camera.position.x,0,camera.position.z);
  env_hills.visible=!HM; // real relief replaces the fake hills ring when a heightmap is loaded
  env_hills.position.set(camera.position.x,0,camera.position.z);
  // shadow box centred a bit ahead of the camera on the ground, snapped to shadow texels (no shimmer)
  camera.getWorldDirection(env_fwd);env_fwd.y=0;if(env_fwd.lengthSq()<1e-6)env_fwd.set(0,0,1);env_fwd.normalize();
  env_T.set(camera.position.x+env_fwd.x*env_SR*.55,0,camera.position.z+env_fwd.z*env_SR*.55);env_T.y=groundY(env_T.x,env_T.z);
  const tex=2*env_SR/env_SMAP;const a=env_T.dot(env_U),b=env_T.dot(env_V);
  env_T.addScaledVector(env_U,Math.round(a/tex)*tex-a).addScaledVector(env_V,Math.round(b/tex)*tex-b);
  sun.target.position.copy(env_T);sun.position.copy(env_T).addScaledVector(env_sunDir,420);sun.target.updateMatrixWorld();
  env_scanT-=dt||0;if(env_scanT<=0){env_scanT=2.5;env_scan();}
}
function envRender(dt){renderer.info.reset();if(++env_shF>=env_SHN){env_shF=0;renderer.shadowMap.needsUpdate=true;}if(env_post){try{env_post.composer.render(dt);return;}catch(e){console.warn('post failed, falling back',e);env_post=null;env_vig.style.display='';}}renderer.render(scene,camera);}
