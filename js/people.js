'use strict';
// Pedestrian + player character models. Owner: PEOPLE agent.
// Characters are built from 6 rigid parts (torso, head, upper arm, forearm+hand, thigh, shin+shoe), each one
// InstancedMesh shared by all pedestrians (arms/legs hold 2 instances per person: i = left, i+PEDN = right).
// One material with a small shader patch: every vertex carries a colour SLOT (skin/top/bottom/hair/shoe/accent…)
// and a FEATURE bit (hair style, cap, headscarf, skirt, coat, backpack, bag, phone…). Each instance carries its
// palette + a feature mask, so a single draw call per part renders dozens of different outfits.
const PEDN=90;
const SHIRTS=[0xc0392b,0x2c3e50,0x27ae60,0x8e44ad,0xecf0f1,0x34495e,0xd35400,0x16a085,0x7f8c8d,0xf1c40f,0x2980b9,0x6d4c41,0x111111],PANTS=[0x2c3e50,0x1b1b1b,0x34495e,0x5d4037,0x3b4a6b,0x6b6b6b],SKIN=[0xe8c3a0,0xd9a77f,0xf0d2b6,0xc69072];

// ---------- feature bits & colour slots ----------
const ppl_F={hairS:1,hairL:2,bun:4,cap:8,scarf:16,skirt:32,pack:64,bag:128,sleeves:256,pants:512,coat:1024,beard:2048,jacket:4096,hair:8192,stripes:16384,bust:32768,glasses:65536,shop:131072,phone:262144,hood:524288};
const ppl_S={fix:0,skin:1,top:2,bot:3,hair:4,shoe:5,acc:6,sleeve:7,shin:8,topDk:9,lip:10,hairDk:11};

// ---------- geometry builder (position, normal, color, aSF = [slot, feature]) ----------
const ppl_v=new THREE.Vector3(),ppl_n=new THREE.Vector3(),ppl_nm=new THREE.Matrix3(),ppl_c=new THREE.Color();
class ppl_Part{
  constructor(){this.p=[];this.n=[];this.c=[];this.sf=[];}
  add(geo,m,slot,feat=0,col=0xffffff){const g=geo.index?geo.toNonIndexed():geo;const P=g.attributes.position,N=g.attributes.normal;
    ppl_nm.getNormalMatrix(m);ppl_c.set(col);
    for(let i=0;i<P.count;i++){ppl_v.fromBufferAttribute(P,i).applyMatrix4(m);ppl_n.fromBufferAttribute(N,i).applyMatrix3(ppl_nm).normalize();
      this.p.push(ppl_v.x,ppl_v.y,ppl_v.z);this.n.push(ppl_n.x,ppl_n.y,ppl_n.z);this.c.push(ppl_c.r,ppl_c.g,ppl_c.b);
      this.sf.push(typeof slot==='function'?slot(ppl_v.x,ppl_v.y,ppl_v.z):slot,feat);}
    return this;}
  geo(){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(this.p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(this.n,3));
    g.setAttribute('color',new THREE.Float32BufferAttribute(this.c,3));g.setAttribute('aSF',new THREE.Float32BufferAttribute(this.sf,2));g.computeBoundingSphere();return g;}
}
let ppl_LO=false;const ppl_seg=n=>ppl_LO?Math.max(3,Math.round(n*.5)):n;
const ppl_lathe=(prof,seg=12,open=false,phiS=0,phiL=TAU)=>{const g=new THREE.LatheGeometry(prof.map(([r,y])=>new THREE.Vector2(Math.max(r,1e-4),y)),Math.max(4,ppl_seg(seg)),phiS,phiL);g.computeVertexNormals();return g;};
const ppl_sph=(r,ws=12,hs=8,ts=0,tl=Math.PI,ps=0,pl=TAU)=>new THREE.SphereGeometry(r,Math.max(4,ppl_seg(ws)),Math.max(2,ppl_seg(hs)),ps,pl,ts,tl);
const ppl_box=(w,h,d)=>new THREE.BoxGeometry(w,h,d);
const ppl_cyl=(a,b,h,s=10,open=false,ts=0,tl=TAU)=>new THREE.CylinderGeometry(a,b,h,Math.max(3,ppl_seg(s)),1,open,ts,tl);
// mirrored helper: add at +x and -x
const ppl_pair=(part,geoFn,x,y,z,slot,feat,col,ry=0,rx=0,rz=0,sx=1,sy=1,sz=1)=>{for(const s of[-1,1])part.add(geoFn(),M(s*x,y+(part.oy||0),z,s*ry,rx,s*rz,sx,sy,sz),slot,feat,col);};

// skeleton constants (adult, metres, origin = feet, +z = forward)
const PPL_HIP=0.95,PPL_THIGH=0.46,PPL_UARM=0.29,PPL_SHO_Y=1.44,PPL_SHO_X=0.2,PPL_NECK=1.535;

function ppl_buildGeos(){
  const F=ppl_F,S=ppl_S;
  // ---- TORSO (absolute coords from the feet) ----
  const T=new ppl_Part();
  const torsoSlot=(x,y)=>y<1.055?S.bot:S.top;
  T.add(ppl_lathe([[0,0.80],[0.07,0.805],[0.125,0.835],[0.155,0.89],[0.168,0.96],[0.163,1.03],[0.152,1.1],[0.152,1.17],[0.165,1.25],[0.183,1.32],[0.195,1.39],[0.198,1.44],[0.185,1.48],[0.14,1.515],[0.075,1.535],[0,1.54]],12),M(0,0,0,0,0,0,1,1,.62),torsoSlot);
  T.add(ppl_lathe([[0.166,1.035],[0.17,1.045],[0.17,1.065],[0.166,1.075]],12,true),M(0,0,0,0,0,0,1,1,.64),S.fix,0,0x2a2420); // belt
  if(!ppl_LO)T.add(ppl_box(.04,.03,.012),M(0,1.055,.107),S.fix,0,0x9a8a60); // buckle
  // jacket: zip + collar
  T.add(ppl_box(.012,.40,.012),M(0,1.27,.122,0,-.08),S.topDk,F.jacket);
  T.add(ppl_lathe([[0.085,1.49],[0.09,1.53],[0.075,1.575]],10,true),M(0,0,.008,0,0,0,1,1,.95),S.topDk,F.jacket);
  // hood (on back)
  T.add(ppl_sph(.11,8,5,0,Math.PI*.6),M(0,1.48,-.11,0,-1.1,0,1.1,.7,.9),S.top,F.hood);
  // side stripes (tracksuits / hero jacket)
  ppl_pair(T,()=>ppl_box(.01,.38,.035),.193,1.26,0,S.acc,F.stripes,0xffffff,0,0,.03);
  // bust
  ppl_pair(T,()=>ppl_sph(.066,8,6),.068,1.335,.085,S.top,F.bust,0xffffff,0,0,0,1,.82,.72);
  // skirt / dress lower part
  T.add(ppl_lathe([[0.168,1.07],[0.19,0.95],[0.225,0.8],[0.255,0.66],[0.258,0.64]],12,true),M(0,0,0,0,0,0,1,1,.78),S.bot,F.skirt);
  // long coat lower part
  T.add(ppl_lathe([[0.17,1.07],[0.195,0.92],[0.225,0.72],[0.245,0.52],[0.245,0.5]],12,true),M(0,0,0,0,0,0,1,1,.8),S.top,F.coat);
  T.add(ppl_box(.012,.52,.02),M(0,.8,.18,0,-.1),S.topDk,F.coat); // coat opening line
  // backpack
  T.add(ppl_box(.27,.34,.12),M(0,1.27,-.19),S.acc,F.pack);T.add(ppl_sph(.135,8,3,0,Math.PI/2),M(0,1.44,-.19,0,0,0,1,.45,.45),S.acc,F.pack);
  T.add(ppl_box(.2,.12,.03),M(0,1.18,-.262),S.acc,F.pack,0xcccccc);
  ppl_pair(T,()=>ppl_box(.035,.32,.016),.085,1.33,.118,S.fix,F.pack,0x222222,0,-.12);
  // shoulder bag
  T.add(ppl_box(.22,.17,.07),M(.215,.99,.02,0,0,.05),S.acc,F.bag);T.add(ppl_box(.03,.68,.012),M(.02,1.24,.118,0,-.08,.6),S.fix,F.bag,0x2a2420);
  T.add(ppl_box(.03,.68,.012),M(.02,1.24,-.118,0,.08,.6),S.fix,F.bag,0x2a2420);
  const torso=T.geo();

  // ---- HEAD (local: neck joint at origin) ----
  const H=new ppl_Part(),hy=PPL_NECK;H.oy=-hy;const Mh=(x,y,z,ry=0,rx=0,rz=0,sx=1,sy=1,sz=1)=>M(x,y-hy,z,ry,rx,rz,sx,sy,sz);
  H.add(ppl_lathe([[0.052,1.48],[0.05,1.55],[0.053,1.62]],8,true),Mh(0,0,-.005),S.skin);                      // neck
  H.add(ppl_sph(.103,14,10),Mh(0,1.685,-.008,0,0,0,.94,1.1,1.04),S.skin);                                        // cranium
  H.add(ppl_sph(.078,10,7),Mh(0,1.61,.028,0,0,0,1,.82,.98),S.skin);                                             // jaw
  H.add(ppl_sph(.03,6,4),Mh(0,1.585,.072,0,0,0,1.15,.8,.8),S.skin);                                              // chin
  if(!ppl_LO)ppl_pair(H,()=>ppl_sph(.026,6,4),.052,1.648,.066,S.skin,0,0xffffff,0,0,0,1,.8,.7);                            // cheeks
  if(!ppl_LO)H.add(ppl_cyl(.004,.021,.05,6),Mh(0,1.664,.104,0,-.35),S.skin,0,0xf0e0dc);                                     // nose bridge
  H.add(ppl_sph(.016,8,6),Mh(0,1.642,.113,0,0,0,1.25,.85,1),S.skin,0,0xf0e0dc);                                  // nose tip
  if(!ppl_LO)ppl_pair(H,()=>ppl_sph(.019,8,5),.036,1.69,.087,S.fix,0,0xf3f1ea,0,0,0,1.15,.72,.6);                           // eye whites
  if(!ppl_LO)ppl_pair(H,()=>ppl_sph(.0095,6,4),.036,1.69,.0985,S.fix,0,0x3a2716);                                            // iris
  ppl_pair(H,()=>ppl_box(.042,.011,.016),.038,1.714,.093,S.hairDk,0,0xffffff,0,0,-.12);                           // brows
  if(!ppl_LO)ppl_pair(H,()=>ppl_box(.042,.006,.012),.036,1.701,.096,S.skin,0,0xd8c0b8);                                      // eyelids
  H.add(ppl_box(.044,.009,.014),Mh(0,1.623,.1,0,0,0),S.lip);if(!ppl_LO)H.add(ppl_box(.038,.008,.012),Mh(0,1.613,.098),S.lip,0,0xe8e0e0); // lips
  if(!ppl_LO)ppl_pair(H,()=>ppl_sph(.03,6,4),.1,1.675,-.005,S.skin,0,0xf0e0dc,0,0,0,.42,1,.75);                              // ears
  // hair: cap (any hair), back, long, bun, beard
  H.add(ppl_sph(.111,14,6,0,Math.PI*.52),Mh(0,1.698,-.014,0,-.18,0,.97,1.08,1.07),S.hair,F.hair);
  H.add(ppl_sph(.109,12,4,Math.PI*.45,Math.PI*.33,Math.PI,Math.PI),Mh(0,1.685,-.012,0,0,0,.97,1.1,1.05),S.hair,F.hair);
  if(!ppl_LO)ppl_pair(H,()=>ppl_box(.016,.06,.05),.098,1.705,.01,S.hair,F.hair);                                             // sideburns
  H.add(ppl_box(.17,.035,.04),Mh(0,1.762,.07,0,-.5),S.hair,F.hairS);                                              // short fringe
  H.add(ppl_lathe([[0.112,1.73],[0.118,1.62],[0.125,1.52],[0.12,1.44]],10,true,Math.PI*.5,Math.PI),Mh(0,0,-.012,0,0,0,1,1,1.05),S.hair,F.hairL); // long hair back
  ppl_pair(H,()=>ppl_box(.03,.2,.07),.104,1.59,.01,S.hair,F.hairL,0xffffff,0,0,.05);                              // long hair sides
  H.add(ppl_sph(.12,10,3,0,Math.PI*.3),Mh(0,1.735,.02,0,.35),S.hair,F.hairL);                                      // fringe/side part
  H.add(ppl_sph(.048,8,5),Mh(0,1.77,-.085),S.hair,F.bun);
  H.add(ppl_sph(.082,10,5,Math.PI*.42,Math.PI*.58),Mh(0,1.635,.022,0,0,0,1.02,1,1.04),S.hair,F.beard);
  H.add(ppl_box(.06,.012,.014),Mh(0,1.632,.104),S.hair,F.beard);
  // cap
  H.add(ppl_sph(.117,12,5,0,Math.PI*.5),Mh(0,1.715,-.005,0,0,0,1,.82,1.06),S.acc,F.cap);
  H.add(ppl_cyl(.075,.075,.012,10),Mh(0,1.72,.11,0,-.12,0,1,1,1.25),S.acc,F.cap,0xdddddd);
  // headscarf (babushka)
  H.add(ppl_sph(.124,12,7,0,Math.PI*.55),Mh(0,1.685,-.02,0,-.42,0,1.03,1.14,1.1),S.acc,F.scarf);
  H.add(ppl_lathe([[0.115,1.63],[0.13,1.56],[0.16,1.48]],10,true,Math.PI*.5,Math.PI),Mh(0,0,-.015),S.acc,F.scarf);
  H.add(ppl_box(.06,.045,.04),Mh(0,1.575,.075,0,0,.6),S.acc,F.scarf,0xcccccc);
  // glasses
  ppl_pair(H,()=>ppl_box(.04,.026,.006),.036,1.69,.112,S.fix,F.glasses,0x1a1a1a);H.add(ppl_box(.03,.006,.006),Mh(0,1.695,.113),S.fix,F.glasses,0x1a1a1a);
  ppl_pair(H,()=>ppl_box(.004,.006,.1),.058,1.692,.065,S.fix,F.glasses,0x1a1a1a);
  const head=H.geo();

  // ---- UPPER ARM (joint at shoulder) ----
  const UA=new ppl_Part();
  UA.add(ppl_sph(.06,8,6),M(-.005,-.015,0,0,0,0,1,.95,1),S.top);
  UA.add(ppl_lathe([[0.062,.02],[0.06,-.05],[0.056,-.15],[0.048,-.25],[0.044,-.3]],10,true),M(0,0,0),S.top);
  UA.add(ppl_sph(.045,8,5),M(0,-.29,0),S.top);
  UA.add(ppl_box(.01,.28,.025),M(.06,-.13,0,0,0,.05),S.acc,F.stripes);UA.add(ppl_box(.01,.28,.025),M(-.06,-.13,0,0,0,-.05),S.acc,F.stripes);
  const uArm=UA.geo();
  // ---- FOREARM + HAND (joint at elbow) ----
  const FA=new ppl_Part();
  FA.add(ppl_lathe([[0.045,0],[0.046,-.06],[0.04,-.16],[0.033,-.235],[0.031,-.245]],10,true),M(0,0,0),S.sleeve);
  if(!ppl_LO)FA.add(ppl_lathe([[0.037,-.215],[0.04,-.225],[0.04,-.245],[0.036,-.25]],10,true),M(0,0,0),S.topDk,F.sleeves);    // cuff
  FA.add(ppl_box(.012,.22,.02),M(.046,-.11,0,0,0,.05),S.acc,F.stripes);FA.add(ppl_box(.012,.22,.02),M(-.046,-.11,0,0,0,-.05),S.acc,F.stripes);
  FA.add(ppl_sph(.033,8,4),M(0,-.25,0),S.skin);                                                                      // wrist
  FA.add(ppl_sph(.042,8,6),M(0,-.292,.004,0,0,0,.72,1.08,.45),S.skin);                                              // palm
  if(ppl_LO)FA.add(ppl_box(.05,.07,.024),M(0,-.34,.006,0,.12),S.skin);else for(let k=0;k<4;k++){const x=-.021+k*.014;FA.add(ppl_cyl(.0075,.0065,.06,4),M(x,-.355+Math.abs(k-1.5)*.005,.012,0,.12),S.skin);} // fingers
  if(!ppl_LO)FA.add(ppl_cyl(.009,.0075,.05,4),M(0,-.3,.034,0,.7),S.skin);                                                        // thumb (forward)
  FA.add(ppl_box(.06,.11,.012),M(0,-.31,.03,0,-.1),S.fix,F.phone,0x111418);                                           // phone
  FA.add(ppl_box(.2,.24,.06),M(0,-.5,0),S.acc,F.shop);FA.add(ppl_box(.06,.12,.004),M(0,-.36,0),S.acc,F.shop);        // plastic shopping bag
  const fArm=FA.geo();
  // ---- THIGH (joint at hip) ----
  const TH=new ppl_Part();
  TH.add(ppl_sph(.084,8,6),M(0,0,0),S.bot);
  TH.add(ppl_lathe([[0.086,.02],[0.089,-.06],[0.085,-.2],[0.072,-.36],[0.06,-.46]],10,true),M(0,0,0),S.bot);
  TH.add(ppl_sph(.058,8,5),M(0,-.46,.004),S.bot);
  TH.add(ppl_box(.012,.42,.028),M(.08,-.22,0,0,0,.04),S.acc,F.stripes);TH.add(ppl_box(.012,.42,.028),M(-.08,-.22,0,0,0,-.04),S.acc,F.stripes);
  const thigh=TH.geo();
  // ---- SHIN + SHOE (joint at knee) ----
  const SH=new ppl_Part();
  SH.add(ppl_lathe([[0.058,.02],[0.06,-.07],[0.055,-.17],[0.042,-.33],[0.037,-.42]],10,true),M(0,0,0),S.shin);
  if(!ppl_LO)SH.add(ppl_lathe([[0.042,-.36],[0.045,-.39],[0.044,-.42]],10,true),M(0,0,0),S.bot,F.pants);                        // trouser hem
  SH.add(ppl_box(.01,.36,.025),M(.056,-.18,0,0,0,.03),S.acc,F.stripes);SH.add(ppl_box(.01,.36,.025),M(-.056,-.18,0,0,0,-.03),S.acc,F.stripes);
  const shin=SH.geo();
  // ---- FOOT / SHOE (joint at ankle, 0.44 below the knee) ----
  const FT=new ppl_Part();
  FT.add(ppl_sph(.058,10,6,0,Math.PI*.55),M(0,-.022,.045,0,0,0,.92,.95,2.15),S.shoe);
  FT.add(ppl_cyl(.045,.047,.06,8),M(0,-.005,-.005),S.shoe);
  FT.add(ppl_box(.1,.026,.27),M(0,-.035,.045),S.fix,0,0xe4e2dc);
  if(!ppl_LO)FT.add(ppl_box(.005,.012,.17),M(0,.008,.075,0,-.25),S.fix,0,0xf2f2f2);
  const foot=FT.geo();
  return {torso,head,uArm,fArm,thigh,shin,foot};
}
const ppl_G=ppl_buildGeos();ppl_LO=true;const ppl_GL=ppl_buildGeos();ppl_LO=false;

// ---------- material ----------
function ppl_patchVS(sh,colour){
  sh.vertexShader=sh.vertexShader.replace('#include <common>',`#include <common>
attribute vec2 aSF;attribute vec4 iA;attribute vec4 iB;attribute vec4 iC;attribute vec4 iD;attribute vec3 iE;
float pplBit(float m,float f){return mod(floor(m/f+0.0001),2.0);}`)
  .replace('#include <begin_vertex>',`#include <begin_vertex>
{float f=aSF.y;if(f>0.5){if(pplBit(iA.w,f)<0.5)transformed=vec3(0.0);}else if(f<-0.5){if(pplBit(iA.w,-f)>0.5)transformed=vec3(0.0);}}`);
  if(colour)sh.vertexShader=sh.vertexShader.replace('#include <color_vertex>',`#include <color_vertex>
#ifdef USE_COLOR
{float s=aSF.x;vec3 skin=iA.rgb,top=iB.rgb,bot=iC.rgb,hair=vec3(iB.w,iC.w,iD.w),shoe=iD.rgb,acc=iE;vec3 c=vec3(1.0);
if(s>0.5){if(s<1.5)c=skin;else if(s<2.5)c=top;else if(s<3.5)c=bot;else if(s<4.5)c=hair;else if(s<5.5)c=shoe;else if(s<6.5)c=acc;
else if(s<7.5)c=pplBit(iA.w,256.0)>0.5?top:skin;else if(s<8.5)c=pplBit(iA.w,512.0)>0.5?bot:skin;else if(s<9.5)c=top*0.62;
else if(s<10.5)c=skin*vec3(0.8,0.52,0.52);else c=hair*0.72;vColor.rgb=c*color;}}
#endif`);
}
const ppl_mat=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide});
ppl_mat.onBeforeCompile=sh=>ppl_patchVS(sh,true);
const ppl_depthMat=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
ppl_depthMat.onBeforeCompile=sh=>ppl_patchVS(sh,false);

// geometry instance for a mesh with its own per-instance palette attributes
function ppl_inst(base,count){const g=new THREE.BufferGeometry();for(const k of['position','normal','color','aSF'])g.setAttribute(k,base.getAttribute(k));
  for(const [k,n] of [['iA',4],['iB',4],['iC',4],['iD',4],['iE',3]]){const a=new THREE.InstancedBufferAttribute(new Float32Array(count*n),n);a.setUsage(THREE.StaticDrawUsage);g.setAttribute(k,a);}
  g.boundingSphere=base.boundingSphere.clone();g.boundingSphere.radius+=2;
  const m=new THREE.InstancedMesh(g,ppl_mat,count);m.customDepthMaterial=ppl_depthMat;m.frustumCulled=false;m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);m.castShadow=true;return m;}
const ppl_cc=new THREE.Color();
function ppl_setLook(m,i,L,mask){const a=m.geometry.attributes;const s=ppl_cc;
  s.set(L.skin);a.iA.setXYZW(i,s.r,s.g,s.b,mask);const hr=new THREE.Color(L.hair);
  s.set(L.top);a.iB.setXYZW(i,s.r,s.g,s.b,hr.r);s.set(L.bot);a.iC.setXYZW(i,s.r,s.g,s.b,hr.g);s.set(L.shoe);a.iD.setXYZW(i,s.r,s.g,s.b,hr.b);s.set(L.acc);a.iE.setXYZ(i,s.r,s.g,s.b);
  for(const k of['iA','iB','iC','iD','iE'])a[k].needsUpdate=true;}

// ---------- outfits (Chișinău street casting) ----------
const ppl_HAIR=[0x1c1410,0x2a1c13,0x3a281b,0x4f3624,0x6b4a2e,0x8f6c45,0xb3925e],ppl_GREY=[0x8e8c88,0xb4b2ae,0xd2d0cc],ppl_DYED=[0x7a2a1e,0x8c3324,0x5a1e28];
const ppl_JEANS=[0x2a3a58,0x33507a,0x1e283e,0x46597a,0x26324a],ppl_DARK=[0x1b1b1d,0x232529,0x2c2e34,0x3a3530,0x2b2f38,0x3b3f45];
const ppl_TEE=[0xd9d9d6,0x1d1d1f,0xb32a2a,0x2c4f86,0x3d7a46,0xd8b13a,0x7a3e8a,0xe07a2a,0x5f6a72,0x9fb7c9,0xc95a7c,0x2a8a8a],ppl_JACKET=[0x1f2228,0x3a2e26,0x26354a,0x4a4f2c,0x5e2222,0x2c2c2c,0x6b5a46,0x203a2e];
const ppl_TRACK=[0x151829,0x111111,0x23252b,0x6a0f12,0x123063,0x1f3d24],ppl_COAT=[0x3b2f28,0x4a3b30,0x2a2a2e,0x5a4a3a,0x6b5a48,0x2f3b2a,0x4a2430],ppl_SCARF=[0x8a1f2a,0x5a2a5a,0x2a3a6a,0x7a6a2a,0x9a5a7a,0x3a5a3a,0x6a3a2a];
const ppl_DRESS=[0x7a1f3a,0x1f3a5a,0x2a2a2a,0x8a6a2a,0x4a2a5a,0xb05070,0x2a5a5a,0xd0c0a0],ppl_SHOES=[0x1a1a1a,0x2a1d14,0x4a3020,0x3a3a3a],ppl_SNEAK=[0xf0f0ee,0xe8e8e8,0x222222,0x9a9a9a,0x2a3a6a];
const ppl_BAG=[0x2a1d14,0x111111,0x6b2a2a,0x8a6a4a,0x2a3a5a,0xc8b090],ppl_SHOP=[0xf2f2f0,0xe8e8f0,0x2a6a2a,0xe0e0d0,0x3a4aa0];
const ppl_pk=a=>a[Math.floor(Math.random()*a.length)],ppl_ch=p=>Math.random()<p;
function ppl_outfit(kind){const F=ppl_F;const o={skin:ppl_pk(SKIN),hair:ppl_pk(ppl_HAIR),shoe:ppl_pk(ppl_SNEAK),acc:0xffffff,mask:F.pants|F.hair,sw:1,sh:1,v:1.15+Math.random()*.45,armL:0,armR:0};
  switch(kind){
  case 'man':o.top=ppl_pk(ppl_TEE);o.bot=ppl_pk(ppl_JEANS);o.mask|=F.hairS;if(ppl_ch(.45)){o.top=ppl_pk(ppl_JACKET);o.mask|=F.sleeves|F.jacket;}if(ppl_ch(.2))o.mask|=F.beard;if(ppl_ch(.15)){o.mask|=F.cap;o.acc=ppl_pk(ppl_TRACK.concat([0xc8c8c8,0x7a1010]));}
    if(ppl_ch(.18))o.mask|=F.bag,o.acc=ppl_pk(ppl_BAG);o.sw=1.02+Math.random()*.1;o.sh=.97+Math.random()*.08;break;
  case 'track':o.top=o.bot=ppl_pk(ppl_TRACK);o.acc=ppl_ch(.7)?0xf2f2f2:0xd8b13a;o.mask|=F.hairS|F.sleeves|F.jacket|F.stripes;o.shoe=ppl_pk(ppl_SNEAK);if(ppl_ch(.4))o.mask|=F.cap;if(ppl_ch(.3))o.mask|=F.hood;
    o.sw=1.04+Math.random()*.1;o.sh=.97+Math.random()*.07;break;
  case 'office':o.top=ppl_pk([0x1f2228,0x262a33,0x34363c,0x2b2b2b,0x3a3f4a]);o.bot=ppl_pk(ppl_DARK);o.shoe=ppl_pk(ppl_SHOES);o.mask|=F.hairS|F.sleeves|F.jacket;if(ppl_ch(.3))o.mask|=F.glasses;
    if(ppl_ch(.4)){o.mask|=F.bag;o.acc=ppl_pk(ppl_BAG);}if(ppl_ch(.15))o.mask|=F.beard;o.sw=1+Math.random()*.08;o.sh=.98+Math.random()*.07;break;
  case 'dress':o.top=o.bot=ppl_pk(ppl_DRESS);if(ppl_ch(.4))o.top=ppl_pk(ppl_TEE.concat(ppl_JACKET));o.mask=F.hair|F.skirt|F.bust|(ppl_ch(.7)?F.hairL:F.bun);if(ppl_ch(.5))o.mask|=F.sleeves;
    o.shoe=ppl_pk(ppl_SHOES.concat([0x7a1f2a,0xc8b090]));o.hair=ppl_ch(.12)?ppl_pk(ppl_DYED):ppl_pk(ppl_HAIR);if(ppl_ch(.55)){o.mask|=F.bag;o.acc=ppl_pk(ppl_BAG);}o.sw=.88+Math.random()*.06;o.sh=.93+Math.random()*.06;break;
  case 'woman':o.top=ppl_pk(ppl_TEE.concat(ppl_JACKET,ppl_COAT));o.bot=ppl_pk(ppl_JEANS.concat(ppl_DARK));o.mask|=F.bust|(ppl_ch(.65)?F.hairL:F.bun);if(ppl_ch(.6))o.mask|=F.sleeves;if(ppl_ch(.3))o.mask|=F.jacket;
    o.hair=ppl_ch(.15)?ppl_pk(ppl_DYED):ppl_pk(ppl_HAIR);if(ppl_ch(.5)){o.mask|=F.bag;o.acc=ppl_pk(ppl_BAG);}if(ppl_ch(.15))o.mask|=F.glasses;o.sw=.88+Math.random()*.06;o.sh=.93+Math.random()*.06;break;
  case 'granny':o.top=ppl_pk(ppl_COAT);o.bot=ppl_pk(ppl_DARK);o.acc=ppl_pk(ppl_SCARF);o.shoe=ppl_pk(ppl_SHOES);o.hair=ppl_pk(ppl_GREY);o.mask=F.scarf|F.coat|F.sleeves|F.pants|F.bust;
    o.v=.85+Math.random()*.25;o.sw=.97+Math.random()*.08;o.sh=.88+Math.random()*.05;if(ppl_ch(.6))o.armR=F.shop;o.shopCol=ppl_pk(ppl_SHOP);break;
  case 'student':o.top=ppl_pk(ppl_TEE.concat(ppl_JACKET));o.bot=ppl_pk(ppl_JEANS);o.acc=ppl_pk([0x1a1a1a,0x2a4a8a,0x8a2a2a,0x3a6a3a,0xd8b13a,0x5a5a5a]);o.mask|=F.pack|F.sleeves|(ppl_ch(.5)?F.hood:0);
    if(ppl_ch(.5)){o.mask|=F.hairS;}else{o.mask|=F.bust|F.hairL;o.sw=.9;}o.v=1.3+Math.random()*.35;o.sh=.94+Math.random()*.08;break;
  case 'oldman':o.top=ppl_pk(ppl_COAT.concat(ppl_JACKET));o.bot=ppl_pk(ppl_DARK);o.shoe=ppl_pk(ppl_SHOES);o.hair=ppl_pk(ppl_GREY);o.mask|=F.sleeves|F.jacket|(ppl_ch(.6)?F.hairS:0);
    if(ppl_ch(.45)){o.mask|=F.cap;o.acc=ppl_pk([0x3a3530,0x2b2f38,0x4a4030]);}if(ppl_ch(.3))o.mask|=F.coat;if(ppl_ch(.4))o.mask|=F.glasses;o.v=.95+Math.random()*.3;o.sw=1.02+Math.random()*.08;o.sh=.94+Math.random()*.05;
    if(ppl_ch(.35))o.armR=F.shop,o.shopCol=ppl_pk(ppl_SHOP);break;
  }
  if(!(o.mask&F.bust)&&o.sw<.95)o.sw=1;
  if(kind!=='granny'&&kind!=='oldman'&&ppl_ch(.14))o.armL=F.phone;
  return o;}
const ppl_KINDS=[['man',22],['track',11],['office',10],['dress',14],['woman',15],['granny',9],['student',10],['oldman',9]];
function ppl_randKind(){let t=0;for(const k of ppl_KINDS)t+=k[1];let r=Math.random()*t;for(const k of ppl_KINDS){r-=k[1];if(r<=0)return k[0];}return 'man';}

// ---------- pedestrian instanced meshes ----------
const PPL_PARTS=['torso','head','uArm','fArm','thigh','shin','foot'],PPL_DOUBLE=[0,0,1,1,1,1,1];
const ppl_mkSet=(G,n)=>PPL_PARTS.map((k,j)=>ppl_inst(G[k],PPL_DOUBLE[j]?n*2:n));
const PPL_NEAR=30,PPL_NEAR_D=48;
const ppl_LOSET=ppl_mkSet(ppl_GL,PEDN),ppl_HISET=ppl_mkSet(ppl_G,PPL_NEAR);
const ppl_hiUsed=new Array(PPL_NEAR).fill(null);let ppl_hiTop=0;
const [pedT,pedH,ppl_UA,ppl_FA,pedL,pedR,ppl_FT]=ppl_LOSET;
const ppl_blobs=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),blobMat,PEDN);ppl_blobs.frustumCulled=false;ppl_blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
const ppl_MESHES=ppl_LOSET.concat(ppl_HISET);
for(const m of ppl_MESHES)scene.add(m);scene.add(ppl_blobs);
const ppl_zero=new THREE.Matrix4().makeScale(0,0,0);
for(const m of ppl_HISET){for(let i=0;i<m.count;i++)m.setMatrixAt(i,ppl_zero);m.count=0;}
function ppl_applyLook(meshes,i,n,o){const [t,h,ua,fa,th,sh,ft]=meshes;
  ppl_setLook(t,i,o,o.mask);ppl_setLook(h,i,o,o.mask);
  for(const [side,extra] of [[0,o.armL],[1,o.armR]]){const j=i+side*n;const L=extra===ppl_F.shop?Object.assign({},o,{acc:o.shopCol||0xf0f0f0}):o;
    ppl_setLook(ua,j,o,o.mask);ppl_setLook(fa,j,L,o.mask|extra);ppl_setLook(th,j,o,o.mask);ppl_setLook(sh,j,o,o.mask);ppl_setLook(ft,j,o,o.mask);}}

const peds=[];
function spawnPedAgent(p,near){const e=randEdgeNear(near.x,near.z,near.min,near.max)||edges[Math.floor(Math.random()*edges.length)];const ds=dirsFor(e,'ped');
  p.a={kind:'ped'};placeAgent(p.a,e,mpick(ds),Math.random());p.x=p.a.x;p.z=p.a.z;p.h=Math.atan2(p.a.hx,p.a.hz);p.down=0;p.flee=0;}
for(let i=0;i<PEDN;i++){const o=ppl_outfit(ppl_randKind());const p={i,pplHi:-1,v:o.v,ph:Math.random()*6,pplT:Math.random()*TAU,pplK:1,pplRun:0,pplO:o,pplLook:0,pplLookT:Math.random()*4,pplLookTo:0,pplFall:0};
  ppl_applyLook(ppl_MESHES,i,PEDN,o);peds.push(p);}

// ---------- pose solver ----------
const ppl_tm=new THREE.Matrix4(),ppl_rm=new THREE.Matrix4();
const ppl_T=(m,x,y,z)=>m.multiply(ppl_tm.makeTranslation(x,y,z)),ppl_RX=(m,a)=>m.multiply(ppl_rm.makeRotationX(a)),ppl_RY=(m,a)=>m.multiply(ppl_rm.makeRotationY(a)),ppl_RZ=(m,a)=>m.multiply(ppl_rm.makeRotationZ(a));
const ppl_out=[...Array(12)].map(()=>new THREE.Matrix4()); // torso, head, uaL,uaR, faL,faR, thL,thR, shL,shR, ftL,ftR
// st: {t phase, k walk blend, run blend, fall 0..1, time, look (head yaw), phoneL, wave}
function ppl_pose(root,st,out){
  const [mT,mH,uL,uR,fL,fR,tL,tR,sL,sR,ftL,ftR]=out;const t=st.t,k=st.k,run=st.run,s=Math.sin(t),c=Math.cos(t),time=st.time;
  if(st.fall>0){ // lying on the back, limbs splayed
    const f=st.fall;mT.copy(root);ppl_T(mT,0,.13*f,0);ppl_T(mT,0,PPL_HIP*.0,0);ppl_RX(mT,-Math.PI/2*f);
    mH.copy(mT);ppl_T(mH,0,PPL_NECK,0);ppl_RY(mH,.4*f);ppl_RX(mH,-.2*f);
    for(let sd=0;sd<2;sd++){const g=sd?-1:1;
      const th=sd?tR:tL;th.copy(mT);ppl_T(th,g*.095,PPL_HIP-.02,0);ppl_RX(th,(sd?-.35:.1)*f);ppl_RZ(th,g*.22*f);
      const sh=sd?sR:sL;sh.copy(th);ppl_T(sh,0,-PPL_THIGH,0);ppl_RX(sh,(sd?.9:.25)*f);
      const ft=sd?ftR:ftL;ft.copy(sh);ppl_T(ft,0,-.44,0);ppl_RX(ft,-.15*f);ppl_RZ(ft,g*.7*f);
      const ua=sd?uR:uL;ua.copy(mT);ppl_T(ua,g*PPL_SHO_X,PPL_SHO_Y,0);ppl_RZ(ua,g*(sd?2.3:1.2)*f);ppl_RX(ua,-.2*f);
      const fa=sd?fR:fL;fa.copy(ua);ppl_T(fa,0,-PPL_UARM,0);ppl_RX(fa,-.6*f);}
    return;}
  if(st.work>0){ // kneeling on the right knee, laying paving tiles: right arm taps with a mallet, left hand sets the tile
    const w=st.work,tap=Math.sin(time*7.5),drop=.37*w;
    mT.copy(root);ppl_T(mT,0,-drop,0);ppl_T(mT,0,PPL_HIP,0);ppl_RX(mT,.55*w+.04*Math.max(0,tap));ppl_T(mT,0,-PPL_HIP,0);
    mH.copy(mT);ppl_T(mH,0,PPL_NECK,0);ppl_RX(mH,.35*w);ppl_RY(mH,.15*Math.sin(time*.6));
    for(let sd=0;sd<2;sd++){const g=sd?-1:1;
      const th=sd?tR:tL;th.copy(root);ppl_T(th,g*.1,PPL_HIP-.03-drop,0);ppl_RX(th,(sd?.05:-1.35)*w);ppl_RZ(th,g*.06);
      const sh=sd?sR:sL;sh.copy(th);ppl_T(sh,0,-PPL_THIGH,0);ppl_RX(sh,(sd?1.55:1.35)*w);
      const ft=sd?ftR:ftL;ft.copy(sh);ppl_T(ft,0,-.44,0);ppl_RX(ft,(sd?-.2:0)*w);}
    for(let sd=0;sd<2;sd++){const g=sd?-1:1;
      const ar=sd?-1.1+.45*tap:-.85+.08*Math.sin(time*1.7),el=sd?-.7-.35*Math.max(0,-tap):-.35;
      const ua=sd?uR:uL;ua.copy(mT);ppl_T(ua,g*PPL_SHO_X,PPL_SHO_Y,0);ppl_RX(ua,ar*w);ppl_RZ(ua,g*.12);
      const fa=sd?fR:fL;fa.copy(ua);ppl_T(fa,0,-PPL_UARM,0);ppl_RX(fa,el*w);}
    return;}
  const bob=k*(.024+.04*run)*Math.cos(2*t)+(1-k)*.004*Math.sin(time*2.1)-run*k*.04;
  const lean=k*(.035+.2*run),twist=k*(.07+.08*run)*s,roll=k*.025*s*(1-run*.5),sway=k*.012*s;
  mT.copy(root);ppl_T(mT,sway,PPL_HIP+bob,0);ppl_RY(mT,twist);ppl_RZ(mT,roll*.6);ppl_RX(mT,lean);ppl_T(mT,0,-PPL_HIP,0);
  // head: counter twist, nod with steps, look-around
  mH.copy(mT);ppl_T(mH,0,PPL_NECK,0);ppl_RY(mH,-twist*.9+st.look);ppl_RX(mH,-lean*.6+k*.03*Math.cos(2*t)+(1-k)*.02*Math.sin(time*.7));ppl_RZ(mH,-roll*.5);
  // legs
  const aTh=k*(.4+.42*run),kMax=.72+.9*run;
  for(let sd=0;sd<2;sd++){const g=sd?-1:1,ps=sd?-s:s,pc=sd?-c:c;
    const thA=-aTh*ps-run*k*.15;const kn=k*(.07+.12*run+kMax*Math.max(0,pc)*(.6+.4*Math.max(0,-ps))+run*.45*Math.max(0,ps));
    const th=sd?tR:tL;th.copy(root);ppl_T(th,g*.095+sway,PPL_HIP-.03+bob,0);ppl_RY(th,twist*.3);ppl_RX(th,thA);ppl_RZ(th,g*(.025+(1-k)*.01));
    const sh=sd?sR:sL;sh.copy(th);ppl_T(sh,0,-PPL_THIGH,0);ppl_RX(sh,kn);
    // foot: keep the sole near level in stance, heel-strike / toe-off around the swing
    const ft=sd?ftR:ftL;ft.copy(sh);ppl_T(ft,0,-.44,0);ppl_RX(ft,-(thA+kn)*.85*k+k*(.25*Math.max(0,pc)*(1-run)-.15*Math.max(0,-pc)*Math.max(0,ps))+run*k*.2);
  }
  // arms
  const aAr=k*(.32+.6*run);
  for(let sd=0;sd<2;sd++){const g=sd?-1:1,ps=sd?-s:s;
    let ar=aAr*ps+run*k*.1,abd=.09+.08*run+(1-k)*(.03+.01*Math.sin(time*1.3+sd)),el=-(.16+1.05*run*k+.35*k*Math.max(0,-ps)*(1-run)+.35*run*k*Math.max(0,-ps))-(1-k)*.08;
    if(sd===0&&st.phoneL){ar=-.55;abd=.32;el=-2.35;}
    if(sd===1&&st.wave){ar=-2.75;abd=.28+.22*Math.sin(time*8);el=-.25;}
    const ua=sd?uR:uL;ua.copy(mT);ppl_T(ua,g*PPL_SHO_X,PPL_SHO_Y,0);ppl_RX(ua,ar);ppl_RZ(ua,g*abd);
    const fa=sd?fR:fL;fa.copy(ua);ppl_T(fa,0,-PPL_UARM,0);ppl_RX(fa,el);if(sd===0&&st.phoneL)ppl_RZ(fa,-.35);}
}
function ppl_writeSet(set,i,n,out){const z=ppl_zero;for(let j=0;j<7;j++){const m=set[j];
  if(PPL_DOUBLE[j]){const a=j*2-2;m.setMatrixAt(i,out?out[a]:z);m.setMatrixAt(i+n,out?out[a+1]:z);}else m.setMatrixAt(i,out?out[j]:z);}}
// walk-cycle frequency (cycles/s) as a function of ground speed
function ppl_freq(sp){if(sp<.05)return 0;return sp<2.6?.48+.34*sp:.86+.165*sp;}
function ppl_runTarget(sp){return clamp((sp-2.3)/1.3,0,1);}

// ---- rendering API called by game.js ----
// p: {i, x, z, h (heading), ph (walk phase), fall (0/1 knocked down), moveSpeed (m/s; 0 when idle/fallen)}
const ppl_root=new THREE.Matrix4(),ppl_q=new THREE.Quaternion(),ppl_up=new THREE.Vector3(0,1,0),ppl_pos=new THREE.Vector3(),ppl_scl=new THREE.Vector3(),ppl_bm=new THREE.Matrix4();
let ppl_time=0;
const PPL_Y=.17; // stand on the sidewalk surface (relative to the terrain)
const ppl_gy=(x,z)=>typeof groundY==='function'?groundY(x,z):0;
// walking surface (bridge decks via bridges.js); refY = previous height so peds can also walk under bridges
const ppl_sy=(x,z,r,hx,hz)=>typeof surfaceY==='function'?surfaceY(x,z,r,hx,hz):ppl_gy(x,z);
const ppl_qs=new THREE.Quaternion(),ppl_qn=new THREE.Quaternion(),ppl_nv=new THREE.Vector3(),ppl_ax=new THREE.Vector3(1,0,0);
function renderPed(p,dt){const o=p.pplO,sp=p.moveSpeed||0;
  p.pplT+=dt*TAU*ppl_freq(sp);p.pplK+=((sp>.05?1:0)-p.pplK)*Math.min(1,dt*6);p.pplRun+=(ppl_runTarget(sp)-p.pplRun)*Math.min(1,dt*5);
  p.pplFall+=((p.fall?1:0)-p.pplFall)*Math.min(1,dt*(p.fall?14:5));
  // head look-around; look at the player when close
  p.pplLookT-=dt;const gp=window.gtcPlayer;let lookTo=p.pplLookTo;
  if(gp){const dx=gp.x-p.x,dz=gp.z-p.z,d2=dx*dx+dz*dz;if(d2<100&&d2>.5){lookTo=clamp(angDiff(Math.atan2(dx,dz),p.h),-1.1,1.1);if(Math.abs(angDiff(Math.atan2(dx,dz),p.h))>2)lookTo=0;}}
  if(p.pplLookT<=0){p.pplLookT=2+Math.random()*5;p.pplLookTo=Math.random()<.6?0:(Math.random()-.5)*1.4;}
  p.pplLook+=(lookTo-p.pplLook)*Math.min(1,dt*3);
  const phx=Math.sin(p.h),phz=Math.cos(p.h),gy=ppl_sy(p.x,p.z,p.y==null||!isFinite(p.y)?null:p.y,phx,phz);p.y=gy;ppl_q.setFromAxisAngle(ppl_up,p.h);
  // knocked down on a slope: tilt the body along the slope of its heading so it lies on the ground
  if(p.pplFall>.01){const sh=Math.sin(p.h),ch=Math.cos(p.h),sl=Math.atan2(ppl_sy(p.x+sh*.9,p.z+ch*.9,gy,sh,ch)-ppl_sy(p.x-sh*.9,p.z-ch*.9,gy,sh,ch),1.8);
    ppl_qs.setFromAxisAngle(ppl_ax,-sl*p.pplFall);ppl_q.multiply(ppl_qs);}
  ppl_root.compose(ppl_pos.set(p.x,gy+PPL_Y,p.z),ppl_q,ppl_scl.set(o.sw,o.sh,o.sw*.96+.04));
  ppl_pose(ppl_root,{t:p.pplT,k:p.pplK,run:p.pplRun,fall:p.pplFall,time:ppl_time+p.i,look:p.pplLook*(1-p.pplRun),phoneL:o.armL===ppl_F.phone&&p.pplRun<.5,wave:false},ppl_out);
  // LOD: up to PPL_NEAR pedestrians near the camera use the high-detail set
  const cdx=p.x-camera.position.x,cdz=p.z-camera.position.z,cd=cdx*cdx+cdz*cdz,nearR=p.pplHi>=0?PPL_NEAR_D+6:PPL_NEAR_D;
  if(cd<nearR*nearR){if(p.pplHi<0){const sl=ppl_hiUsed.indexOf(null);if(sl>=0){ppl_hiUsed[sl]=p;p.pplHi=sl;ppl_applyLook(ppl_HISET,sl,PPL_NEAR,o);ppl_hiTop=Math.max(ppl_hiTop,sl+1);}}}
  else if(p.pplHi>=0){ppl_writeSet(ppl_HISET,p.pplHi,PPL_NEAR,null);ppl_hiUsed[p.pplHi]=null;p.pplHi=-1;}
  if(p.pplHi>=0){ppl_writeSet(ppl_HISET,p.pplHi,PPL_NEAR,ppl_out);ppl_writeSet(ppl_LOSET,p.i,PEDN,null);}else ppl_writeSet(ppl_LOSET,p.i,PEDN,ppl_out);
  const bs=p.pplFall>.5?1.9:.85,bx=p.x-(p.pplFall>.5?Math.sin(p.h)*.8:0),bz=p.z-(p.pplFall>.5?Math.cos(p.h)*.8:0);
  {const n=typeof groundNormal==='function'?groundNormal(bx,bz):[0,1,0];ppl_qn.setFromUnitVectors(ppl_up,ppl_nv.set(n[0],n[1],n[2]));ppl_qs.setFromAxisAngle(ppl_up,p.h);ppl_qn.multiply(ppl_qs);}
  ppl_bm.compose(ppl_pos.set(bx,ppl_sy(bx,bz,gy,phx,phz)+PPL_Y+.02,bz),ppl_qn,ppl_scl.set(.75,1,bs));ppl_blobs.setMatrixAt(p.i,ppl_bm);}
function renderPedsCommit(){ppl_time=performance.now()/1000;while(ppl_hiTop>0&&!ppl_hiUsed[ppl_hiTop-1])ppl_hiTop--;for(let j=0;j<7;j++){const m=ppl_HISET[j];m.count=PPL_DOUBLE[j]?PPL_NEAR+ppl_hiTop:ppl_hiTop;}for(const m of ppl_MESHES)m.instanceMatrix.needsUpdate=true;ppl_blobs.instanceMatrix.needsUpdate=true;
  // idle passengers waiting for the taxi wave their arm
  for(let k=ppl_groups.length-1;k>=0;k--){const g=ppl_groups[k];if(!g.parent){ppl_groups.splice(k,1);continue;}if(g.userData.hero)continue;
    ppl_poseGroup(g,{t:0,k:0,run:0,fall:0,time:ppl_time,look:0,phoneL:false,wave:true});}}

// ---------- player / passenger groups ----------
const ppl_groups=[];let ppl_groupN=0;
function ppl_poseGroup(g,st){const u=g.userData;ppl_root.compose(ppl_pos.set(0,PPL_Y,0),ppl_q.identity(),ppl_scl.set(u.o.sw,u.o.sh,u.o.sw));ppl_pose(ppl_root,st,ppl_out);
  const [t,h,ua,fa,th,sh,ft]=u.ims;t.setMatrixAt(0,ppl_out[0]);h.setMatrixAt(0,ppl_out[1]);ua.setMatrixAt(0,ppl_out[2]);ua.setMatrixAt(1,ppl_out[3]);fa.setMatrixAt(0,ppl_out[4]);fa.setMatrixAt(1,ppl_out[5]);
  th.setMatrixAt(0,ppl_out[6]);th.setMatrixAt(1,ppl_out[7]);sh.setMatrixAt(0,ppl_out[8]);sh.setMatrixAt(1,ppl_out[9]);ft.setMatrixAt(0,ppl_out[10]);ft.setMatrixAt(1,ppl_out[11]);for(const m of u.ims)m.instanceMatrix.needsUpdate=true;}
function makePersonGroup(shirt,pants,skin){const g=new THREE.Group();const hero=ppl_groupN++===0;const F=ppl_F;let o;
  if(hero){o={skin,hair:0x1c1410,top:shirt,bot:pants,shoe:0xf4f4f2,acc:0xf4f4f2,mask:F.hair|F.hairS|F.sleeves|F.pants|F.jacket|F.stripes,sw:1.06,sh:1.02,armL:0,armR:0};}
  else{o=ppl_outfit(ppl_randKind());o.skin=skin;o.armL=0;o.armR=0;}
  const ims=[ppl_inst(ppl_G.torso,1),ppl_inst(ppl_G.head,1),ppl_inst(ppl_G.uArm,2),ppl_inst(ppl_G.fArm,2),ppl_inst(ppl_G.thigh,2),ppl_inst(ppl_G.shin,2),ppl_inst(ppl_G.foot,2)];
  ppl_applyLook(ims,0,1,o);for(const m of ims)g.add(m);
  const bl=new THREE.Mesh(new THREE.PlaneGeometry(.75,.85).rotateX(-Math.PI/2),blobMat);bl.position.y=.07;g.add(bl);
  g.userData={ims,o,hero,ph:Math.random()*TAU,k:0,run:0,look:0};
  ppl_poseGroup(g,{t:0,k:0,run:0,fall:0,time:0,look:0,phoneL:false,wave:!hero});
  scene.add(g);ppl_groups.push(g);return g;}
// player character (a THREE.Group from makePersonGroup); phase from game is ignored — we integrate our own; speed m/s (0 idle)
function animatePlayer(g,phase,speed,dt){const u=g.userData;if(!u||!u.ims)return;dt=Math.min(dt||0,.1);
  u.ph+=dt*TAU*ppl_freq(speed)*(speed>6?.92:1);u.k+=((speed>.05?1:0)-u.k)*Math.min(1,dt*8);u.run+=(ppl_runTarget(speed)-u.run)*Math.min(1,dt*6);
  ppl_poseGroup(g,{t:u.ph,k:u.k,run:Math.min(1,u.run*(speed>6?1:.85)),fall:0,time:performance.now()/1000,look:0,phoneL:false,wave:false});}
