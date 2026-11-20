'use strict';
// Linella stores you can walk into.
// Outside: a glass storefront (LINELLA band, canopy, lit door frame) is stuck on the block wall behind each roadside sign
// (found by marching from the sign away from the road until we hit a building footprint; no footprint → a small pavilion),
// plus a pulsing yellow entrance marker on the pavement for the nearest stores.
// Inside: ONE shared supermarket interior, built lazily on the first visit and reused by every store. It is placed
// ST_DY metres above the store (nothing up there can shadow it) and the screen fades to black for ~0.3 s on the way in/out.
// game.js hooks: storeUpdate(dt,inp) → true while this module drives the player + camera; storeInside(); storeSavePos().
// Needs window.gtcApi (player, camYaw, camPitch, camPos, money, say, addStar) from game.js.
const ST_DY=260,ST_HW=11,ST_D=29,ST_H=4.2;          // floor height above street, half-width, depth, ceiling (local: +z into store, door at z=0)
const ST_AX=[-8.85,-5.55,-1.85,1.85,5.55,8.85];     // aisle centre lines
const ST_ISL=[-7.2,-3.7,0,3.7,7.2];                 // island shelf centres (z 10..24)
const ST_CO=[4,6.5,9];                              // checkout counter centres (x)
const ST_ITEMS={
  lactate:[['Lapte JLC',18],['Iaurt',12],['Cașcaval',45],['Smântână',16],['Brânză de vaci',28]],
  dulciuri:[['Ciocolată Bucuria',25],['Bomboane Bucuria',38],['Biscuiți',15],['Napolitane',19]],
  bauturi:[['Bere Chișinău',22],['Apă minerală',9],['Cola',19],['Suc de mere',24]],
  vinuri:[['Vin Purcari',140],['Divin Kvint',210],['Vin Cricova',95],['Spumant',120]],
  paine:[['Pâine albă',8],['Covrig',4],['Franzelă',7],['Plăcintă cu brânză',12]],
  conserve:[['Mazăre conservată',17],['Pateu',14],['Ketchup',20],['Hrișcă',26]],
  snacks:[['Semințe',10],['Chipsuri',21],['Fistic',35],['Pufuleți',9]],
  legume:[['Roșii',30],['Castraveți',25],['Mere',15],['Pepene',40],['Cartofi',12]],
  frig:[['Bere rece',24],['Kvas',18],['Limonadă',20],['Chefir',14]],
};
const ST_CATNAME={lactate:'LACTATE',dulciuri:'DULCIURI',bauturi:'BĂUTURI',vinuri:'VINURI ȘI DIVINURI',paine:'PÂINE',conserve:'CONSERVE',snacks:'SNACKS',legume:'LEGUME ȘI FRUCTE',frig:'BĂUTURI RECI'};
const ST_LINES=[['Paza, anulare!',.55],['Pachet vă trebuie?',.15],['Aveți card Linella?',.15],['Casă liberă!',.15]];

let lst_mats=null,lst_tick=0,lst_markers=[],lst_int=null,lst_cur=null,lst_tr=null,lst_A=0,lst_cA=1,lst_sA=0,lst_O={x:0,z:0},lst_Y=0;
let lst_px=0,lst_pz=0,lst_boxes=[],lst_npcs=[],lst_cash=[],lst_guard=null,lst_item=null,lst_eventT=10,lst_lights=null,lst_alarm=false;
const lst_camL=new THREE.Vector3(),lst_v=new THREE.Vector3();let lst_camSnap=true;
let lst_ui=null,lst_bub=null,lst_voice=null;

function lst_tex(w,h,draw,rep){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);t.anisotropy=4;if(rep)t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;}
const lst_rnd=a=>a[Math.floor(Math.random()*a.length)];
// painted "shop behind glass" used on storefront windows
function lst_paintShop(g,x0,y0,w,h,seed){let r=seed;const R=()=>{r=(r*16807)%2147483647;return r/2147483647;};
  const gr=g.createLinearGradient(0,y0,0,y0+h);gr.addColorStop(0,'#fffbea');gr.addColorStop(1,'#e8e1cc');g.fillStyle=gr;g.fillRect(x0,y0,w,h);
  g.fillStyle='#f6f3ea';for(let i=0;i<4;i++)g.fillRect(x0+i*w/4+6,y0+4,w/4-12,10);   // ceiling lights
  const pal=['#d8262c','#f2b705','#2a7ab8','#3c9a40','#7a3d9a','#f08a24','#ffffff','#1f3f7a'];
  for(let s=0;s<3;s++){const sx=x0+8+s*(w-16)/3,sw=(w-16)/3-14;g.fillStyle='#9aa1a8';g.fillRect(sx,y0+h*.3,sw,h*.66);
    for(let lv=0;lv<4;lv++){const ly=y0+h*.32+lv*h*.16;for(let px=sx+3;px<sx+sw-6;){const pw=4+R()*7;g.fillStyle=pal[Math.floor(R()*pal.length)];g.fillRect(px,ly,pw,h*.12);px+=pw+1.5;}}}}
function lst_initMats(){if(lst_mats)return lst_mats;
  const red=new THREE.MeshLambertMaterial({color:0xc4001f,emissive:0x2a0006});
  const sign=linella_face?new THREE.MeshLambertMaterial({map:linella_face,emissive:0x5a0010,emissiveMap:linella_face}):red;
  const front=lst_tex(1024,320,(g,w,h)=>{g.fillStyle='#3b3f45';g.fillRect(0,0,w,h);
    lst_paintShop(g,14,14,372,292,7);lst_paintShop(g,638,14,372,292,11);
    // posters in the windows
    const poster=(x,y,t1,t2,bg,fg)=>{g.fillStyle=bg;g.fillRect(x,y,92,120);g.fillStyle=fg;g.textAlign='center';g.font='900 26px Anton, Impact, sans-serif';g.fillText(t1,x+46,y+44);g.font='900 40px Anton, Impact, sans-serif';g.fillText(t2,x+46,y+96);};
    poster(36,150,'REDUCERI','-30%','#ffd200','#c4001f');poster(890,150,'OFERTA','2+1','#c4001f','#ffffff');
    // door: two glass leaves with a brighter shop view, aluminium frames, push bars
    g.fillStyle='#2a2d31';g.fillRect(392,0,240,h);lst_paintShop(g,400,66,110,254,3);lst_paintShop(g,514,66,110,254,5);
    g.fillStyle='rgba(255,255,255,.18)';g.fillRect(400,66,110,254);g.fillRect(514,66,110,254);
    g.fillStyle='#c9ced4';g.fillRect(508,66,8,254);g.fillRect(470,190,30,6);g.fillRect(524,190,30,6);
    g.fillStyle='#ffd200';g.fillRect(400,14,224,44);g.fillStyle='#c4001f';g.font='900 24px Inter, Arial, sans-serif';g.textAlign='center';g.fillText('INTRARE · 07:00–23:00',512,44);
    // glass reflections
    g.fillStyle='rgba(255,255,255,.12)';for(const x of [60,700]){g.beginPath();g.moveTo(x,14);g.lineTo(x+70,14);g.lineTo(x-30,306);g.lineTo(x-100,306);g.fill();}});
  const frontMat=new THREE.MeshLambertMaterial({map:front,emissive:0x4a4740,emissiveMap:front});
  const glow=new THREE.MeshBasicMaterial({color:0xffd23f,toneMapped:false});
  const wall=new THREE.MeshLambertMaterial({color:0xd8d4cc});
  const mk=new THREE.MeshBasicMaterial({color:0xffd23f,transparent:true,opacity:.28,depthWrite:false,side:THREE.DoubleSide});
  const mkR=new THREE.MeshBasicMaterial({color:0xffd23f,transparent:true,opacity:.85,side:THREE.DoubleSide,depthWrite:false});
  const label=lst_tex(256,96,(g,w,h)=>{g.fillStyle='rgba(196,0,31,.92)';g.fillRect(0,0,w,h);g.fillStyle='#ffd200';g.fillRect(0,h-12,w,12);
    g.fillStyle='#fff';g.font='900 46px Anton, Impact, sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText('▼ INTRĂ',w/2,h/2-4);});
  const labelMat=new THREE.SpriteMaterial({map:label,depthWrite:false,toneMapped:false});
  lst_mats={red,sign,frontMat,glow,wall,mk,mkR,labelMat,
    G:{front:new THREE.PlaneGeometry(1,1),box:new THREE.BoxGeometry(1,1,1),col:new THREE.CylinderGeometry(.9,.9,2.4,24,1,true),ring:new THREE.RingGeometry(.75,1,32).rotateX(-Math.PI/2),cone:new THREE.ConeGeometry(.28,.5,4).rotateX(Math.PI)}};
  for(let i=0;i<3;i++){const g=new THREE.Group();const c=new THREE.Mesh(lst_mats.G.col,mk);c.position.y=1.2;const r=new THREE.Mesh(lst_mats.G.ring,mkR);r.position.y=.06;
    const s=new THREE.Sprite(labelMat);s.scale.set(1.9,.71,1);s.position.y=2.5;g.add(c,r,s);g.visible=false;scene.add(g);lst_markers.push({g,s,c});}
  return lst_mats;}

// ---- find the store's wall: march from the sign away from the road until we hit a building footprint ----
function lst_findDoor(s,pd){let hit=null,t=0,bx=s.x,bz=s.z;
  for(t=.5;t<=32&&!hit;t+=.5){const x=s.x+s.nx*t,z=s.z+s.nz*t;polysNear(x,z,0,P=>{if((P.h||0)>2.5&&insidePoly(P,x,z)){hit=P;return true;}return false;});if(!hit){bx=x;bz=z;}}
  if(!hit){if(pd>30&&!polysNear(s.x,s.z,60,()=>true))return null;  // tile not built yet — try again later
    // no block behind the sign: small standalone pavilion 9 m back from the kerb
    const ox=-s.nx,oz=-s.nz,cx=s.x+s.nx*9,cz=s.z+s.nz*9,ux=-oz,uz=ox,W=12,DD=8;
    const pts=[[-W/2,0],[W/2,0],[W/2,DD],[-W/2,DD]].map(([a,b])=>[cx+ux*a-ox*b+ox*DD/2,cz+uz*a-oz*b+oz*DD/2]);if(sArea(pts)<0)pts.reverse();addPoly([pts],4.6);
    const fx=cx+ox*DD/2,fz=cz+oz*DD/2;return {x:fx+ox*.06,z:fz+oz*.06,ox,oz,w:10,y:groundY(fx+ox,fz+oz),pav:DD};}
  let best=null,bd=1e9;for(const r of hit.rings)for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[j],c=r[i];const dx=c[0]-a[0],dz=c[1]-a[1],l2=dx*dx+dz*dz||1e-9;
    let u=((bx-a[0])*dx+(bz-a[1])*dz)/l2;u=u<0?0:u>1?1:u;const qx=a[0]+dx*u,qz=a[1]+dz*u,d=(bx-qx)**2+(bz-qz)**2;if(d<bd){bd=d;best={a,dx,dz,l:Math.sqrt(l2),u};}}
  const {a,l}=best,ux=best.dx/l,uz=best.dz/l;let ox=-uz,oz=ux;const tc0=best.u*l;
  if((bx-(a[0]+ux*tc0))*ox+(bz-(a[1]+uz*tc0))*oz<0){ox=-ox;oz=-oz;}
  const W=Math.max(3.4,Math.min(10,l-.6)),tc=l>W?clamp(tc0,W/2,l-W/2):l/2;const cx=a[0]+ux*tc,cz=a[1]+uz*tc;
  return {x:cx+ox*.06,z:cz+oz*.06,ox,oz,w:W,y:groundY(cx+ox,cz+oz)};}
function lst_buildFront(s){const M=lst_initMats(),D=s.door,G=M.G,W=D.w,g=new THREE.Group();
  const add=(geo,mat,sx,sy,sz,x,y,z)=>{const m=new THREE.Mesh(geo,mat);m.scale.set(sx,sy,sz);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;g.add(m);return m;};
  if(D.pav){add(G.box,M.wall,W+2,4.6,D.pav,0,2.3,-D.pav/2-.07);add(G.box,M.red,W+2.2,.35,D.pav+.2,0,4.75,-D.pav/2-.07);}
  add(G.front,M.frontMat,W,3.2,1,0,1.6,.02).castShadow=false;
  add(G.box,[M.red,M.red,M.red,M.red,M.sign,M.red],W+.2,.95,.3,0,3.72,.15);
  add(G.box,M.red,W+.3,.1,1.3,0,3.18,.65);
  const post=(x)=>add(G.box,M.glow,.1,2.5,.1,x,1.25,.1);post(-1.2);post(1.2);add(G.box,M.glow,2.5,.1,.1,0,2.5,.1);
  g.position.set(D.x,D.y,D.z);g.rotation.y=Math.atan2(D.ox,D.oz);scene.add(g);return g;}

// called every frame from linellaUpdate(): storefronts near the player + entrance markers
function lst_frontsUpdate(){const P=window.gtcApi&&gtcApi.player;if(!P||!linella_list)return;lst_initMats();lst_ionUpdate(P);
  const now=performance.now();
  if(now>lst_tick){lst_tick=now+250;
    for(const s of linella_list){const d=Math.hypot(s.x-P.x,s.z-P.z);
      if(d<220&&!s.door&&!(s.doorT>now)){s.door=lst_findDoor(s,d);if(!s.door)s.doorT=now+1500;}
      if(s.door&&d<260&&!s.front)s.front=lst_buildFront(s);
      else if(s.front&&d>360){scene.remove(s.front);s.front=null;}}}
  // markers on the 3 nearest doors within 90 m (hidden while inside)
  const near=[];if(!lst_cur)for(const s of linella_list){if(!s.door)continue;const d=Math.hypot(s.door.x-P.x,s.door.z-P.z);if(d<90)near.push([d,s]);}
  near.sort((a,b)=>a[0]-b[0]);const t=now/1000;
  lst_markers.forEach((m,i)=>{const e=near[i];if(!e){m.g.visible=false;return;}const D=e[1].door;const x=D.x+D.ox*1.5,z=D.z+D.oz*1.5;
    m.g.visible=true;m.g.position.set(x,groundY(x,z),z);m.s.position.y=2.5+Math.sin(t*3)*.1;m.c.material.opacity=.2+Math.sin(t*4)*.08;});}

// ================= interior =================
function lst_buildInterior(){const g=new THREE.Group();g.visible=false;scene.add(g);lst_boxes=[];
  const B=(w,h,d,x,y,z,mat,col)=>{const m=new THREE.Mesh(lst_mats.G.box,mat);m.scale.set(w,h,d);m.position.set(x,y+h/2,z);g.add(m);if(col)lst_boxes.push(Object.assign({x0:x-w/2,x1:x+w/2,z0:z-d/2,z1:z+d/2},col===true?{}:col));return m;};
  const P=(w,h,x,y,z,ry,mat)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);m.position.set(x,y,z);m.rotation.y=ry;g.add(m);return m;};
  const basic=c=>new THREE.MeshBasicMaterial({color:c}),lam=c=>new THREE.MeshLambertMaterial({color:c});
  const W=ST_HW*2;
  // floor, ceiling, walls
  const floorT=lst_tex(256,256,(c,w,h)=>{c.fillStyle='#d9d6cf';c.fillRect(0,0,w,h);for(let i=0;i<2;i++)for(let j=0;j<2;j++){c.fillStyle=(i+j)%2?'#e6e3dc':'#dcd8d0';c.fillRect(i*128+2,j*128+2,124,124);}
    c.globalAlpha=.06;for(let k=0;k<400;k++){c.fillStyle=Math.random()<.5?'#000':'#fff';c.fillRect(Math.random()*w,Math.random()*h,2,2);}},true);floorT.repeat.set(W/1.2,ST_D/1.2);
  const fl=new THREE.Mesh(new THREE.PlaneGeometry(W,ST_D).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({map:floorT,color:0x9c9a96}));fl.position.set(0,0,ST_D/2);g.add(fl);
  const ceilT=lst_tex(128,128,(c,w,h)=>{c.fillStyle='#e9e9e6';c.fillRect(0,0,w,h);c.strokeStyle='#b9bab6';c.lineWidth=3;c.strokeRect(0,0,w,h);},true);ceilT.repeat.set(W/1.2,ST_D/1.2);
  const ce=new THREE.Mesh(new THREE.PlaneGeometry(W,ST_D).rotateX(Math.PI/2),new THREE.MeshBasicMaterial({map:ceilT,color:0xb4b4b2}));ce.position.set(0,ST_H,ST_D/2);g.add(ce);
  const wallM=basic(0xc9c6bf),bandM=basic(0xc4001f),yel=basic(0xffd200);
  B(W,ST_H,.2,0,0,ST_D+.1,wallM);B(.2,ST_H,ST_D,-ST_HW-.1,0,ST_D/2,wallM);B(.2,ST_H,ST_D,ST_HW+.1,0,ST_D/2,wallM);
  B(W/2-1.25,ST_H,.2,-(W/2+1.25)/2,0,-.1,wallM);B(W/2-1.25,ST_H,.2,(W/2+1.25)/2,0,-.1,wallM);B(2.5,ST_H-2.5,.2,0,2.5,-.1,wallM);
  // red/yellow brand band round the walls
  for(const [w,d,x,z] of [[W,.05,0,ST_D-.01],[.05,ST_D,-ST_HW+.01,ST_D/2],[.05,ST_D,ST_HW-.01,ST_D/2],[W,.05,0,.01]]){B(w,.45,d,x,2.75,z,bandM);B(w,.08,d,x,2.67,z,yel);}
  // glass door panes (looking out = bright daylight)
  B(2.4,2.45,.04,0,0,-.05,new THREE.MeshBasicMaterial({color:0xdfeaf2,toneMapped:false}));B(.06,2.5,.08,0,0,-.02,basic(0x9aa0a6));
  // fluorescent strips
  const lamp=new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false});
  for(let x=-9;x<=9;x+=3)for(let z=2;z<ST_D-1;z+=3.2)B(.35,.04,1.7,x,ST_H-.05,z,lamp);
  // big back-wall sign
  const bigT=lst_tex(1024,160,(c,w,h)=>{c.fillStyle='#c4001f';c.fillRect(0,0,w,h);c.fillStyle='#ffd200';c.fillRect(0,h-22,w,22);c.fillStyle='#fff';c.font='900 112px Anton, Impact, sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('LINELLA',w/2,h/2-10);});
  P(8,1.25,0,3.45,ST_D-.02,Math.PI,new THREE.MeshBasicMaterial({map:bigT}));
  const posterM=(t1,t2,bg,fg)=>new THREE.MeshBasicMaterial({map:lst_tex(256,340,(c,w,h)=>{c.fillStyle=bg;c.fillRect(0,0,w,h);c.fillStyle=fg;c.textAlign='center';c.font='900 52px Anton, Impact, sans-serif';c.fillText(t1,w/2,110);c.font='900 110px Anton, Impact, sans-serif';c.fillText(t2,w/2,250);})});
  P(1.3,1.7,-ST_HW+.02,1.9,7,Math.PI/2,posterM('REDUCERI','-30%','#ffd200','#c4001f'));P(1.3,1.7,ST_HW-.02,1.9,7.8,-Math.PI/2,posterM('OFERTA','2+1','#c4001f','#fff'));
  P(1.3,1.7,-5,1.9,.12,0,posterM('PROSPEȚIME','ZILNIC','#2f8a3c','#fff'));
  // product instancing
  const prodT=lst_tex(64,64,(c,w,h)=>{c.fillStyle='#d8d8d8';c.fillRect(0,0,w,h);c.fillStyle='#fff';c.fillRect(0,h*.35,w,h*.3);c.fillStyle='#8a8a8a';c.fillRect(0,0,w,h*.1);c.fillStyle='#bbb';c.fillRect(w*.2,h*.42,w*.6,h*.06);c.fillRect(w*.2,h*.52,w*.4,h*.05);});
  const prodM=new THREE.MeshLambertMaterial({map:prodT});const prods=[];
  const PAL={lactate:[0xf2f4f7,0x2a6fd1,0x7fb3e6,0xffffff,0x3c9a40],dulciuri:[0x8a2a8a,0xd8262c,0xf2b705,0x5a2a14,0xe85a9a],bauturi:[0xd8262c,0x2a7ab8,0x3c9a40,0xf08a24,0x111111],
    vinuri:[0x5a0a1a,0x2c3a1c,0x7a1a2a,0xd8c48a,0x1a1a1a],paine:[0xd9a24a,0xc98a3a,0xe8c27a,0xb06a2a],conserve:[0xd8262c,0x3c9a40,0xf2b705,0xe8e8e8,0xf08a24],
    snacks:[0xf2b705,0xd8262c,0x2a7ab8,0x3c9a40,0x111111],frig:[0x2a7ab8,0xd8262c,0x3c9a40,0xf2b705,0xffffff]};
  const fill=(cat,x0,x1,z0,z1,y,hMax,alongZ)=>{for(let u=(alongZ?z0:x0)+.05;u<(alongZ?z1:x1)-.08;){const w=mr(.12,.3),h=mr(.16,hMax),d=alongZ?(x1-x0):(z1-z0);
      const c=new THREE.Color(lst_rnd(PAL[cat])).multiplyScalar(mr(.82,1.05));if(alongZ)prods.push([(x0+x1)/2,y+h/2,u+w/2,d,h,w,c]);else prods.push([u+w/2,y+h/2,(z0+z1)/2,w,h,d,c]);u+=w+.015;}};
  const shelfM=lam(0xd4d8dc),baseM=lam(0x6a7078),tagM=basic(0xfff6c8);
  const LV=[.12,.55,.98,1.41],cats=['lactate','dulciuri','conserve','snacks','bauturi','paine'];
  ST_ISL.forEach((cx,i)=>{const catA=cats[i%cats.length],catB=cats[(i+1)%cats.length];
    B(1.1,.12,14,cx,0,17,baseM,{cat:catA,catR:catB});   // -x side = catA, +x side = catB
    B(.06,1.85,14,cx,0,17,shelfM);
    for(const y of LV){B(1.1,.03,14,cx,y,17,shelfM);B(.02,.05,14,cx-.56,y-.02,17,tagM);B(.02,.05,14,cx+.56,y-.02,17,tagM);
      fill(catA,cx-.53,cx-.05,10.05,23.95,y+.03,.38,true);fill(catB,cx+.05,cx+.53,10.05,23.95,y+.03,.38,true);}});
  // wall shelves: wine left, drinks right
  for(const [side,cat] of [[-1,'vinuri'],[1,'bauturi']]){const x=side*(ST_HW-.35);B(.7,2.15,18,x,0,18,shelfM,{cat});
    for(let k=0;k<5;k++){const y=.12+k*.42;B(.72,.03,18,x,y,18,shelfM);fill(cat,x-.3,x+.3,9.05,26.95,y+.03,.34,true);}}
  // back wall fridges (glowing) with bottles
  B(W,2.25,.8,0,0,ST_D-.4,lam(0xf4f6f8),{cat:'frig'});B(W-.4,1.8,.02,0,.25,ST_D-.81,new THREE.MeshBasicMaterial({color:0xcfe6ff,toneMapped:false}));
  const bottles=[];for(let k=0;k<4;k++){const y=.27+k*.45;for(let x=-ST_HW+.4;x<ST_HW-.4;x+=.13)if(Math.random()<.88)bottles.push([x,y,ST_D-.7,new THREE.Color(lst_rnd(PAL.frig)).multiplyScalar(mr(.8,1))]);}
  const glassF=new THREE.MeshBasicMaterial({color:0xbfdfff,transparent:true,opacity:.16,depthWrite:false});B(W-.4,1.85,.02,0,.22,ST_D-.86,glassF);
  for(let x=-ST_HW+2.2;x<ST_HW;x+=2.2)B(.06,2.25,.05,x,0,ST_D-.85,lam(0xc8ccd0));
  // bread rack + vegetables at the front-left
  B(2.6,1.5,.7,-9.2,0,7.5,lam(0x8a5a32),{cat:'paine'});fill('paine',-10.45,-7.95,7.2,7.8,1.5,.22,false);fill('paine',-10.45,-7.95,7.2,7.8,.75,.22,false);
  const vegM=lam(0x8a5a32),veg=[];
  for(const vx of [-8,-5.2]){B(2.2,.8,2.2,vx,0,3.3,vegM,{cat:'legume'});
    for(let i=0;i<4;i++){const c=lst_rnd([0xd8262c,0xf08a24,0x3c9a40,0xf2c705,0x7a1a3a,0xc8a060]);const qx=vx-.55+(i%2)*1.1,qz=3.3-.55+Math.floor(i/2)*1.1;
      for(let k=0;k<26;k++)veg.push([qx+mr(-.45,.45),.85+mr(0,.12),qz+mr(-.45,.45),c]);}}
  // checkouts
  const cM=lam(0x3b3f45),belt=basic(0x161616),reg=lam(0x2a2a2e),scr=new THREE.MeshBasicMaterial({color:0x7fd0ff,toneMapped:false});
  for(const cx of ST_CO){B(.8,.9,3.2,cx,0,3.8,cM,{pay:cx});B(.62,.02,2.2,cx,.9,4.2,belt);B(.35,.3,.35,cx+.2,.9,2.7,reg);B(.3,.2,.02,cx+.2,1.25,2.53,scr);
    B(.06,1.4,.06,cx-.35,0,2.25,lam(0x9aa0a6));const nm=new THREE.Mesh(new THREE.PlaneGeometry(.6,.3),new THREE.MeshBasicMaterial({map:lst_tex(128,64,(c,w,h)=>{c.fillStyle='#c4001f';c.fillRect(0,0,w,h);c.fillStyle='#fff';c.font='900 40px Anton, Impact, sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('CASA '+(ST_CO.indexOf(cx)+1),w/2,h/2);}),side:THREE.DoubleSide}));
    nm.position.set(cx-.35,1.55,2.25);g.add(nm);lst_boxes.push({x0:cx+.4,x1:cx+1.1,z0:2.6,z1:5.0});}
  // security gates, lockers, carts
  const gate=lam(0xb8bec4),redL=new THREE.MeshBasicMaterial({color:0xff2030,toneMapped:false});
  for(const x of [-1.3,1.3]){B(.18,1.55,.5,x,0,1.45,gate,true);B(.19,.06,.51,x,1.55,1.45,redL);}
  B(.6,1.9,3,-ST_HW+.3,0,12.5-7,lam(0x2f5d8a),true);
  for(let i=0;i<3;i++){const cart=B(.55,.55,.85,-2.9-i*.18,.35,.75,new THREE.MeshLambertMaterial({color:0xc4001f,transparent:true,opacity:.75}));cart.userData.k=i;}
  lst_boxes.push({x0:-3.6,x1:-2.4,z0:.3,z1:1.2});
  // hanging aisle signs
  ST_AX.forEach((ax,i)=>{if(i===0||i===ST_AX.length-1)return;const cat=cats[i%cats.length];const t=lst_tex(512,128,(c,w,h)=>{c.fillStyle='#ffd200';c.fillRect(0,0,w,h);c.fillStyle='#c4001f';c.fillRect(0,0,w,18);c.fillStyle='#1a1305';c.font='900 64px Anton, Impact, sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(ST_CATNAME[cat],w/2,h/2+8);});
    P(2.2,.55,ax,3.35,10.3,Math.PI,new THREE.MeshBasicMaterial({map:t}));B(.02,.5,.02,ax-.9,3.6,10.3,basic(0x777777));B(.02,.5,.02,ax+.9,3.6,10.3,basic(0x777777));});
  for(const [x,cat,ry] of [[-ST_HW+.75,'vinuri',Math.PI/2],[ST_HW-.75,'bauturi',-Math.PI/2]]){const t=lst_tex(512,128,(c,w,h)=>{c.fillStyle='#c4001f';c.fillRect(0,0,w,h);c.fillStyle='#fff';c.font='900 56px Anton, Impact, sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(ST_CATNAME[cat],w/2,h/2);});
    P(3,.75,x,2.55,18,ry,new THREE.MeshBasicMaterial({map:t}));}
  // instanced meshes
  const im=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),prodM,prods.length),m4=new THREE.Matrix4(),q=new THREE.Quaternion(),p=new THREE.Vector3(),s=new THREE.Vector3();
  prods.forEach((r,i)=>{m4.compose(p.set(r[0],r[1],r[2]),q,s.set(r[3],r[4],r[5]));im.setMatrixAt(i,m4);im.setColorAt(i,r[6]);});g.add(im);
  const bi=new THREE.InstancedMesh(new THREE.CylinderGeometry(.045,.05,.32,8),new THREE.MeshLambertMaterial({color:0xffffff}),bottles.length);
  bottles.forEach((r,i)=>{m4.compose(p.set(r[0],r[1]+.16,r[2]),q,s.set(1,1,1));bi.setMatrixAt(i,m4);bi.setColorAt(i,r[3]);});g.add(bi);
  const vi=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.09,1),new THREE.MeshLambertMaterial({color:0xffffff}),veg.length);
  veg.forEach((r,i)=>{m4.compose(p.set(r[0],r[1],r[2]),q,s.set(1,1,1));vi.setMatrixAt(i,m4);vi.setColorAt(i,new THREE.Color(r[3]).multiplyScalar(mr(.8,1.05)));});g.add(vi);
  g.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=false;o.frustumCulled=false;}});
  // lights that only matter in here (kept at intensity 0 outside so no shader rebuilds later)
  const amb=new THREE.AmbientLight(0xfff6ea,0),dir=new THREE.DirectionalLight(0xffffff,0);dir.position.set(0,1,-.4);scene.add(amb,dir,dir.target);lst_lights={amb,dir};
  // staff + shoppers
  const person=(top,bot,cap)=>{const p=makePersonGroup(0xffffff,0x222222,0xe0b896);const u=p.userData;u.own=true;if(top!=null){u.o.top=top;u.o.bot=bot;u.o.mask|=ppl_F.sleeves;if(cap)u.o.mask|=ppl_F.cap,u.o.acc=0x111111;ppl_applyLook(u.ims,0,1,u.o);}
    scene.remove(p);g.add(p);return p;};
  lst_cash=ST_CO.map((cx,i)=>({g:person(0xc8102e,0x23262c),x:cx+.75,z:3.6+i*.15,h:-Math.PI/2,talk:0,k:i,name:'Casiera',col:'#ff6b6b'}));
  lst_guard={g:person(0x14161a,0x14161a,true),hx:-2.3,hz:2.6,x:-2.3,z:2.6,h:Math.PI/2,st:'idle',path:[],wait:0,talk:0,name:'Paznic',col:'#9ecbff'};
  lst_npcs=[];for(let i=0;i<6;i++){const staff=i<2;lst_npcs.push({g:staff?person(0xc8102e,0x23262c):person(),ai:Math.floor(Math.random()*ST_AX.length),z:mr(11,23),path:[],wait:mr(0,3),sp:staff?1.2:mr(.9,1.3),h:0,staff});}
  for(const n of lst_npcs)n.x=ST_AX[n.ai];
  lst_int=g;}

function lst_ui_init(){if(lst_ui)return;const css=document.createElement('style');css.textContent=
  '#lst_fade{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:28}'+
  '#lst_hint{position:fixed;left:50%;bottom:18%;transform:translateX(-50%);font:700 15px Inter,Arial,sans-serif;color:#fff;background:rgba(0,0,0,.55);padding:8px 14px;border-radius:10px;display:none;z-index:12;text-align:center}'+
  '#lst_hint b{background:#ffd23f;color:#1a1305;padding:1px 7px;border-radius:5px;margin-right:6px}'+
  '#lst_bub{position:fixed;transform:translate(-50%,-100%);font:800 17px Inter,Arial,sans-serif;color:#1a1305;background:#fff;padding:7px 12px;border-radius:14px;display:none;z-index:12;white-space:nowrap;box-shadow:0 3px 0 rgba(0,0,0,.35)}'+
  '#lst_bub:after{content:"";position:absolute;left:50%;bottom:-8px;margin-left:-8px;border:8px solid transparent;border-bottom:0;border-top-color:#fff}';
  document.head.appendChild(css);for(const id of ['lst_fade','lst_hint','lst_bub']){const d=document.createElement('div');d.id=id;document.body.appendChild(d);}
  lst_ui={fade:document.getElementById('lst_fade'),hint:document.getElementById('lst_hint'),bub:document.getElementById('lst_bub')};}
// every NPC line goes through here: a pre-rendered file (assets/voice/voices.js 'all', tools/gen_piper.py) if there is one,
// pitched per character via playbackRate; otherwise the browser's speechSynthesis
function lst_speak(t,pitch,rate){try{if(typeof fx_muted!=='undefined'&&fx_muted)return;
  const V=window.NPC_VOICES&&NPC_VOICES.all,f=V&&V[t];if(f){npc_play(f,Math.min(1.2,Math.max(.85,pitch||1)));return;}
  const S=window.speechSynthesis;if(!S)return;
  if(!lst_voice)lst_voice=S.getVoices().find(v=>/^ro/i.test(v.lang))||null;const u=new SpeechSynthesisUtterance(t);u.lang='ro-RO';if(lst_voice)u.voice=lst_voice;u.rate=rate||1.05;u.pitch=pitch||1;u.volume=1;S.cancel();S.speak(u);}catch(e){}}
// pre-generated character voices (assets/voice/voices.js, made by tools/gen_voices.py); false = no file, caller falls back to lst_speak
const npc_audio={};let npc_cur=null;
function npc_voice(grp,name,text,rate){try{const V=window.NPC_VOICES,f=V&&V[grp]&&V[grp][name]&&V[grp][name][text];if(!f)return false;
  if(typeof fx_muted!=='undefined'&&fx_muted)return true;const a=npc_audio[f]||(npc_audio[f]=new Audio(f));
  npc_play(f,rate||1);return true;}catch(e){return false;}}
// play one pre-rendered line; rate also shifts pitch (preservesPitch off), so one voice gives deeper/higher characters
function npc_play(f,rate){const a=npc_audio[f]||(npc_audio[f]=new Audio(f));if(npc_cur&&npc_cur!==a)npc_cur.pause();if(window.speechSynthesis)speechSynthesis.cancel();
  a.preservesPitch=false;a.mozPreservesPitch=false;a.webkitPreservesPitch=false;a.currentTime=0;a.playbackRate=rate;a.play().catch(()=>{});npc_cur=a;}
function lst_say(who,text,pitch,vg){lst_bub={who,text,t:2.6};if(!(vg&&npc_voice(vg[0],vg[1],text)))lst_speak(text,pitch);subtitle(who.name||'Casiera',text,who.col);}
function lst_beep(){try{const a=(typeof fx_AC!=='undefined'&&fx_AC)||(lst_beep.ac=lst_beep.ac||new (window.AudioContext||window.webkitAudioContext)());const t=a.currentTime,o=a.createOscillator(),g=a.createGain();o.type='square';
  for(let i=0;i<6;i++)o.frequency.setValueAtTime(i%2?880:1320,t+i*.12);g.gain.setValueAtTime(.08,t);g.gain.setValueAtTime(0,t+.72);o.connect(g);g.connect(a.destination);o.start(t);o.stop(t+.75);}catch(e){}}

// local ↔ world
const lst_W=(lx,lz)=>[lst_O.x+lx*lst_cA+lz*lst_sA,lst_O.z-lx*lst_sA+lz*lst_cA];
function lst_begin(s,enter){lst_ui_init();lst_tr={ph:'out',t:0,enter,s};}
function lst_enter(s){lst_initMats();if(!lst_int)lst_buildInterior();const api=gtcApi,P=api.player,D=s.door;
  lst_cur=s;s.armed=false;lst_A=Math.atan2(-D.ox,-D.oz);lst_cA=Math.cos(lst_A);lst_sA=Math.sin(lst_A);lst_O={x:D.x,z:D.z};lst_Y=D.y+ST_DY;
  lst_int.position.set(D.x,lst_Y,D.z);lst_int.rotation.y=lst_A;lst_int.visible=true;lst_lights.amb.intensity=.7;lst_lights.dir.intensity=.35;
  lst_lights.dir.position.set(D.x,lst_Y+10,D.z-4);lst_lights.dir.target.position.set(D.x,lst_Y,D.z);lst_lights.dir.target.updateMatrixWorld();
  lst_guardName=LST_GUARD_NAMES[Math.floor(Math.random()*LST_GUARD_NAMES.length)];lst_guard.name='Paznic '+lst_guardName;
  lst_px=0;lst_pz=1.9;P.h=lst_A;api.camYaw=lst_A;lst_camSnap=true;lst_item=null;lst_alarm=false;lst_eventT=mr(5,12);
  const gd=lst_guard;gd.x=gd.hx;gd.z=gd.hz;gd.st='idle';gd.path=[];for(const m of lst_markers)m.g.visible=false;
  api.say('LINELLA','Bine ați venit! · E lângă raft — ia un produs',2.4,'#ffd23f');}
function lst_exit(){const api=gtcApi,P=api.player,s=lst_cur,D=s.door;const h=Math.atan2(D.ox,D.oz);
  P.x=D.x+D.ox*1.7;P.z=D.z+D.oz*1.7;P.h=h;P.y=groundY(P.x,P.z);api.camYaw=h;api.camPos.set(P.x-Math.sin(h)*6,P.y+3,P.z-Math.cos(h)*6);
  P.m.position.set(P.x,P.y,P.z);P.m.rotation.y=h;lst_int.visible=false;lst_lights.amb.intensity=0;lst_lights.dir.intensity=0;
  if(lst_item){const nm=lst_item.name;if(!lst_item.paid){lst_ionStart(D);const gn=lst_guardName;setTimeout(()=>api.say('Ai furat: '+nm,'Paznicul '+gn+' fuge după tine!',2.6,'#ffd23f'),50);}
    else setTimeout(()=>api.say('Ai cumpărat: '+nm,'Poftă bună!',2,'#7dff8a'),50);
    if(typeof missionEvent==='function')missionEvent('store_exit',{name:nm,paid:lst_item.paid});}
  lst_item=null;lst_ui.hint.style.display='none';lst_ui.bub.style.display='none';lst_bub=null;lst_cur=null;s.armed=false;}
function storeInside(){return !!lst_cur;}
function storeSavePos(){if(!lst_cur)return null;const D=lst_cur.door;return {x:D.x+D.ox*1.7,z:D.z+D.oz*1.7,h:Math.atan2(D.ox,D.oz)};}

function storeUpdate(dt,inp){const api=window.gtcApi;if(!api||!linella_list)return false;const P=api.player;
  if(lst_tr){const T=.15;lst_tr.t+=dt;
    if(lst_tr.ph==='out'){lst_ui.fade.style.opacity=Math.min(1,lst_tr.t/T);if(lst_tr.t>=T){lst_tr.ph='in';lst_tr.t=0;if(lst_tr.enter)lst_enter(lst_tr.s);else lst_exit();}}
    else{lst_ui.fade.style.opacity=Math.max(0,1-lst_tr.t/T);if(lst_tr.t>=T){lst_ui.fade.style.opacity=0;lst_tr=null;}}
    if(lst_tr&&lst_tr.ph==='out'&&!lst_cur){envUpdate(dt);return true;}   // fading out on the street: freeze
    if(lst_cur){lst_camera(dt,api);const [wx,wz]=lst_W(lst_px,lst_pz);P.m.position.set(wx,lst_Y,wz);animatePlayer(P.m,0,0,dt);return true;}
    return false;}
  if(lst_cur)return lst_insideUpdate(dt,inp,P,api);
  if(P.mode!=='foot')return false;
  for(const s of linella_list){if(!s.door)continue;const D=s.door,ex=D.x+D.ox*1.2,ez=D.z+D.oz*1.2;if(Math.abs(P.x-ex)>6||Math.abs(P.z-ez)>6){s.armed=true;continue;}
    const d=Math.hypot(P.x-ex,P.z-ez);if(d>3)s.armed=true;else if(s.armed&&d<1.0){lst_begin(s,true);envUpdate(dt);return true;}}
  return false;}

function lst_collide(r){lst_px=clamp(lst_px,-ST_HW+r,ST_HW-r);lst_pz=clamp(lst_pz,.3,ST_D-r);
  for(const b of lst_boxes){const qx=clamp(lst_px,b.x0,b.x1),qz=clamp(lst_pz,b.z0,b.z1),dx=lst_px-qx,dz=lst_pz-qz,d=Math.hypot(dx,dz);
    if(d<r){if(d>1e-5){lst_px+=dx/d*(r-d);lst_pz+=dz/d*(r-d);}else{const e=[lst_px-b.x0,b.x1-lst_px,lst_pz-b.z0,b.z1-lst_pz],m=Math.min(...e);if(m===e[0])lst_px=b.x0-r;else if(m===e[1])lst_px=b.x1+r;else if(m===e[2])lst_pz=b.z0-r;else lst_pz=b.z1+r;}}}
  if(lst_pz<1.75&&Math.abs(lst_px)>1.12&&Math.abs(lst_px)<1.6)lst_px=Math.sign(lst_px)*(Math.abs(lst_px)<1.36?1.12:1.6);
  for(const n of lst_npcs.concat(lst_cash,[lst_guard])){const dx=lst_px-n.x,dz=lst_pz-n.z,d=Math.hypot(dx,dz);if(d<.62&&d>1e-4){lst_px+=dx/d*(.62-d);lst_pz+=dz/d*(.62-d);}}}
// what can the player do right here?
function lst_near(){let best=null,bd=.95;for(const b of lst_boxes){if(!b.cat&&!b.pay)continue;const qx=clamp(lst_px,b.x0,b.x1),qz=clamp(lst_pz,b.z0,b.z1),d=Math.hypot(lst_px-qx,lst_pz-qz);
    if(b.pay){if(lst_px<b.x0&&lst_pz>2.2&&lst_pz<5.6&&lst_px>b.x0-1.4&&d<bd+.6){best={pay:b.pay};bd=d;}continue;}
    if(d<bd){bd=d;best={cat:b.catR&&lst_px>(b.x0+b.x1)/2?b.catR:b.cat};}}
  return best;}
function lst_interact(){if(!lst_cur||lst_tr)return;const api=gtcApi,n=lst_near();if(!n)return;
  if(n.pay){if(!lst_item){lst_say(lst_cash[ST_CO.indexOf(n.pay)],'Casă liberă!');return;}if(lst_item.paid)return;
    const c=lst_cash[ST_CO.indexOf(n.pay)];if(api.money<lst_item.price){lst_say(c,'Nu ajung banii...',.9);return;}
    api.money-=lst_item.price;lst_item.paid=true;lst_say(c,'Mulțumim! Pachet vă trebuie?');api.say('-'+lst_item.price+' lei',lst_item.name+' plătit',1.8,'#7dff8a');return;}
  if(lst_item&&!lst_item.paid){api.say('Ai pus la loc',lst_item.name,1.4);lst_item=null;return;}
  if(lst_item&&lst_item.paid)return;
  const [name,price]=lst_rnd(ST_ITEMS[n.cat]);lst_item={name,price,paid:false};api.say('Ai luat: '+name,price+' lei · plătește la casă',2,'#ffd23f');}
addEventListener('keydown',e=>{if(e.code==='KeyE'&&lst_cur&&!e.repeat)lst_interact();});
addEventListener('pointerdown',e=>{if(lst_cur&&e.pointerType==='touch'&&e.clientX>innerWidth*.6&&e.clientY>innerHeight*.55)lst_interact();});

function lst_route(n){const tai=Math.floor(Math.random()*ST_AX.length),tz=mr(10.6,23.4);
  if(tai===n.ai)n.path=[[ST_AX[tai],tz]];else{const cz=(n.z+tz)/2<17?8.4:26;n.path=[[ST_AX[n.ai],cz],[ST_AX[tai],cz],[ST_AX[tai],tz]];}n.ai=tai;}
function lst_walk(n,sp,dt){const p=n.path[0];const dx=p[0]-n.x,dz=p[1]-n.z,d=Math.hypot(dx,dz);let v=0;
  const pd=Math.hypot(lst_px-n.x,lst_pz-n.z);if(pd<.9&&((lst_px-n.x)*dx+(lst_pz-n.z)*dz)>0)return 0;   // don't walk into the player
  if(d<.05){n.path.shift();return 0;}const s=Math.min(d,sp*dt);n.x+=dx/d*s;n.z+=dz/d*s;n.h=lerpAng(n.h,Math.atan2(dx,dz),1-Math.exp(-8*dt));v=sp;return v;}
function lst_place(n,v,dt){n.g.position.set(n.x,0,n.z);n.g.rotation.y=n.h;animatePlayer(n.g,0,v,dt);}

function lst_insideUpdate(dt,inp,P,api){
  const yaw=api.camYaw,fx=Math.sin(yaw),fz=Math.cos(yaw),rx=-fz,rz=fx;let mx=fx*inp.t+rx*inp.s,mz=fz*inp.t+rz*inp.s;const l=Math.hypot(mx,mz),sp=inp.run?6.2:3.4;let spd=0,dlz=0;
  if(l>.08){mx/=Math.max(1,l);mz/=Math.max(1,l);const dlx=(mx*lst_cA-mz*lst_sA)*sp*dt;dlz=(mx*lst_sA+mz*lst_cA)*sp*dt;lst_px+=dlx;lst_pz+=dlz;P.h=lerpAng(P.h,Math.atan2(mx,mz),1-Math.exp(-12*dt));spd=sp*Math.min(1,l);}
  const pz0=lst_pz;lst_collide(.32);
  // theft alarm when walking out through the gates with an unpaid item
  if(lst_item&&!lst_item.paid&&pz0>1.75&&lst_pz<=1.75&&Math.abs(lst_px)<1.3&&!lst_alarm){lst_alarm=true;lst_beep();const c=lst_cash[0];lst_say(c,'Paza!! Hoțul!',1.2);lst_guard.st='chase';}
  if(lst_pz<.55&&Math.abs(lst_px)<1.15&&dlz<0){lst_begin(lst_cur,false);}
  const [wx,wz]=lst_W(lst_px,lst_pz);P.x=wx;P.z=wz;P.y=lst_Y;P.m.visible=true;P.m.position.set(wx,lst_Y,wz);P.m.rotation.y=P.h;animatePlayer(P.m,0,spd,dt);
  // staff & shoppers
  for(const n of lst_npcs){let v=0;if(n.wait>0){n.wait-=dt;}else if(n.path.length){v=lst_walk(n,n.sp,dt);if(!n.path.length)n.wait=n.staff?mr(3,7):mr(1,4);}else lst_route(n);lst_place(n,v,dt);}
  for(const c of lst_cash){c.h=lerpAng(c.h,-Math.PI/2+Math.sin(performance.now()/1700+c.k*2)*.5,1-Math.exp(-2*dt));lst_place(c,0,dt);}
  const gd=lst_guard;let gv=0;
  if(gd.st==='chase'){const dx=lst_px-gd.x,dz=lst_pz-gd.z,d=Math.hypot(dx,dz);
    if(!lst_item||lst_item.paid||lst_pz>9){gd.st='back';gd.path=[[gd.hx,gd.hz]];}
    else if(d<.75){api.money=Math.max(0,api.money-20);lst_say(gd,'Stai! Dă încoace!',.8,['guard',lst_gv(lst_guardName)]);api.say('Paza te-a prins!','Ți-a luat '+lst_item.name+' · amendă 20 lei',2.6,'#ff8a65');lst_item=null;lst_alarm=false;gd.st='back';gd.path=[[gd.hx,gd.hz]];}
    else{const s=Math.min(d,4.6*dt);gd.x+=dx/d*s;gd.z+=dz/d*s;gd.h=lerpAng(gd.h,Math.atan2(dx,dz),1-Math.exp(-10*dt));gv=4.6;}}
  else if(gd.path.length){gv=lst_walk(gd,1.5,dt);if(!gd.path.length){if(gd.st==='go'){gd.st='fix';gd.wait=3;gd.h=Math.PI/2;}else if(gd.st==='back'){gd.st='idle';gd.h=Math.PI/2;}}}
  else if(gd.st==='fix'){gd.wait-=dt;if(gd.wait<=0){gd.st='back';const p=gd.ret;gd.path=[[p[0],6.1],[gd.hx,6.1],[gd.hx,gd.hz]];}}
  lst_place(gd,gv,dt);
  // random checkout chatter — "Paza, anulare!" calls the guard to that till
  lst_eventT-=dt;if(lst_eventT<=0){lst_eventT=mr(14,32);const c=lst_rnd(lst_cash);let r=Math.random(),line=ST_LINES[0][0];for(const [t,w] of ST_LINES){r-=w;if(r<=0){line=t;break;}}
    lst_say(c,line,1+Math.random()*.15);
    if(line==='Paza, anulare!'&&gd.st==='idle'){const lx=ST_CO[c.k]-1.0;gd.st='go';gd.ret=[lx,4.2];gd.path=[[gd.hx,6.1],[lx,6.1],[lx,4.2]];}}
  // hint + speech bubble
  const n=lst_near();let h='';
  if(n&&n.pay)h=lst_item&&!lst_item.paid?'<b>E</b>Plătește '+lst_item.name+' — '+lst_item.price+' lei':'';
  else if(n)h=lst_item&&!lst_item.paid?'<b>E</b>Pune la loc '+lst_item.name:(lst_item?'':'<b>E</b>Ia din '+ST_CATNAME[n.cat].toLowerCase());
  if(!h&&lst_item)h=lst_item.paid?'✔ '+lst_item.name+' (plătit)':'🛒 '+lst_item.name+' — '+lst_item.price+' lei · nu e plătit!';
  lst_ui.hint.innerHTML=h;lst_ui.hint.style.display=h?'block':'none';
  if(lst_bub){lst_bub.t-=dt;const w=lst_bub.who,p=lst_W(w.x,w.z);lst_v.set(p[0],lst_Y+2.15,p[1]).project(camera);
    if(lst_bub.t<=0||lst_v.z>1){lst_ui.bub.style.display='none';if(lst_bub.t<=0)lst_bub=null;}
    else{const b=lst_ui.bub;b.textContent=lst_bub.text;b.style.display='block';b.style.left=((lst_v.x+1)/2*innerWidth)+'px';b.style.top=((1-lst_v.y)/2*innerHeight)+'px';}}
  lst_camera(dt,api);return true;}

function lst_camera(dt,api){const ly=api.camYaw-lst_A,fx=Math.sin(ly),fz=Math.cos(ly),dist=3.3;
  let cx=lst_px-fx*dist,cz=lst_pz-fz*dist,cy=clamp(2.55+(api.camPitch-.12)*2.2,2.35,ST_H-.25);cx=clamp(cx,-ST_HW+.3,ST_HW-.3);cz=clamp(cz,.25,ST_D-.95);
  if(lst_camSnap){lst_camL.set(cx,cy,cz);lst_camSnap=false;}else lst_camL.lerp(lst_v.set(cx,cy,cz),1-Math.exp(-10*dt));
  const [wx,wz]=lst_W(lst_camL.x,lst_camL.z),[tx,tz]=lst_W(lst_px+fx*1.4,lst_pz+fz*1.4);
  camera.position.set(wx,lst_Y+lst_camL.y,wz);camera.lookAt(tx,lst_Y+1.15,tz);if(Math.abs(camera.fov-62)>.1){camera.fov=62;camera.updateProjectionMatrix();}
  envUpdate(dt);}

// ================= store guard (Paznic Ion/Vasile/...): after a theft the store guard runs after you on the street for a while, yelling =================
const LST_ION_LINES=['Stai, hoțule!','Paza! Prindeți-l!','Unde fugi, mă?!','Dă înapoi marfa!','Stai că chem poliția!','Te văd, nu te ascunde!','Hoțul! Hoțul!','Lasă că te prind eu!'];
let lst_ion=null,lst_ionLast=0;
// the store guard's name: picked fresh on every store visit, the same guard chases you if you steal
const LST_GUARD_NAMES=['Ion','Vasile','Gheorghe','Toader','Grigore','Mitică'];let lst_guardName='Ion';
// voice every guard speaks with (assets/voice/voices.js 'guard' entry); null = each guard his own voice (Ion, Vasile, ...)
const LST_GUARD_VOICE=null;const lst_gv=n=>LST_GUARD_VOICE||n;
function lst_ionStart(D){if(!lst_ion){const g=makePersonGroup(0x14161a,0x14161a,0xe0b896);const u=g.userData;u.own=true;u.o.top=0x14161a;u.o.bot=0x14161a;u.o.mask|=ppl_F.sleeves|ppl_F.cap;u.o.acc=0x111111;
    ppl_applyLook(u.ims,0,1,u.o);g.visible=false;lst_ion={g};}
  const I=lst_ion;I.x=D.x+D.ox*.8;I.z=D.z+D.oz*.8;I.h=Math.atan2(D.ox,D.oz);I.name=lst_guardName;I.delay=1.4;I.t=28;I.lineT=0;I.on=true;I.v=0;I.text='';I.textT=0;}
function lst_ionSay(I,t){I.text=t;I.textT=2.2;if(!npc_voice('guard',lst_gv(I.name),t))lst_speak(t,.75,1.2);subtitle('Paznic '+I.name,t,'#ff8a65');}
function lst_ionEnd(msg,sub){const I=lst_ion;I.on=false;I.g.visible=false;if(lst_ui)lst_ui.bub.style.display='none';if(msg)gtcApi.say(msg,sub||'',2.4,'#7dff8a');}
function lst_ionUpdate(P){const now=performance.now(),dt=Math.min(.05,(now-(lst_ionLast||now))/1000);lst_ionLast=now;const I=lst_ion;if(!I||!I.on)return;
  if(lst_cur){I.g.visible=false;if(lst_ui)lst_ui.bub.style.display='none';return;}   // waits outside while you're in a store
  if(I.delay>0){I.delay-=dt;if(I.delay<=0)lst_ionSay(I,'Stai, hoțule!');else return;}
  I.t-=dt;const dx=P.x-I.x,dz=P.z-I.z,d=Math.hypot(dx,dz);
  if(I.t<=0||d>110){lst_ionEnd('Paznicul '+I.name+' a obosit','Ai scăpat de el');return;}
  // run at the player (a bit slower than your sprint: walking won't save you, running will)
  const sp=d>40?7.8:7.0;if(d>.6){const s=Math.min(d-.5,sp*dt);I.x+=dx/d*s;I.z+=dz/d*s;I.v=sp;I.h=lerpAng(I.h,Math.atan2(dx,dz),1-Math.exp(-10*dt));}else I.v=0;
  const po=pushOut(I.x,I.z,.4);if(po){I.x+=po.x;I.z+=po.z;}
  const y=surfaceY(I.x,I.z,P.y!=null?P.y:groundY(I.x,I.z));I.g.visible=true;I.g.position.set(I.x,y,I.z);I.g.rotation.y=I.h;animatePlayer(I.g,0,I.v,dt);
  // caught you on foot → fine
  if(P.mode==='foot'&&d<.95){const api=gtcApi,fine=Math.min(api.money,Math.max(30,Math.round(api.money*.2)));api.money-=fine;lst_ionSay(I,'Te-am prins! Dă banii!');
    lst_ionEnd();setTimeout(()=>api.say('Paznicul '+I.name+' te-a prins!','Amendă: '+fine+' lei',2.6,'#ff8a65'),30);return;}
  I.lineT-=dt;if(I.lineT<=0){I.lineT=mr(2.2,3.6);lst_ionSay(I,LST_ION_LINES[Math.floor(Math.random()*LST_ION_LINES.length)]);}
  // speech bubble over his head
  lst_ui_init();const b=lst_ui.bub;I.textT-=dt;
  if(I.textT>0){lst_v.set(I.x,y+2.2,I.z).project(camera);if(lst_v.z<1&&Math.abs(lst_v.x)<1.1&&Math.abs(lst_v.y)<1.1){b.textContent=I.text;b.style.display='block';b.style.left=((lst_v.x+1)/2*innerWidth)+'px';b.style.top=((1-lst_v.y)/2*innerHeight)+'px';}else b.style.display='none';}
  else b.style.display='none';}
