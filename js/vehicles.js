'use strict';
// Vehicle models, instanced pools, trolleybus, render. Owner: VEHICLES agent.
// Cars: procedural lofted bodies (Catmull-Rom refined stations), transparent glass with interior hints,
// MeshPhysical paint (clear-coat, PMREM env reflections), per-vertex roughness/metal/coat/tint attributes,
// separate instanced wheels that spin + steer, brake/reverse lamp glows, near/far LOD with per-frame instance compaction.
const _pos=new THREE.Vector3(); // shared temp (also used by game.js)

// ================= environment map for reflections =================
const veh_env=(()=>{
  const s=new THREE.Scene();
  const g=new THREE.SphereGeometry(50,32,16),c=[];const top=new THREE.Color(0x4f86c6),hor=new THREE.Color(0xdfe8ef),gnd=new THREE.Color(0x4a4a48);
  const p=g.attributes.position;for(let i=0;i<p.count;i++){const y=p.getY(i)/50;const col=y>0?hor.clone().lerp(top,Math.pow(y,.6)):hor.clone().lerp(gnd,Math.min(1,-y*4));c.push(col.r,col.g,col.b);}
  g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));
  s.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.BackSide})));
  // sun + bright sky patches + building silhouettes around the horizon
  const sunM=new THREE.Mesh(new THREE.SphereGeometry(3,12,8),new THREE.MeshBasicMaterial({color:0xfff6e0}));sunM.position.set(-25,32,18);s.add(sunM);
  const bm=new THREE.MeshBasicMaterial({color:0x6d6e70}),bl=new THREE.MeshBasicMaterial({color:0xa9adb1});
  for(let i=0;i<26;i++){const a=i/26*Math.PI*2,h=4+((i*7919)%9);const b=new THREE.Mesh(new THREE.BoxGeometry(7,h,2),i%3?bm:bl);b.position.set(Math.cos(a)*44,h/2-2,Math.sin(a)*44);b.lookAt(0,h/2-2,0);s.add(b);}
  const soft=new THREE.Mesh(new THREE.PlaneGeometry(40,10),new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide}));soft.position.set(0,40,0);soft.rotation.x=Math.PI/2;s.add(soft);
  const pm=new THREE.PMREMGenerator(renderer);const rt=pm.fromScene(s,0.02);pm.dispose();return rt.texture;})();

// ================= decal atlas (plates, route boards, police text) =================
const veh_AW=1024,veh_AH=512,veh_COLS=8,veh_COLW=veh_AW/veh_COLS;
const veh_ROUTES=['105','112','117','121','125','135','156','192'];
const veh_atlas=(()=>{const cv=document.createElement('canvas');cv.width=veh_AW;cv.height=veh_AH;const g=cv.getContext('2d');
  g.fillStyle='#ffffff';g.fillRect(0,0,veh_AW,veh_AH);
  const L='ABCEHKMOPTX';
  for(let k=0;k<veh_COLS;k++){const x=k*veh_COLW;
    // plate 0..30
    g.fillStyle='#fdfdfb';g.fillRect(x+2,2,124,28);g.strokeStyle='#111';g.lineWidth=2;g.strokeRect(x+3,3,122,26);
    g.fillStyle='#1f4fb5';g.fillRect(x+4,4,18,24);g.fillStyle='#ffd200';g.font='bold 7px Arial';g.textAlign='center';g.fillText('MD',x+13,25);
    g.fillStyle='#0046ae';g.fillRect(x+7,7,4,9);g.fillStyle='#ffd200';g.fillRect(x+11,7,4,9);g.fillStyle='#cc092f';g.fillRect(x+15,7,4,9);
    const txt=L[(k*3)%L.length]+L[(k*5+2)%L.length]+L[(k*7+4)%L.length]+' '+String(100+((k*137)%899));
    g.fillStyle='#111';g.font='bold 20px Arial';g.textAlign='center';g.textBaseline='middle';g.fillText(txt,x+72,17);
    // rutieră LED board 34..82
    g.fillStyle='#0c0c0c';g.fillRect(x+2,34,124,46);g.fillStyle='#ff9a1a';g.font='900 34px Arial';g.fillText(veh_ROUTES[k],x+64,58);
    g.fillStyle='rgba(255,154,26,.25)';for(let yy=36;yy<80;yy+=3)g.fillRect(x+2,yy,124,1);
    // police text 86..118 (white on blue)
    g.fillStyle='#1f4fa8';g.fillRect(x,86,128,32);g.fillStyle='#fff';g.font='900 22px Arial';g.fillText('POLIȚIA',x+64,103);
    // route card 122..170 (white card black number)
    g.fillStyle='#fbfbf6';g.fillRect(x+6,122,116,48);g.strokeStyle='#c22';g.lineWidth=3;g.strokeRect(x+8,124,112,44);g.fillStyle='#111';g.font='900 30px Arial';g.fillText(veh_ROUTES[k],x+64,142);
    g.font='bold 9px Arial';g.fillText('CENTRU',x+64,162);
    // police hood/rear text 174..198 (blue on white)
    g.fillStyle='#fff';g.fillRect(x,174,128,24);g.fillStyle='#1f4fa8';g.font='900 19px Arial';g.fillText('POLIȚIA',x+64,187);
    // grille mesh texture 202..250 (dark honeycomb)
    g.fillStyle='#111';g.fillRect(x,202,128,48);g.fillStyle='#2b2b2b';for(let yy=204;yy<250;yy+=6)for(let xx=x+((yy/6)%2?3:0);xx<x+128;xx+=6)g.fillRect(xx,yy,3,3);
  }
  const t=new THREE.CanvasTexture(cv);t.anisotropy=renderer.capabilities.getMaxAnisotropy();return t;})();
const veh_px=(x0,y0,x1,y1)=>[x0/veh_AW,1-y1/veh_AH,x1/veh_AW,1-y0/veh_AH];
const veh_UV={plate:veh_px(2,2,126,30),led:veh_px(2,34,126,80),pol:veh_px(0,86,128,118),card:veh_px(6,122,122,170),polw:veh_px(0,174,128,198),grille:veh_px(0,202,128,250)};
const veh_WU=(veh_AW-40)/veh_AW,veh_WV=1-(veh_AH-10)/veh_AH; // white texel (col 7 bottom, never decal-shifted)

// ================= geometry builder with material attributes =================
const veh_nm=new THREE.Matrix3(),veh_v=new THREE.Vector3(),veh_n=new THREE.Vector3(),veh_c=new THREE.Color();
class veh_B{
  constructor(){this.p=[];this.n=[];this.c=[];this.uv=[];this.aT=[];this.aR=[];this.aM=[];this.aC=[];this.aD=[];}
  add(geo,m,color,o){o=o||{};const g=geo.index?geo.toNonIndexed():geo;const P=g.attributes.position,N=g.attributes.normal,U=g.attributes.uv;
    m=m||veh_I;veh_nm.getNormalMatrix(m);veh_c.set(color);const t=o.t||0,ro=o.ro!=null?o.ro:.5,me=o.me||0,co=o.co||0,dec=o.dec?1:0,ur=o.uvr;
    const flip=m.determinant()<0;
    for(let k=0;k<P.count;k+=3)for(let q=0;q<3;q++){const i=flip?k+(q===0?0:3-q):k+q;
      veh_v.fromBufferAttribute(P,i).applyMatrix4(m);veh_n.fromBufferAttribute(N,i).applyMatrix3(veh_nm).normalize();
      this.p.push(veh_v.x,veh_v.y,veh_v.z);this.n.push(veh_n.x,veh_n.y,veh_n.z);this.c.push(veh_c.r,veh_c.g,veh_c.b);
      if(ur&&U)this.uv.push(ur[0]+U.getX(i)*(ur[2]-ur[0]),ur[1]+U.getY(i)*(ur[3]-ur[1]));else this.uv.push(veh_WU,veh_WV);
      this.aT.push(t);this.aR.push(ro);this.aM.push(me);this.aC.push(co);this.aD.push(dec);}}
  geo(){const g=new THREE.BufferGeometry(),F=(a,n)=>new THREE.Float32BufferAttribute(a,n);
    g.setAttribute('position',F(this.p,3));g.setAttribute('normal',F(this.n,3));g.setAttribute('color',F(this.c,3));g.setAttribute('uv',F(this.uv,2));
    g.setAttribute('aTint',F(this.aT,1));g.setAttribute('aRough',F(this.aR,1));g.setAttribute('aMetal',F(this.aM,1));g.setAttribute('aCoat',F(this.aC,1));g.setAttribute('aDec',F(this.aD,1));
    g.computeBoundingSphere();return g;}
  tris(){return this.p.length/9;}
}
const veh_I=new THREE.Matrix4();
const veh_q=new THREE.Quaternion(),veh_e=new THREE.Euler(),veh_s3=new THREE.Vector3(),veh_p3=new THREE.Vector3();
const veh_M=(x,y,z,ry=0,rx=0,rz=0,sx=1,sy=1,sz=1)=>new THREE.Matrix4().compose(veh_p3.set(x,y,z),veh_q.setFromEuler(veh_e.set(rx,ry,rz,'YXZ')),veh_s3.set(sx,sy,sz));
// materials presets
const veh_PAINT={t:1,ro:.24,me:.12,co:1},veh_BLK={ro:.7},veh_TRIM={ro:.35,co:.6},veh_CHR={ro:.1,me:1},veh_RUB={ro:.95},veh_LENS={ro:.05,me:.1,co:1},veh_INT={ro:.92},veh_MET={ro:.4,me:.8};
const veh_C={chrome:0xdadcde,black:0x151617,trim:0x0b0c0d,lens:0xf1efe6,red:0xb3121a,amber:0xdd8a1c,int:0x2a2a2c,dash:0x1b1b1d,plateW:0xffffff,glassLod:0x141a21,rubber:0x121212};

function veh_physMat(extra){
  const m=new THREE.MeshPhysicalMaterial(Object.assign({vertexColors:true,map:veh_atlas,roughness:1,metalness:1,clearcoat:1,clearcoatRoughness:.05,envMap:veh_env,envMapIntensity:.6},extra||{}));
  m.onBeforeCompile=sh=>{
    sh.vertexShader='attribute float aTint;attribute float aRough;attribute float aMetal;attribute float aCoat;attribute float aDec;attribute float aVar;\nvarying float vRough;varying float vMetal;varying float vCoat;\n'+sh.vertexShader;
    sh.vertexShader=sh.vertexShader.replace('#include <color_vertex>',`
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
vColor *= mix( vec3( 1.0 ), instanceColor, aTint );
#endif
vRough = aRough; vMetal = aMetal; vCoat = aCoat;`).replace('#include <uv_vertex>','#include <uv_vertex>\n#ifdef USE_UV\nvUv.x += aVar * '+(veh_COLW/veh_AW).toFixed(5)+' * aDec;\n#endif');
    sh.fragmentShader='varying float vRough;varying float vMetal;varying float vCoat;\n'+sh.fragmentShader;
    sh.fragmentShader=sh.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor = vRough;')
      .replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\nmetalnessFactor = vMetal;')
      .replace('#include <lights_physical_fragment>','#include <lights_physical_fragment>\n#ifdef CLEARCOAT\nmaterial.clearcoat *= vCoat;\n#endif');};
  m.customProgramCacheKey=()=>'vehPhys2';return m;}
const veh_bodyMat=veh_physMat(),veh_staticMat=veh_physMat();
const veh_glassMat=new THREE.MeshPhysicalMaterial({color:0x0b1219,roughness:.04,metalness:.1,transparent:true,opacity:.5,envMap:veh_env,envMapIntensity:1.6,depthWrite:false,clearcoat:1,clearcoatRoughness:.03});

// ================= loft helpers =================
// one-side cross-section from bottom centre up to top centre; hwt = half-width at top (tumblehome)
function veh_sec(hw,yb,yt,rb,rt,hwt,n){const P=[[0,yb]];
  for(let i=0;i<=n;i++){const a=-Math.PI/2+i/n*Math.PI/2;P.push([hw-rb+Math.cos(a)*rb,yb+rb+Math.sin(a)*rb]);}
  for(let i=0;i<=n;i++){const a=i/n*Math.PI/2;P.push([hwt-rt+Math.cos(a)*rt,yt-rt+Math.sin(a)*rt]);}
  P.push([0,yt]);return P;}
// sections: [{z,pts}] rear→front, same point count. returns indexed geometry (both sides, smooth normals), optional caps (separate verts)
function veh_loft(st,caps,uvFn){const pos=[],uv=[],idx=[],m=st[0].pts.length;
  for(const side of[1,-1]){const base=pos.length/3;
    for(const s of st)for(const p of s.pts){pos.push(p[0]*side,p[1],s.z);const u=uvFn?uvFn(p[0]*side,p[1],s.z,side):[veh_WU,veh_WV];uv.push(u[0],u[1]);}
    for(let i=0;i<st.length-1;i++)for(let j=0;j<m-1;j++){const a=base+i*m+j,b=a+m,c=a+1,d=b+1;if(side>0)idx.push(a,c,b,c,d,b);else idx.push(a,b,c,c,b,d);}}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();
  if(!caps)return g;
  const out=[g];
  for(const [s,front] of [[st[0],false],[st[st.length-1],true]]){const cp=[],cu=[];let yb=1e9,yt=-1e9;for(const p of s.pts){yb=Math.min(yb,p[1]);yt=Math.max(yt,p[1]);}const cy=(yb+yt)/2;
    for(const side of[1,-1])for(let j=0;j<m-1;j++){const a=s.pts[j],b=s.pts[j+1];let A=[a[0]*side,a[1]],Bq=[b[0]*side,b[1]];const ccw=(side>0)===front;const tri=ccw?[[0,cy],A,Bq]:[[0,cy],Bq,A];
      for(const t of tri){cp.push(t[0],t[1],s.z);const u=uvFn?uvFn(t[0],t[1],s.z,0,front):[veh_WU,veh_WV];cu.push(u[0],u[1]);}}
    const cg=new THREE.BufferGeometry();cg.setAttribute('position',new THREE.Float32BufferAttribute(cp,3));cg.setAttribute('uv',new THREE.Float32BufferAttribute(cu,2));cg.computeVertexNormals();cg.userData.front=front;out.push(cg);}
  return out;}
// Catmull-Rom refinement of station rows [z, ...params]
function veh_refine(st,k){if(k<=1)return st.map(r=>r.slice());const out=[];const n=st.length;
  for(let i=0;i<n-1;i++)for(let s=0;s<k;s++){const t=s/k,p0=st[Math.max(0,i-1)],p1=st[i],p2=st[i+1],p3=st[Math.min(n-1,i+2)];
    out.push(p1.map((_,j)=>{if(j===0)return p1[0]+(p2[0]-p1[0])*t;const a=p0[j],b=p1[j],c=p2[j],d=p3[j];return .5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t);}));}
  out.push(st[n-1].slice());return out;}
const veh_interp=(st,j)=>z=>{if(z<=st[0][0])return st[0][j];for(let i=0;i<st.length-1;i++){const a=st[i],b=st[i+1];if(z<=b[0]){const t=(z-a[0])/(b[0]-a[0]||1);return a[j]+(b[j]-a[j])*t;}}return st[st.length-1][j];};

// ================= generic car builder =================
// def: {L,W,yb,rb,tumble,body:[[z,hw,yt,rt]...], cab:{zRG,zRR,zRF,zWS,roof:[r,m,f],hwR,rr,beltIn,wsBulge}, wheel:{r,tw,zf,zr,inset,style},
//       pillar:{A:'paint'|'black',B:zB|null,Bcol,Cpanel:[z0,z1]|null}, extras(H), lamps:{tail:[[x,y,z]],head:[[x,y,z]]}, seat}
function veh_buildCar(def,lod){
  const B=new veh_B(),G=new veh_B(),n=lod?2:5;
  const st=veh_refine(def.body,lod?1:4);const hwAt=veh_interp(st,1),ytAt=veh_interp(st,2);
  const yb=def.yb,rb=def.rb||.09,tum=def.tumble||.03;
  // lower body
  const secs=st.map(([z,hw,yt,rt])=>({z,pts:veh_sec(hw,yb,yt,Math.min(rb,(yt-yb)*.3),Math.min(rt,(yt-yb)*.45),hw-tum*Math.min(1,(yt-yb)/.6),n)}));
  for(const gg of veh_loft(secs,true))B.add(gg,null,0xffffff,veh_PAINT);
  // cabin
  const C=def.cab;const roofAt=z=>{const [r,m,f]=C.roof;if(z<=C.zRG)return ytAt(z);
    if(z<C.zRR){const t=(z-C.zRG)/(C.zRR-C.zRG);const y0=ytAt(C.zRG)+.015;return y0+(r-y0)*Math.pow(t,.8)+(C.rgBulge||.02)*Math.sin(Math.PI*t);}
    if(z<=C.zRF){const t=(z-C.zRR)/(C.zRF-C.zRR);return r*(1-t)*(1-2*t)+m*4*t*(1-t)+f*t*(2*t-1);}
    if(z<C.zWS){const t=(z-C.zRF)/(C.zWS-C.zRF);const y1=ytAt(C.zWS)+.015;return f+(y1-f)*Math.pow(t,1.12)+(C.wsBulge||.04)*Math.sin(Math.PI*t);}return ytAt(z);};
  const cz=[];const pushR=(a,b,k)=>{for(let i=0;i<k;i++)cz.push(a+(b-a)*i/k);};
  const kq=lod?2:6;pushR(C.zRG,C.zRR,kq);pushR(C.zRR,C.zRF,lod?3:10);pushR(C.zRF,C.zWS,kq+2);cz.push(C.zWS);
  const fracAt=z=>z<C.zRR?(z-C.zRG)/(C.zRR-C.zRG):z>C.zRF?1-(z-C.zRF)/(C.zWS-C.zRF):1;
  const cabSec=(z,lift,onlyTop)=>{const belt=ytAt(z)-.005,hwB=hwAt(z)-tum-(C.beltIn||.05),f=Math.max(0,Math.min(1,fracAt(z)));const ry=roofAt(z)+lift;
    const hwR=(hwB-.02)+(C.hwR-(hwB-.02))*f+lift,rr=Math.max(.004,C.rr*f);
    return veh_sec(hwB+lift,belt,Math.max(ry,belt+.012),.003,Math.min(rr,(ry-belt)*.45),Math.max(hwR,rr+.01),n);};
  const glassSecs=cz.map(z=>({z,pts:cabSec(z,0)}));
  const glassGeo=veh_loft(glassSecs,false);
  if(lod)B.add(glassGeo,null,veh_C.glassLod,{ro:.08,co:1});else G.add(glassGeo,null,0xffffff,{});
  // roof panel (paint) + headliner
  {const rz=cz.filter(z=>z>=C.zRR-.001&&z<=C.zRF+.001);const top=rz.map(z=>{const full=cabSec(z,.012);const k=full.length;return {z,pts:full.slice(Math.floor(k/2))};});
   top[0].z-=.02;top[top.length-1].z+=.03;B.add(veh_loft(top,false),null,0xffffff,veh_PAINT);
   if(!lod){const hl=rz.map(z=>{const full=cabSec(z,-.012);const k=full.length;return {z,pts:full.slice(Math.floor(k/2)).reverse()};});
     // reversed point order flips faces inward (visible from inside through glass)
     const g=veh_loft(hl,false);B.add(g,null,0x8d8a84,veh_INT);}}
  const H={B,G,lod,hwAt,ytAt,roofAt,yb,def,n,
    box:(w,h,d,x,y,z,col,mt,ry=0,rx=0,rz=0)=>B.add(BOX(w,h,d),veh_M(x,y,z,ry,rx,rz),col,mt),
    rbox:(w,h,d,x,y,z,col,mt,r=.03,ry=0,rx=0)=>{const g=veh_rbox(w,h,d,r,lod?1:2);B.add(g,veh_M(x,y,z,ry,rx),col,mt);},
    cyl:(rt,rb2,h,x,y,z,col,mt,seg=16,ry=0,rx=0,rz=0)=>B.add(CYL(rt,rb2,h,lod?Math.min(seg,8):seg),veh_M(x,y,z,ry,rx,rz),col,mt),
    beam:(a,b,w,d,col,mt)=>{const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],l=Math.hypot(dx,dy,dz);const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(dx/l,dy/l,dz/l));
      B.add(BOX(w,l,d),new THREE.Matrix4().compose(veh_p3.set((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2),q,veh_s3.set(1,1,1)),col,mt);},
    quad:(a,b,c,d,col,mt,out)=>{const g=new THREE.BufferGeometry();const P=[a,b,c,a,c,d];g.setAttribute('position',new THREE.Float32BufferAttribute(P.flat(),3));
      g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,1,1,0,0,1,1,0,1],2));g.computeVertexNormals();
      const nn=g.attributes.normal;if(out&&nn.getX(0)*out[0]+nn.getY(0)*out[1]+nn.getZ(0)*out[2]<0){g.setAttribute('position',new THREE.Float32BufferAttribute([a,c,b,a,d,c].flat(),3));g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,1,1,0,0,0,0,1,1,1],2));g.computeVertexNormals();}
      B.add(g,null,col,mt);},
    decal:(w,h,x,y,z,ry,rx,uvr,mt)=>{if(lod)return;B.add(new THREE.PlaneGeometry(w,h),veh_M(x,y,z,ry,rx),0xffffff,Object.assign({dec:1,uvr,ro:.45},mt||{}));},
    sideX:(z,y)=>{const hw=hwAt(z),yt=ytAt(z);const k=Math.max(0,Math.min(1,(y-(yb+.1))/Math.max(.05,yt-yb-.1)));return hw-tum*k*k;},
  };
  // pillars & window trims
  const P=def.pillar||{};
  for(const s of[1,-1]){
    const pA0=[s*(hwAt(C.zWS)-tum-(C.beltIn||.05)+.012),ytAt(C.zWS),C.zWS],pA1=[s*(C.hwR+.012),roofAt(C.zRF+.04)-C.rr*.5,C.zRF+.04];
    H.beam(pA0,pA1,.075,.1,P.A==='black'?veh_C.trim:0xffffff,P.A==='black'?veh_TRIM:veh_PAINT);
    const pC0=[s*(hwAt(C.zRG)-tum-(C.beltIn||.05)+.012),ytAt(C.zRG),C.zRG],pC1=[s*(C.hwR+.012),roofAt(C.zRR-.03)-C.rr*.5,C.zRR-.03];
    H.beam(pC0,pC1,.07,.12,0xffffff,veh_PAINT);
    if(P.B!=null){const z=P.B;H.beam([s*(hwAt(z)-tum-(C.beltIn||.05)+.01),ytAt(z),z],[s*(C.hwR+.012),roofAt(z)-C.rr*.6,z],.085,.03,P.Bcol==='paint'?0xffffff:veh_C.trim,P.Bcol==='paint'?veh_PAINT:veh_TRIM);}
    if(P.Cpanel){const [z0,z1]=P.Cpanel,o=.016;const a=[s*(hwAt(z0)-tum-(C.beltIn||.05)+o),ytAt(z0)-.01,z0],b=[s*(hwAt(z1)-tum-(C.beltIn||.05)+o),ytAt(z1)-.01,z1],
      c=[s*(C.hwR+o),roofAt(z1)-C.rr,z1],d=[s*(C.hwR+o),roofAt(z0)-C.rr,z0];H.quad(a,b,c,d,0xffffff,veh_PAINT,[s,0,0]);}
    if(!lod){ // belt trim strip
      const zs=[];for(let i=0;i<=8;i++)zs.push(C.zRG+(C.zWS-C.zRG)*i/8);
      for(let i=0;i<8;i++){const z0=zs[i],z1=zs[i+1];H.beam([s*(hwAt(z0)-tum*.9+.004),ytAt(z0)-.012,z0],[s*(hwAt(z1)-tum*.9+.004),ytAt(z1)-.012,z1],.02,.035,P.belt||veh_C.trim,P.belt===veh_C.chrome?veh_CHR:veh_TRIM);}}
  }
  // wheel arches (dark cavity + lip)
  const W=def.wheel;
  for(const az of [W.zf,W.zr])for(const s of[1,-1]){const x=s*(hwAt(az)+.004);
    const cav=new THREE.CircleGeometry(W.r+.06,lod?8:20,0,Math.PI);B.add(cav,veh_M(x,W.r-.02,az,s*Math.PI/2),0x070707,{ro:1});
    if(!lod){const lip=new THREE.RingGeometry(W.r+.05,W.r+(W.lip||.1),20,1,0,Math.PI);B.add(lip,veh_M(x+s*.006,W.r-.02,az,s*Math.PI/2),W.lipCol!=null?W.lipCol:0xffffff,W.lipCol!=null?veh_BLK:veh_PAINT);}}
  // interior hints
  if(!lod&&def.seat!==false){const zs=def.seatZ||[C.zWS-.95,C.zWS-1.8],belt=ytAt(zs[0]),hwI=hwAt(zs[0])-tum-.1;const sc=def.seatCol||0x3a3b3e;
    // dark floor plane at belt (hides painted body top through glass)
    const fl=[];for(const z of cz)fl.push(z);H.quad([hwI,ytAt(C.zRG+.05)+.004,C.zRG+.05],[-hwI,ytAt(C.zRG+.05)+.004,C.zRG+.05],[-hwI,ytAt(C.zWS-.05)+.004,C.zWS-.05],[hwI,ytAt(C.zWS-.05)+.004,C.zWS-.05],veh_C.int,veh_INT,[0,1,0]);
    // dashboard
    H.rbox(hwI*2-.05,.12,.42,0,ytAt(C.zWS-.25)+.05,C.zWS-.27,veh_C.dash,veh_INT,.04);
    // steering wheel (driver on the left = +x)
    const sw=new THREE.TorusGeometry(.17,.022,6,18);B.add(sw,veh_M(.36,ytAt(C.zWS-.5)+.16,C.zWS-.5,0,-1.1),0x161616,{ro:.6});
    H.beam([.36,ytAt(C.zWS-.5)+.1,C.zWS-.47],[.36,ytAt(C.zWS-.38)+.05,C.zWS-.38],.05,.05,0x161616,veh_INT);
    for(const sx of[.36,-.36]){H.rbox(.46,.5,.12,sx,belt+.12,zs[0]-.25,sc,veh_INT,.05,0,-.18);H.rbox(.26,.18,.1,sx,belt+.46,zs[0]-.31,sc,veh_INT,.04,0,-.12);}
    if(zs[1]!=null&&def.rearSeat!==false){H.rbox(hwI*2-.12,.42,.12,0,belt+.1,zs[1]-.3,sc,veh_INT,.05,0,-.2);for(const sx of[.4,-.4])H.rbox(.24,.15,.09,sx,belt+.38,zs[1]-.34,sc,veh_INT,.04);}
    H.rbox(.16,.12,.5,0,belt+.02,zs[0]+.05,veh_C.dash,veh_INT,.03); // console
  }
  if(def.extras)def.extras(H);
  // LOD wheels baked
  if(lod)for(const az of[W.zf,W.zr])for(const s of[1,-1]){const x=s*(hwAt(az)-W.tw/2+(W.out||.02));B.add(CYL(W.r,W.r,W.tw,10),veh_M(x,W.r,az,0,0,Math.PI/2),veh_C.rubber,veh_RUB);B.add(CYL(W.r*.6,W.r*.6,W.tw+.01,8),veh_M(x,W.r,az,0,0,Math.PI/2),0x9a9a9a,veh_MET);}
  return {body:B.geo(),glass:lod?null:G.geo(),tris:B.tris()+G.tris()};
}
// rounded box (few segments)
const veh_rbCache={};
function veh_rbox(w,h,d,r,seg){const k=[w,h,d,r,seg].map(v=>+v.toFixed(3)).join(',');if(veh_rbCache[k])return veh_rbCache[k];
  r=Math.min(r,w/2-.001,h/2-.001,d/2-.001);const sh=new THREE.Shape();const x=-w/2,y=-h/2;
  sh.moveTo(x+r,y);sh.lineTo(x+w-r,y);sh.quadraticCurveTo(x+w,y,x+w,y+r);sh.lineTo(x+w,y+h-r);sh.quadraticCurveTo(x+w,y+h,x+w-r,y+h);sh.lineTo(x+r,y+h);sh.quadraticCurveTo(x,y+h,x,y+h-r);sh.lineTo(x,y+r);sh.quadraticCurveTo(x,y,x+r,y);
  const g=new THREE.ExtrudeGeometry(sh,{depth:Math.max(.001,d-2*r*.6),bevelEnabled:true,bevelThickness:r*.6,bevelSize:0,bevelSegments:seg,curveSegments:seg});g.translate(0,0,-(d-2*r*.6)/2);
  return veh_rbCache[k]=g;}

// ---- common detail helpers ----
function veh_headlamp(H,x,y,z,w,h,ry,rx){if(H.lod){H.box(w,h,.05,x,y,z,0xcfd6dc,veh_LENS,ry,rx);return;}
  const c=Math.cos(ry),s=Math.sin(ry),side=x>0?1:-1;
  H.rbox(w,h,.07,x,y,z,0x23272b,{ro:.5,me:.3},Math.min(w,h)*.35,ry,rx);                       // dark housing
  H.rbox(w*.94,h*.86,.05,x+s*.012,y,z+c*.012,0xb7bec4,{ro:.08,me:1},Math.min(w,h)*.3,ry,rx);   // chrome reflector
  const px=x-side*c*w*.18,pz=z+side*s*w*.18;H.cyl(h*.28,h*.32,.06,px+s*.03,y,pz+c*.03,0xfffbea,{ro:.05,co:1},14,ry,rx+Math.PI/2); // projector
  H.rbox(w*.26,h*.3,.04,x+side*c*w*.33+s*.03,y-h*.18,z-side*s*w*.33+c*.03,veh_C.amber,veh_LENS,.02,ry,rx);           // indicator
  H.rbox(w*.98,h*.95,.02,x+s*.05,y,z+c*.05,0xe9eef2,{ro:.02,me:.3,co:1},Math.min(w,h)*.33,ry,rx);}                // clear cover (thin)
function veh_taillamp(H,x,y,z,w,h,ry,col){H.rbox(w,h,.07,x,y,z,col||veh_C.red,{ro:.08,co:1},Math.min(w,h)*.25,ry);
  if(!H.lod){const c=Math.cos(ry),s=Math.sin(ry);H.box(w*.35,h*.3,.04,x-s*.035+c*w*.25*(x>0?-1:1),y-h*.25,z-c*.035,0xf4f4f0,{ro:.1,co:1},ry);}}
function veh_mirror(H,s,x,y,z,arm){H.beam([s*(x-.06),y-.02,z],[s*(x+.06),y-.02,z+.02],.04,.08,0x151515,veh_BLK);
  H.rbox(.11,.13,.2,s*(x+.1),y,z+.04,0xffffff,veh_PAINT,.04,s*-.2);if(!H.lod)H.box(.005,.11,.16,s*(x+.1)+s*-.058,y,z+.06,0x8899aa,veh_CHR,s*-.2);}
function veh_seams(H,zs,y0,y1,s){if(H.lod)return;for(const z of zs){const x=H.sideX(z,(y0+y1)/2)+.003;H.beam([s*x,y0,z],[s*(H.sideX(z,y1)+.003),y1,z],.008,.008,0x0c0c0c,{ro:.9});}}
function veh_handle(H,s,z,y){if(H.lod)return;H.rbox(.03,.035,.16,s*(H.sideX(z,y)+.012),y,z,veh_C.chrome,veh_CHR,.012);}

// ================= model definitions =================
const veh_DEFS={};
// ---------- Toyota Yaris XP90 5-door (the classic Chișinău taxi) ----------
veh_DEFS.yaris={L:3.75,W:1.695,yb:.25,rb:.09,tumble:.045,
  body:[[-1.875,.74,.9,.16],[-1.85,.8,.97,.12],[-1.78,.835,1.0,.09],[-1.4,.845,1.0,.08],[-.6,.847,.985,.08],[.2,.847,.96,.08],[.62,.845,.935,.09],[1.0,.838,.885,.12],[1.35,.82,.83,.16],[1.62,.79,.77,.2],[1.78,.75,.71,.22],[1.85,.69,.65,.22],[1.875,.6,.58,.2]],
  cab:{zRG:-1.77,zRR:-1.58,zRF:-.12,zWS:.6,roof:[1.47,1.53,1.515],hwR:.66,rr:.13,beltIn:.05,wsBulge:.05,rgBulge:.03},
  wheel:{r:.3,tw:.19,zf:1.07,zr:-1.39,style:'alloy',out:.012},pillar:{A:'paint',B:-.38,Cpanel:[-1.58,-1.28]},
  seatZ:[.6-.9,-.95],seatCol:0x3d3e42,
  lamps:{tail:[[.71,1.12,-1.875],[-.71,1.12,-1.875]],head:[[.55,.69,1.85],[-.55,.69,1.85]],tailN:[0,0,-1]},
  extras:H=>{
    for(const s of[1,-1]){veh_headlamp(H,s*.55,.69,1.77,.36,.17,s*.62,-.35);veh_taillamp(H,s*.705,1.12,-1.845,.16,.34,s*-.4);
      veh_mirror(H,s,.86,.99,.48);veh_seams(H,[.6,-.38,-1.28],.33,.94,s);veh_handle(H,s,.08,.87);veh_handle(H,s,-.86,.88);
      H.box(.08,.06,.04,s*.48,.44,1.835,veh_C.lens,veh_LENS);}
    H.rbox(.5,.09,.06,0,.66,1.86,0x0e0e0e,veh_BLK,.03);H.box(.1,.06,.02,0,.66,1.895,veh_C.chrome,veh_CHR);
    H.rbox(1.05,.17,.1,0,.43,1.83,0x0c0c0c,veh_BLK,.04);H.decal(.95,.13,0,.43,1.882,0,0,veh_UV.grille);
    H.rbox(1.42,.07,.12,0,.29,1.79,0x101010,veh_BLK,.03);H.rbox(1.5,.14,.1,0,.33,-1.84,0x111111,veh_BLK,.04);
    H.decal(.52,.115,0,.52,1.888,0,0,veh_UV.plate);H.decal(.52,.115,0,.7,-1.883,Math.PI,0,veh_UV.plate);
    H.rbox(1.15,.05,.2,0,1.475,-1.66,0xffffff,veh_PAINT,.02);H.beam([-.25,1.2,-1.83],[.25,1.35,-1.82],.02,.02,0x111111,veh_BLK);
    H.beam([-.5,.97,.64],[.2,1.02,.6],.02,.02,0x111111,veh_BLK);H.beam([.15,.97,.64],[.75,1.0,.6],.02,.02,0x111111,veh_BLK);}};
// ---------- Dacia Logan L90 ----------
veh_DEFS.logan={L:4.29,W:1.74,yb:.26,rb:.09,tumble:.04,
  body:[[-2.145,.77,.9,.12],[-2.12,.84,.97,.09],[-2.02,.865,.995,.07],[-1.5,.87,1.0,.07],[-.6,.872,.98,.07],[.4,.872,.955,.08],[1.13,.868,.93,.09],[1.5,.86,.9,.1],[1.85,.845,.86,.12],[2.05,.81,.81,.15],[2.12,.74,.75,.16],[2.145,.66,.7,.16]],
  cab:{zRG:-1.42,zRR:-.78,zRF:.36,zWS:1.13,roof:[1.49,1.525,1.51],hwR:.705,rr:.1,beltIn:.05,wsBulge:.045,rgBulge:.04},
  wheel:{r:.31,tw:.19,zf:1.33,zr:-1.3,style:'steel',out:.012},pillar:{A:'paint',B:-.2},seatZ:[1.13-.95,-.5],seatCol:0x45464a,
  lamps:{tail:[[.66,.89,-2.15],[-.66,.89,-2.15]],head:[[.6,.745,2.16],[-.6,.745,2.16]]},
  extras:H=>{
    for(const s of[1,-1]){veh_headlamp(H,s*.6,.745,2.1,.42,.15,s*.35,-.15);veh_taillamp(H,s*.64,.89,-2.12,.42,.2,s*-.25);
      veh_mirror(H,s,.9,1.0,1.0);veh_seams(H,[1.11,-.2,-1.28],.34,.92,s);veh_handle(H,s,.5,.86);veh_handle(H,s,-.7,.87);}
    H.rbox(.72,.17,.06,0,.75,2.12,0x111111,veh_BLK,.03);H.decal(.66,.14,0,.75,2.152,0,0,veh_UV.grille);
    H.rbox(.76,.03,.05,0,.84,2.12,veh_C.chrome,veh_CHR,.01);H.rbox(.76,.03,.05,0,.665,2.125,veh_C.chrome,veh_CHR,.01);H.cyl(.05,.05,.03,0,.75,2.16,veh_C.chrome,veh_CHR,14,0,Math.PI/2);
    H.rbox(1.1,.16,.08,0,.45,2.11,0x0c0c0c,veh_BLK,.03);H.rbox(1.46,.06,.12,0,.29,2.07,0x101010,veh_BLK,.03);H.rbox(1.6,.12,.1,0,.36,-2.11,0x121212,veh_BLK,.04);
    H.decal(.52,.115,0,.5,2.155,0,0,veh_UV.plate);H.decal(.52,.115,0,.7,-2.152,Math.PI,0,veh_UV.plate);
    H.rbox(.5,.03,.03,0,.83,-2.14,veh_C.chrome,veh_CHR,.01);
    if(!H.lod){for(const z of[-2.02])H.beam([-.8,.997,z],[.8,.997,z],.006,.006,0x0c0c0c,{ro:.9});}
    H.beam([-.55,.94,1.16],[.15,.98,1.12],.02,.02,0x111111,veh_BLK);H.beam([.1,.94,1.16],[.75,.97,1.12],.02,.02,0x111111,veh_BLK);
    H.cyl(.004,.006,.6,-.55,1.2,-1.75,0x111111,veh_BLK,4,0,-.3);}};
// ---------- VAZ-2107 ----------
veh_DEFS.lada={L:4.13,W:1.62,yb:.3,rb:.05,tumble:.02,
  body:[[-2.065,.77,.86,.05],[-2.045,.8,.915,.045],[-1.95,.81,.93,.045],[-.5,.81,.93,.045],[1.0,.81,.925,.045],[1.9,.81,.915,.045],[2.03,.8,.89,.045],[2.065,.77,.84,.05]],
  cab:{zRG:-1.25,zRR:-.96,zRF:.42,zWS:.98,roof:[1.415,1.44,1.43],hwR:.68,rr:.06,beltIn:.04,wsBulge:.02,rgBulge:.01},
  wheel:{r:.29,tw:.17,zf:1.21,zr:-1.21,style:'steel',out:.0,lipCol:0x121212,lip:.07},pillar:{A:'paint',B:-.2,Bcol:'paint',belt:veh_C.chrome},seatZ:[.98-.92,-.6],seatCol:0x5a3a2c,
  lamps:{tail:[[.5,.78,-2.07],[-.5,.78,-2.07]],head:[[.53,.74,2.08],[-.53,.74,2.08]]},
  extras:H=>{
    for(const s of[1,-1]){// rectangular twin headlamp units
      H.rbox(.44,.23,.06,s*.53,.74,2.05,veh_C.chrome,veh_CHR,.02);H.rbox(.19,.18,.04,s*.43,.74,2.075,0xfff8e6,veh_LENS,.02);H.rbox(.19,.18,.04,s*.63,.74,2.075,0xf3f6f8,veh_LENS,.02);
      H.rbox(.17,.07,.04,s*.6,.42,2.1,veh_C.amber,veh_LENS,.02);
      H.rbox(.54,.21,.05,s*.5,.78,-2.06,veh_C.chrome,veh_CHR,.015);H.box(.22,.17,.03,s*.38,.78,-2.08,veh_C.red,veh_LENS);H.box(.13,.17,.03,s*.56,.78,-2.08,veh_C.amber,veh_LENS);H.box(.1,.17,.03,s*.69,.78,-2.08,0xf2f2f0,veh_LENS);
      veh_seams(H,[.98,-.2,-1.2],.36,.9,s);veh_handle(H,s,.45,.86);veh_handle(H,s,-.65,.86);
      H.rbox(.08,.08,.1,s*.84,.99,.88,veh_C.chrome,veh_CHR,.03);H.box(.12,.11,.012,s*.86,1.03,.88,0x8899aa,veh_CHR);
      H.beam([s*.70,1.39,-.96],[s*.70,1.41,.42],.018,.02,veh_C.chrome,veh_CHR);
      H.rbox(.05,.04,3.2,s*(.812),.62,.0,veh_C.chrome,veh_CHR,.015);}
    H.rbox(.5,.25,.05,0,.74,2.065,veh_C.chrome,veh_CHR,.02);for(let i=-5;i<=5;i++)H.box(.018,.2,.03,i*.04,.74,2.09,0x1a1a1a,veh_BLK);
    H.rbox(1.68,.13,.13,0,.47,2.09,veh_C.chrome,veh_CHR,.04);H.rbox(1.68,.05,.14,0,.47,2.1,0x111111,veh_BLK,.02);H.rbox(1.68,.13,.13,0,.47,-2.09,veh_C.chrome,veh_CHR,.04);
    H.decal(.52,.115,0,.6,2.115,0,0,veh_UV.plate);H.decal(.52,.115,0,.62,-2.115,Math.PI,0,veh_UV.plate);
    H.cyl(.004,.006,.9,-.72,1.25,1.6,0x222222,veh_CHR,4,0,-.15);
    for(const s of[1,-1])H.box(.18,.22,.01,s*.62,.25,-1.72,0x111111,veh_BLK);
    H.beam([-.5,.94,1.0],[.15,.98,.97],.02,.02,0x111111,veh_BLK);H.beam([.1,.94,1.0],[.7,.97,.97],.02,.02,0x111111,veh_BLK);}};
// ---------- Toyota RAV4 XA20 ----------
veh_DEFS.suv={L:4.0,W:1.735,yb:.4,rb:.1,tumble:.045,
  body:[[-2.0,.8,1.05,.12],[-1.97,.85,1.12,.09],[-1.85,.865,1.13,.08],[-.9,.87,1.12,.08],[.1,.87,1.09,.08],[.72,.868,1.06,.09],[1.1,.86,1.0,.11],[1.5,.84,.94,.14],[1.82,.8,.88,.17],[1.95,.74,.83,.17],[2.0,.66,.77,.16]],
  cab:{zRG:-1.92,zRR:-1.84,zRF:.02,zWS:.72,roof:[1.66,1.69,1.675],hwR:.72,rr:.11,beltIn:.05,wsBulge:.04,rgBulge:.0},
  wheel:{r:.34,tw:.22,zf:1.22,zr:-1.27,style:'alloy',out:.02,lipCol:0x1a1a1a,lip:.14},pillar:{A:'paint',B:-.55,Cpanel:[-1.84,-1.55]},seatZ:[.72-.95,-1.15],seatCol:0x4a4b50,
  lamps:{tail:[[.8,1.22,-2.02],[-.8,1.22,-2.02]],head:[[.6,.82,2.0],[-.6,.82,2.0]]},
  extras:H=>{
    for(const s of[1,-1]){veh_headlamp(H,s*.6,.82,1.95,.4,.16,s*.45,-.2);veh_taillamp(H,s*.79,1.22,-1.985,.13,.4,0);
      veh_mirror(H,s,.9,1.12,.75);veh_seams(H,[.72,-.55,-1.62],.6,1.08,s);veh_handle(H,s,.2,1.0);veh_handle(H,s,-1.05,1.02);
      H.rbox(.03,.2,3.0,s*(.875),.53,0,0x1c1c1c,veh_BLK,.01);
      H.beam([s*.6,1.725,-1.75],[s*.6,1.725,-.15],.04,.035,0x1a1a1a,veh_BLK);for(const z of[-1.75,-.15])H.box(.05,.05,.06,s*.6,1.7,z,0x1a1a1a,veh_BLK);}
    H.rbox(.62,.15,.06,0,.8,1.99,0x101010,veh_BLK,.03);H.decal(.56,.12,0,.8,2.022,0,0,veh_UV.grille);H.rbox(.66,.03,.04,0,.87,2.0,veh_C.chrome,veh_CHR,.01);
    H.rbox(1.62,.3,.16,0,.56,1.96,0x1b1b1b,veh_BLK,.05);H.rbox(1.1,.06,.12,0,.42,2.0,0x9a9da0,veh_MET,.02);H.rbox(1.65,.26,.14,0,.56,-1.98,0x1b1b1b,veh_BLK,.05);
    H.decal(.52,.115,0,.58,2.045,0,0,veh_UV.plate);H.decal(.52,.115,0,.76,-2.005,Math.PI,0,veh_UV.plate);
    // spare wheel on the tailgate
    if(!H.lod){const tg=new THREE.TorusGeometry(.27,.075,8,22);H.B.add(tg,veh_M(.05,1.02,-2.1),0x111111,veh_RUB);}
    H.cyl(.33,.33,.2,.05,1.02,-2.12,0xffffff,veh_PAINT,24,0,Math.PI/2);H.cyl(.24,.24,.02,.05,1.02,-2.225,0x1a1a1a,veh_BLK,20,0,Math.PI/2);
    H.beam([-.55,1.09,.75],[.15,1.13,.71],.02,.02,0x111111,veh_BLK);H.beam([.1,1.09,.75],[.75,1.12,.71],.02,.02,0x111111,veh_BLK);}};
// ---------- Mercedes Sprinter W906 (rutieră) — full-height body, no separate greenhouse ----------
veh_DEFS.sprinter={L:5.91,W:1.99,yb:.42,rb:.1,tumble:.07,van:true,
  body:[[-2.955,.93,2.55,.16],[-2.92,.985,2.62,.17],[-2.7,.995,2.64,.18],[.65,.995,2.64,.18],[.85,.99,2.5,.24],[1.3,.98,1.92,.2],[1.72,.975,1.36,.18],[2.25,.96,1.24,.18],[2.65,.93,1.12,.2],[2.85,.88,1.02,.22],[2.955,.8,.9,.22]],
  wheel:{r:.37,tw:.22,zf:1.98,zr:-1.69,style:'steel',out:.015,lipCol:0x1a1a1a,lip:.1},
  lamps:{tail:[[.94,1.05,-2.98],[-.94,1.05,-2.98]],head:[[.72,.98,2.93],[-.72,.98,2.93]]}};
// van builder (no cabin loft); glass = transparent windows with interior seats visible
function veh_buildVan(def,lod){const B=new veh_B(),G=new veh_B(),n=lod?2:5;const st=veh_refine(def.body,lod?1:4);const hwAt=veh_interp(st,1),ytAt=veh_interp(st,2);
  const yb=def.yb,rb=def.rb,tum=def.tumble;
  for(const gg of veh_loft(st.map(([z,hw,yt,rt])=>({z,pts:veh_sec(hw,yb,yt,rb,Math.min(rt,(yt-yb)*.45),hw-tum,n)})),true))B.add(gg,null,0xffffff,veh_PAINT);
  const H={B,G,lod,hwAt,ytAt,yb,def,n,roofAt:ytAt,
    box:(w,h,d,x,y,z,col,mt,ry=0,rx=0,rz=0)=>B.add(BOX(w,h,d),veh_M(x,y,z,ry,rx,rz),col,mt),
    rbox:(w,h,d,x,y,z,col,mt,r=.03,ry=0,rx=0)=>B.add(veh_rbox(w,h,d,r,lod?1:2),veh_M(x,y,z,ry,rx),col,mt),
    cyl:(rt,rb2,h,x,y,z,col,mt,seg=16,ry=0,rx=0,rz=0)=>B.add(CYL(rt,rb2,h,lod?Math.min(seg,8):seg),veh_M(x,y,z,ry,rx,rz),col,mt),
    beam:(a,b,w,d,col,mt)=>{const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],l=Math.hypot(dx,dy,dz);const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(dx/l,dy/l,dz/l));
      B.add(BOX(w,l,d),new THREE.Matrix4().compose(veh_p3.set((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2),q,veh_s3.set(1,1,1)),col,mt);},
    decal:(w,h,x,y,z,ry,rx,uvr,mt)=>{if(lod)return;B.add(new THREE.PlaneGeometry(w,h),veh_M(x,y,z,ry,rx),0xffffff,Object.assign({dec:1,uvr,ro:.45},mt||{}));},
    sideX:(z,y)=>{const hw=hwAt(z),yt=ytAt(z);const k=Math.max(0,Math.min(1,(y-(yb+rb))/Math.max(.05,yt-rb-(yb+rb))));return hw-tum*k;}};
  // side windows: transparent panes (glass builder) slightly proud of the side; dark frames
  const win=(s,z0,z1,y0,y1)=>{const x0=H.sideX(z0,y0)+.006,x1=H.sideX(z0,y1)+.006;
    const g=new THREE.BufferGeometry();const P=[[x0,y0,z0],[x0,y0,z1],[x1,y1,z1],[x1,y1,z0]].map(p=>[p[0]*s,p[1],p[2]]);
    const pts=s>0?[P[0],P[2],P[1],P[0],P[3],P[2]]:[P[0],P[1],P[2],P[0],P[2],P[3]];g.setAttribute('position',new THREE.Float32BufferAttribute(pts.flat(),3));g.computeVertexNormals();
    B.add(g,null,0x0e141a,{ro:.05,co:1});if(!lod){
      for(const [a,b] of[[[z0,y0],[z1,y0]],[[z0,y1],[z1,y1]],[[z0,y0],[z0,y1]],[[z1,y0],[z1,y1]]])H.beam([s*(H.sideX(a[0],a[1])+.008),a[1],a[0]],[s*(H.sideX(b[0],b[1])+.008),b[1],b[0]],.03,.03,0x0d0d0d,veh_BLK);}};
  for(const s of[1,-1]){win(s,.78,1.55,1.42,2.18);for(const [a,b] of[[-2.7,-1.95],[-1.8,-1.05],[-.9,-.12],[.02,.6]])win(s,a,b,1.45,2.2);}
  // windscreen (transparent) + rear door windows
  {const ws=[[.88,2.46],[1.71,1.38]],w=1.84;const mk=(ga)=>{const g=new THREE.BufferGeometry();const [a,b]=ws;const pts=[[w/2,a[1]+.012,a[0]+.012],[-w/2,a[1]+.012,a[0]+.012],[-w/2,b[1]+.012,b[0]+.012],[w/2,b[1]+.012,b[0]+.012]];
     g.setAttribute('position',new THREE.Float32BufferAttribute([pts[0],pts[1],pts[2],pts[0],pts[2],pts[3]].flat(),3));g.computeVertexNormals();return g;};
   B.add(mk(),null,0x0e141a,{ro:.04,co:1});
   for(const s of[1,-1]){const mkR=()=>{const g=new THREE.BufferGeometry();const z=-2.962,x0=s*.06,x1=s*.84;const p=s>0?[[x0,1.5,z],[x0,2.3,z],[x1,2.3,z],[x0,1.5,z],[x1,2.3,z],[x1,1.5,z]]:[[x0,1.5,z],[x1,2.3,z],[x0,2.3,z],[x0,1.5,z],[x1,1.5,z],[x1,2.3,z]];
     g.setAttribute('position',new THREE.Float32BufferAttribute(p.flat(),3));g.computeVertexNormals();return g;};B.add(mkR(),null,0x0e141a,{ro:.05,co:1});}}
  // front fascia
  for(const s of[1,-1]){veh_headlamp(H,s*.72,.98,2.87,.44,.24,s*.55,-.25);veh_taillamp(H,s*.935,1.05,-2.955,.14,.62,0);
    H.beam([s*.99,1.72,1.52],[s*1.16,1.74,1.6],.04,.05,0x151515,veh_BLK);H.rbox(.12,.34,.22,s*1.2,1.62,1.62,0x151515,veh_BLK,.04);
    if(!lod)H.box(.01,.28,.18,s*1.13,1.62,1.64,0x8899aa,veh_CHR);
    H.rbox(.04,.08,4.2,s*(H.sideX(-.5,.8)+.015),.8,-.55,0x1b1b1b,veh_BLK,.02);
    if(!lod){for(const z of[1.62,-2.75])H.beam([s*(H.sideX(z,.6)+.004),.6,z],[s*(H.sideX(z,2.4)+.004),2.4,z],.008,.008,0x0c0c0c,{ro:.9});}}
  if(!lod){H.beam([-(H.sideX(-.1,.6)+.004),.6,-.1],[-(H.sideX(-.1,2.35)+.004),2.35,-.1],.008,.008,0x0c0c0c,{ro:.9});H.beam([-(H.sideX(.7,.6)+.004),.6,.7],[-(H.sideX(.7,2.35)+.004),2.35,.7],.008,.008,0x0c0c0c,{ro:.9});
    H.beam([0,.55,-2.962],[0,2.45,-2.962],.01,.01,0x0c0c0c,{ro:.9});H.beam([-(H.sideX(-.4,1.0)+.012),1.0,-.4],[-(H.sideX(-.4,1.0)+.012),1.0,-.25],.03,.03,veh_C.chrome,veh_CHR);}
  H.rbox(.84,.28,.06,0,.95,2.935,0x0f0f0f,veh_BLK,.04);for(let i=0;i<3;i++)H.rbox(.82,.025,.03,0,.87+i*.08,2.96,veh_C.chrome,veh_CHR,.01);
  H.rbox(1.96,.36,.2,0,.62,2.92,0x1d1d1d,veh_BLK,.06);H.rbox(1.96,.26,.16,0,.55,-2.95,0x1d1d1d,veh_BLK,.05);H.box(.6,.08,.6,0,2.67,-.5,0xdedede,veh_BLK);
  H.decal(.52,.115,0,.6,3.03,0,0,veh_UV.plate);H.decal(.52,.115,0,.75,-2.965,Math.PI,0,veh_UV.plate);
  // route LED board top of windscreen + route card behind glass + side board
  H.decal(.9,.24,.15,2.32,1.005,0,-.66,veh_UV.led,{ro:.3});H.decal(.36,.2,-.5,1.62,1.55,0,-.66,veh_UV.card);H.decal(.5,.2,-(H.sideX(.2,2.0)+.012),2.36,.25,-Math.PI/2,0,veh_UV.led);
  // arches
  for(const az of[def.wheel.zf,def.wheel.zr])for(const s of[1,-1]){const x=s*(H.sideX(az,.5)+.004);B.add(new THREE.CircleGeometry(def.wheel.r+.07,lod?8:20,0,Math.PI),veh_M(x,def.wheel.r-.02,az,s*Math.PI/2),0x070707,{ro:1});
    if(!lod)B.add(new THREE.RingGeometry(def.wheel.r+.06,def.wheel.r+.13,20,1,0,Math.PI),veh_M(x+s*.008,def.wheel.r-.02,az,s*Math.PI/2),0x1a1a1a,veh_BLK);}
  if(lod){const W=def.wheel;for(const az of[W.zf,W.zr])for(const s of[1,-1]){const x=s*(hwAt(az)-W.tw/2+(W.out||.02));B.add(CYL(W.r,W.r,W.tw,10),veh_M(x,W.r,az,0,0,Math.PI/2),veh_C.rubber,veh_RUB);}}
  return {body:B.geo(),glass:lod?null:G.geo(),tris:B.tris()+G.tris()};}
// ---------- police (Logan + livery) ----------
veh_DEFS.police=Object.assign({},veh_DEFS.logan,{seatCol:0x2b2c30,extras:H=>{veh_DEFS.logan.extras(H);
  for(const s of[1,-1]){const zs=[-1.95,1.95],y0=.62,y1=.8,o=.008;
    for(let i=0;i<12;i++){const z0=zs[0]+(zs[1]-zs[0])*i/12,z1=zs[0]+(zs[1]-zs[0])*(i+1)/12;
      H.quad([s*(H.sideX(z0,y0)+o),y0,z0],[s*(H.sideX(z1,y0)+o),y0,z1],[s*(H.sideX(z1,y1)+o),y1,z1],[s*(H.sideX(z0,y1)+o),y1,z0],0x1f4fa8,{ro:.35,co:1},[s,0,0]);}
    H.decal(1.2,.17,s*(H.sideX(.0,.71)+.012),.71,.0,s*Math.PI/2,0,veh_UV.pol,{ro:.35,co:1});}
  H.decal(.9,.17,0,.93,1.7,0,-1.42,veh_UV.polw);H.decal(.8,.15,0,.82,-2.14,Math.PI,0,veh_UV.pol);
  H.rbox(1.4,.1,.1,0,.48,2.2,0x111111,veh_BLK,.03);}});

// ================= wheels (instanced, two styles) =================
function veh_wheelGeo(style,lod){const B=new veh_B();const seg=lod?12:28;
  // tyre: lathe profile (radius, axial) → axis along x after rotation
  const prof=[[.64,-.5],[.86,-.5],[.95,-.46],[.995,-.36],[1.0,-.3],[.985,-.27],[1.0,-.24],[1.0,-.1],[.985,-.07],[1.0,-.04],[1.0,.04],[.985,.07],[1.0,.1],[1.0,.24],[.985,.27],[1.0,.3],[.995,.36],[.95,.46],[.86,.5],[.64,.5]].map(([r,a])=>new THREE.Vector2(r,a));
  const tg=new THREE.LatheGeometry(lod?[prof[0],prof[2],prof[6],prof[13],prof[17],prof[19]]:prof,seg);tg.rotateZ(-Math.PI/2);B.add(tg,null,0x161616,veh_RUB);
  const ring=(r0,r1,x,col,mt)=>{const g=new THREE.RingGeometry(r0,r1,seg,1);g.rotateY(x<0?-Math.PI/2:Math.PI/2);B.add(g,veh_M(x,0,0),col,mt);};
  ring(.0,.66,-.48,0x0a0a0a,{ro:1});
  if(style==='alloy'){const L=[[.66,.47],[.64,.5],[.6,.49],[.58,.4],[.58,.1]].map(([r,a])=>new THREE.Vector2(r,a));const lg=new THREE.LatheGeometry(L,seg);lg.rotateZ(-Math.PI/2);B.add(lg,null,0xc7cbcf,{ro:.18,me:1});
    ring(0,.58,.12,0x2a2b2d,{ro:.6,me:.5});
    if(!lod){B.add(CYL(.44,.44,.04,28),veh_M(.06,0,0,0,0,Math.PI/2),0x6b6d70,{ro:.35,me:.9}); // brake disc
      for(let i=0;i<5;i++){const a=i/5*Math.PI*2;for(const off of[-.12,.12]){const aa=a+off;const g=veh_rbox(.07,.46,.06,.02,1);B.add(g,new THREE.Matrix4().compose(veh_p3.set(.42,Math.cos(aa)*.36,Math.sin(aa)*.36),veh_q.setFromEuler(veh_e.set(aa+(off>0?-.08:.08),0,0,'XYZ')),veh_s3.set(1,1,1)),0xc7cbcf,{ro:.2,me:1});}}
      B.add(CYL(.15,.17,.08,20),veh_M(.43,0,0,0,0,Math.PI/2),0xb9bdc1,{ro:.2,me:1});for(let i=0;i<5;i++){const a=i/5*Math.PI*2;B.add(CYL(.025,.025,.05,8),veh_M(.47,Math.cos(a)*.09,Math.sin(a)*.09,0,0,Math.PI/2),0x8a8d90,veh_CHR);}
      B.add(CYL(.06,.06,.02,14),veh_M(.475,0,0,0,0,Math.PI/2),0x222222,{ro:.4});}}
  else{ // steel wheel with hub cap / slots
    const L=[[.66,.44],[.6,.44],[.55,.36],[.5,.3]].map(([r,a])=>new THREE.Vector2(r,a));const lg=new THREE.LatheGeometry(L,seg);lg.rotateZ(-Math.PI/2);B.add(lg,null,0x55585c,{ro:.45,me:.8});
    ring(0,.5,.3,0x5d6064,{ro:.45,me:.8});
    if(!lod){for(let i=0;i<8;i++){const a=i/8*Math.PI*2;B.add(veh_rbox(.03,.12,.07,.02,1),new THREE.Matrix4().compose(veh_p3.set(.305,Math.cos(a)*.42,Math.sin(a)*.42),veh_q.setFromEuler(veh_e.set(a,0,0,'XYZ')),veh_s3.set(1,1,1)),0x1b1b1b,{ro:.9});}
      const hc=new THREE.SphereGeometry(.34,24,8,0,Math.PI*2,0,Math.PI/2);hc.scale(1,.25,1);hc.rotateZ(-Math.PI/2);B.add(hc,veh_M(.31,0,0),0xd5d8dc,{ro:.12,me:1});
      B.add(CYL(.07,.07,.02,14),veh_M(.4,0,0,0,0,Math.PI/2),0x333333,{ro:.4});}}
  return B.geo();}

// ================= pools =================
const veh_NEAR=130,veh_FAR=640,veh_NEAR2=veh_NEAR*veh_NEAR,veh_FAR2=veh_FAR*veh_FAR;
const VEH_POOL={};let veh_TRIS={};
function veh_im(geo,mat,cap,inst){const m=new THREE.InstancedMesh(geo,mat,cap);m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);m.frustumCulled=false;m.count=0;m.castShadow=true;m.receiveShadow=true;
  m.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(cap*3).fill(1),3);m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  if(inst){const a=new THREE.InstancedBufferAttribute(new Float32Array(cap),1);a.setUsage(THREE.DynamicDrawUsage);geo.setAttribute('aVar',a);}
  scene.add(m);return m;}
for(const name of['yaris','logan','lada','suv','sprinter','police']){const d=veh_DEFS[name];const build=d.van?veh_buildVan:veh_buildCar;const hi=build(d,false),lo=build(d,true);
  const near=veh_im(hi.body,veh_bodyMat,90,true);let glass=null;if(hi.glass&&hi.glass.attributes.position.count){glass=veh_im(hi.glass,veh_glassMat,90,false);glass.castShadow=false;glass.receiveShadow=false;glass.renderOrder=2;}
  const far=veh_im(lo.body,veh_bodyMat,260,true);VEH_POOL[name]={d,near,glass,far,nk:0,fk:0};veh_TRIS[name]=[hi.tris,lo.body.attributes.position.count/3];}
const veh_WHEEL={alloy:veh_im(veh_wheelGeo('alloy'),veh_bodyMat,460,false),steel:veh_im(veh_wheelGeo('steel'),veh_bodyMat,460,false)};
for(const k in veh_WHEEL)veh_WHEEL[k].k=0;
// lamp glows (brake / reverse / police strobe / daytime lights)
const veh_glowTex=ctex(64,64,g=>{const gr=g.createRadialGradient(32,32,2,32,32,32);gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(.25,'rgba(255,255,255,.55)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(0,0,64,64);},false);
const veh_lampIM=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:veh_glowTex,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}),700);
veh_lampIM.frustumCulled=false;veh_lampIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);veh_lampIM.setColorAt(0,veh_c.set(0));veh_lampIM.count=0;veh_lampIM.renderOrder=3;scene.add(veh_lampIM);
// taxi roof sign
const veh_signTex=ctex(256,96,g=>{g.fillStyle='#ffd23f';g.fillRect(0,0,256,96);g.fillStyle='#111';for(let i=0;i<16;i++)g.fillRect(i*16+(i%2?0:0),i%2?78:86,16,8);for(let i=0;i<16;i++)if(i%2)g.fillRect(i*16,86,16,10);else g.fillRect(i*16,78,16,8);
  g.font='900 58px Arial';g.textAlign='center';g.textBaseline='middle';g.fillText('TAXI',128,40);},false);
const veh_signIM=(()=>{const geo=new THREE.BoxGeometry(.72,.24,.3);const m=new THREE.InstancedMesh(geo,new THREE.MeshStandardMaterial({map:veh_signTex,roughness:.35,emissive:0x332200,emissiveIntensity:.4}),200);
  m.frustumCulled=false;m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);m.count=0;m.castShadow=true;scene.add(m);return m;})();
const veh_signBase=veh_im((()=>{const B=new veh_B();B.add(veh_rbox(.78,.05,.34,.02,1),null,0x1a1a1a,veh_BLK);for(const s of[1,-1])B.add(BOX(.04,.03,.4),veh_M(s*.3,-.035,0),0x111111,veh_BLK);return B.geo();})(),veh_bodyMat,200,false);
// police light bar (red | blue halves modulated per instance)
const veh_barIM=(()=>{const B=new veh_B();B.add(veh_rbox(1.22,.08,.3,.03,1),veh_M(0,-.06,0),0x1a1a1a,veh_BLK);B.add(veh_rbox(.56,.12,.26,.05,2),veh_M(-.31,.04,0),0xff1a1a,{});B.add(veh_rbox(.56,.12,.26,.05,2),veh_M(.31,.04,0),0x2050ff,{});
  const m=new THREE.InstancedMesh(B.geo(),new THREE.MeshBasicMaterial({vertexColors:true}),60);m.frustumCulled=false;m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);m.setColorAt(0,veh_c.set(0xffffff));m.count=0;scene.add(m);return m;})();
// blob shadows
const veh_blobIM=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),blobMat,700);veh_blobIM.frustumCulled=false;veh_blobIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);veh_blobIM.count=0;scene.add(veh_blobIM);

// ================= trolleybus =================
const veh_TROUTES=['1','2','3','4','5','7','8','10','11','12','13','16','17','20','22','24','25','28','29','30','34','36'];
const veh_TL=12,veh_TW=2.55,veh_TH=3.38;
function veh_trolleyTextures(variant){
  const side=document.createElement('canvas');side.width=2048;side.height=1024;const g=side.getContext('2d');
  const rowY=(off,y)=>off+512*(1-y/veh_TH);
  for(const [off,doors] of[[0,false],[512,true]]){const zpx=z=>doors?(z+6)/12*2048:(6-z)/12*2048;const R=(z0,z1,y0,y1,fill)=>{const a=zpx(z0),b=zpx(z1);g.fillStyle=fill;g.fillRect(Math.min(a,b),rowY(off,y1),Math.abs(b-a),rowY(off,y0)-rowY(off,y1));};
    g.fillStyle=variant?'#f3efe2':'#f7f7f5';g.fillRect(0,off,2048,512);
    R(-6.1,6.1,3.02,3.6,'#d4d7da');R(-6.1,6.1,.28,.52,'#33363b');
    if(variant===0){R(-6.1,6.1,.52,.98,'#1d5fb4');g.fillStyle='#1d5fb4';g.beginPath();g.moveTo(zpx(-6.1),rowY(off,.98));g.lineTo(zpx(-1.5),rowY(off,.98));g.lineTo(zpx(-4.2),rowY(off,1.18));g.lineTo(zpx(-6.1),rowY(off,1.18));g.fill();
      R(-6.1,6.1,2.72,2.86,'#1d5fb4');g.fillStyle='#4aa3ff';g.beginPath();g.moveTo(zpx(-6.1),rowY(off,1.02));g.lineTo(zpx(-.4),rowY(off,1.02));g.lineTo(zpx(-.9),rowY(off,1.08));g.lineTo(zpx(-6.1),rowY(off,1.08));g.fill();}
    else{R(-6.1,6.1,.52,1.12,'#2a4f8f');R(-6.1,6.1,1.12,1.17,'#c9302c');for(let y=.6;y<1.1;y+=.12)R(-6.1,6.1,y,y+.015,'#3b62a6');}
    // windows band
    const glass=(z0,z1,y0,y1)=>{const a=zpx(z0),b=zpx(z1),x=Math.min(a,b),w=Math.abs(b-a),Y=rowY(off,y1),h=rowY(off,y0)-Y;const gr=g.createLinearGradient(0,Y,0,Y+h);gr.addColorStop(0,'#8ea6bb');gr.addColorStop(.35,'#3a4c5d');gr.addColorStop(1,'#141c24');g.fillStyle=gr;g.fillRect(x,Y,w,h);
      g.fillStyle='rgba(255,255,255,.12)';g.beginPath();g.moveTo(x+w*.15,Y);g.lineTo(x+w*.35,Y);g.lineTo(x+w*.1,Y+h);g.lineTo(x-w*.1,Y+h);g.fill();
      g.fillStyle='rgba(30,30,30,.55)';for(let k=0;k<3;k++)g.fillRect(x+w*(.2+k*.27),Y+h*.55,w*.16,h*.45);};
    const doorZ=variant?[[4.6,5.6],[-.25,.85],[-4.95,-3.95]]:[[4.45,5.65],[0,1.25],[-4.65,-3.4]];
    let z=5.85;const segs=[];while(z>-5.84){const z1=Math.max(-5.85,z-1.42);segs.push([z1,z]);z=z1;}
    for(const [a,b] of segs){let ok=true;if(doors)for(const [d0,d1] of doorZ)if(b>d0-.05&&a<d1+.05)ok=false;if(ok)glass(a+.05,b-.05,1.22,2.62);}
    if(!doors)glass(4.3,5.85,1.22,2.62);
    R(-6.1,6.1,2.62,2.66,'#2b2f33');R(-6.1,6.1,1.18,1.22,'#2b2f33');
    if(doors)for(const [d0,d1] of doorZ){R(d0,d1,.36,2.66,'#c5cacf');const m=(d0+d1)/2;glass(d0+.06,m-.02,.48,2.58);glass(m+.02,d1-.06,.48,2.58);R(m-.015,m+.015,.4,2.62,'#22262a');R(d0,d1,.36,.44,'#1a1a1a');}
    // wheel arches
    for(const az of[3.9,-2.5]){const cx=zpx(az),cy=rowY(off,.3),r=512*.66/veh_TH;g.fillStyle='#202224';g.beginPath();g.ellipse(cx,cy,r*(2048/12)/(512/veh_TH),r,0,Math.PI,0);g.fill();}
    g.fillStyle=variant?'#2a4f8f':'#fff';g.font='900 40px Arial';g.textAlign='center';g.textBaseline='middle';if(!variant){g.fillText('CHIȘINĂU',zpx(-3.2),rowY(off,.76));}
    g.fillStyle='#222';g.font='bold 26px Arial';g.fillText(String(1200+((off*7)%800)+(variant?2000:3000)),zpx(5.0),rowY(off,2.94));}
  const front=document.createElement('canvas');front.width=front.height=512;const f=front.getContext('2d');
  const fy=y=>512*(1-y/veh_TH),fx=x=>(x+veh_TW/2)/veh_TW*512;
  f.fillStyle=variant?'#f3efe2':'#f7f7f5';f.fillRect(0,0,512,512);f.fillStyle='#d4d7da';f.fillRect(0,0,512,fy(3.05));
  f.fillStyle=variant?'#2a4f8f':'#1d5fb4';f.fillRect(0,fy(1.08),512,fy(.55)-fy(1.08));f.fillStyle='#2c2f33';f.fillRect(0,fy(.55),512,512-fy(.55));
  {const gr=f.createLinearGradient(0,fy(2.95),0,fy(1.15));gr.addColorStop(0,'#9db3c6');gr.addColorStop(.4,'#3d5163');gr.addColorStop(1,'#121a22');f.fillStyle=gr;
   const r=40;const x0=fx(-1.18),x1=fx(1.18),y0=fy(2.95),y1=fy(1.15);f.beginPath();f.moveTo(x0+r,y0);f.lineTo(x1-r,y0);f.quadraticCurveTo(x1,y0,x1,y0+r);f.lineTo(x1,y1);f.lineTo(x0,y1);f.lineTo(x0,y0+r);f.quadraticCurveTo(x0,y0,x0+r,y0);f.fill();
   f.fillStyle='rgba(255,255,255,.14)';f.beginPath();f.moveTo(fx(-.6),y0);f.lineTo(fx(-.2),y0);f.lineTo(fx(-.9),y1);f.lineTo(fx(-1.2),y1);f.fill();
   if(variant){f.fillStyle='#2b2f33';f.fillRect(fx(-.02),y0,10,y1-y0);}
   f.strokeStyle='#111';f.lineWidth=5;f.beginPath();f.moveTo(fx(-.9),y1-6);f.lineTo(fx(-.15),y1-120);f.moveTo(fx(.2),y1-6);f.lineTo(fx(.95),y1-120);f.stroke();}
  f.fillStyle='#111';f.fillRect(fx(-1.05),fy(3.3),fx(1.05)-fx(-1.05),fy(2.98)-fy(3.3));
  for(const s of[-1,1]){if(variant){f.fillStyle='#ddd';f.beginPath();f.arc(fx(s*.92),fy(.82),22,0,Math.PI*2);f.fill();f.fillStyle='#fffbe0';f.beginPath();f.arc(fx(s*.92),fy(.82),16,0,Math.PI*2);f.fill();}
    else{f.fillStyle='#cfd3d6';f.fillRect(fx(s*.95)-46,fy(.95),92,fy(.7)-fy(.95));f.fillStyle='#fffbe6';f.fillRect(fx(s*.95)-40,fy(.92),80,fy(.73)-fy(.92));f.fillStyle='#e08a1c';f.fillRect(fx(s*.95)-40,fy(.72)+2,80,10);}}
  f.fillStyle='#e6e6e6';f.fillRect(fx(-.26),fy(.5),fx(.26)-fx(-.26),fy(.38)-fy(.5));
  const back=document.createElement('canvas');back.width=back.height=512;const b=back.getContext('2d');
  b.fillStyle=variant?'#f3efe2':'#f7f7f5';b.fillRect(0,0,512,512);b.fillStyle='#d4d7da';b.fillRect(0,0,512,fy(3.05));b.fillStyle=variant?'#2a4f8f':'#1d5fb4';b.fillRect(0,fy(1.08),512,fy(.55)-fy(1.08));b.fillStyle='#2c2f33';b.fillRect(0,fy(.55),512,512-fy(.55));
  {const gr=b.createLinearGradient(0,fy(2.85),0,fy(1.9));gr.addColorStop(0,'#7d93a6');gr.addColorStop(1,'#141c24');b.fillStyle=gr;b.fillRect(fx(-.95),fy(2.85),fx(.95)-fx(-.95),fy(1.9)-fy(2.85));}
  for(const s of[-1,1]){b.fillStyle='#b3121a';b.fillRect(fx(s*1.02)-28,fy(1.45),56,fy(.65)-fy(1.45));b.fillStyle='#dd8a1c';b.fillRect(fx(s*1.02)-28,fy(.65),56,22);}
  b.fillStyle='#555';for(let i=0;i<7;i++)b.fillRect(fx(.45),fy(1.2+i*.27),70,6);b.fillRect(fx(.45),fy(3.05),6,fy(1.2)-fy(3.05));b.fillRect(fx(.45)+64,fy(3.05),6,fy(1.2)-fy(3.05));
  b.fillStyle='#fff';b.fillRect(fx(-.26),fy(.5),fx(.26)-fx(-.26),fy(.38)-fy(.5));
  const T=c=>{const t=new THREE.CanvasTexture(c);t.anisotropy=renderer.capabilities.getMaxAnisotropy();return t;};
  return {side:T(side),front:T(front),back:T(back)};}
const veh_TRT=[veh_trolleyTextures(0),veh_trolleyTextures(1)];
const veh_TMAT=veh_TRT.map(t=>({side:new THREE.MeshPhysicalMaterial({map:t.side,roughness:.38,metalness:.05,clearcoat:.8,clearcoatRoughness:.12,envMap:veh_env}),
  front:new THREE.MeshPhysicalMaterial({map:t.front,roughness:.3,metalness:.05,clearcoat:.8,envMap:veh_env}),back:new THREE.MeshPhysicalMaterial({map:t.back,roughness:.35,clearcoat:.6,envMap:veh_env})}));
const veh_TGEO=[0,1].map(variant=>{const rt=variant?.16:.34,rbb=.06,n=6;
  const st=variant?[[-6,1.22,3.3,rt],[-5.96,1.265,3.36,rt],[-5.85,1.275,3.38,rt],[5.85,1.275,3.38,rt],[5.96,1.265,3.36,rt],[6,1.22,3.3,rt]]
                  :[[-6,1.2,3.3,rt],[-5.94,1.26,3.36,rt],[-5.8,1.275,3.38,rt],[5.7,1.275,3.38,rt],[5.88,1.262,3.34,rt],[6,1.225,3.28,rt]];
  const secs=st.map(([z,hw,yt,r])=>({z,pts:veh_sec(hw,.32,yt,rbb,r,hw-.03,n)}));
  const uvFn=(x,y,z,side,front)=>{if(side===0){return front?[(x+veh_TW/2)/veh_TW,Math.min(1,y/veh_TH)]:[(veh_TW/2-x)/veh_TW,Math.min(1,y/veh_TH)];}
    const t=Math.min(1,Math.max(0,y/veh_TH));return side>0?[(6-z)/12,.5+.5*t]:[(z+6)/12,.5*t];};
  const parts=veh_loft(secs,true,uvFn);
  const D=new veh_B();
  // bumpers, mirrors ("rabbit ears"), roof equipment, pole platform & hooks, wipers
  D.add(veh_rbox(2.5,.32,.24,.08,2),veh_M(0,.5,6.02),0x2a2c30,veh_BLK);D.add(veh_rbox(2.5,.3,.22,.08,2),veh_M(0,.48,-6.02),0x2a2c30,veh_BLK);
  for(const s of[1,-1]){const a=[s*1.15,3.0,5.9],b=[s*1.42,2.86,6.35];const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],l=Math.hypot(dx,dy,dz);
    D.add(CYL(.025,.025,l,8),new THREE.Matrix4().compose(veh_p3.set((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2),new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(dx/l,dy/l,dz/l)),veh_s3.set(1,1,1)),0x1b1b1b,veh_MET);
    D.add(veh_rbox(.1,.46,.24,.04,2),veh_M(s*1.44,2.6,6.36),0x1b1b1b,veh_BLK);D.add(BOX(.01,.4,.2),veh_M(s*1.385,2.6,6.36),0x8899aa,veh_CHR);
    D.add(BOX(.1,.12,.3),veh_M(s*.32,3.42,-5.75),0x333333,veh_MET);}
  D.add(veh_rbox(1.95,.38,2.3,.12,2),veh_M(0,3.55,3.5),0xd9dcdf,{ro:.4,me:.2,co:.5});D.add(veh_rbox(1.6,.26,1.7,.08,2),veh_M(0,3.5,1.0),0xc9ccd0,{ro:.45,me:.2});
  D.add(veh_rbox(2.0,.32,2.5,.1,2),veh_M(0,3.52,-3.6),0xd9dcdf,{ro:.4,me:.2,co:.5});for(let i=0;i<6;i++)D.add(BOX(1.7,.02,.06),veh_M(0,3.72,-4.6+i*.35),0x9a9da0,veh_MET);
  for(const s of[1,-1])D.add(veh_rbox(.24,.16,.55,.05,1),veh_M(s*.32,3.66,1.0),0x2a2a2a,veh_MET);
  for(const az of[3.9,-2.5])for(const s of[1,-1])D.add(new THREE.RingGeometry(.6,.68,20,1,0,Math.PI),veh_M(s*1.279,.32,az,s*Math.PI/2),0x1a1a1a,veh_BLK);
  return {body:parts[0],caps:[parts[1],parts[2]],det:D.geo()};});
const veh_routeMat={};
function veh_routeSign(num){if(veh_routeMat[num])return veh_routeMat[num];const t=ctex(256,48,g=>{g.fillStyle='#0b0b0b';g.fillRect(0,0,256,48);g.fillStyle='#ff9a1a';g.font='900 34px Arial';g.textBaseline='middle';g.textAlign='left';g.fillText(num,10,25);
  g.font='bold 18px Arial';g.fillText(num==='22'||num==='4'?'BD. DACIA':num==='10'||num==='24'?'STR. MIORIȚA':'CENTRU',70,25);g.fillStyle='rgba(255,154,26,.2)';for(let y=0;y<48;y+=3)g.fillRect(0,y,256,1);},false);
  return veh_routeMat[num]=new THREE.MeshBasicMaterial({map:t});}
const veh_poleMat=new THREE.MeshStandardMaterial({color:0x262626,roughness:.5,metalness:.6});
function veh_makeTrolley(){const variant=Math.random()<.35?1:0,num=mpick(veh_TROUTES);const g=new THREE.Group();const G=veh_TGEO[variant],Mt=veh_TMAT[variant];
  const body=new THREE.Mesh(G.body,Mt.side);const cr=new THREE.Mesh(G.caps[0],Mt.back),cf=new THREE.Mesh(G.caps[1],Mt.front);const det=new THREE.Mesh(G.det,veh_staticMat);
  for(const m of[body,cr,cf,det]){m.castShadow=m.receiveShadow=true;g.add(m);}
  const rs=new THREE.Mesh(new THREE.PlaneGeometry(1.95,.3),veh_routeSign(num));rs.position.set(0,3.14,6.012);g.add(rs);
  const ss=new THREE.Mesh(new THREE.PlaneGeometry(1.1,.2),veh_routeSign(num));ss.position.set(-1.282,2.4,4.0);ss.rotation.y=-Math.PI/2;g.add(ss);
  const poles=[];for(const s of[-1,1]){const piv=new THREE.Group();piv.position.set(s*.32,3.75,1.0);
    const p=new THREE.Mesh(CYL(.03,.04,6.2,8),veh_poleMat);p.rotation.x=Math.PI/2;p.position.z=-3.1;piv.add(p);
    const sp=new THREE.Mesh(CYL(.07,.07,.45,10),veh_poleMat);sp.rotation.x=Math.PI/2;sp.position.z=-.15;piv.add(sp);
    const sh=new THREE.Mesh(BOX(.1,.09,.32),veh_poleMat);sh.position.set(0,.04,-6.22);piv.add(sh);const wh=new THREE.Mesh(CYL(.05,.05,.04,10),veh_poleMat);wh.rotation.z=Math.PI/2;wh.position.set(0,.1,-6.25);piv.add(wh);
    piv.rotation.x=.33;g.add(piv);poles.push(piv);for(const o of piv.children)o.castShadow=true;}
  const bl=new THREE.Mesh(new THREE.PlaneGeometry(veh_TW*1.4,veh_TL*1.08).rotateX(-Math.PI/2),blobMat);bl.position.y=.06;g.add(bl);
  scene.add(g);return {g,poles};}

// ================= vehicle API =================
const SPEC={
  taxi:{model:'yaris',max:38,acc:11,brake:26,turn:2.1,cam:8.2,camH:3.0,name:'Toyota Yaris · Taxi'},
  yaris:{model:'yaris',max:38,acc:11,brake:26,turn:2.1,cam:8.2,camH:3.0,name:'Toyota Yaris'},
  logan:{model:'logan',max:40,acc:10,brake:24,turn:2.0,cam:8.6,camH:3.1,name:'Dacia Logan'},
  lada:{model:'lada',max:31,acc:7.5,brake:18,turn:1.9,cam:8.4,camH:3.0,name:'VAZ-2107 „Jiguli”'},
  suv:{model:'suv',max:41,acc:10.5,brake:25,turn:1.95,cam:9,camH:3.3,name:'Toyota RAV4'},
  rutiera:{model:'sprinter',max:30,acc:6.8,brake:17,turn:1.45,cam:11,camH:4.3,name:'Mercedes Sprinter · Rutieră'},
  police:{model:'police',max:45,acc:12.5,brake:27,turn:2.15,cam:8.8,camH:3.1,name:'Poliția'},
  trolley:{model:null,max:19,acc:3.8,brake:10,turn:.95,cam:17,camH:6,name:'Troleibuz',len:12,wid:2.55},
};
for(const k in SPEC){const s=SPEC[k];if(s.model){const d=veh_DEFS[s.model];s.len=d.L;s.wid=d.W;}}
const veh_PAINTS={yaris:[0xc9ccd0,0x1f1f22,0xb51d24,0x2a4f8a,0xe8e8e6,0x6b6e72,0x8a9a5b],logan:[0xe8e8e6,0x8d9298,0x2b2d31,0x7a1c20,0x23395c,0x5d6b55,0xb7a98a,0x3d4a5c],
  lada:[0xf1efe4,0xb94a32,0x2d5b3a,0x55224a,0xd8c48d,0x3b6aa3,0x8a8f7a,0x6e1f22],suv:[0xe8e8e6,0x2b2d31,0x8d9298,0x5a1f24,0x39465a,0x6f7a63],sprinter:[0xf4f4f2,0xeeeeea,0xf3f1ea],police:[0xf7f7f7]};
const vehicles=[];
function makeVehicle(type,x,z,h,paint){const sp=SPEC[type];
  const v={type,spec:sp,x,z,h,speed:0,mode:'parked',ai:null,driver:false,stuck:0,rev:0,wire:true,v0:12,steer:0,
    veh_rot:Math.random()*6,veh_ps:0,veh_brk:0,veh_var:Math.floor(Math.random()*veh_COLS),veh_st:0};
  if(type==='trolley'){const t=veh_makeTrolley();v.g=t.g;v.poles=t.poles;}
  else{v.veh_pool=VEH_POOL[sp.model];v.paint=paint!=null?paint:type==='taxi'?(Math.random()<.85?0xf2c318:0xf4f4f2):mpick(veh_PAINTS[sp.model]);v.veh_col=new THREE.Color(v.paint);}
  v.y=veh_sy(x,z,null,Math.sin(h),Math.cos(h));v.pitch=0;v.roll=0;vehicles.push(v);return v;}
function removeVehicle(v){const i=vehicles.indexOf(v);if(i>=0)vehicles.splice(i,1);if(v.g)scene.remove(v.g);}

// ================= per-frame render (instance compaction + LOD) =================
const veh_fr=new THREE.Frustum(),veh_pmx=new THREE.Matrix4(),veh_sph=new THREE.Sphere(),veh_m4=new THREE.Matrix4(),veh_m5=new THREE.Matrix4(),veh_m6=new THREE.Matrix4(),veh_qq=new THREE.Quaternion(),veh_up=new THREE.Vector3(0,1,0),veh_one=new THREE.Vector3(1,1,1),veh_tp=new THREE.Vector3(),veh_ts=new THREE.Vector3();
const veh_qy=new THREE.Quaternion(),veh_qx=new THREE.Quaternion(),veh_qs=new THREE.Quaternion(),veh_X=new THREE.Vector3(1,0,0);
let veh_lk=0;
function veh_lamp(base,x,y,z,sx,sy,col,ry){veh_m5.compose(veh_tp.set(x,y,z),veh_qq.setFromAxisAngle(veh_up,ry||0),veh_ts.set(sx,sy,1));veh_m5.premultiply(base);if(veh_lk<700){veh_lampIM.setMatrixAt(veh_lk,veh_m5);veh_lampIM.setColorAt(veh_lk,veh_c.set(col));veh_lk++;}}
function veh_wheelsOf(v,base,W,hwAt,near,dt){const im=veh_WHEEL[W.style];if(!near)return;
  for(const az of[W.zf,W.zr])for(const s of[1,-1]){if(im.k>=460)return;const front=az===W.zf;
    veh_qy.setFromAxisAngle(veh_up,(front?-v.steer*.42:0)+(s<0?Math.PI:0));veh_qx.setFromAxisAngle(veh_X,s>0?v.veh_rot:-v.veh_rot);veh_qs.multiplyQuaternions(veh_qy,veh_qx);
    const x=s*(hwAt(az)-W.tw/2+(W.out||.02));veh_m5.compose(veh_tp.set(x,W.r,az),veh_qs,veh_ts.set(W.tw,W.r,W.r));veh_m5.premultiply(base);im.setMatrixAt(im.k++,veh_m5);}}
const veh_HW={};for(const k in veh_DEFS){const d=veh_DEFS[k];veh_HW[k]=d.van?(z=>.995):veh_interp(veh_refine(d.body,4),1);}
const veh_TWHEEL={r:.5,tw:.3,zf:3.9,zr:-2.5,style:'steel',out:.03};const veh_THW=()=>1.275;
// ---- terrain: ground height + pitch/roll from the four wheel-contact heights (exposes v.y, v.pitch, v.roll) ----
const veh_eu=new THREE.Euler(0,0,0,'YXZ');
const veh_gy=(x,z)=>typeof groundY==='function'?groundY(x,z):0;
// road surface (bridge decks via bridges.js); refY = vehicle's previous height so it can also pass UNDER a bridge
const veh_sy=(x,z,r,hx,hz)=>typeof surfaceY==='function'?surfaceY(x,z,r,hx,hz):veh_gy(x,z);
function veh_ground(v,dt){const W=v.g?veh_TWHEEL:v.veh_pool.d.wheel,zf=W.zf,zr=W.zr,hw=v.spec.wid*.42,sh=Math.sin(v.h),ch=Math.cos(v.h);
  const ry=v.y==null||!isFinite(v.y)?null:v.y,G=(a,s)=>veh_sy(v.x+sh*a+ch*s*hw,v.z+ch*a-sh*s*hw,ry,sh,ch);
  const yfl=G(zf,1),yfr=G(zf,-1),yrl=G(zr,1),yrr=G(zr,-1),yf=(yfl+yfr)*.5,yr=(yrl+yrr)*.5;
  const pitch=Math.atan2(yf-yr,zf-zr),roll=Math.atan2((yfl+yrl)-(yfr+yrr),4*hw);
  v.y=yr+(yf-yr)*(-zr)/(zf-zr);
  if(v.veh_pt==null||!(dt>0)){v.veh_pt=pitch;v.veh_rl=roll;}else{const k=1-Math.exp(-dt*10);v.veh_pt+=(pitch-v.veh_pt)*k;v.veh_rl+=(roll-v.veh_rl)*k;}
  v.pitch=v.veh_pt;v.roll=v.veh_rl;}
function renderVehicles(dt){dt=dt||0.016;
  camera.updateMatrixWorld();veh_pmx.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);veh_fr.setFromProjectionMatrix(veh_pmx);
  const cx=camera.position.x,cz=camera.position.z,now=performance.now(),flash=(now/140|0)%2,flash2=(now/70|0)%4===0;
  for(const k in VEH_POOL){VEH_POOL[k].nk=0;VEH_POOL[k].fk=0;}veh_WHEEL.alloy.k=veh_WHEEL.steel.k=0;veh_lk=0;let sk=0,bk=0,blk=0;
  for(const v of vehicles){const sp=v.speed||0;v.veh_rot+=sp*dt/(v.g?.5:veh_DEFS[v.spec.model].wheel.r);
    const acc=(sp-v.veh_ps)/Math.max(dt,1e-3);v.veh_ps=sp;const moving=v.mode!=='parked';
    const want=moving&&(acc<-1.2||(Math.abs(sp)<.4&&v.mode!=='player')||(v.mode==='player'&&Math.abs(sp)<.4))?1:0;v.veh_brk+=(want-v.veh_brk)*Math.min(1,dt*12);
    const dx=v.x-cx,dz=v.z-cz,d2=dx*dx+dz*dz;
    // ground fit = 4 surface queries: only when the car moved and is close enough to matter (or is the player's)
    if((v._gx!==v.x||v._gz!==v.z||v._gh!==v.h||v.y==null)&&(d2<veh_FAR2*1.2||v.mode==='player'||v.y==null)){veh_ground(v,dt);v._gx=v.x;v._gz=v.z;v._gh=v.h;}
    veh_qq.setFromEuler(veh_eu.set(-v.pitch,v.h,v.roll));veh_m4.compose(veh_tp.set(v.x,v.y,v.z),veh_qq,veh_one);
    if(v.g){const vis=d2<veh_FAR2;v.g.visible=vis;if(!vis)continue;v.g.position.set(v.x,v.y,v.z);v.g.quaternion.copy(veh_qq);
      veh_sph.center.set(v.x,v.y+1.7,v.z);veh_sph.radius=7;if(!veh_fr.intersectsSphere(veh_sph))continue;
      veh_wheelsOf(v,veh_m4,veh_TWHEEL,veh_THW,d2<veh_NEAR2*1.6,dt);
      if(d2<veh_NEAR2*2){const b=.25+v.veh_brk*1.1;for(const s of[-1,1]){veh_lamp(veh_m4,s*1.02,1.05,-6.04,.5*b+.2,.8*b+.2,veh_c.setRGB(.9*b,.08*b,.06*b).getHex(),Math.PI);veh_lamp(veh_m4,s*.92,.82,6.04,.38,.28,0x6b6550,0);}}
      continue;}
    if(d2>veh_FAR2)continue;
    veh_sph.center.set(v.x,v.y+1,v.z);veh_sph.radius=v.spec.len*.6+1;if(!veh_fr.intersectsSphere(veh_sph))continue;
    const P=v.veh_pool,near=d2<veh_NEAR2;
    if(near){if(P.nk<90){P.near.setMatrixAt(P.nk,veh_m4);P.near.setColorAt(P.nk,v.veh_col);P.near.geometry.attributes.aVar.setX(P.nk,v.veh_var);if(P.glass)P.glass.setMatrixAt(P.nk,veh_m4);P.nk++;}}
    else if(P.fk<260){P.far.setMatrixAt(P.fk,veh_m4);P.far.setColorAt(P.fk,v.veh_col);P.fk++;}
    const d=P.d;veh_wheelsOf(v,veh_m4,d.wheel,veh_HW[v.spec.model],near,dt);
    if(blk<700){veh_m5.compose(veh_tp.set(v.x,v.y+.055,v.z),veh_qq,veh_ts.set(v.spec.wid*1.5,1,v.spec.len*1.15));veh_blobIM.setMatrixAt(blk++,veh_m5);}
    if(d2<veh_NEAR2*3){const L=d.lamps;
      const b=v.veh_brk,rev=sp<-.3;for(const t of L.tail){const k=.22+b*1.0;veh_lamp(veh_m4,t[0],t[1],t[2]-.03,.36*k+.12,.22*k+.1,rev?0xbfbfbf:veh_c.setRGB(.95*k,.07*k,.05*k).getHex(),Math.PI);}
      if(moving)for(const t of L.head)veh_lamp(veh_m4,t[0],t[1],t[2]+.03,.32,.2,0x5a5548,0);}
    if(v.type==='taxi'&&sk<200){const rz=-.55,ry=d.cab.roof[1]+.02;veh_m5.compose(veh_tp.set(0,ry+.15,rz),veh_qs.set(0,0,0,1),veh_one);veh_m5.premultiply(veh_m4);veh_signIM.setMatrixAt(sk,veh_m5);
      veh_m5.compose(veh_tp.set(0,ry+.03,rz),veh_qs.set(0,0,0,1),veh_one);veh_m5.premultiply(veh_m4);veh_signBase.setMatrixAt(sk,veh_m5);sk++;}
    if(v.type==='police'&&bk<60){const ry=d.cab.roof[1]+.08;veh_m5.compose(veh_tp.set(0,ry,-.1),veh_qs.set(0,0,0,1),veh_one);veh_m5.premultiply(veh_m4);veh_barIM.setMatrixAt(bk,veh_m5);
      const ch=v.mode==='chase';veh_barIM.setColorAt(bk,ch?veh_c.setRGB(flash?1:.15,flash?.4:.4,flash?.15:1):veh_c.setRGB(.35,.35,.35));bk++;
      if(ch){const red=flash;veh_lamp(veh_m4,red?-.31:.31,ry+.05,-.1,2.2,1.4,red?0xff2020:0x2060ff,0);veh_lamp(veh_m4,red?-.31:.31,ry+.05,-.1,2.2,1.4,red?0xff2020:0x2060ff,Math.PI);
        if(flash2)veh_lamp(veh_m4,0,ry+.06,.0,3.4,2.2,0xffffff,Math.PI/2);}}}
  for(const k in VEH_POOL){const P=VEH_POOL[k];P.near.count=P.nk;if(P.glass)P.glass.count=P.nk;P.far.count=P.fk;
    for(const m of[P.near,P.glass,P.far])if(m)m.instanceMatrix.needsUpdate=true;P.near.instanceColor.needsUpdate=true;P.far.instanceColor.needsUpdate=true;P.near.geometry.attributes.aVar.needsUpdate=true;}
  for(const k in veh_WHEEL){const m=veh_WHEEL[k];m.count=m.k;m.instanceMatrix.needsUpdate=true;}
  veh_lampIM.count=veh_lk;veh_lampIM.instanceMatrix.needsUpdate=true;if(veh_lampIM.instanceColor)veh_lampIM.instanceColor.needsUpdate=true;
  veh_signIM.count=veh_signBase.count=sk;veh_signIM.instanceMatrix.needsUpdate=true;veh_signBase.instanceMatrix.needsUpdate=true;
  veh_barIM.count=bk;veh_barIM.instanceMatrix.needsUpdate=true;if(veh_barIM.instanceColor)veh_barIM.instanceColor.needsUpdate=true;
  veh_blobIM.count=blk;veh_blobIM.instanceMatrix.needsUpdate=true;}
const veh_WT={alloy:veh_WHEEL.alloy.geometry.attributes.position.count/3,steel:veh_WHEEL.steel.geometry.attributes.position.count/3};
window.veh_stats=()=>{let t=0,calls=0;for(const k in VEH_POOL){const P=VEH_POOL[k];t+=P.near.count*veh_TRIS[k][0]+P.far.count*veh_TRIS[k][1];calls+=(P.near.count?1:0)+(P.glass&&P.glass.count?1:0)+(P.far.count?1:0);}
  for(const k in veh_WHEEL){t+=veh_WHEEL[k].count*veh_WT[k];calls+=veh_WHEEL[k].count?1:0;}
  let tr=0;for(const v of vehicles)if(v.g&&v.g.visible){tr++;}calls+=tr*7+4;
  return {frameVehicleTris:Math.round(t+tr*(veh_TGEO[0].body.index.count/3+veh_TGEO[0].det.attributes.position.count/3)),approxCalls:calls,visibleTrolleys:tr,model:veh_TRIS,wheelTris:veh_WT};};
