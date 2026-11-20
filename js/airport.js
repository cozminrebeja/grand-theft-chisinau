'use strict';
// Chișinău International Airport (KIV). The OSM extract stops at the city edge, so the airport is built here by hand at its
// real position (world coords, already scaled by WS): terminal facing north to the city, access road from the end of
// Strada Aeroport, parking, control tower, apron with parked planes, and the 08/26 runway (real length, east-west).
// The terminal can be entered (same scheme as the Linella stores: fade, interior placed APT_DY above the terminal):
// check-in, security, café, seating, travellers, a departures board (Arad, Viena, Antalya) and PA announcements.
// game.js hooks: airportUpdate(dt,inp) → true while inside; airportInside(); airportSavePos(). Uses lst_* UI helpers.
const APT={x:6260,z:8075,W:110,D:32,H:13};                 // terminal centre, size; front (door) faces north (-z)
const APT_RWY={x0:4540,x1:7410,z:8640,w:36};               // runway 08/26
const APT_DY=300,APT_HW=30,APT_HD=34,APT_HH=9;             // interior: above the terminal, half-width, depth, height
const APT_FLIGHTS=[['14:20','ARAD','GT 311','2'],['15:05','VIENA','GT 517','4'],['16:40','ANTALYA','GT 905','7']];
const APT_STATUS=[['Îmbarcare','#7dff8a'],['La timp','#ffffff'],['Check-in','#ffd23f'],['Întârziat','#ff6b6b'],['Poarta închisă','#ff9e40']];
let apt_built=false,apt_door=null,apt_mk=null,apt_int=null,apt_cur=false,apt_tr=null,apt_boxes=[],apt_npcs=[],apt_staff=[],apt_lights=null;
let apt_px=0,apt_pz=0,apt_board=null,apt_boardT=0,apt_annT=12,apt_armed=true,apt_camSnap=true;const apt_camL=new THREE.Vector3(),apt_v=new THREE.Vector3();
const APT_ICON=[{x:APT.x,z:APT.z}];
// keep the airport free of trees (vegetation.js checks VEG_CLEAR when it plants a tile)
const APT_ROAD=[[5759,7825],[5900,7880],[6080,7965],[6200,8010],[6260,8030]];
if(typeof VEG_CLEAR!=='undefined')VEG_CLEAR.push((x,z)=>{
  if(x>APT.x-APT.W/2-50&&x<APT.x+APT.W/2+70&&z>7975&&z<APT.z+APT.D/2+240)return true;            // parking, terminal, apron
  if(z>APT_RWY.z-45&&z<APT_RWY.z+45&&x>APT_RWY.x0-30&&x<APT_RWY.x1+30)return true;                 // runway strip
  if(x>6190&&x<6230&&z>8300&&z<8650)return true;if(Math.hypot(x-6020,z-8135)<12)return true;      // taxiway, tower
  for(let i=0;i<APT_ROAD.length-1;i++){const [ax,az]=APT_ROAD[i],[bx,bz]=APT_ROAD[i+1],dx=bx-ax,dz=bz-az,l2=dx*dx+dz*dz;let t=((x-ax)*dx+(z-az)*dz)/l2;t=t<0?0:t>1?1:t;
    if(Math.hypot(ax+dx*t-x,az+dz*t-z)<9)return true;}
  return false;});

function apt_tex(w,h,draw,rep){return lst_tex(w,h,draw,rep);}
// mesh that follows the terrain: a ribbon along a polyline (roads, runway) or a flat patch (apron, parking)
function apt_ribbon(pts,w,mat,yo,step,uLen){const P=[],UV=[],I=[];let acc=0;
  const sp=[];for(let i=0;i<pts.length-1;i++){const [ax,az]=pts[i],[bx,bz]=pts[i+1],L=Math.hypot(bx-ax,bz-az),n=Math.max(1,Math.ceil(L/step));
    for(let k=(i?1:0);k<=n;k++)sp.push([ax+(bx-ax)*k/n,az+(bz-az)*k/n]);}
  for(let i=0;i<sp.length;i++){const a=sp[Math.max(0,i-1)],b=sp[Math.min(sp.length-1,i+1)],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz)||1,nx=-dz/l*w/2,nz=dx/l*w/2;
    if(i)acc+=Math.hypot(sp[i][0]-sp[i-1][0],sp[i][1]-sp[i-1][1]);
    for(const s of [-1,1]){const x=sp[i][0]+nx*s,z=sp[i][1]+nz*s;P.push(x,groundY(x,z)+yo,z);UV.push(s<0?0:1,acc/uLen);}
    if(i){const q=(i-1)*2;I.push(q,q+2,q+1,q+1,q+2,q+3);}}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(UV,2));g.setIndex(I);g.computeVertexNormals();
  const m=new THREE.Mesh(g,mat);m.receiveShadow=true;scene.add(m);return m;}
function apt_patch(x0,z0,x1,z1,mat,yo,step,tile){const nx=Math.ceil((x1-x0)/step),nz=Math.ceil((z1-z0)/step),P=[],UV=[],I=[];
  for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){const x=x0+(x1-x0)*i/nx,z=z0+(z1-z0)*j/nz;P.push(x,groundY(x,z)+yo,z);UV.push((x-x0)/tile,(z-z0)/tile);}
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const a=j*(nx+1)+i;I.push(a,a+nx+1,a+1,a+1,a+nx+1,a+nx+2);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(UV,2));g.setIndex(I);g.computeVertexNormals();
  const m=new THREE.Mesh(g,mat);m.receiveShadow=true;scene.add(m);return m;}
function apt_box(w,h,d,x,y,z,mat,ry,shadow){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.rotation.y=ry||0;m.castShadow=shadow!==false;m.receiveShadow=true;scene.add(m);return m;}
function apt_rect(x,z,w,d,ry,h){addRect(x,z,w,d,ry||0,h);}

function apt_plane(x,z,h,livery){const g=new THREE.Group(),white=new THREE.MeshLambertMaterial({color:0xf4f6f8}),blue=new THREE.MeshLambertMaterial({color:livery}),grey=new THREE.MeshLambertMaterial({color:0x9aa2aa}),dark=new THREE.MeshLambertMaterial({color:0x22262b});
  const winT=apt_tex(512,32,(c,w,hh)=>{c.fillStyle='#f4f6f8';c.fillRect(0,0,w,hh);c.fillStyle='#1d2733';for(let i=8;i<w-8;i+=10)c.fillRect(i,10,5,8);c.fillStyle='#'+livery.toString(16).padStart(6,'0');c.fillRect(0,24,w,6);});
  const fus=new THREE.Mesh(new THREE.CylinderGeometry(1.95,1.95,30,18,1,true).rotateX(Math.PI/2),new THREE.MeshLambertMaterial({map:winT,side:THREE.DoubleSide}));winT.rotation=Math.PI/2;winT.center.set(.5,.5);g.add(fus);
  const nose=new THREE.Mesh(new THREE.SphereGeometry(1.95,18,10,0,Math.PI*2,0,Math.PI/2).rotateX(Math.PI/2).scale(1,1,1.7),white);nose.position.z=15;g.add(nose);
  const tail=new THREE.Mesh(new THREE.ConeGeometry(1.95,7,18).rotateX(-Math.PI/2),white);tail.position.set(0,.5,-18.4);g.add(tail);
  const wing=new THREE.Mesh(new THREE.BoxGeometry(34,.45,5.5),grey);wing.position.set(0,-.9,1);g.add(wing);
  const stab=new THREE.Mesh(new THREE.BoxGeometry(12,.3,3),grey);stab.position.set(0,.8,-19.5);g.add(stab);
  const fin=new THREE.Mesh(new THREE.BoxGeometry(.4,7,5),blue);fin.position.set(0,4.5,-19);fin.rotation.x=-.35;g.add(fin);
  for(const s of [-1,1]){const e=new THREE.Mesh(new THREE.CylinderGeometry(1.15,1.05,4.2,14).rotateX(Math.PI/2),dark);e.position.set(s*6,-2,3);g.add(e);
    const gear=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,.5,10).rotateZ(Math.PI/2),dark);gear.position.set(s*2.8,-3.4,-1);g.add(gear);}
  const ng=new THREE.Mesh(new THREE.CylinderGeometry(.45,.45,.4,10).rotateZ(Math.PI/2),dark);ng.position.set(0,-3.5,12);g.add(ng);
  g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  g.position.set(x,groundY(x,z)+3.85,z);g.rotation.y=h;scene.add(g);apt_rect(x,z,4,34,h,6);return g;}

function apt_build(){apt_built=true;
  const asph=new THREE.MeshLambertMaterial({map:apt_tex(64,64,(c,w,h)=>{c.fillStyle='#4a4c50';c.fillRect(0,0,w,h);c.globalAlpha=.1;for(let i=0;i<300;i++){c.fillStyle=Math.random()<.5?'#000':'#fff';c.fillRect(Math.random()*w,Math.random()*h,1,1);}},true)});
  const conc=new THREE.MeshLambertMaterial({map:apt_tex(128,128,(c,w,h)=>{c.fillStyle='#a3a39d';c.fillRect(0,0,w,h);c.strokeStyle='#8b8b85';c.lineWidth=2;c.strokeRect(0,0,w,h);},true)});
  const rwyT=apt_tex(256,512,(c,w,h)=>{c.fillStyle='#3e4044';c.fillRect(0,0,w,h);c.fillStyle='#f2f2f0';c.fillRect(w/2-4,0,8,h*.55);c.fillRect(6,0,5,h);c.fillRect(w-11,0,5,h);},true);
  const rwy=new THREE.MeshLambertMaterial({map:rwyT});
  // access road from the end of Strada Aeroport, parking, apron, taxiway, runway
  apt_ribbon(APT_ROAD,11,asph,.18,8,8);
  apt_patch(6170,7985,6350,8045,asph,.2,8,10);
  apt_patch(APT.x-APT.W/2-40,APT.z+APT.D/2,APT.x+APT.W/2+60,APT.z+APT.D/2+230,conc,.16,10,12);
  apt_ribbon([[6210,8320],[6210,8640]],23,asph,.15,10,10);
  apt_ribbon([[APT_RWY.x0,APT_RWY.z],[APT_RWY.x1,APT_RWY.z]],APT_RWY.w,rwy,.22,20,60);
  // threshold stripes + runway numbers
  const thrM=new THREE.MeshBasicMaterial({color:0xf2f2f0});
  for(const [x,dir] of [[APT_RWY.x0+20,1],[APT_RWY.x1-20,-1]])for(let k=-6;k<=6;k++){if(!k)continue;const z=APT_RWY.z+k*2.6;const m=new THREE.Mesh(new THREE.PlaneGeometry(30,1.4).rotateX(-Math.PI/2),thrM);m.position.set(x+dir*15,groundY(x+dir*15,z)+.26,z);scene.add(m);}
  // terminal: glass front, concrete sides, roof overhang, sign, drop-off canopy
  const T=APT,gy=Math.min(groundY(T.x-T.W/2,T.z-T.D/2),groundY(T.x+T.W/2,T.z-T.D/2),groundY(T.x,T.z));
  const glassT=apt_tex(1024,128,(c,w,h)=>{const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#9cc4dc');g.addColorStop(1,'#3b5d75');c.fillStyle=g;c.fillRect(0,0,w,h);
    c.fillStyle='#d8dde2';for(let x=0;x<w;x+=32)c.fillRect(x,0,3,h);c.fillRect(0,h*.48,w,5);c.fillRect(0,0,w,4);
    c.fillStyle='rgba(255,236,190,.35)';for(let x=6;x<w;x+=32)c.fillRect(x,h*.55,22,h*.4);});
  const glass=new THREE.MeshLambertMaterial({map:glassT,emissive:0x2a3238,emissiveMap:glassT});
  const wallM=new THREE.MeshLambertMaterial({color:0xd9d6cf}),roofM=new THREE.MeshLambertMaterial({color:0x8d9399}),blueM=new THREE.MeshLambertMaterial({color:0x1e5aa8});
  apt_box(T.W,T.H+3,T.D,T.x,gy+(T.H+3)/2-3,T.z,[wallM,wallM,roofM,roofM,glass,glass]);
  apt_box(T.W+8,1,T.D+10,T.x,gy+T.H+.5,T.z,roofM);apt_box(T.W+8.2,1.2,.5,T.x,gy+T.H-.4,T.z-T.D/2-5,blueM);
  apt_rect(T.x,T.z,T.W,T.D,0,T.H);
  const signT=apt_tex(2048,160,(c,w,h)=>{c.fillStyle='#1e5aa8';c.fillRect(0,0,w,h);c.fillStyle='#fff';c.font='900 96px Inter, Arial, sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('AEROPORTUL INTERNAȚIONAL CHIȘINĂU',w/2,h/2+4);});
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(70,5.5),new THREE.MeshBasicMaterial({map:signT,toneMapped:false}));sign.position.set(T.x,gy+T.H+3.6,T.z-T.D/2-2);sign.rotation.y=Math.PI;scene.add(sign);
  apt_box(70.4,6,.4,T.x,gy+T.H+3.6,T.z-T.D/2-1.7,blueM);
  apt_box(60,.6,9,T.x,gy+6,T.z-T.D/2-4.5,roofM);for(const dx of [-28,-14,0,14,28])apt_box(.5,6,.5,T.x+dx,gy+3,T.z-T.D/2-8.5,wallM);
  const glow=new THREE.MeshBasicMaterial({color:0x7fd0ff,toneMapped:false});
  apt_box(.25,3.4,.25,T.x-1.8,gy+1.7,T.z-T.D/2-.15,glow,0,false);apt_box(.25,3.4,.25,T.x+1.8,gy+1.7,T.z-T.D/2-.15,glow,0,false);apt_box(3.85,.25,.25,T.x,gy+3.4,T.z-T.D/2-.15,glow,0,false);
  apt_door={x:T.x,z:T.z-T.D/2-.1,y:groundY(T.x,T.z-T.D/2-1)};
  // control tower
  const tw={x:6020,z:8135},ty=groundY(tw.x,tw.z);
  const tower=new THREE.Mesh(new THREE.CylinderGeometry(2.6,3.4,34,16),wallM);tower.position.set(tw.x,ty+17,tw.z);tower.castShadow=true;scene.add(tower);
  const cab=new THREE.Mesh(new THREE.CylinderGeometry(6,4.4,5,12),new THREE.MeshLambertMaterial({color:0x2c4a5e,emissive:0x0e2230}));cab.position.set(tw.x,ty+36.5,tw.z);cab.castShadow=true;scene.add(cab);
  apt_box(13,.8,13,tw.x,ty+39.4,tw.z,roofM);apt_rect(tw.x,tw.z,7,7,0,40);
  // planes on the apron (nose to the terminal) — fictional liveries
  apt_plane(6175,8150,Math.PI,0x1e5aa8);apt_plane(6265,8150,Math.PI,0xc8102e);apt_plane(6360,8165,Math.PI*.92,0x0a8a43);apt_plane(6600,8640,-Math.PI/2,0x1e5aa8);
  // entrance marker (same look as the Linella ones, blue)
  const g=new THREE.Group(),mk=new THREE.MeshBasicMaterial({color:0x7fd0ff,transparent:true,opacity:.28,depthWrite:false,side:THREE.DoubleSide});
  const col=new THREE.Mesh(new THREE.CylinderGeometry(1.1,1.1,2.6,24,1,true),mk);col.position.y=1.3;const ring=new THREE.Mesh(new THREE.RingGeometry(.95,1.25,32).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:0x7fd0ff,transparent:true,opacity:.85,side:THREE.DoubleSide}));ring.position.y=.08;
  const lbl=new THREE.Sprite(new THREE.SpriteMaterial({map:apt_tex(320,96,(c,w,h)=>{c.fillStyle='rgba(30,90,168,.95)';c.fillRect(0,0,w,h);c.fillStyle='#fff';c.font='900 44px Anton, Impact, sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('✈ TERMINAL',w/2,h/2);}),depthWrite:false}));
  lbl.scale.set(2.6,.78,1);lbl.position.y=2.9;g.add(col,ring,lbl);g.position.set(apt_door.x,apt_door.y,apt_door.z-1.6);scene.add(g);apt_mk={g,col,lbl};}

// ================= interior =================
function apt_buildInterior(){const g=new THREE.Group();g.visible=false;scene.add(g);apt_boxes=[];
  const basic=c=>new THREE.MeshBasicMaterial({color:c}),lam=c=>new THREE.MeshLambertMaterial({color:c}),W=APT_HW*2;
  const B=(w,h,d,x,y,z,mat,col)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y+h/2,z);g.add(m);if(col)apt_boxes.push({x0:x-w/2,x1:x+w/2,z0:z-d/2,z1:z+d/2});return m;};
  const P=(w,h,x,y,z,ry,mat)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);m.position.set(x,y,z);m.rotation.y=ry;g.add(m);return m;};
  const txt=(w,h,bg,fg,t,font)=>new THREE.MeshBasicMaterial({map:apt_tex(w,h,(c)=>{c.fillStyle=bg;c.fillRect(0,0,w,h);c.fillStyle=fg;c.font=font||'900 '+Math.round(h*.55)+'px Inter, Arial, sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(t,w/2,h/2+2);})});
  const floorT=apt_tex(256,256,(c,w,h)=>{c.fillStyle='#cfccc6';c.fillRect(0,0,w,h);c.fillStyle='#d9d6d0';c.fillRect(2,2,124,124);c.fillRect(130,130,124,124);c.fillStyle='rgba(255,255,255,.25)';c.fillRect(0,0,w,40);},true);floorT.repeat.set(W/2,APT_HD/2);
  const fl=new THREE.Mesh(new THREE.PlaneGeometry(W,APT_HD).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({map:floorT,color:0xb4b2ae}));fl.position.set(0,0,APT_HD/2);g.add(fl);
  const ceT=apt_tex(128,128,(c,w,h)=>{c.fillStyle='#dcdcda';c.fillRect(0,0,w,h);c.strokeStyle='#b0b0ad';c.lineWidth=2;c.strokeRect(0,0,w,h);},true);ceT.repeat.set(W/3,APT_HD/3);
  const ce=new THREE.Mesh(new THREE.PlaneGeometry(W,APT_HD).rotateX(Math.PI/2),new THREE.MeshBasicMaterial({map:ceT,color:0xb8b8b6}));ce.position.set(0,APT_HH,APT_HD/2);g.add(ce);
  const wallM=basic(0xc4c2bd);
  B(.2,APT_HH,APT_HD,-APT_HW-.1,0,APT_HD/2,wallM);B(.2,APT_HH,APT_HD,APT_HW+.1,0,APT_HD/2,wallM);
  B(APT_HW-2,APT_HH,.2,-(APT_HW+2)/2,0,-.1,wallM);B(APT_HW-2,APT_HH,.2,(APT_HW+2)/2,0,-.1,wallM);B(4,APT_HH-3.4,.2,0,3.4,-.1,wallM);
  B(3.6,3.3,.05,0,0,-.05,new THREE.MeshBasicMaterial({color:0xdfeaf2,toneMapped:false}));
  // back wall = glass onto the apron: sky, runway, a parked plane
  const viewT=apt_tex(2048,512,(c,w,h)=>{const s=c.createLinearGradient(0,0,0,h*.7);s.addColorStop(0,'#7fb2dc');s.addColorStop(1,'#d7e6ef');c.fillStyle=s;c.fillRect(0,0,w,h);
    c.fillStyle='#8a9a6a';c.fillRect(0,h*.62,w,h*.08);c.fillStyle='#9d9d97';c.fillRect(0,h*.7,w,h*.3);c.fillStyle='#4a4c50';c.fillRect(0,h*.64,w,h*.03);
    const plane=(x,y,s,col)=>{c.fillStyle='#f4f6f8';c.beginPath();c.ellipse(x,y,170*s,22*s,0,0,Math.PI*2);c.fill();c.fillStyle=col;c.beginPath();c.moveTo(x+120*s,y-10*s);c.lineTo(x+175*s,y-80*s);c.lineTo(x+190*s,y-80*s);c.lineTo(x+165*s,y);c.fill();
      c.fillStyle='#9aa2aa';c.fillRect(x-60*s,y+4*s,120*s,10*s);c.fillStyle='#22262b';c.fillRect(x-40*s,y+14*s,40*s,14*s);c.fillStyle='#1d2733';for(let i=-140;i<110;i+=14)c.fillRect(x+i*s,y-6*s,6*s,6*s);};
    plane(560,h*.8,1.6,'#1e5aa8');plane(1500,h*.78,1.2,'#c8102e');
    c.fillStyle='#e8ecef';for(let x=0;x<w;x+=128)c.fillRect(x,0,8,h);c.fillRect(0,h*.33,w,6);});
  P(W,APT_HH,0,APT_HH/2,APT_HD-.01,Math.PI,new THREE.MeshBasicMaterial({map:viewT,toneMapped:false}));
  const lamp=new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false});for(let x=-24;x<=24;x+=8)B(.5,.05,APT_HD-4,x,APT_HH-.06,APT_HD/2,lamp);
  // departures board (canvas redrawn every second) hanging in front of the entrance
  const bc=document.createElement('canvas');bc.width=1024;bc.height=384;const bt=new THREE.CanvasTexture(bc);apt_board={c:bc,g:bc.getContext('2d'),t:bt};apt_drawBoard(0);
  const bm=new THREE.MeshBasicMaterial({map:bt,toneMapped:false});P(12,4.5,0,4.7,9,Math.PI,bm);B(12.4,4.9,.2,0,2.25,9.12,basic(0x1a1d22));B(.1,1.9,.1,-5,7.1,9.1,basic(0x777777));B(.1,1.9,.1,5,7.1,9.1,basic(0x777777));
  P(7,2.6,-APT_HW+.05,5.2,20,Math.PI/2,bm);
  // check-in: 6 desks with belts, staff behind, signs above (1-2 Arad, 3-4 Viena, 5-6 Antalya)
  const desk=lam(0x5a6470),belt=basic(0x1a1a1a),dests=['ARAD','ARAD','VIENA','VIENA','ANTALYA','ANTALYA'];
  for(let i=0;i<6;i++){const x=-25+i*3.2;B(2.4,1.05,1,x,0,16,desk,true);B(.9,.45,.9,x+1.2,0,16.4,belt);B(.5,.4,.08,x-.6,1.05,15.6,new THREE.MeshBasicMaterial({color:0x7fd0ff,toneMapped:false}));
    P(2.6,.9,x,3.4,15.7,Math.PI,txt(256,96,'#1e5aa8','#fff','CHECK-IN '+(i+1)));P(2.6,.6,x,2.7,15.7,Math.PI,txt(256,64,'#0f1a2a','#ffd23f',dests[i]));
    for(const dz of [-1.5,-3.5])B(.08,1,.08,x-1,0,16+dz,lam(0x9aa0a6));}
  B(20,.06,.06,-17,.95,14.5,basic(0x1e5aa8));B(20,.06,.06,-17,.95,12.5,basic(0x1e5aa8));
  apt_boxes.push({x0:-27,x1:-7,z0:16.6,z1:18});   // staff zone behind the desks
  // security
  for(let i=0;i<3;i++){const x=12+i*4.5;B(.25,2.3,.6,x-.55,0,22,lam(0xb8bec4),true);B(.25,2.3,.6,x+.55,0,22,lam(0xb8bec4),true);B(1.35,.3,.6,x,2.3,22,lam(0xb8bec4));B(.9,1,2.6,x+1.7,0,22,lam(0x4a4f56),true);}
  P(12,1,16.5,4.2,21.6,Math.PI,txt(1024,96,'#1e5aa8','#fff','CONTROL DE SECURITATE · PORȚILE 1–8'));
  B(26,1.1,.1,17,0,24.2,new THREE.MeshLambertMaterial({color:0xbfe3ff,transparent:true,opacity:.35}));
  // café
  B(5,1.1,1.2,-26,0,5,lam(0x6b4a2e),true);B(5,.08,1.4,-26,1.1,5,lam(0xe8e4dc));P(5,1,-26,3.2,4.38,Math.PI,txt(512,96,'#6b4a2e','#fff','CAFENEA'));apt_boxes.push({x0:-28.5,x1:-23.5,z0:5.6,z1:7.2});
  // seating rows
  const seatM=lam(0x2f5d8a),legM=lam(0x8a9097);
  for(let r=0;r<4;r++){const z=4+r*2.4;B(9,.12,.6,17,.45,z,seatM);B(9,.6,.08,17,.5,z+.3,seatM);B(9,.45,.4,17,0,z,legM);apt_boxes.push({x0:12.5,x1:21.5,z0:z-.35,z1:z+.35});}
  for(const [x,z] of [[-8,3],[8,3],[-28,30],[28,12]]){B(.8,.7,.8,x,0,z,lam(0x7a7068),true);const p=new THREE.Mesh(new THREE.IcosahedronGeometry(.7,1),lam(0x3c7a3a));p.position.set(x,1.3,z);g.add(p);}
  g.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=false;o.frustumCulled=false;}});
  const amb=new THREE.AmbientLight(0xfff6ea,0),dir=new THREE.DirectionalLight(0xffffff,0);dir.position.set(0,1,-.4);scene.add(amb,dir,dir.target);apt_lights={amb,dir};
  // people: check-in staff, security, barista, travellers with suitcases
  const person=(top,bot)=>{const p=makePersonGroup(0xffffff,0x222222,mpick([0xe0b896,0xd8a982,0xc99a74]));const u=p.userData;u.own=true;
    if(top!=null){u.o.top=top;u.o.bot=bot;u.o.mask|=ppl_F.sleeves;ppl_applyLook(u.ims,0,1,u.o);}scene.remove(p);g.add(p);return p;};
  apt_staff=[];for(const i of [0,2,3,5]){apt_staff.push({g:person(0x1e5aa8,0x1a1d22),x:-25+i*3.2,z:17.2,h:Math.PI});}
  apt_staff.push({g:person(0x14161a,0x14161a),x:10.6,z:21,h:Math.PI},{g:person(0x14161a,0x14161a),x:19.6,z:21,h:Math.PI},{g:person(0x6b4a2e,0x222222),x:-26,z:6.3,h:Math.PI});
  const bag=new THREE.BoxGeometry(.42,.6,.26),bagM=[lam(0x1d1f24),lam(0x7a1f2a),lam(0x1e5aa8),lam(0x5a5f66)];
  apt_npcs=[];for(let i=0;i<10;i++){const p=person();const b=new THREE.Mesh(bag,mpick(bagM));b.position.set(.42,.48,-.25);p.add(b);const n={g:p,h:0,wait:mr(0,3),x:0,z:12};apt_pick(n,true);n.x=n.tx;n.z=n.tz;apt_npcs.push(n);}
  apt_int=g;}
// travellers wander between spots in the open hall (queue, board, seats, café, security)
const APT_SPOTS=[[-24,13],[-21,13.5],[-18,13],[-15,12.8],[-12,13.4],[0,6],[-3,7],[3,7.5],[14,19],[17,19.2],[20,18.8],[-20,6.5],[-6,24],[6,26],[0,28],[-14,28],[10,13],[24,14],[-26,9],[2,3]];
function apt_pick(n,first){const s=APT_SPOTS[Math.floor(Math.random()*APT_SPOTS.length)];const tx=s[0]+mr(-.6,.6),tz=s[1]+mr(-.6,.6);
  n.path=first||Math.hypot(tx-n.x,tz-n.z)<6?[[tx,tz]]:[[mr(-1,1),12.5+mr(-1,1)],[tx,tz]];n.tx=n.path[0][0];n.tz=n.path[0][1];}
function apt_drawBoard(t){const {g,c}=apt_board,w=c.width,h=c.height;g.fillStyle='#0b1018';g.fillRect(0,0,w,h);
  g.fillStyle='#ffd23f';g.font='900 46px Inter, Arial, sans-serif';g.textAlign='left';g.textBaseline='middle';g.fillText('✈ PLECĂRI / DEPARTURES',24,40);
  g.fillStyle='#7f8a99';g.font='700 22px Inter, Arial, sans-serif';[['ORA',24],['DESTINAȚIA',150],['ZBOR',520],['POARTA',680],['STARE',820]].forEach(([s,x])=>g.fillText(s,x,92));
  g.fillStyle='#2a3340';g.fillRect(16,108,w-32,2);
  APT_FLIGHTS.forEach((f,i)=>{const y=150+i*76,[st,col]=APT_STATUS[(i+Math.floor(t/45))%APT_STATUS.length];g.fillStyle=i%2?'#111824':'#0e141e';g.fillRect(16,y-34,w-32,68);
    g.font='800 40px Inter, Arial, sans-serif';g.fillStyle='#fff';g.fillText(f[0],24,y);g.fillStyle='#ffd23f';g.fillText(f[1],150,y);g.fillStyle='#fff';g.fillText(f[2],520,y);g.fillText(f[3],700,y);
    if(!(st==='Îmbarcare'&&Math.floor(t*2)%2)){g.fillStyle=col;g.font='800 32px Inter, Arial, sans-serif';g.fillText(st,820,y);}});
  apt_board.t.needsUpdate=true;}

function apt_world(lx,lz){return [apt_door.x+lx,apt_door.z+lz];}   // hall local axes = world axes, origin at the door; the hall runs south (+z)
function apt_enter(){if(!apt_int)apt_buildInterior();const api=gtcApi,P=api.player;apt_cur=true;apt_armed=false;
  apt_int.position.set(apt_door.x,apt_door.y+APT_DY,apt_door.z);
  apt_int.visible=true;apt_lights.amb.intensity=.75;apt_lights.dir.intensity=.35;apt_lights.dir.position.set(apt_door.x,apt_door.y+APT_DY+10,apt_door.z-4);apt_lights.dir.target.position.set(apt_door.x,apt_door.y+APT_DY,apt_door.z);apt_lights.dir.target.updateMatrixWorld();
  apt_px=0;apt_pz=2.2;P.h=0;api.camYaw=0;apt_camSnap=true;apt_annT=mr(4,8);apt_mk.g.visible=false;api.say('Aeroportul Internațional Chișinău','Bine ați venit! · Plecări: Arad, Viena, Antalya',2.6,'#7fd0ff');}
function apt_exit(){const api=gtcApi,P=api.player;P.x=apt_door.x;P.z=apt_door.z-2.4;P.h=Math.PI;P.y=groundY(P.x,P.z);api.camYaw=Math.PI;api.camPos.set(P.x,P.y+3,P.z+6);
  P.m.position.set(P.x,P.y,P.z);P.m.rotation.y=P.h;apt_int.visible=false;apt_lights.amb.intensity=0;apt_lights.dir.intensity=0;apt_mk.g.visible=true;apt_cur=false;apt_armed=false;}
function airportInside(){return apt_cur;}
function airportSavePos(){return apt_cur?{x:apt_door.x,z:apt_door.z-2.4,h:Math.PI}:null;}
function airportUpdate(dt,inp){const api=window.gtcApi;if(!api)return false;if(!apt_built){if(typeof addRect!=='function'||typeof scene==='undefined')return false;apt_build();}
  const P=api.player;if(typeof lst_ui_init==='function')lst_ui_init();const fade=lst_ui&&lst_ui.fade;
  if(apt_mk&&apt_mk.g.visible){const t=performance.now()/1000;apt_mk.lbl.position.y=2.9+Math.sin(t*3)*.1;apt_mk.col.material.opacity=.2+Math.sin(t*4)*.08;}
  if(apt_tr){const T=.15;apt_tr.t+=dt;
    if(apt_tr.ph==='out'){fade.style.opacity=Math.min(1,apt_tr.t/T);if(apt_tr.t>=T){apt_tr.ph='in';apt_tr.t=0;if(apt_tr.enter)apt_enter();else apt_exit();}}
    else{fade.style.opacity=Math.max(0,1-apt_tr.t/T);if(apt_tr.t>=T){fade.style.opacity=0;apt_tr=null;}}
    if(apt_tr&&apt_tr.ph==='out'&&!apt_cur){envUpdate(dt);return true;}
    if(apt_cur){apt_camera(dt,api);return true;}return false;}
  if(apt_cur)return apt_inside(dt,inp,P,api);
  if(P.mode!=='foot')return false;
  const ex=apt_door.x,ez=apt_door.z-1.6,d=Math.hypot(P.x-ex,P.z-ez);if(d>3.5)apt_armed=true;else if(apt_armed&&d<1.2){apt_tr={ph:'out',t:0,enter:true};envUpdate(dt);return true;}
  return false;}
function apt_collide(r){apt_px=clamp(apt_px,-APT_HW+r,APT_HW-r);apt_pz=clamp(apt_pz,.3,APT_HD-r);
  for(const b of apt_boxes){const qx=clamp(apt_px,b.x0,b.x1),qz=clamp(apt_pz,b.z0,b.z1),dx=apt_px-qx,dz=apt_pz-qz,d=Math.hypot(dx,dz);
    if(d<r){if(d>1e-5){apt_px+=dx/d*(r-d);apt_pz+=dz/d*(r-d);}else{const e=[apt_px-b.x0,b.x1-apt_px,apt_pz-b.z0,b.z1-apt_pz],m=Math.min(...e);if(m===e[0])apt_px=b.x0-r;else if(m===e[1])apt_px=b.x1+r;else if(m===e[2])apt_pz=b.z0-r;else apt_pz=b.z1+r;}}}
  for(const n of apt_npcs.concat(apt_staff)){const dx=apt_px-n.x,dz=apt_pz-n.z,d=Math.hypot(dx,dz);if(d<.62&&d>1e-4){apt_px+=dx/d*(.62-d);apt_pz+=dz/d*(.62-d);}}}
function apt_inside(dt,inp,P,api){
  const yaw=api.camYaw,fx=Math.sin(yaw),fz=Math.cos(yaw),rx=-fz,rz=fx;let mx=fx*inp.t+rx*inp.s,mz=fz*inp.t+rz*inp.s;const l=Math.hypot(mx,mz),sp=inp.run?6.5:3.6;let spd=0,dlz=0;
  if(l>.08){mx/=Math.max(1,l);mz/=Math.max(1,l);apt_px+=mx*sp*dt;dlz=mz*sp*dt;apt_pz+=dlz;P.h=lerpAng(P.h,Math.atan2(mx,mz),1-Math.exp(-12*dt));spd=sp*Math.min(1,l);}
  apt_collide(.32);
  if(apt_pz<.6&&Math.abs(apt_px)<1.6&&dlz<0)apt_tr={ph:'out',t:0,enter:false};
  const [wx,wz]=apt_world(apt_px,apt_pz),Y=apt_door.y+APT_DY;P.x=wx;P.z=wz;P.y=Y;P.m.visible=true;P.m.position.set(wx,Y,wz);P.m.rotation.y=P.h;animatePlayer(P.m,0,spd,dt);
  const time=performance.now()/1000;
  for(const n of apt_npcs){let v=0;if(n.wait>0)n.wait-=dt;else{const dx=n.tx-n.x,dz=n.tz-n.z,d=Math.hypot(dx,dz);
      const pd=Math.hypot(apt_px-n.x,apt_pz-n.z);if(pd<.9&&((apt_px-n.x)*dx+(apt_pz-n.z)*dz)>0){}else if(d<.08){n.path.shift();if(n.path.length){n.tx=n.path[0][0];n.tz=n.path[0][1];}else{n.wait=mr(2,8);apt_pick(n);}}
      else{const s=Math.min(d,1.25*dt);n.x+=dx/d*s;n.z+=dz/d*s;n.h=lerpAng(n.h,Math.atan2(dx,dz),1-Math.exp(-8*dt));v=1.25;}}
    n.g.position.set(n.x,0,n.z);n.g.rotation.y=n.h;animatePlayer(n.g,0,v,dt);}
  for(const s of apt_staff){s.g.position.set(s.x,0,s.z);s.g.rotation.y=s.h+Math.sin(time*.5+s.x)*.3;animatePlayer(s.g,0,0,dt);}
  apt_boardT-=dt;if(apt_boardT<=0){apt_boardT=.5;apt_drawBoard(time);}
  apt_annT-=dt;if(apt_annT<=0){apt_annT=mr(28,45);const f=mpick(APT_FLIGHTS);
    const t=mpick([`Atenție! Pasagerii zborului ${f[2]} spre ${f[1][0]+f[1].slice(1).toLowerCase()} sunt rugați să se prezinte la poarta ${f[3]} pentru îmbarcare.`,
      `Check-in-ul pentru zborul ${f[2]} spre ${f[1][0]+f[1].slice(1).toLowerCase()} se închide în 20 de minute.`,'Vă rugăm să nu lăsați bagajele nesupravegheate.']);
    subtitle('Anunț',t,'#7fd0ff',6);if(typeof lst_speak==='function')lst_speak(t,1,1);}
  apt_camera(dt,api);return true;}
function apt_camera(dt,api){const fx=Math.sin(api.camYaw),fz=Math.cos(api.camYaw),dist=4.6;
  let cx=apt_px-fx*dist,cz=apt_pz-fz*dist;cx=clamp(cx,-APT_HW+.4,APT_HW-.4);cz=clamp(cz,.3,APT_HD-.4);const cy=clamp(3.2+(api.camPitch-.12)*3,2.6,APT_HH-.4);
  if(apt_camSnap){apt_camL.set(cx,cy,cz);apt_camSnap=false;}else apt_camL.lerp(apt_v.set(cx,cy,cz),1-Math.exp(-10*dt));
  const Y=apt_door.y+APT_DY,[wx,wz]=apt_world(apt_camL.x,apt_camL.z),[tx,tz]=apt_world(apt_px+fx*1.6,apt_pz+fz*1.6);
  camera.position.set(wx,Y+apt_camL.y,wz);camera.lookAt(tx,Y+1.3+Math.max(0,.12-api.camPitch)*8,tz);if(Math.abs(camera.fov-62)>.1){camera.fov=62;camera.updateProjectionMatrix();}envUpdate(dt);}
