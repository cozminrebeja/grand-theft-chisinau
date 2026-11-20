'use strict';
// Ground, parks, water, roads, sidewalks, kerbs, markings, crossings, street furniture, trolley catenary, stops. Owner: STREETS agent.
let roads=[],stops=[];
const RG=24,rgrid=new Map(),segs=[];
let st_stamp=0;
function nearestSeg(x,z,maxd,filter){let best=null,bd=maxd*maxd;const sm=++st_stamp;
  for(let i=Math.floor((x-maxd)/RG);i<=Math.floor((x+maxd)/RG);i++)for(let j=Math.floor((z-maxd)/RG);j<=Math.floor((z+maxd)/RG);j++){const c=rgrid.get(gk(i,j));if(!c)continue;
    for(const s of c){if(s.st===sm)continue;s.st=sm;if(filter&&!filter(s))continue;const dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1],l2=dx*dx+dz*dz||1e-9;let t=((x-s.a[0])*dx+(z-s.a[1])*dz)/l2;t=clamp(t,0,1);
      const qx=s.a[0]+dx*t,qz=s.a[1]+dz*t,d=(x-qx)**2+(z-qz)**2;if(d<bd){bd=d;best={s,qx,qz,d:Math.sqrt(d),t};}}}
  return best;}

// ===================================================================================
// Surface atlas: one texture, one material for every ground surface (+ fences, manholes, grates).
// Each vertex carries a 'tile' attribute (atlas cell origin); the shader wraps uv inside the cell (fract)
// and samples with textureGrad so mip-mapping has no seams.
// ===================================================================================
const st_TS=512,st_PAD=16,st_AN=4,st_AS=st_TS*st_AN;
const st_TILES={ASPH:[0,0],ASPH2:[1,0],SIDEWALK:[2,0],KERB:[3,0],PAVE:[0,1],GRASS:[1,1],GRAVEL:[2,1],PAINT:[3,1],DIRT:[0,2],FENCE:[1,2],MANHOLE:[2,2],GRATE:[3,2],TACTILE:[0,3],CONC:[1,3],STONE:[2,3],PAVE2:[3,3]};
const st_T={};for(const k in st_TILES){const [cx,cy]=st_TILES[k];st_T[k]=[cx*st_TS/st_AS,1-(cy+1)*st_TS/st_AS];}
let st_seed=777;const st_R=()=>{st_seed=(st_seed*16807)%2147483647;return (st_seed-1)/2147483646;};
// fast tileable fBm field via canvas bilinear up-scaling of small random grids (seamless: 3x3 tiled source)
function st_field(base,oct){const S=st_TS,F=new Float32Array(S*S);let tot=0,amp=1;const big=document.createElement('canvas');big.width=big.height=S;const bg=big.getContext('2d');bg.imageSmoothingEnabled=true;bg.imageSmoothingQuality='high';
  for(let o=0;o<oct;o++){const gs=Math.min(S,base<<o);const sm=document.createElement('canvas');sm.width=sm.height=gs*3;const sg=sm.getContext('2d');const im=sg.createImageData(gs,gs);
    for(let i=0;i<gs*gs;i++){const v=Math.random()*255;im.data[i*4]=im.data[i*4+1]=im.data[i*4+2]=v;im.data[i*4+3]=255;}
    for(let a=0;a<3;a++)for(let b=0;b<3;b++)sg.putImageData(im,a*gs,b*gs);
    bg.clearRect(0,0,S,S);bg.drawImage(sm,gs-.5,gs-.5,gs,gs,0,0,S,S);const d=bg.getImageData(0,0,S,S).data;for(let i=0;i<S*S;i++)F[i]+=d[i*4]/255*amp;tot+=amp;amp*=.5;}
  for(let i=0;i<S*S;i++)F[i]/=tot;return F;}
function st_fbm(rnd,base=4,oct=4){const F=st_field(base,oct),S=st_TS;return (x,y)=>F[(Math.min(S-1,y*S|0))*S+Math.min(S-1,x*S|0)];}
function st_tileCanvas(paint){const c=document.createElement('canvas');c.width=c.height=st_TS;const g=c.getContext('2d');paint(g,st_TS);return c;}
// draw fn 9 times so shapes that cross the tile border wrap seamlessly
function st_W(g,S,fn){for(const dx of[-S,0,S])for(const dy of[-S,0,S]){g.save();g.translate(dx,dy);fn();g.restore();}}
function st_pix(g,S,f){const st_Rs=st_R;const im=g.getImageData(0,0,S,S),d=im.data;for(let y=0;y<S;y++)for(let x=0;x<S;x++){const i=(y*S+x)*4;const c=f(x/S,y/S,d[i],d[i+1],d[i+2],d[i+3]);d[i]=c[0];d[i+1]=c[1];d[i+2]=c[2];d[i+3]=c.length>3?c[3]:255;}g.putImageData(im,0,0);}
function st_crack(g,S,x,y,len,w,col){g.strokeStyle=col;g.lineWidth=w;g.lineCap='round';g.beginPath();g.moveTo(x,y);let a=st_R()*TAU;
  for(let i=0;i<len;i++){a+=(Math.random()-.5)*1.1;x+=Math.cos(a)*6;y+=Math.sin(a)*6;g.lineTo(x,y);if(st_R()<.08){g.stroke();g.lineWidth=w*.6;g.beginPath();g.moveTo(x,y);}}g.stroke();}
function st_asphalt(g,S,base,cracks,patches){const n=st_fbm(st_R,4,5),n2=st_fbm(st_R,16,3);
  st_pix(g,S,(x,y)=>{let v=base+(n(x,y)-.5)*26+(n2(x,y)-.5)*14+(Math.random()-.5)*22;if(st_R()<.035)v+=26+st_R()*30;if(st_R()<.02)v-=20;return [v,v+1,v+4];});
  for(let k=0;k<patches;k++){const x=st_R()*S,y=st_R()*S,w=60+st_R()*140,h=40+st_R()*90,d=(Math.random()-.5)*22;
    st_W(g,S,()=>{g.fillStyle=d>0?`rgba(120,120,124,${.05+Math.abs(d)/300})`:`rgba(10,10,12,${.06+Math.abs(d)/250})`;g.fillRect(x,y,w,h);g.strokeStyle='rgba(15,15,17,.3)';g.lineWidth=2;g.strokeRect(x,y,w,h);});}
  for(let k=0;k<cracks;k++){const x=st_R()*S,y=st_R()*S,l=8+st_R()*26;st_W(g,S,()=>st_crack(g,S,x,y,l,1.6,'rgba(12,12,14,.75)'));}
  for(let k=0;k<cracks/2;k++){const x=st_R()*S,y=st_R()*S;st_W(g,S,()=>{g.strokeStyle='rgba(5,5,6,.6)';g.lineWidth=3;g.beginPath();g.moveTo(x,y);g.bezierCurveTo(x+40,y+(Math.random()-.5)*60,x+80,y+(Math.random()-.5)*60,x+130,y+(Math.random()-.5)*40);g.stroke();});}}
function st_buildAtlas(){const A=document.createElement('canvas');A.width=A.height=st_AS;const ag=A.getContext('2d');const IS=st_TS-2*st_PAD;
  const put=(k,c)=>{const [cx,cy]=st_TILES[k];const x0=cx*st_TS,y0=cy*st_TS;ag.save();ag.beginPath();ag.rect(x0,y0,st_TS,st_TS);ag.clip();
    for(const dx of[-1,0,1])for(const dy of[-1,0,1])ag.drawImage(c,x0+st_PAD+dx*IS,y0+st_PAD+dy*IS,IS,IS);ag.restore();};
  put('ASPH',st_tileCanvas((g,S)=>st_asphalt(g,S,62,4,2)));
  put('ASPH2',st_tileCanvas((g,S)=>st_asphalt(g,S,80,12,5)));
  put('SIDEWALK',st_tileCanvas((g,S)=>{const n=st_fbm(st_R,4,4);const q=S/4;const tone=[];for(let i=0;i<16;i++)tone.push((Math.random()-.5)*22);
    st_pix(g,S,(x,y)=>{const t=tone[Math.floor(y*4)*4+Math.floor(x*4)];let v=168+t+(n(x,y)-.5)*20+(Math.random()-.5)*18;return [v+3,v+1,v-6];});
    g.fillStyle='rgba(70,66,60,.85)';for(let i=0;i<4;i++){g.fillRect(i*q-1.5,0,3,S);g.fillRect(0,i*q-1.5,S,3);}g.fillRect(S-1.5,0,2,S);g.fillRect(0,S-1.5,S,2);
    g.fillStyle='rgba(230,226,218,.35)';for(let i=0;i<4;i++){g.fillRect(i*q+2,0,1.5,S);g.fillRect(0,i*q+2,S,1.5);}
    for(let k=0;k<4;k++){const sx=Math.floor(st_R()*4)*q,sy=Math.floor(st_R()*4)*q;st_crack(g,S,sx+q*.2+st_R()*q*.6,sy+q*.3,5,1.4,'rgba(60,56,50,.8)');}
    for(let k=0;k<10;k++){const x=st_R()*S,y=st_R()*S,r=6+st_R()*30;st_W(g,S,()=>{const gr=g.createRadialGradient(x,y,1,x,y,r);gr.addColorStop(0,'rgba(60,55,45,.22)');gr.addColorStop(1,'rgba(60,55,45,0)');g.fillStyle=gr;g.beginPath();g.arc(x,y,r,0,TAU);g.fill();});}
    for(let k=0;k<30;k++){g.fillStyle='rgba(40,40,40,.5)';g.beginPath();g.arc(st_R()*S,st_R()*S,1.5+st_R()*1.5,0,TAU);g.fill();}}));
  put('KERB',st_tileCanvas((g,S)=>{const n=st_fbm(st_R,8,4);st_pix(g,S,(x,y)=>{let v=176+(n(x,y)-.5)*30+(Math.random()-.5)*30;if(st_R()<.05)v-=30;const top=y<.18?14:0;return [v+top,v+top,v+top+2];});
    g.fillStyle='rgba(55,55,55,.9)';g.fillRect(0,0,4,S);g.fillStyle='rgba(30,30,30,.25)';g.fillRect(0,S*.82,S,S*.18);}));
  put('PAVE',st_tileCanvas((g,S)=>{g.fillStyle='#8f877c';g.fillRect(0,0,S,S);const bw=S/16,bh=S/32;
    for(let r=0;r<32;r++)for(let c=0;c<17;c++){const x=c*bw-(r%2?bw/2:0),y=r*bh;const red=Math.random()<.18;let v=(Math.random()-.5)*22;
      g.fillStyle=red?`rgb(${150+v},${118+v*.6},${104+v*.5})`:`rgb(${158+v},${154+v},${146+v})`;g.fillRect(x+1.2,y+1.2,bw-2.4,bh-2.4);g.fillStyle='rgba(255,255,255,.12)';g.fillRect(x+1.2,y+1.2,bw-2.4,1.5);}
    const n=st_fbm(st_R,4,3);st_pix(g,S,(x,y,r,gg,b)=>{const k=.85+n(x,y)*.3+(Math.random()-.5)*.08;return [r*k,gg*k,b*k];});}));
  put('PAVE2',st_tileCanvas((g,S)=>{g.fillStyle='#7d786f';g.fillRect(0,0,S,S);const q=S/8;
    for(let r=0;r<8;r++)for(let c=0;c<8;c++){let v=(Math.random()-.5)*24;g.fillStyle=`rgb(${150+v},${147+v},${140+v})`;g.fillRect(c*q+2,r*q+2,q-4,q-4);}
    const n=st_fbm(st_R,4,3);st_pix(g,S,(x,y,r,gg,b)=>{const k=.85+n(x,y)*.3+(Math.random()-.5)*.1;return [r*k,gg*k,b*k];});}));
  put('GRASS',st_tileCanvas((g,S)=>{const n=st_fbm(st_R,4,5),m=st_fbm(st_R,8,3);
    st_pix(g,S,(x,y)=>{const a=n(x,y),b=m(x,y);const dirt=Math.max(0,(b-.66)*3.2);let r=62+a*40,gg=100+a*42,bb=38+a*18;r=r*(1-dirt)+120*dirt;gg=gg*(1-dirt)+102*dirt;bb=bb*(1-dirt)+70*dirt;const k=1+(Math.random()-.5)*.22;return [r*k,gg*k,bb*k];});
    for(let i=0;i<4500;i++){const x=st_R()*S,y=st_R()*S,l=3+st_R()*7,a=-Math.PI/2+(Math.random()-.5)*.9;const v=st_R();g.strokeStyle=v<.5?`rgba(${40+v*40},${85+v*60},${25},.55)`:`rgba(${110+v*40},${150+v*30},${60},.45)`;g.lineWidth=1;g.beginPath();g.moveTo(x,y);g.lineTo(x+Math.cos(a)*l,y+Math.sin(a)*l);g.stroke();}
    for(let i=0;i<40;i++){g.fillStyle=st_R()<.5?'rgba(250,245,230,.9)':'rgba(240,210,60,.9)';g.beginPath();g.arc(st_R()*S,st_R()*S,1.6,0,TAU);g.fill();}}));
  put('GRAVEL',st_tileCanvas((g,S)=>{const n=st_fbm(st_R,4,4);st_pix(g,S,(x,y)=>{const v=(n(x,y)-.5)*30+(Math.random()-.5)*30;return [176+v,160+v,126+v];});
    for(let i=0;i<1600;i++){const x=st_R()*S,y=st_R()*S,r=1+st_R()*3;const v=st_R()*70+110;g.fillStyle=`rgba(${v},${v-8},${v-22},.85)`;g.beginPath();g.ellipse(x,y,r,r*.75,st_R()*3,0,TAU);g.fill();}}));
  put('PAINT',st_tileCanvas((g,S)=>{const n=st_fbm(st_R,4,5),n2=st_fbm(st_R,32,2);st_pix(g,S,(x,y)=>{const w=n(x,y)*.8+n2(x,y)*.4;let v=236+(Math.random()-.5)*16;if(w<.42){const k=clamp((.42-w)*6,0,.85);v=v*(1-k)+70*k;}return [v,v,v-4];});}));
  put('DIRT',st_tileCanvas((g,S)=>{const n=st_fbm(st_R,4,6),m=st_fbm(st_R,8,4);st_pix(g,S,(x,y)=>{const a=n(x,y),b=m(x,y);const k=clamp((a-.42)*3,0,1);
    let r=118*(1-k)+92*k,gg=104*(1-k)+112*k,bb=78*(1-k)+58*k;const s=.8+b*.4+(Math.random()-.5)*.14;return [r*s,gg*s,bb*s];});
    for(let i=0;i<2500;i++){const x=st_R()*S,y=st_R()*S;g.strokeStyle=`rgba(${70+st_R()*40},${95+st_R()*40},40,.4)`;g.beginPath();g.moveTo(x,y);g.lineTo(x+(Math.random()-.5)*3,y-3-st_R()*5);g.stroke();}}));
  put('FENCE',st_tileCanvas((g,S)=>{g.clearRect(0,0,S,S);g.fillStyle='#1d1f21';g.fillRect(0,S*.1,S,10);g.fillRect(0,S*.86,S,12);g.fillRect(0,S*.52,S,6);
    for(let x=0;x<S;x+=S/16){g.fillRect(x-2.5,S*.06,5,S*.9);g.beginPath();g.moveTo(x-6,S*.07);g.lineTo(x,S*.01);g.lineTo(x+6,S*.07);g.fill();}
    g.fillRect(0,S*.02,10,S*.98);g.fillRect(S-10,S*.02,10,S*.98);g.fillRect(S/2-8,S*.02,16,S*.98);
    for(let x=S/32;x<S;x+=S/16){g.strokeStyle='#1d1f21';g.lineWidth=4;g.beginPath();g.arc(x,S*.3,S/40,0,TAU);g.stroke();}}));
  put('MANHOLE',st_tileCanvas((g,S)=>{g.clearRect(0,0,S,S);const c=S/2;g.fillStyle='#4a4a4c';g.beginPath();g.arc(c,c,S*.48,0,TAU);g.fill();g.fillStyle='#2e2f31';g.beginPath();g.arc(c,c,S*.42,0,TAU);g.fill();
    g.strokeStyle='#5b5b5e';g.lineWidth=7;for(let r=S*.1;r<S*.4;r+=S*.075){g.beginPath();g.arc(c,c,r,0,TAU);g.stroke();}for(let a=0;a<12;a++){g.beginPath();g.moveTo(c,c);g.lineTo(c+Math.cos(a/12*TAU)*S*.4,c+Math.sin(a/12*TAU)*S*.4);g.stroke();}
    g.fillStyle='#2e2f31';g.fillRect(c-S*.2,c-S*.05,S*.4,S*.1);g.fillStyle='#6a6a6c';g.font='bold 34px Arial';g.textAlign='center';g.textBaseline='middle';g.fillText('APĂ-CANAL',c,c+2);
    st_pix(g,S,(x,y,r,gg,b,a)=>{const k=(Math.random()-.5)*30;return [r+k,gg+k,b+k,a];});}));
  put('GRATE',st_tileCanvas((g,S)=>{g.fillStyle='#58595b';g.fillRect(0,0,S,S);g.fillStyle='#141516';for(let i=0;i<9;i++)g.fillRect(S*.08+i*S*.096,S*.12,S*.06,S*.76);
    g.strokeStyle='#707174';g.lineWidth=10;g.strokeRect(5,5,S-10,S-10);st_pix(g,S,(x,y,r,gg,b)=>{const k=(Math.random()-.5)*26;return [r+k,gg+k-2,b+k-6];});}));
  put('TACTILE',st_tileCanvas((g,S)=>{g.fillStyle='#c79a2a';g.fillRect(0,0,S,S);const q=S/8;for(let r=0;r<8;r++)for(let c=0;c<8;c++){const x=c*q+q/2,y=r*q+q/2;
    const gr=g.createRadialGradient(x-5,y-5,2,x,y,q*.33);gr.addColorStop(0,'#f2cf62');gr.addColorStop(1,'#9a7414');g.fillStyle=gr;g.beginPath();g.arc(x,y,q*.32,0,TAU);g.fill();}
    st_pix(g,S,(x,y,r,gg,b)=>{const k=(Math.random()-.5)*22;return [r+k,gg+k,b+k];});}));
  put('CONC',st_tileCanvas((g,S)=>{const n=st_fbm(st_R,4,5);st_pix(g,S,(x,y)=>{const v=176+(n(x,y)-.5)*36+(Math.random()-.5)*16;return [v,v-1,v-5];});g.fillStyle='rgba(80,78,72,.7)';g.fillRect(0,0,3,S);}));
  put('STONE',st_tileCanvas((g,S)=>{g.fillStyle='#6d685e';g.fillRect(0,0,S,S);const rows=6,h=S/rows;for(let r=0;r<rows;r++){let x=-(r%2)*40;while(x<S){const w=60+st_R()*90;const v=(Math.random()-.5)*40;
      g.fillStyle=`rgb(${150+v},${143+v},${128+v})`;st_W(g,S,()=>g.fillRect(x+3,r*h+3,w-6,h-6));x+=w;}}
    st_pix(g,S,(x,y,r,gg,b)=>{const k=(Math.random()-.5)*28;return [r+k,gg+k,b+k];});}));
  const t=new THREE.CanvasTexture(A);t.anisotropy=Math.min(16,renderer.capabilities.getMaxAnisotropy());t.minFilter=THREE.LinearMipmapLinearFilter;return t;}
let st_atlas=null,st_mat=null;
const st_PH0={uPh:{value:null},uPh0:{value:new THREE.Vector2()},uPhS:{value:500},uPhOn:{value:0}},ST_PHK=1.05;  // photo brightness vs. the lit procedural surfaces
// per-tile aerial photo (world/photo, tools/data/make_photo_tiles.py): one texture per tile object, shared by the ground (st_photoMat)
// and low roofs (facades.js fac_photoMat); arrives async (uPhOn=0 until then), disposed on unload
function st_photoU(t){if(t.ph!==undefined)return t.ph;if(t.key==='all'||!isFinite(t.x0)||!(D.tiles&&D.tiles[t.key]))return t.ph=null;
  const u={uPh:{value:null},uPh0:{value:new THREE.Vector2(t.x0,t.z0)},uPhS:{value:t.x1-t.x0},uPhOn:{value:0}};
  new THREE.TextureLoader().load((WORLD.base||'world/')+'photo/'+(t.lod==='far'?'lo/':'')+t.key+'.webp',tex=>{
    if(t.state==='unloaded'){tex.dispose();return;}tex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());u.uPh.value=tex;u.uPhOn.value=1;},undefined,()=>{});
  return t.ph=u;}
// ground material: same shader program as st_mat (cache key), the tile's photo uniforms
function st_photoMat(t){const u=st_photoU(t);if(!u)return null;
  const m=st_mat.clone();m.onBeforeCompile=st_mat.onBeforeCompile;m.customProgramCacheKey=st_mat.customProgramCacheKey;m.userData.ph=u;return m;}
function streetsUnloadTile(t){if(t.stPhM){t.stPhM.dispose();t.stPhM=null;}if(t.ph){if(t.ph.uPh.value)t.ph.uPh.value.dispose();t.ph=null;}}
function st_makeMat(){st_atlas=st_buildAtlas();
  const m=new THREE.MeshLambertMaterial({map:st_atlas,vertexColors:true,side:THREE.DoubleSide,alphaTest:.5});
  const K=((st_TS-2*st_PAD)/st_AS).toFixed(6),P0=(st_PAD/st_AS).toFixed(6);
  // aerial photo (js: st_photo*): ground, parks, plazas/pedestrian and parking/service surfaces take the tile's photo by world
  // position, faded in from 30 to 110 m (0.5 m photo pixels and baked shadows smear up close); roads, pavements, kerbs, markings stay procedural
  const ph=k=>`(abs(vStTile.x-${st_T[k][0].toFixed(6)})+abs(vStTile.y-${st_T[k][1].toFixed(6)})<.001)`;
  m.onBeforeCompile=function(sh){Object.assign(sh.uniforms,this.userData.ph||st_PH0);
    sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute vec2 tile;\nvarying vec2 vStTile;\nvarying vec3 vStW;\nvarying float vStD;').replace('#include <uv_vertex>','#include <uv_vertex>\nvStTile=tile;')
      .replace('#include <project_vertex>','#include <project_vertex>\nvStW=(modelMatrix*vec4(transformed,1.0)).xyz;vStD=length(mvPosition.xyz);');
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vStTile;\nvarying vec3 vStW;\nvarying float vStD;\nuniform sampler2D uPh;uniform vec2 uPh0;uniform float uPhS,uPhOn;').replace('#include <map_fragment>',`
      vec2 stA=vStTile+${P0}+fract(vUv)*${K};
      #if __VERSION__>=300
        vec4 texelColor=textureGrad(map,stA,dFdx(vUv)*${K},dFdy(vUv)*${K});
      #else
        vec4 texelColor=texture2D(map,stA);
      #endif
      texelColor=mapTexelToLinear(texelColor);diffuseColor*=texelColor;
      if(uPhOn>.5&&(${ph('DIRT')}||${ph('GRASS')}||${ph('PAVE')}||${ph('ASPH2')})){vec2 pu=(vStW.xz-uPh0)/uPhS;
        vec3 phc=texture2D(uPh,vec2(pu.x,1.0-pu.y)).rgb*(.72+.56*dot(texelColor.rgb,vec3(.3,.59,.11)))*${ST_PHK.toFixed(3)};
        diffuseColor.rgb=mix(diffuseColor.rgb,phc,smoothstep(30.,110.,vStD));}`);};
  m.customProgramCacheKey=()=>'st_atlas';st_mat=m;}

// ---- geometry accumulator for the atlas material ----
class St_G{constructor(){this.n0=0;this.cap=0;this.x0=1e9;this.x1=-1e9;this.z0=1e9;this.z1=-1e9;this._grow(8192);}
  _grow(c){const o=this,P=new Float32Array(c*3),N=new Float32Array(c*3),U=new Float32Array(c*2),C=new Float32Array(c*3),T=new Float32Array(c*2);
    if(o.cap){P.set(o.P);N.set(o.N);U.set(o.U);C.set(o.C);T.set(o.T);}o.P=P;o.N=N;o.U=U;o.C=C;o.T=T;o.cap=c;}
  get p(){return {length:this.n0*3};}
  v(x,y,z,nx,ny,nz,u,w,col,tl){if(this.n0>=this.cap)this._grow(this.cap*2);const k=this.n0++,k3=k*3,k2=k*2;
    this.P[k3]=x;this.P[k3+1]=y;this.P[k3+2]=z;this.N[k3]=nx;this.N[k3+1]=ny;this.N[k3+2]=nz;this.U[k2]=u;this.U[k2+1]=w;this.C[k3]=col.r;this.C[k3+1]=col.g;this.C[k3+2]=col.b;this.T[k2]=tl[0];this.T[k2+1]=tl[1];}
  mesh(mat){const n=this.n0,g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(this.P.slice(0,n*3),3));g.setAttribute('normal',new THREE.BufferAttribute(this.N.slice(0,n*3),3));
    g.setAttribute('uv',new THREE.BufferAttribute(this.U.slice(0,n*2),2));g.setAttribute('color',new THREE.BufferAttribute(this.C.slice(0,n*3),3));g.setAttribute('tile',new THREE.BufferAttribute(this.T.slice(0,n*2),2));
    g.computeBoundingSphere();const m=new THREE.Mesh(g,mat);m.matrixAutoUpdate=false;m.updateMatrix();return m;}}
// current tile's surface accumulator (one atlas mesh per tile)
let st_cur=null;
function st_g(x,z){return st_cur;}
const st_col=h=>new THREE.Color(h);
const st_WHITE=st_col(0xffffff);
// flat triangle (normal up), world-space uv (metres / scale)
// ---- terrain draping (TERRAIN.md): every ground-level vertex gets groundY(x,z) added; long edges are subdivided first ----
const st_gy=(x,z)=>typeof groundY==='function'?groundY(x,z):0;
const st_MAXE=7;let st_maxe2=49; // current max edge² for draped triangles (areas use a coarser value)
let st_noDrape=false;
// bridges (js/bridges.js): road-level geometry on a bridge span takes the deck height; terrain/areas/footways/water never do
let st_bridgeOK=false,st_dx=null,st_dz=null; // st_dx/st_dz: travel direction of the segment being emitted (null = any)
const st_sy=(x,z)=>{if(st_bridgeOK&&typeof onBridge==='function'){const h=onBridge(x,z,st_dx,st_dz);if(h)return h.y;}return st_gy(x,z);};
const st_setDir=(a,b)=>{if(a&&b){st_dx=b[0]-a[0];st_dz=b[1]-a[1];}else st_dx=st_dz=null;}; // set while emitting things that must stay flat at an absolute height (water)
function st_ftri(g,y,x0,z0,x1,z1,x2,z2,tl,sc,col){if((z1-z0)*(x2-x0)-(x1-x0)*(z2-z0)<0){let t=x1;x1=x2;x2=t;t=z1;z1=z2;z2=t;}
  st_ftriD(g,y,x0,z0,x1,z1,x2,z2,tl,sc,col);}
// leaf emitter: drape 3 vertices, flat face normal of the draped triangle
function st_emit(g,y,x0,z0,x1,z1,x2,z2,tl,sc,col){if((z1-z0)*(x2-x0)-(x1-x0)*(z2-z0)<0){let t=x1;x1=x2;x2=t;t=z1;z1=z2;z2=t;}
  const y0=y+st_sy(x0,z0),y1=y+st_sy(x1,z1),y2=y+st_sy(x2,z2);
  const ux=x1-x0,uy=y1-y0,uz=z1-z0,vx=x2-x0,vy=y2-y0,vz=z2-z0;let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;if(ny<0){nx=-nx;ny=-ny;nz=-nz;}const l=Math.hypot(nx,ny,nz)||1;nx/=l;ny/=l;nz/=l;
  g.v(x0,y0,z0,nx,ny,nz,x0/sc,z0/sc,col,tl);g.v(x1,y1,z1,nx,ny,nz,x1/sc,z1/sc,col,tl);g.v(x2,y2,z2,nx,ny,nz,x2/sc,z2/sc,col,tl);}
// bounded uniform subdivision (n² sub-triangles, n = longest edge / max edge, ≤ 12) — no sliver fans
function st_ftriD(g,y,x0,z0,x1,z1,x2,z2,tl,sc,col){const m=Math.max((x1-x0)**2+(z1-z0)**2,(x2-x1)**2+(z2-z1)**2,(x0-x2)**2+(z0-z2)**2);
  const n=Math.min(12,Math.ceil(Math.sqrt(m/st_maxe2)));if(n<=1){st_emit(g,y,x0,z0,x1,z1,x2,z2,tl,sc,col);return;}
  const P=(i,j)=>{const a=i/n,b=j/n;return [x0+(x1-x0)*a+(x2-x0)*b,z0+(z1-z0)*a+(z2-z0)*b];};
  for(let i=0;i<n;i++)for(let j=0;j<n-i;j++){const A=P(i,j),B=P(i+1,j),C=P(i,j+1);st_emit(g,y,A[0],A[1],B[0],B[1],C[0],C[1],tl,sc,col);
    if(i+j<n-1){const Dd=P(i+1,j+1);st_emit(g,y,B[0],B[1],Dd[0],Dd[1],C[0],C[1],tl,sc,col);}}}
// quad a-b-c-d (in order around): split along its long direction only (and across only if wide)
function st_fquad(g,y,ax,az,bx,bz,cx,cz,dx,dz,tl,sc,col){const E=Math.sqrt(st_maxe2);
  const l1=Math.max(Math.hypot(bx-ax,bz-az),Math.hypot(cx-dx,cz-dz)),l2=Math.max(Math.hypot(cx-bx,cz-bz),Math.hypot(dx-ax,dz-az));
  const nu=Math.max(1,Math.ceil(l1/(l1>=l2?E:E*1.6))),nv=Math.max(1,Math.ceil(l2/(l2>l1?E:E*1.6)));
  const P=(u,v)=>{const x0=ax+(bx-ax)*u,z0=az+(bz-az)*u,x1=dx+(cx-dx)*u,z1=dz+(cz-dz)*u;return [x0+(x1-x0)*v,z0+(z1-z0)*v];};
  for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){const A=P(i/nu,j/nv),B=P((i+1)/nu,j/nv),C=P((i+1)/nu,(j+1)/nv),Dd=P(i/nu,(j+1)/nv);
    st_emit(g,y,A[0],A[1],B[0],B[1],C[0],C[1],tl,sc,col);st_emit(g,y,A[0],A[1],C[0],C[1],Dd[0],Dd[1],tl,sc,col);}}
// generic quad with explicit uvs: P=[[x,y,z,u,v]x4] in order around; normal n; winding auto-fixed so front face matches n
function st_quad(g,P,n,tl,col){
  // subdivide long quads (along P0->P1 / P3->P2 and P1->P2 / P0->P3), then drape each vertex
  const L=(p,q)=>Math.hypot(q[0]-p[0],q[2]-p[2]);const nu=Math.max(1,Math.ceil(Math.max(L(P[0],P[1]),L(P[3],P[2]))/st_MAXE)),nv=Math.max(1,Math.ceil(Math.max(L(P[1],P[2]),L(P[0],P[3]))/st_MAXE));
  const lerp=(p,q,t)=>p.map((v,k)=>v+(q[k]-v)*t);const at=(u,v)=>lerp(lerp(P[0],P[1],u),lerp(P[3],P[2],u),v);
  for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){const Q=[at(i/nu,j/nv),at((i+1)/nu,j/nv),at((i+1)/nu,(j+1)/nv),at(i/nu,(j+1)/nv)];
    if(!st_noDrape)for(const q of Q)q[1]+=st_sy(q[0],q[2]);let nn=n;
    if(Math.abs(n[1])>.7&&!st_noDrape){const ux=Q[1][0]-Q[0][0],uy=Q[1][1]-Q[0][1],uz=Q[1][2]-Q[0][2],vx=Q[3][0]-Q[0][0],vy=Q[3][1]-Q[0][1],vz=Q[3][2]-Q[0][2];let cx=uy*vz-uz*vy,cy=uz*vx-ux*vz,cz=ux*vy-uy*vx;if(cy*n[1]<0){cx=-cx;cy=-cy;cz=-cz;}const l=Math.hypot(cx,cy,cz)||1;nn=[cx/l,cy/l,cz/l];}
    st_quad0(g,Q,nn,tl,col);}}
function st_quad0(g,P,n,tl,col){const a=P[0],b=P[1],c=P[2];const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
  const cx=uy*vz-uz*vy,cy=uz*vx-ux*vz,cz=ux*vy-uy*vx;const o=(cx*n[0]+cy*n[1]+cz*n[2])<0?[0,3,2,0,2,1]:[0,1,2,0,2,3];
  for(const i of o){const q=P[i];g.v(q[0],q[1],q[2],n[0],n[1],n[2],q[3],q[4],col,tl);}}
// miter offset of a polyline (positive = right of travel direction, i.e. normal (-dz,dx))
function st_off(pts,off){const n=pts.length,out=[];for(let i=0;i<n;i++){let nx=0,nz=0;
    if(i>0){const dx=pts[i][0]-pts[i-1][0],dz=pts[i][1]-pts[i-1][1],l=Math.hypot(dx,dz)||1;nx+=-dz/l;nz+=dx/l;}
    if(i<n-1){const dx=pts[i+1][0]-pts[i][0],dz=pts[i+1][1]-pts[i][1],l=Math.hypot(dx,dz)||1;nx+=-dz/l;nz+=dx/l;}
    const l=Math.hypot(nx,nz)||1;nx/=l;nz/=l;let s=off;
    if(i>0&&i<n-1){const dx=pts[i+1][0]-pts[i][0],dz=pts[i+1][1]-pts[i][1],ll=Math.hypot(dx,dz)||1;s=off/Math.max(.5,Math.abs(nx*(-dz/ll)+nz*(dx/ll)));}
    out.push([pts[i][0]+nx*s,pts[i][1]+nz*s]);}return out;}
function st_strip(pts,w,y,tl,sc,col,caps){const L=st_off(pts,w/2),Rr=st_off(pts,-w/2);
  for(let i=0;i<pts.length-1;i++){const g=st_g(pts[i][0],pts[i][1]);st_setDir(pts[i],pts[i+1]);st_fquad(g,y,L[i][0],L[i][1],Rr[i][0],Rr[i][1],Rr[i+1][0],Rr[i+1][1],L[i+1][0],L[i+1][1],tl,sc,col);}
  st_setDir();if(caps)for(const e of[pts[0],pts[pts.length-1]]){const g=st_g(e[0],e[1]),r=w/2,seg=14;for(let k=0;k<seg;k++){const a0=k/seg*TAU,a1=(k+1)/seg*TAU;st_ftri(g,y,e[0],e[1],e[0]+Math.cos(a0)*r,e[1]+Math.sin(a0)*r,e[0]+Math.cos(a1)*r,e[1]+Math.sin(a1)*r,tl,sc,col);}}}
function st_polyEar(outer,holes,y,tl,sc,col){const c=outer.map(p=>new THREE.Vector2(p[0],p[1])),h=(holes||[]).map(r=>r.map(p=>new THREE.Vector2(p[0],p[1])));
  let tris;try{tris=THREE.ShapeUtils.triangulateShape(c,h);}catch(e){return;}const all=c.concat(...h);const g=st_g(outer[0][0],outer[0][1]);
  for(const t of tris){const a=all[t[0]],b=all[t[1]],d=all[t[2]];if(a&&b&&d)st_ftri(g,y,a.x,a.y,b.x,b.y,d.x,d.y,tl,sc,col);}}
// clip a ring to an axis-aligned rectangle (Sutherland–Hodgman)
function st_clipRect(ring,x0,z0,x1,z1){let P=ring;const E=[[0,x0,1],[0,x1,-1],[1,z0,1],[1,z1,-1]];
  for(const [ax,v,sgn] of E){if(!P.length)break;const out=[];for(let i=0;i<P.length;i++){const a=P[i],b=P[(i+1)%P.length],ia=(a[ax]-v)*sgn>=0,ib=(b[ax]-v)*sgn>=0;
      if(ia)out.push(a);if(ia!==ib){const t=(v-a[ax])/(b[ax]-a[ax]);out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}}P=out;}return P;}
// areas: small polygons -> earcut + uniform subdivision; big ones -> clipped to a world-aligned grid (C = max edge) so they follow the terrain without slivers
function st_poly(outer,holes,y,tl,sc,col){let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;for(const p of outer){x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);z0=Math.min(z0,p[1]);z1=Math.max(z1,p[1]);}
  const C=Math.sqrt(st_maxe2);if(x1-x0<=2*C&&z1-z0<=2*C){st_polyEar(outer,holes,y,tl,sc,col);return;}
  const g=st_g(outer[0][0],outer[0][1]),hs=holes||[];
  for(let gx=Math.floor(x0/C)*C;gx<x1;gx+=C)for(let gz=Math.floor(z0/C)*C;gz<z1;gz+=C){
    if(hs.length&&hs.some(h=>pip(gx+C/2,gz+C/2,h)))continue;
    const P=st_clipRect(outer,gx,gz,gx+C,gz+C);if(P.length<3)continue;
    if(P.length===4&&Math.abs(Math.abs(sArea(P))-C*C)<1e-3){st_emit(g,y,P[0][0],P[0][1],P[1][0],P[1][1],P[2][0],P[2][1],tl,sc,col);st_emit(g,y,P[0][0],P[0][1],P[2][0],P[2][1],P[3][0],P[3][1],tl,sc,col);continue;}
    let tris;try{tris=THREE.ShapeUtils.triangulateShape(P.map(p=>new THREE.Vector2(p[0],p[1])),[]);}catch(e){continue;}
    for(const t of tris){const a=P[t[0]],b=P[t[1]],d=P[t[2]];if(a&&b&&d)st_emit(g,y,a[0],a[1],b[0],b[1],d[0],d[1],tl,sc,col);}}}
// ---- "is this point on another drivable road's asphalt" (for clipping sidewalks / markings at junctions) ----
function st_others(r,ax,az,bx,bz,pad){const out=[],seen=new Set();const x0=Math.min(ax,bx)-pad,x1=Math.max(ax,bx)+pad,z0=Math.min(az,bz)-pad,z1=Math.max(az,bz)+pad;
  for(let i=Math.floor(x0/RG);i<=Math.floor(x1/RG);i++)for(let j=Math.floor(z0/RG);j<=Math.floor(z1/RG);j++){const c=rgrid.get(gk(i,j));if(!c)continue;for(const s of c)if(s.r!==r&&!seen.has(s)){seen.add(s);out.push(s);}}return out;}
function st_inside(list,x,z,m){for(const s of list){const dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1],l2=dx*dx+dz*dz||1e-9;let t=((x-s.a[0])*dx+(z-s.a[1])*dz)/l2;t=t<0?0:t>1?1:t;
  const qx=s.a[0]+dx*t-x,qz=s.a[1]+dz*t-z,lim=s.r.w/2+m;if(qx*qx+qz*qz<lim*lim)return true;}return false;}
const st_Y={GROUND:-.03,PARK:.02,PARKING:.03,PLAZA:.04,FOOT:.05,SERV:.06,ROAD:.075,TRACK:.08,MARK:.088,ZEBRA:.092,MAN:.09,SW:.17,KERB:.173,TACT:.176,PED:.18};
// sidewalk width beside a drivable road
const st_sw=r=>r.w>=14?4.6:r.w>=9?3.6:2.7;
const st_crossOnRoad=new Map(); // road -> [along positions of zebra crossings]
const st_nodes=new Map();       // node id -> {x,z,arms:[{r,dir:[ux,uz],w,out}]}
function st_cum(pts){const c=[0];for(let i=1;i<pts.length;i++)c.push(c[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));return c;}

// along-polyline emission of a ribbon at lateral offset [o0,o1] (o positive = right), split into pieces where keep(s,x,z) is true.
// cb(piece) receives {i, ta, tb, sa, sb, A0,A1,B0,B1 (corner points)} per straight-segment piece.
function st_ribbon(r,o0,o1,step,keep,cb,S){const pts=r.pts,A=st_off(pts,o0),B=st_off(pts,o1),cum=r.cum;
  for(let i=0;i<pts.length-1;i++){if(S&&!S.has(i))continue;const L=cum[i+1]-cum[i];if(L<.05)continue;const n=Math.max(1,Math.ceil(L/step));
    const at=t=>[A[i][0]+(A[i+1][0]-A[i][0])*t,A[i][1]+(A[i+1][1]-A[i][1])*t],bt=t=>[B[i][0]+(B[i+1][0]-B[i][0])*t,B[i][1]+(B[i+1][1]-B[i][1])*t];
    const f=t=>keep(cum[i]+L*t,at(t),bt(t),i);st_setDir(pts[i],pts[i+1]);
    let prev=f(0),start=prev?0:null;
    const edge=(t0,t1,v0)=>{for(let k=0;k<6;k++){const tm=(t0+t1)/2;if(f(tm)===v0)t0=tm;else t1=tm;}return (t0+t1)/2;};
    for(let k=1;k<=n;k++){const t=k/n,cur=f(t);if(cur!==prev){const te=edge((k-1)/n,t,prev);if(prev){cb({i,ta:start,tb:te,sa:cum[i]+L*start,sb:cum[i]+L*te,a:at,b:bt});start=null;}else start=te;prev=cur;}}
    if(prev&&start!=null)cb({i,ta:start,tb:1,sa:cum[i]+L*start,sb:cum[i+1],a:at,b:bt});}st_setDir();}

let st_zebras=[];
function st_isMajor(N){const a=N.arms;if(a.length<3)return false;let big=0;for(const x of a)if(x.w>=8.5)big++;return big>=2&&Math.max(...a.map(x=>x.w))>=9.5;}

// ---- water with animated ripples + stone embankment ----
const st_waterUni={uTime:{value:0}};
function st_tpl(build){const b=new Bk(VC,false);build(b);return b.geo();}
const st_add=(b,geo,x,y,z,ry,col,rx=0,rz=0)=>b.add(geo,M(x,y,z,ry,rx,rz),col);
// wrap a Bk so every added part is lifted by the terrain height under its own origin
function st_drapeBk(b){const add=b.add.bind(b);b.add=(geo,m,col,faces)=>{const e=m.elements,m2=m.clone();m2.elements[13]+=st_sy(e[12],e[14]);return add(geo,m2,col,faces);};return b;}
// drape LineSegments point pairs (subdivide pieces longer than 12 m first)
function st_drapeLines(P){const out=[];for(let i=0;i<P.length;i+=6){const x0=P[i],y0=P[i+1],z0=P[i+2],x1=P[i+3],y1=P[i+4],z1=P[i+5];const n=Math.max(1,Math.ceil(Math.hypot(x1-x0,z1-z0)/12));
  for(let k=0;k<n;k++){const a=k/n,b=(k+1)/n;const xa=x0+(x1-x0)*a,za=z0+(z1-z0)*a,xb=x0+(x1-x0)*b,zb=z0+(z1-z0)*b;out.push(xa,y0+(y1-y0)*a+st_sy(xa,za),za,xb,y0+(y1-y0)*b+st_sy(xb,zb),zb);}}return out;}
let st_TPL=null;
function st_templates(){const T={};const G=0x5e6267,DK=0x2c2f33;
  // Soviet tall street lamp: octagonal tapered steel pole, curved bracket, cobra-head luminaire. Faces +z (arm reaches toward +z)
  T.lamp=st_tpl(b=>{b.add(new THREE.CylinderGeometry(.2,.24,.5,8,1,true),M(0,.25,0),0x4a4d52);b.add(new THREE.CylinderGeometry(.07,.13,9,8,1,true),M(0,4.75,0),G);
    
    const arc=[[0,9.2],[.25,9.55],[.6,9.8],[1.05,9.92],[1.6,9.95]];for(let i=0;i<arc.length-1;i++){const a=arc[i],c=arc[i+1],dz=c[0]-a[0],dy=c[1]-a[1],l=Math.hypot(dz,dy);
      b.add(new THREE.CylinderGeometry(.045,.05,l,4,1,true),M(0,(a[1]+c[1])/2,(a[0]+c[0])/2,0,Math.atan2(dz,dy)),G);}
    b.add(new THREE.SphereGeometry(.34,8,3,0,TAU,0,Math.PI/2),M(0,9.87,1.95,0,0,0,.85,.45,1.6),0x7c8187);
    b.add(new THREE.CircleGeometry(.27,8).rotateX(Math.PI/2),M(0,9.85,1.97,0,0,0,.85,1,1.5),0xfff0c4);b.add(BOX(.12,.12,.25),M(0,9.93,1.48),DK);});
  // catenary pole (trolley) with a lamp bracket toward the road (+z)
  T.cpole=st_tpl(b=>{b.add(new THREE.CylinderGeometry(.24,.3,.6,8,1,true),M(0,.3,0),0x4a4d52);b.add(new THREE.CylinderGeometry(.1,.17,8.6,8,1,true),M(0,4.9,0),0x55595e);
    b.add(new THREE.ConeGeometry(.12,.35,6,1,true),M(0,9.35,0),DK);b.add(new THREE.CylinderGeometry(.13,.13,.2,8,1,true),M(0,7.0,0),DK);
    b.add(new THREE.CylinderGeometry(.04,.045,1.9,4,1,true),M(0,8.75,.9,0,Math.PI/2*.82),0x55595e);
    b.add(new THREE.SphereGeometry(.32,8,3,0,TAU,0,Math.PI/2),M(0,8.95,1.85,0,0,0,.85,.45,1.5),0x7c8187);b.add(new THREE.CircleGeometry(.25,8).rotateX(Math.PI/2),M(0,8.93,1.86,0,0,0,.85,1,1.45),0xfff0c4);
    b.add(BOX(.25,.6,.2),M(0,2.6,.18),0x3d4146);});
  T.bench=st_tpl(b=>{for(const x of[-.75,.75]){b.add(BOX(.12,.45,.5),M(x,.225,0),0x3a3c3f);b.add(BOX(.1,.6,.08),M(x,.65,-.24,0,-.2),0x3a3c3f);}
    b.add(BOX(1.8,.05,.4),M(0,.47,-.03),0x8a5a33);b.add(BOX(1.8,.28,.04),M(0,.72,-.28,0,-.2),0x8a5a33);});
  T.bin=st_tpl(b=>{b.add(new THREE.CylinderGeometry(.24,.2,.75,8,1,true),M(0,.43,0),0x355e3b);b.add(new THREE.CylinderGeometry(.26,.26,.05,8),M(0,.81,0),0x2d4f31);});
  T.tl=st_tpl(b=>{b.add(new THREE.CylinderGeometry(.06,.07,3.2,8,1,true),M(0,1.6,0),0x2f3236);b.add(BOX(.32,.95,.24),M(0,3.0,0),0x1e2022);b.add(BOX(.42,1.05,.03),M(0,3.0,-.12),0x111213);
    for(let k=0;k<3;k++){b.add(new THREE.CylinderGeometry(.12,.12,.03,10),M(0,3.3-k*.3,.13,0,Math.PI/2),0x0e0e0e);b.add(BOX(.3,.04,.1),M(0,3.42-k*.3,.17),0x1e2022);}
    b.add(BOX(.25,.35,.18),M(.32,1.15,0),0x1e2022);b.add(BOX(.25,.3,.18),M(-.3,2.2,0),0xe8e8e8);});
  T.tlArm=st_tpl(b=>{b.add(new THREE.CylinderGeometry(.11,.14,6,8,1,true),M(0,3,0),0x2f3236);});
  T.signPed=st_tpl(b=>{b.add(new THREE.CylinderGeometry(.04,.04,2.6,6,1,true),M(0,1.3,0),0x8f9398);b.add(BOX(.62,.62,.04),M(0,2.45,.03),0x1f5fb8);b.add(BOX(.5,.5,.045),M(0,2.45,.035),0xf2f2f2);
    b.add(new THREE.CylinderGeometry(.21,.21,.05,3),M(0,2.45,.04,0,Math.PI/2,0),0x1f5fb8);});
  T.signYield=st_tpl(b=>{b.add(new THREE.CylinderGeometry(.04,.04,2.4,6,1,true),M(0,1.2,0),0x8f9398);b.add(new THREE.CylinderGeometry(.48,.48,.04,3),M(0,2.25,.03,0,Math.PI/2,Math.PI),0xc8171e);
    b.add(new THREE.CylinderGeometry(.33,.33,.045,3),M(0,2.22,.035,0,Math.PI/2,Math.PI),0xf4f4f4);});
  T.bollard=st_tpl(b=>{b.add(new THREE.CylinderGeometry(.08,.1,.9,6,1,true),M(0,.45,0),0x3b3d40);b.add(new THREE.ConeGeometry(.08,.08,6,1,true),M(0,.94,0),0x3b3d40);b.add(new THREE.CylinderGeometry(.095,.095,.06,6,1,true),M(0,.75,0),0xd8d8d8);});
  T.shelter=st_tpl(b=>{const B2=0x2b5fa8,ST=0x585d63,GL=0xa7c3d6;b.add(BOX(6.4,.16,2.2),M(0,2.75,0),0xd9dde2);b.add(BOX(6.5,.24,.08),M(0,2.75,-1.1),B2);b.add(BOX(6.5,.24,.08),M(0,2.75,1.1),B2);
    for(const x of[-3,3]){for(const z of[-.95,.95])b.add(BOX(.09,2.7,.09),M(x,1.35,z),ST);}
    b.add(BOX(6,.06,.07),M(0,.35,.98),ST);b.add(BOX(6,.06,.07),M(0,2.55,.98),ST);b.add(BOX(.06,2.2,.07),M(-.9,1.45,.98),ST);b.add(BOX(1.3,1.9,.12),M(2.2,1.3,.9),0x2e3238);b.add(BOX(1.2,1.75,.04),M(2.2,1.3,.84),0xf2e4b0);
    for(let k=0;k<3;k++)b.add(BOX(2.6,.04,.12),M(-.6,.48,.55+k*.14),0x8a5a33);for(const x of[-1.7,.5])b.add(BOX(.08,.46,.4),M(x,.23,.68),ST);
    b.add(new THREE.CylinderGeometry(.04,.04,3.2,6,1,true),M(3.6,1.6,-1.0),0x8f9398);b.add(BOX(.75,.6,.05),M(3.6,3.0,-1.0),0xf2c400);b.add(BOX(.55,.4,.055),M(3.6,3.0,-1.0),0x1d5fb4);
    b.add(BOX(6.4,.04,2.4),M(0,.18,0),0xb9b5ad);});
  return T;}
function st_free(x,z,r){if(solidAt(x,z,.5))return false;const ns=nearestSeg(x,z,r+12);if(ns&&ns.d<ns.s.r.w/2+r)return false;return true;}

// ===================================================================================
// STREAMING (WORLD.md): buildStreetsGlobal() once, then buildStreetsTile(t) / buildTransitTile(t) per 500 m tile.
// Drivable/service/pedestrian roads (kinds 0-2) are rendered from the GLOBAL road list (D.r): every road is split at
// tile borders and each segment belongs to exactly one tile (by its midpoint). Miter offsets, dash phase, lamp/drain/
// manhole spacing and per-road randomness are all computed along the whole global road, so sidewalks, kerbs and
// markings are continuous across seams. Junction context (clipping, traffic lights, stop lines) uses the global
// rgrid / node table. Footways (kind 3) come from the tile's own render pieces.
// ===================================================================================
let st_globalDone=false,st_TILE=500;
const st_tileSegs=new Map();   // tile key -> [[road, segIndex], ...]
const st_tileNodes=new Map();  // tile key -> [junction node, ...]
const st_POLES=false; // street lamps + trolley catenary poles (and their cross-span wires) switched off; contact wires stay
let st_lampMat=null,st_glassMat=null,st_wireMat=null,st_waterMat=null,st_kioskMat=null;
let st_curF=null,st_curGlass=null;
function st_f(x,z){return st_curF;}
// deterministic small RNG + string hash (tile keys, road/node ids)
function st_rng(seed){let s=(Math.abs(seed|0)%2147483646)+1;return ()=>{s=(s*16807)%2147483647;return (s-1)/2147483646;};}
function st_hash(str){let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
const st_tkey=(x,z)=>Math.floor(x/st_TILE)+'_'+Math.floor(z/st_TILE);
// insert extra vertices where a polyline crosses a tile border (ids get -1)
function st_split(pts,ids){const T=st_TILE,P=[pts[0]],I=ids?[ids[0]]:null;
  for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1],dx=b[0]-a[0],dz=b[1]-a[1],ts=[];
    for(const [ac,bc,d] of [[a[0],b[0],dx],[a[1],b[1],dz]]){const fa=Math.floor(ac/T),fb=Math.floor(bc/T);if(fa===fb||!d)continue;
      for(let k=Math.min(fa,fb)+1;k<=Math.max(fa,fb);k++){const t=(k*T-ac)/d;if(t>1e-4&&t<1-1e-4)ts.push(t);}}
    ts.sort((x,y)=>x-y);for(const t of ts){P.push([a[0]+dx*t,a[1]+dz*t]);if(I)I.push(-1);}
    P.push(b);if(I)I.push(ids[i+1]);}
  return [P,I];}
function st_kioskTexture(){
const N=['FLORI','ZIARE','CAFEA','COVRIGI','LOTO','SUCURI','ÎNGHEȚATĂ','TUTUN'],BG=['#2f8f4e','#1d4f9a','#6b3e26','#c9661a','#b3121a','#e0a400','#d23c8a','#4a4a4a'];
  const c=document.createElement('canvas');c.width=1024;c.height=512;const g=c.getContext('2d');
  for(let i=0;i<8;i++){const x0=(i%4)*256,y0=Math.floor(i/4)*256;g.fillStyle='#ecebe6';g.fillRect(x0,y0,256,256);g.fillStyle=BG[i];g.fillRect(x0,y0,256,52);
    g.fillStyle='#fff';g.font='900 34px Arial';g.textAlign='center';g.textBaseline='middle';g.fillText(N[i],x0+128,y0+28);
    const gr=g.createLinearGradient(0,y0+62,0,y0+180);gr.addColorStop(0,'#90a8bc');gr.addColorStop(1,'#2a3642');g.fillStyle=gr;g.fillRect(x0+14,y0+62,228,118);
    for(let s=0;s<3;s++)for(let k=0;k<9;k++){g.fillStyle=`hsl(${(k*47+i*30)%360},60%,${45+((k+s)%3)*12}%)`;g.fillRect(x0+20+k*25,y0+90+s*30,18,20);}
    g.fillStyle='#d6d2c8';g.fillRect(x0+14,y0+180,228,10);g.fillStyle='#bdb8ad';g.fillRect(x0,y0+190,256,66);g.fillStyle='#8b867c';g.fillRect(x0+120,y0+200,16,40);}
  return c;}
function st_waterMaterial(){const m=new THREE.MeshPhongMaterial({color:0x2f6f8f,specular:0xcfe6f2,shininess:120,transparent:true,opacity:.93});
  m.onBeforeCompile=sh=>{sh.uniforms.uTime=st_waterUni.uTime;
    sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vStW;').replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvStW=(modelMatrix*vec4(transformed,1.0)).xyz;');
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vStW;\nuniform float uTime;').replace('#include <normal_fragment_begin>',`#include <normal_fragment_begin>
      vec2 sp=vStW.xz;float t=uTime;
      vec3 rn=vec3(sin(sp.x*.37+t*1.3)*.5+sin(sp.y*.53-t*1.05)*.35+sin((sp.x+sp.y)*1.3+t*2.3)*.18+sin((sp.x*2.7-sp.y*1.9)+t*3.1)*.08,0.,
                   cos(sp.y*.41+t*1.2)*.5+cos(sp.x*.61-t*.9)*.35+cos((sp.x-sp.y)*1.1-t*1.9)*.18+cos((sp.y*2.3+sp.x*1.7)-t*2.7)*.08)*.16;
      normal=normalize(normal+(viewMatrix*vec4(rn,0.)).xyz);`).replace('#include <dithering_fragment>',`#include <dithering_fragment>
      float fr=pow(1.0-abs(dot(normalize(vViewPosition),normal)),3.0);gl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(.62,.76,.86),fr*.55);`);};
  m.customProgramCacheKey=()=>'st_water';return m;}

function buildStreetsGlobal(){
  if(st_globalDone)return;st_globalDone=true;st_TILE=(typeof WORLD!=='undefined'&&WORLD.T)||D.tile||500;
  st_makeMat();st_TPL=st_templates();
  st_lampMat=new THREE.MeshLambertMaterial({vertexColors:true});
  st_glassMat=new THREE.MeshPhongMaterial({vertexColors:true,transparent:true,opacity:.32,shininess:90,specular:0xffffff,depthWrite:false,side:THREE.DoubleSide});
  st_wireMat=new THREE.LineBasicMaterial({color:0x1d1d1d});st_waterMat=st_waterMaterial();
  {const tex=new THREE.CanvasTexture(st_kioskTexture());tex.anisotropy=8;st_kioskMat=new THREE.MeshLambertMaterial({map:tex,vertexColors:true});}
  roads=[];
  D.r.forEach((q,idx)=>{const [pts,ids]=st_split(dec(q[6]),q[5]);const r={kind:q[0],w:q[1],ow:q[2],name:D.names[q[3]]||'',tw:q[4],ids,pts,idx};r.cum=st_cum(pts);roads.push(r);});
  for(const r of roads){if(r.kind===3||r.pts.length<2)continue;
    for(let i=0;i<r.pts.length-1;i++){const a=r.pts[i],b=r.pts[i+1];const k=st_tkey((a[0]+b[0])/2,(a[1]+b[1])/2);let L=st_tileSegs.get(k);if(!L){L=[];st_tileSegs.set(k,L);}L.push(r,i);
      if(r.kind!==0)continue;const s={r,a,b,st:0};segs.push(s);
      const x0=Math.min(a[0],b[0]),x1=Math.max(a[0],b[0]),z0=Math.min(a[1],b[1]),z1=Math.max(a[1],b[1]);
      for(let x=Math.floor(x0/RG);x<=Math.floor(x1/RG);x++)for(let z=Math.floor(z0/RG);z<=Math.floor(z1/RG);z++){const kk=gk(x,z);let c=rgrid.get(kk);if(!c){c=[];rgrid.set(kk,c);}c.push(s);}}}
  // junction nodes (global graph ids)
  for(const r of roads){if(r.kind!==0||!r.ids)continue;const n=r.pts.length;for(let i=0;i<n;i++){const id=r.ids[i];if(id<0)continue;let N=st_nodes.get(id);if(!N){N={id,x:r.pts[i][0],z:r.pts[i][1],arms:[]};st_nodes.set(id,N);}
    for(const d of[-1,1]){const j=i+d;if(j<0||j>=n)continue;let k=j;while(k>0&&k<n-1&&Math.hypot(r.pts[k][0]-r.pts[i][0],r.pts[k][1]-r.pts[i][1])<6)k+=d;
      const dx=r.pts[k][0]-r.pts[i][0],dz=r.pts[k][1]-r.pts[i][1],l=Math.hypot(dx,dz)||1;N.arms.push({r,i,d,ux:dx/l,uz:dz/l,w:r.w,out:(r.ow===1&&d>0)||(r.ow===-1&&d<0)});}}}
  for(const N of st_nodes.values()){const k=st_tkey(N.x,N.z);let L=st_tileNodes.get(k);if(!L){L=[];st_tileNodes.set(k,L);}L.push(N);}
  // ground (one big quad under the whole city)
  // (distant terrain is drawn by world.js; tiles with t.hasTerrain get a hole cut there)
  // trolleybus stops, city-wide (shelters are built per tile in buildTransitTile)
  stops.length=0;
  for(const [sx,sz,name] of (D.stops||[])){const x=sx*SC,z=sz*SC;const ns=nearestSeg(x,z,22,s=>s.r.tw);if(!ns)continue;if(stops.some(s=>Math.abs(s.x-x)<12&&Math.abs(s.z-z)<12&&Math.hypot(s.x-x,s.z-z)<12))continue;
    const s=ns.s,dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1],l=Math.hypot(dx,dz),ux=dx/l,uz=dz/l,nx=-uz,nz=ux;const side=Math.sign((x-ns.qx)*nx+(z-ns.qz)*nz)||1;
    const sw=st_sw(s.r),e=s.r.w/2+Math.min(sw-1.2,2.4),px=ns.qx+nx*side*e,pz=ns.qz+nz*side*e;
    stops.push({x,z,px,pz,name,i:stops.length,ry:Math.atan2(nx*side,nz*side)});}
}
// ---- terrain grid mesh (indexed, atlas material, DIRT surface); waterClamp(x,z,y) may lower vertices under lakes ----
let st_farTerrain=null;
function st_gridMesh(x0,z0,nx,nz,C,lift,waterClamp,col){const V=(nx+1)*(nz+1),P=new Float32Array(V*3),N=new Float32Array(V*3),U=new Float32Array(V*2),Cc=new Float32Array(V*3),Tt=new Float32Array(V*2);
  const hasN=typeof groundNormal==='function',tl=st_T.DIRT;let k=0;
  for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++,k++){const x=x0+i*C,z=z0+j*C;let y=st_gy(x,z)+lift;if(waterClamp)y=waterClamp(x,z,y);
    P[k*3]=x;P[k*3+1]=y;P[k*3+2]=z;const n=hasN?groundNormal(x,z):[0,1,0];N[k*3]=n[0];N[k*3+1]=n[1];N[k*3+2]=n[2];U[k*2]=x/14;U[k*2+1]=z/14;
    Cc[k*3]=col.r;Cc[k*3+1]=col.g;Cc[k*3+2]=col.b;Tt[k*2]=tl[0];Tt[k*2+1]=tl[1];}
  const I=new (V>65535?Uint32Array:Uint16Array)(nx*nz*6);let q=0;
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const a=j*(nx+1)+i,b=a+1,c=a+nx+1,d=c+1;I[q++]=a;I[q++]=c;I[q++]=b;I[q++]=b;I[q++]=c;I[q++]=d;}
  const g=new THREE.BufferGeometry();g.setIndex(new THREE.BufferAttribute(I,1));g.setAttribute('position',new THREE.BufferAttribute(P,3));g.setAttribute('normal',new THREE.BufferAttribute(N,3));
  g.setAttribute('uv',new THREE.BufferAttribute(U,2));g.setAttribute('color',new THREE.BufferAttribute(Cc,3));g.setAttribute('tile',new THREE.BufferAttribute(Tt,2));g.computeBoundingSphere();
  const m=new THREE.Mesh(g,st_mat);m.matrixAutoUpdate=false;m.updateMatrix();return m;}
// ---- lakes are level: one water level per lake, shared by all its clipped tile pieces (cache by bbox overlap) ----
const st_lakes=[];
function st_waterLevel(o){let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;for(const p of o){x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);z0=Math.min(z0,p[1]);z1=Math.max(z1,p[1]);}
  for(const L of st_lakes)if(x0<L.x1+25&&x1>L.x0-25&&z0<L.z1+25&&z1>L.z0-25){L.x0=Math.min(L.x0,x0);L.x1=Math.max(L.x1,x1);L.z0=Math.min(L.z0,z0);L.z1=Math.max(L.z1,z1);return L.level;}
  const A=Math.abs(sArea(o)),st=Math.max(5,Math.sqrt(A)/14),v=[];for(let x=x0+st/2;x<x1;x+=st)for(let z=z0+st/2;z<z1;z+=st)if(pip(x,z,o))v.push(st_gy(x,z));
  if(v.length<3)for(const p of o)v.push(st_gy(p[0],p[1]));v.sort((a,b)=>a-b);const level=v[Math.floor(v.length*.2)]-.3;
  st_lakes.push({x0,x1,z0,z1,level});return level;}
// channels (mapcore RV, audited beds carved into groundY) need a finer grid to show the profile; far tiles keep the smooth valley
function st_tileHasRiver(t){if(typeof rv_dist!=='function')return false;if(!RV)rv_dist(0,0);for(const L of (RV&&RV.lines)||[])for(const p of L.pts)if(p[0]>t.x0-30&&p[0]<t.x1+30&&p[1]>t.z0-30&&p[1]<t.z1+30)return true;return false;}
function st_terrainTile(t,grp,water){if(t.key==='all'||!isFinite(t.x0))return;const far=t.lod==='far',riv=st_tileHasRiver(t),N=far?24:riv?160:64,C=(t.x1-t.x0)/N;
  const wclamp=water.length?(x,z,y)=>{for(const w of water){if(x<w.x0||x>w.x1||z<w.z0||z>w.z1)continue;if(pip(x,z,w.o)&&!w.hs.some(h=>pip(x,z,h))){const rl=riverLevelAt(x,z);return Math.min(y,(rl!==null?rl:w.level)-1.2);}}return y;}:null;
  // far: un-carve channels (coarse grid would alias the bed); near: sink the ground 0.7 m under concrete linings so the lining shows
  const clamp=!riv?wclamp:(x,z,y)=>{if(rv_dist(x,z)<0){if(far)y=Math.max(y,groundDemY(x,z)-.15);else if(rv_dist(x,z,true)<-.5)y-=.7;}return wclamp?wclamp(x,z,y):y;};
  const m=st_gridMesh(t.x0,t.z0,N,N,C,-.15,clamp,st_col(0xf2f2f2));m.name='st_terrain';grp.add(m);t.hasTerrain=true;}
// Map road -> Set(segment indices) for a tile
function st_tileRoads(t){const M2=new Map();
  if(t.key==='all'){for(const r of roads){if(r.kind===3||r.pts.length<2)continue;const S=new Set();for(let i=0;i<r.pts.length-1;i++)S.add(i);M2.set(r,S);}return M2;}
  const L=st_tileSegs.get(t.key);if(!L)return M2;for(let k=0;k<L.length;k+=2){const r=L[k];let S=M2.get(r);if(!S){S=new Set();M2.set(r,S);}S.add(L[k+1]);}return M2;}
const st_pointAt=(r,s)=>{let i=0;while(i<r.cum.length-2&&r.cum[i+1]<s)i++;const t=(s-r.cum[i])/((r.cum[i+1]-r.cum[i])||1);
  const ux=r.pts[i+1][0]-r.pts[i][0],uz=r.pts[i+1][1]-r.pts[i][1],ul=Math.hypot(ux,uz)||1;return {i,x:r.pts[i][0]+ux*t,z:r.pts[i][1]+uz*t,ux:ux/ul,uz:uz/ul};};
// an edge lying exactly on the tile border (artefact of clipping) — no fence / embankment there
const st_onBorder=(t,a,b)=>{const e=.06;return (Math.abs(a[0]-t.x0)<e&&Math.abs(b[0]-t.x0)<e)||(Math.abs(a[0]-t.x1)<e&&Math.abs(b[0]-t.x1)<e)||(Math.abs(a[1]-t.z0)<e&&Math.abs(b[1]-t.z0)<e)||(Math.abs(a[1]-t.z1)<e&&Math.abs(b[1]-t.z1)<e);};
function st_addRectPoly(x,z,w,d,ang,h,t){const c=Math.cos(ang),s=Math.sin(ang);const pts=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([a,b])=>[x+a*c+b*s,z-a*s+b*c]);if(sArea(pts)<0)pts.reverse();return addPoly([pts],h,t);}
function st_lampMesh(kind,list,group){if(!list.length)return;const geo=st_TPL[kind].clone();const im=new THREE.InstancedMesh(geo,st_lampMat,list.length);let cx=0,cz=0;const _m=new THREE.Matrix4(),up=new THREE.Vector3(0,1,0);
  list.forEach(([x,z,ry],i)=>{_m.compose(_p.set(x,(kind==='lamp'?st_Y.SW-.17:0)+st_sy(x,z),z),_q.setFromAxisAngle(up,ry),_s.set(1,1,1));im.setMatrixAt(i,_m);cx+=x;cz+=z;});
  cx/=list.length;cz/=list.length;let rad=0;for(const [x,z] of list)rad=Math.max(rad,Math.hypot(x-cx,z-cz));geo.boundingSphere=new THREE.Sphere(new THREE.Vector3(cx,5+st_gy(cx,cz),cz),rad+30);im.frustumCulled=true;group.add(im);}

function buildStreetsTile(t){
  buildStreetsGlobal();
  const far=t.lod==='far',grp=t.group,rnd=st_rng(st_hash('st'+t.key));
  const inT=(x,z)=>x>=t.x0&&x<t.x1&&z>=t.z0&&z<t.z1;
  st_cur=new St_G();st_curF=st_drapeBk(new Bk(VC,false));st_curGlass=st_drapeBk(new Bk(st_glassMat,false));
  const RM=st_tileRoads(t),T=st_TPL,d=t.data||{};st_bridgeOK=false;st_maxe2=196;st_setDir();
  // ---- areas (clipped to the tile) ----
  const water=[],bigParks=[];
  for(const [kind,ring,holes] of (d.a||[])){const o=dec(ring),hs=(holes||[]).map(dec);if(o.length<3)continue;
    if(kind==='water'){if(typeof rv_dist==='function'){let cx=0,cz=0;for(const p of o){cx+=p[0];cz+=p[1];}if(rv_dist(cx/o.length,cz/o.length,true)<0)continue;}water.push([o,hs]);continue;}   // lined channels draw their own water
    const k=.92+rnd()*.16;
    if(kind==='park'){st_poly(o,hs,st_Y.PARK,st_T.GRASS,5,new THREE.Color(k,k*(.98+rnd()*.06),k*.95));
      if(Math.abs(sArea(o))>=4000){let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;for(const p of o){x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);z0=Math.min(z0,p[1]);z1=Math.max(z1,p[1]);}bigParks.push({o,x0,x1,z0,z1});}}
    else if(kind==='parking')st_poly(o,hs,st_Y.PARKING,st_T.ASPH2,6,st_col(0xe8e8e8));
    else st_poly(o,hs,st_Y.PLAZA,st_T.PAVE,3,new THREE.Color(k,k,k));}
  for(const w of water){const o=w[0];w.level=st_waterLevel(o);let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;for(const p of o){x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);z0=Math.min(z0,p[1]);z1=Math.max(z1,p[1]);}Object.assign(w,{o,hs:w[1],x0,x1,z0,z1});}
  st_terrainTile(t,grp,water);
  if(water.length)st_buildWaterTile(water,grp,t);
  st_maxe2=49;st_bridgeOK=true;
  const inPark=(x,z)=>bigParks.some(P=>x>P.x0&&x<P.x1&&z>P.z0&&z<P.z1&&pip(x,z,P.o));
  // ---- footways (tile render pieces) ----
  const cAsph=st_col(0xffffff),cServ=st_col(0xf0f0f0),cFoot=st_col(0xe6e3dc),cPed=st_col(0xffffff),cTrack=st_col(0xececec),cGutter=st_col(0xc8c8c8),cPaint=st_col(0xffffff),cKerb=st_col(0xffffff),cSide=st_col(0xffffff);
  const foot=[];for(const q of (d.r||[])){if(q[0]!==3)continue;const pts=dec(q[6]);if(pts.length<2)continue;foot.push({w:q[1],pts,cum:st_cum(pts)});st_strip(pts,q[1],st_Y.FOOT,q[1]<=2.5?st_T.PAVE2:st_T.GRAVEL,q[1]<=2.5?2:4,cFoot,false);}
  st_maxe2=36;
  // ---- asphalt / pedestrian surfaces of the global roads (only this tile's segments; round caps at true road ends) ----
  for(const [r,S] of RM){const y=r.kind===2?st_Y.PED:r.kind===1?st_Y.SERV:st_Y.ROAD,tl=r.kind===2?st_T.PAVE:r.kind===1?st_T.ASPH2:st_T.ASPH,sc=r.kind===2?3:r.kind===1?6:9,col=r.kind===2?cPed:r.kind===1?cServ:cAsph;
    const Lp=st_off(r.pts,r.w/2),Rp=st_off(r.pts,-r.w/2),g=st_cur;
    for(const i of S){st_setDir(r.pts[i],r.pts[i+1]);st_fquad(g,y,Lp[i][0],Lp[i][1],Rp[i][0],Rp[i][1],Rp[i+1][0],Rp[i+1][1],Lp[i+1][0],Lp[i+1][1],tl,sc,col);}
    const last=r.pts.length-2;for(const [i,e] of [[0,r.pts[0]],[last,r.pts[last+1]]]){if(!S.has(i))continue;const rr=r.w/2,seg=14;for(let k=0;k<seg;k++){const a0=k/seg*TAU,a1=(k+1)/seg*TAU;st_ftri(g,y,e[0],e[1],e[0]+Math.cos(a0)*rr,e[1]+Math.sin(a0)*rr,e[0]+Math.cos(a1)*rr,e[1]+Math.sin(a1)*rr,tl,sc,col);}}}
  st_setDir();
  // ---- zebra crossings of this tile ----
  const zebras=[],crossOn=new Map();const C=d.cross||[];
  for(let i=0;i<C.length;i+=2){const x=C[i]*SC,z=C[i+1]*SC;const ns=nearestSeg(x,z,4);if(!ns)continue;const s=ns.s,r=s.r;
    if(zebras.some(q=>Math.hypot(q.x-ns.qx,q.z-ns.qz)<6))continue;const si=r.pts.indexOf(s.a);const along=r.cum[si]+Math.hypot(ns.qx-s.a[0],ns.qz-s.a[1]);
    const dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1],l=Math.hypot(dx,dz);zebras.push({x:ns.qx,z:ns.qz,ux:dx/l,uz:dz/l,r,along});let L=crossOn.get(r);if(!L){L=[];crossOn.set(r,L);}L.push(along);}
  // ---- per drivable road: sidewalks, kerbs, ramps, gutters, drains, markings, manholes ----
  for(const [r,S] of RM){if(r.kind!==0)continue;
    const sw=st_sw(r),others=[];for(let i=0;i<r.pts.length-1;i++)others.push(S.has(i)?st_others(r,r.pts[i][0],r.pts[i][1],r.pts[i+1][0],r.pts[i+1][1],r.w/2+sw+12):null);
    const cr=crossOn.get(r)||[];const inRamp=s=>{for(const c of cr)if(Math.abs(s-c)<1.6)return true;return false;};
    const clip=(s,a,b,i)=>!st_inside(others[i],a[0],a[1],-.05)&&!st_inside(others[i],b[0],b[1],-.05);
    for(const side of[-1,1]){
      const slab=p=>{const g=st_cur;const A0=p.a(p.ta),A1=p.a(p.tb),B0=p.b(p.ta),B1=p.b(p.tb);
        st_fquad(g,st_Y.SW,A0[0],A0[1],A1[0],A1[1],B1[0],B1[1],B0[0],B0[1],st_T.SIDEWALK,2,cSide);return [A0,A1,B0,B1,g];};
      st_ribbon(r,side*(r.w/2+1.2),side*(r.w/2+sw),2,clip,slab,S);
      st_ribbon(r,side*r.w/2,side*(r.w/2+1.2),2,(s,a,b,i)=>!inRamp(s)&&clip(s,a,b,i),p=>{const [A0,A1,B0,B1,g]=slab(p);
        const ix=(B0[0]-A0[0])/1.2*.3,iz=(B0[1]-A0[1])/1.2*.3;const fn=[-(B0[0]-A0[0])/1.2,0,-(B0[1]-A0[1])/1.2];
        st_quad(g,[[A0[0],st_Y.KERB,A0[1],p.sa,0],[A1[0],st_Y.KERB,A1[1],p.sb,0],[A1[0]+ix,st_Y.KERB,A1[1]+iz,p.sb,.999],[A0[0]+ix,st_Y.KERB,A0[1]+iz,p.sa,.999]],[0,1,0],st_T.KERB,cKerb);
        st_quad(g,[[A0[0],st_Y.ROAD,A0[1],p.sa,.001],[A1[0],st_Y.ROAD,A1[1],p.sb,.001],[A1[0],st_Y.KERB,A1[1],p.sb,.999],[A0[0],st_Y.KERB,A0[1],p.sa,.999]],fn,st_T.KERB,cKerb);},S);
      if(far)continue;
      if(cr.length){const IN=st_off(r.pts,side*r.w/2),OUT=st_off(r.pts,side*(r.w/2+1.2));const at=(L,s)=>{let i=0;while(i<r.cum.length-2&&r.cum[i+1]<s)i++;const tt=clamp((s-r.cum[i])/((r.cum[i+1]-r.cum[i])||1),0,1);return [L[i][0]+(L[i+1][0]-L[i][0])*tt,L[i][1]+(L[i+1][1]-L[i][1])*tt,i];};
        for(const c of cr){const s0=c-1.6,s1=c+1.6;const a0=at(IN,s0),a1=at(IN,s1),b0=at(OUT,s0),b1=at(OUT,s1);
          const o0=others[a0[2]]||st_others(r,a0[0],a0[1],a1[0],a1[1],r.w/2+sw+12),o1=others[a1[2]]||o0;if(st_inside(o0,a0[0],a0[1],-.05)||st_inside(o1,a1[0],a1[1],-.05))continue;
          const g=st_cur;st_quad(g,[[a0[0],st_Y.ROAD+.012,a0[1],0,0],[a1[0],st_Y.ROAD+.012,a1[1],1.6,0],[b1[0],st_Y.SW+.004,b1[1],1.6,.6],[b0[0],st_Y.SW+.004,b0[1],0,.6]],[0,1,0],st_T.TACTILE,cKerb);
          for(const [P,Q] of [[a0,b0],[a1,b1]])g.v(P[0],st_Y.ROAD,P[1],0,1,0,0,0,cKerb,st_T.CONC),g.v(Q[0],st_Y.SW,Q[1],0,1,0,.5,0,cKerb,st_T.CONC),g.v(P[0],st_Y.SW,P[1],0,1,0,0,.3,cKerb,st_T.CONC);}}
      st_ribbon(r,side*(r.w/2-.55),side*r.w/2,4,(s,a,b,i)=>!st_inside(others[i],a[0],a[1],.15)&&!st_inside(others[i],b[0],b[1],.15),p=>{
        const g=st_cur,A0=p.a(p.ta),A1=p.a(p.tb),B0=p.b(p.ta),B1=p.b(p.tb);
        st_fquad(g,st_Y.TRACK,A0[0],A0[1],A1[0],A1[1],B1[0],B1[1],B0[0],B0[1],st_T.ASPH,9,cGutter);
        for(let s=Math.ceil(p.sa/22)*22+7;s<p.sb-1;s+=22){const tt=p.ta+(p.tb-p.ta)*(s-p.sa)/(p.sb-p.sa||1);const a=p.a(tt),b=p.b(tt);const ux=r.pts[p.i+1][0]-r.pts[p.i][0],uz=r.pts[p.i+1][1]-r.pts[p.i][1],ul=Math.hypot(ux,uz)||1;
          const cx=(a[0]*.35+b[0]*.65),cz=(a[1]*.35+b[1]*.65),hx=ux/ul*.45,hz=uz/ul*.45,vx=(b[0]-a[0])/.55*.22,vz=(b[1]-a[1])/.55*.22;
          st_quad(g,[[cx-hx-vx,st_Y.MAN,cz-hz-vz,.001,.001],[cx+hx-vx,st_Y.MAN,cz+hz-vz,.999,.001],[cx+hx+vx,st_Y.MAN,cz+hz+vz,.999,.999],[cx-hx+vx,st_Y.MAN,cz-hz+vz,.001,.999]],[0,1,0],st_T.GRATE,st_WHITE);}},S);
    }
    if(far)continue;
    const lines=[];
    if(!r.ow){const nPer=Math.max(1,Math.floor(r.w/2/3));if(r.w>=12){lines.push([.14,.13,0,0],[-.14,.13,0,0]);}else if(r.w>=6.5)lines.push([0,.13,3,6]);
      for(let k=1;k<nPer;k++){const o=k*(r.w/2)/nPer;lines.push([o,.13,3,9],[-o,.13,3,9]);}
      if(r.w>=9)lines.push([r.w/2-.35,.16,0,0],[-(r.w/2-.35),.16,0,0]);
      for(let k=0;k<nPer;k++){const o=(k+.5)*(r.w/2)/nPer;for(const s of[-1,1])for(const q of[-.8,.8])lines.push([s*o+q,.55,0,0,'track']);}}
    else{const nPer=Math.max(1,Math.round(r.w/3.3));for(let k=1;k<nPer;k++)lines.push([-r.w/2+k*r.w/nPer,.13,3,9]);if(r.w>=7)lines.push([r.w/2-.35,.16,0,0],[-(r.w/2-.35),.16,0,0]);
      for(let k=0;k<nPer;k++){const o=-r.w/2+(k+.5)*r.w/nPer;for(const q of[-.8,.8])lines.push([o+q,.55,0,0,'track']);}}
    for(const [o,wd,dash,gap,kind] of lines){const per=dash+gap;
      st_ribbon(r,o-wd/2,o+wd/2,per?1.5:4,(s,a,b,i)=>(!per||(s%per)<dash)&&!st_inside(others[i],a[0],a[1],.4)&&!st_inside(others[i],b[0],b[1],.4)&&!(cr.some(c=>Math.abs(s-c)<2.2)),p=>{
        const g=st_cur,A0=p.a(p.ta),A1=p.a(p.tb),B0=p.b(p.ta),B1=p.b(p.tb);
        if(kind==='track'){st_fquad(g,st_Y.TRACK+.002,A0[0],A0[1],A1[0],A1[1],B1[0],B1[1],B0[0],B0[1],st_T.ASPH,9,cTrack);}
        else{st_fquad(g,st_Y.MARK,A0[0],A0[1],A1[0],A1[1],B1[0],B1[1],B0[0],B0[1],st_T.PAINT,1.3,cPaint);}},S);}
    // manholes: spacing along the whole road (per-road RNG), emitted where they fall in this tile
    {const rr=st_rng(r.idx*104729+3),tot=r.cum[r.cum.length-1];for(let s=17+rr()*30;s<tot-5;s+=38+rr()*40){const lat=(rr()-.5)*(r.w-2.4);const P=st_pointAt(r,s);if(!S.has(P.i))continue;
      const x=P.x-P.uz*lat,z=P.z+P.ux*lat;if(st_inside(others[P.i],x,z,.5))continue;const h=.42;
      st_quad(st_cur,[[x-h,st_Y.MAN+.001,z-h,.001,.001],[x+h,st_Y.MAN+.001,z-h,.999,.001],[x+h,st_Y.MAN+.001,z+h,.999,.999],[x-h,st_Y.MAN+.001,z+h,.001,.999]],[0,1,0],st_T.MANHOLE,st_WHITE);}}
  }
  // ---- zebra stripes ----
  for(const q of zebras){const w=q.r.w,nx=-q.uz,nz=q.ux,g=st_cur;
    for(let o=-w/2+.55;o<=w/2-.45;o+=1.0){const cx=q.x+nx*o,cz=q.z+nz*o,ax=q.ux*1.7,az=q.uz*1.7,bx=nx*.27,bz=nz*.27;
      st_fquad(g,st_Y.ZEBRA,cx-ax-bx,cz-az-bz,cx+ax-bx,cz+az-bz,cx+ax+bx,cz+az+bz,cx-ax+bx,cz-az+bz,st_T.PAINT,1.3,cPaint);}}
  const nodes=t.key==='all'?[...st_nodes.values()]:(st_tileNodes.get(t.key)||[]);
  if(!far){
    // stop lines at major junctions
    for(const N of nodes){const arms=N.arms;if(!st_isMajor(N))continue;
      for(const A of arms){if(A.out)continue;const oth=arms.filter(o=>o!==A);const Ld=Math.max(...oth.map(o=>o.w/2))+2.2;const nx=A.uz,nz=-A.ux;
        const cx=N.x+A.ux*Ld,cz=N.z+A.uz*Ld;const o0=A.r.ow?-A.w/2:0,o1=A.w/2-.1;
        const p0=[cx+nx*o0,cz+nz*o0],p1=[cx+nx*o1,cz+nz*o1],ax=A.ux*.22,az=A.uz*.22;
        st_quad(st_cur,[[p0[0]-ax,st_Y.ZEBRA,p0[1]-az,0,0],[p1[0]-ax,st_Y.ZEBRA,p1[1]-az,1,0],[p1[0]+ax,st_Y.ZEBRA,p1[1]+az,1,.4],[p0[0]+ax,st_Y.ZEBRA,p0[1]+az,0,.4]],[0,1,0],st_T.PAINT,cPaint);}}
    // ---- street lamps along drivable roads without trolley wires (spacing along the whole road) ----
    const lamps=[];
    if(st_POLES)for(const [r,S] of RM){if(r.kind!==0||r.tw||r.w<4.5)continue;const rr=st_rng(r.idx*7919+1),both=r.w>=9.5,sp=r.w>=9.5?30:36;const tot=r.cum[r.cum.length-1];let flip=1;
      for(let s=8+rr()*8;s<tot-4;s+=sp){const sides=both?[1,-1]:[flip];flip=-flip;const P=st_pointAt(r,s);if(!S.has(P.i))continue;const nx=-P.uz,nz=P.ux;
        for(const sd of sides){const e=r.w/2+.55,x=P.x+nx*e*sd,z=P.z+nz*e*sd;if(!st_free(x,z,.25))continue;lamps.push([x,z,Math.atan2(-nx*sd,-nz*sd)]);}}}
    if(st_POLES)st_lampMesh('lamp',lamps,grp);
    // ---- junction furniture: traffic lights (+mast arms, lenses), yield signs ----
    for(const N of nodes){const major=st_isMajor(N);const ref=N.arms[0];
      for(const A of N.arms){const oth=N.arms.filter(o=>o!==A);if(!oth.length)continue;const Ld=Math.max(...oth.map(o=>o.w/2))+2.2;const nx=A.uz,nz=-A.ux;const face=Math.atan2(A.ux,A.uz);
        if(major&&!A.out){const off=A.w/2+.45,x=N.x+A.ux*(Ld+.6)+nx*off,z=N.z+A.uz*(Ld+.6)+nz*off;if(solidAt(x,z,.5))continue;const b=st_curF;st_add(b,T.tl,x,0,z,face,null);
          const go=Math.abs(A.ux*ref.ux+A.uz*ref.uz)>.6,kk=go?2:0;const lens=(px,py,pz)=>b.add(new THREE.CylinderGeometry(.11,.11,.035,10),M(px+Math.sin(face)*.15,py+.3-kk*.3,pz+Math.cos(face)*.15,face,Math.PI/2),go?0x4dff7a:0xff3326);lens(x,3.0,z);
          if(A.w>=11){const span=A.w/2-1.5;st_add(b,T.tlArm,x,0,z,face,null);b.add(new THREE.CylinderGeometry(.07,.08,span,6,1,true),M(x-nx*span/2,5.8,z-nz*span/2,face,0,Math.PI/2),0x2f3236);
            b.add(T.tl,M(x-nx*(span-.2),2.75,z-nz*(span-.2),face),null);lens(x-nx*(span-.2),5.75,z-nz*(span-.2));}}
        else if(!major&&oth.some(o=>o.w>=A.w+2.5)&&!A.out&&A.w<9){const off=A.w/2+.5,x=N.x+A.ux*(Ld+1.5)+nx*off,z=N.z+A.uz*(Ld+1.5)+nz*off;if(!solidAt(x,z,.5))st_add(st_curF,T.signYield,x,0,z,face,null);}}}
    // ---- pedestrian crossing signs + bollards ----
    for(const q of zebras){const nx=-q.uz,nz=q.ux;for(const s of[-1,1]){const e=q.r.w/2+.6,x=q.x+nx*e*s+q.ux*2.2*s,z=q.z+nz*e*s+q.uz*2.2*s;if(!solidAt(x,z,.5))st_add(st_curF,T.signPed,x,0,z,Math.atan2(-q.ux*s,-q.uz*s),null);
      for(const dd of[-1.9,1.9]){const bx=q.x+nx*(q.r.w/2+.35)*s+q.ux*dd,bz=q.z+nz*(q.r.w/2+.35)*s+q.uz*dd;if(!solidAt(bx,bz,.3))st_add(st_curF,T.bollard,bx,st_Y.SW-.01,bz,0,null);}}}
    // ---- benches + bins: boulevards & pedestrian streets (global roads), park paths (tile footways) ----
    const bench=(x,z,face,y,ux,uz)=>{st_add(st_curF,T.bench,x,y,z,face,null);st_add(st_curF,T.bin,x+ux*1.35,y,z+uz*1.35,0,null);};
    for(const [r,S] of RM){const blvd=r.kind===0&&/Ștefan cel Mare|Grigore Vieru|Negruzzi|Renașterii|Dacia/.test(r.name);if(!blvd&&r.kind!==2)continue;
      const tot=r.cum[r.cum.length-1];const sp=blvd?26:14;if(tot<8)continue;let alt=1;
      for(let s=6;s<tot-3;s+=sp){alt=-alt;const P=st_pointAt(r,s);if(!S.has(P.i))continue;const nx=-P.uz,nz=P.ux;
        for(const sd of (blvd?[1,-1]:[alt])){const e=blvd?r.w/2+st_sw(r)-.55:r.w/2+.55,x=P.x+nx*e*sd,z=P.z+nz*e*sd;if(solidAt(x,z,.3))continue;
          if(!blvd){const q=nearestSeg(x,z,8);if(q&&q.d<q.s.r.w/2+1)continue;}bench(x,z,Math.atan2(-nx*sd,-nz*sd),blvd?st_Y.SW:0,P.ux,P.uz);}}}
    for(const f of foot){const tot=f.cum[f.cum.length-1];if(tot<8)continue;let alt=1;
      for(let s=6;s<tot-3;s+=22){alt=-alt;let i=0;while(i<f.cum.length-2&&f.cum[i+1]<s)i++;const tt=(s-f.cum[i])/((f.cum[i+1]-f.cum[i])||1);
        const ux0=f.pts[i+1][0]-f.pts[i][0],uz0=f.pts[i+1][1]-f.pts[i][1],ul=Math.hypot(ux0,uz0)||1,ux=ux0/ul,uz=uz0/ul;const px=f.pts[i][0]+ux0*tt,pz=f.pts[i][1]+uz0*tt;if(!inPark(px,pz))continue;
        const nx=-uz,nz=ux,x=px+nx*(f.w/2+.55)*alt,z=pz+nz*(f.w/2+.55)*alt;if(solidAt(x,z,.3))continue;const q=nearestSeg(x,z,8);if(q&&q.d<q.s.r.w/2+1)continue;bench(x,z,Math.atan2(-nx*alt,-nz*alt),0,ux,uz);}}
    // ---- park fences along street-facing park edges (never along clipped tile borders) ----
    const cF=st_col(0xffffff);
    for(const P of bigParks){const o=P.o;let acc=0;for(let i=0;i<o.length;i++){const a=o[i],b=o[(i+1)%o.length],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(l<.5)continue;
        if(st_onBorder(t,a,b)){acc+=l;continue;}const mx=(a[0]+b[0])/2,mz=(a[1]+b[1])/2;const ns=nearestSeg(mx,mz,18);if(!ns||ns.d>ns.s.r.w/2+st_sw(ns.s.r)+6||ns.d<ns.s.r.w/2+st_sw(ns.s.r)-.3){acc+=l;continue;}
        const H=1.25,u0=acc/2.2,u1=(acc+l)/2.2;st_quad(st_cur,[[a[0],0,a[1],u0,.001],[b[0],0,b[1],u1,.001],[b[0],H,b[1],u1,.999],[a[0],H,a[1],u0,.999]],[(b[1]-a[1])/l,0,-(b[0]-a[0])/l],st_T.FENCE,cF);acc+=l;}}
    // ---- kiosks at major junctions (per-node RNG), collidable ----
    const kb=st_drapeBk(new Bk(st_kioskMat,true));const sub=(geo,face,u0,v0,u1,v1)=>{const uv=geo.attributes.uv;for(let k=0;k<4;k++){const i=face*4+k;uv.setXY(i,u0+uv.getX(i)*(u1-u0),v0+uv.getY(i)*(v1-v0));}};
    for(const N of nodes){if(!st_isMajor(N))continue;const nr=st_rng(N.id*31337+7);if(nr()>.3)continue;const A=N.arms[Math.floor(nr()*N.arms.length)];const sw=st_sw(A.r);if(sw<3.5)continue;
      const nx=A.uz,nz=-A.ux,sd=nr()<.5?1:-1,along=Math.max(...N.arms.map(o=>o.w/2))+8+nr()*12,e=A.w/2+sw-1.15;const x=N.x+A.ux*along+nx*e*sd,z=N.z+A.uz*along+nz*e*sd;
      if(solidAt(x,z,.5)||!st_free(x,z,1.2))continue;const ang=Math.atan2(A.ux,A.uz)+(sd>0?-Math.PI/2:Math.PI/2);const v=Math.floor(nr()*8),u0=(v%4)/4,v0=1-(Math.floor(v/4)+1)/2;
      const geo=BOX(3.2,2.6,2.2);sub(geo,4,u0,v0,u0+.25,v0+.5);for(const f of[0,1,5])sub(geo,f,u0+.01,v0+.01,u0+.04,v0+.04);sub(geo,2,u0+.01,v0+.46,u0+.24,v0+.49);sub(geo,3,u0+.01,v0+.01,u0+.04,v0+.04);
      kb.add(geo,M(x,st_Y.SW+1.3,z,ang),0xffffff);kb.add(BOX(3.6,.18,2.6),M(x,st_Y.SW+2.69,z,ang),0x9a9a9a);st_addRectPoly(x,z,3.4,2.4,ang,3,t);}
    if(kb.p.length)grp.add(kb.mesh());
  }
  // ---- finalize ----
  if(st_cur.p.length)grp.add(st_cur.mesh(st_mat));
  {const m=st_photoMat(t);if(m){t.stPhM=m;for(const o of grp.children)if(o.material===st_mat)o.material=m;}}
  if(st_curF.p.length)grp.add(st_curF.mesh());
  if(st_curGlass.p.length){const gm=st_curGlass.mesh();gm.renderOrder=2;grp.add(gm);}
  st_cur=null;st_curF=null;st_curGlass=null;st_bridgeOK=false;
}
// water surfaces (+ stone embankment on real lakes, but never along clipped tile borders)
function st_buildWaterTile(list,group,t){const p=[],n=[];
  for(const w of list){const o=w.o,hs=w.hs,lv=w.level;const c=o.map(q=>new THREE.Vector2(q[0],q[1])),h=hs.map(r=>r.map(q=>new THREE.Vector2(q[0],q[1])));let tris;try{tris=THREE.ShapeUtils.triangulateShape(c,h);}catch(e){continue;}
    const all=c.concat(...h);for(const tr of tris){let a=all[tr[0]],b=all[tr[1]],d=all[tr[2]];if(!a||!b||!d)continue;if((b.y-a.y)*(d.x-a.x)-(b.x-a.x)*(d.y-a.y)<0){const tt=b;b=d;d=tt;}
      for(const q of[a,b,d]){const rl=riverLevelAt(q.x,q.y);p.push(q.x,(rl!==null?rl:lv)+.07,q.y);n.push(0,1,0);}}   // rivers slope, lakes are level
    let A=0;for(let i=0;i<o.length;i++){const a=o[i],b=o[(i+1)%o.length];A+=a[0]*b[1]-b[0]*a[1];}A/=2;if(Math.abs(A)<1500)continue;const ring=A>0?o:o.slice().reverse();
    for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);if(l<.2||st_onBorder(t,a,b))continue;const nx=dz/l,nz=-dx/l;const g=st_cur;
      // absolute heights: top follows the shore but never below lake level + 0.42; inner face reaches below the water
      const W=.9,nseg=Math.max(1,Math.ceil(l/st_MAXE));st_noDrape=true;
      for(let k=0;k<nseg;k++){const t0=k/nseg,t1=(k+1)/nseg,A=[a[0]+dx*t0,a[1]+dz*t0],B=[a[0]+dx*t1,a[1]+dz*t1];
        const tA=Math.max(lv+.42,st_gy(A[0]+nx*W,A[1]+nz*W)+.12),tB=Math.max(lv+.42,st_gy(B[0]+nx*W,B[1]+nz*W)+.12),oA=st_gy(A[0]+nx*W,A[1]+nz*W)+st_Y.PARK-.1,oB=st_gy(B[0]+nx*W,B[1]+nz*W)+st_Y.PARK-.1,u0=l*t0,u1=l*t1;
        st_quad0(g,[[A[0],tA,A[1],u0/1.5,0],[B[0],tB,B[1],u1/1.5,0],[B[0]+nx*W,tB,B[1]+nz*W,u1/1.5,W/1.5],[A[0]+nx*W,tA,A[1]+nz*W,u0/1.5,W/1.5]],[0,1,0],st_T.CONC,st_WHITE);
        st_quad0(g,[[A[0],lv-.6,A[1],u0/4,.001],[B[0],lv-.6,B[1],u1/4,.001],[B[0],tB,B[1],u1/4,.999],[A[0],tA,A[1],u0/4,.999]],[-nx,0,-nz],st_T.STONE,st_WHITE);
        st_quad0(g,[[A[0]+nx*W,Math.min(oA,tA),A[1]+nz*W,u0/4,.001],[B[0]+nx*W,Math.min(oB,tB),B[1]+nz*W,u1/4,.001],[B[0]+nx*W,tB,B[1]+nz*W,u1/4,.4],[A[0]+nx*W,tA,A[1]+nz*W,u0/4,.4]],[nx,0,nz],st_T.STONE,st_WHITE);}
      st_noDrape=false;}}
  if(!p.length)return;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));g.computeBoundingSphere();
  const mesh=new THREE.Mesh(g,st_waterMat);mesh.onBeforeRender=()=>{st_waterUni.uTime.value=performance.now()/1000;};group.add(mesh);}

function buildTransitTile(t){
  buildStreetsGlobal();
  const grp=t.group,inT=(x,z)=>x>=t.x0&&x<t.x1&&z>=t.z0&&z<t.z1,RM=st_tileRoads(t),T=st_TPL;st_bridgeOK=true;
  const wirePts=[],cpoles=[];
  // trolley catenary: pole spacing measured along the whole road, wires emitted per tile segment
  for(const [r,S] of RM){if(r.kind!==0||!r.tw)continue;const nPer=r.ow?Math.max(1,Math.round(r.w/3.3)):Math.max(1,Math.floor(r.w/2/3.0));
    const offs=r.ow?[(r.ow>0?1:-1)*(-r.w/2+(nPer-.5)*r.w/nPer)]:[(nPer-.5)*(r.w/2)/nPer,-(nPer-.5)*(r.w/2)/nPer];let acc=0;
    for(let i=0;i<r.pts.length-1;i++){const a=r.pts[i],c=r.pts[i+1],dx=c[0]-a[0],dz=c[1]-a[1],l=Math.hypot(dx,dz);if(l<.01)continue;
      if(S.has(i)){const nx=-dz/l,nz=dx/l;
        for(const o of offs)for(const dd of[-.3,.3])wirePts.push(a[0]+nx*(o+dd),5.8,a[1]+nz*(o+dd),c[0]+nx*(o+dd),5.8,c[1]+nz*(o+dd));
        if(st_POLES)for(let tt=(35-acc%35)%35;tt<l;tt+=35){const px=a[0]+dx/l*tt,pz=a[1]+dz/l*tt,e=r.w/2+.75;const ry=Math.atan2(nx,nz);
          const okL=st_free(px+nx*e,pz+nz*e,.3),okR=st_free(px-nx*e,pz-nz*e,.3);
          if(okL)cpoles.push([px+nx*e,pz+nz*e,ry+Math.PI]);if(okR)cpoles.push([px-nx*e,pz-nz*e,ry]);
          const L=okL?e:r.w/2,Rr=okR?e:r.w/2;const sag=s=>6.95-.25*(1-((s+L)/(L+Rr)*2-1)**2);
          let px0=px+nx*L,pz0=pz+nz*L,y0=7.0;for(let k=1;k<=6;k++){const s=L-(L+Rr)*k/6;const x1=px+nx*s,z1=pz+nz*s,y1=k===6?7.0:sag(s);wirePts.push(px0,y0,pz0,x1,y1,z1);px0=x1;pz0=z1;y0=y1;}
          for(const o of offs)for(const dd of[-.3,.3]){const s=o+dd;wirePts.push(px+nx*s,sag(s),pz+nz*s,px+nx*s,5.82,pz+nz*s);}
          for(const o of offs)wirePts.push(px+nx*(o-.3),5.95,pz+nz*(o-.3),px+nx*(o+.3),5.95,pz+nz*(o+.3));}}
      acc+=l;}}
  if(wirePts.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(st_drapeLines(wirePts),3));g.computeBoundingSphere();const ls=new THREE.LineSegments(g,st_wireMat);grp.add(ls);}
  st_lampMesh('cpole',cpoles,grp);
  // trolleybus stop shelters located in this tile
  const fb=st_drapeBk(new Bk(VC,false)),gl=st_drapeBk(new Bk(st_glassMat,false));
  for(const s of stops){if(!inT(s.px,s.pz)||solidAt(s.px,s.pz,.5))continue;const ry=s.ry,px=s.px,pz=s.pz;st_add(fb,T.shelter,px,st_Y.SW-.17,pz,ry,null);
    for(const [w,h,dd,lx,ly,lz] of [[6,2.2,.03,0,1.45,.98],[.03,2.2,1.8,-3,1.4,0],[.03,2.2,1.8,3,1.4,0]]){const c=Math.cos(ry),sn=Math.sin(ry);gl.add(BOX(w,h,dd),M(px+lx*c+lz*sn,ly,pz-lx*sn+lz*c,ry),0xbfd8e6);}}
  if(fb.p.length)grp.add(fb.mesh());if(gl.p.length){const gm=gl.mesh();gm.renderOrder=2;grp.add(gm);}
  st_bridgeOK=false;
}

// ---- legacy single-pass API (whole map as one pseudo tile) ----
let st_legacyT=null;
function st_legacyTile(){if(st_legacyT)return st_legacyT;const g=new THREE.Group();g.name='streets_legacy';scene.add(g);
  st_legacyT={key:'all',i:0,j:0,x0:-1e9,z0:-1e9,x1:1e9,z1:1e9,data:{r:(D.r||[]).filter(q=>q[0]===3),a:D.a||[],cross:D.cross||[]},group:g,polys:[]};return st_legacyT;}
function buildStreets(){buildStreetsGlobal();buildStreetsTile(st_legacyTile());}
function buildTransit(){buildStreetsGlobal();buildTransitTile(st_legacyTile());}
