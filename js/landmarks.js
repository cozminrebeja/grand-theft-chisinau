'use strict';
// Landmark models (Arc, Cathedral, Bell tower, Statue, Government House, Primăria, Parliament, Opera, theatres, museum, bank, water tower).
// Owner: LANDMARKS agent. All top-level names prefixed lm_ (except buildLandmarks, the public API).
//
// Strategy: the iconic buildings below are found in D.b by footprint centroid, removed from the generic
// facade extrusion via LANDMARK_SKIP, and rebuilt here on the exact OSM footprint with a landmark texture
// atlas (1 draw call) + untextured detail merged into SB (shared static bucket).

// ---- footprints replaced by custom models (vertex-mean centroids of the OSM rings in data.json) ----
const lm_TARGETS={
  gov:{x:-105.2,z:100.7},      // Casa Guvernului
  parl:{x:-478.5,z:-262.6},    // Parlamentul
  prim:{x:139.9,z:230.7},      // Primăria
  opera:{x:-160.3,z:-358.3},   // Teatrul de Operă și Balet
  water:{x:-772.5,z:596.4},    // Turnul de Apă
  emin:{x:250.9,z:348.8},      // Teatrul Național Mihai Eminescu
  art:{x:-195.3,z:316.8},      // Muzeul Național de Artă
  bnm:{x:422.5,z:-508.1},      // Banca Națională
  cath2:{x:-281.9,z:-491.3},   // Catedrala Catolică (main nave with apse)
};
for(const k in lm_TARGETS){const t=lm_TARGETS[k];LANDMARK_SKIP.push({x:t.x,z:t.z,r:2.5});}

// ---- atlas ----
const lm_AT={PLAIN:0,CLASSIC:1,ARCHWIN:2,SOVIET:3,SOVPLAIN:4,GOTHIC:5,BRICK:6,GLASS:7,SLATS:8,BELL:9,CATHWIN:10,DOOR:11,CLOCK:12,RUST:13,GOTHDOOR:14,FRIEZE:15,DRUM:16,BNM:17,ARTWIN:18,OPERAGLASS:19,SOVDOOR:20,WATERWIN:21};
let lm_atlasTex=null;
function lm_buildAtlas(){
  const TS=256,COLS=8,ROWS=4,SCL=2;
  const tex=ctex(TS*COLS*SCL,TS*ROWS*SCL,(g)=>{
    const T=(i,fn)=>{const ox=(i%COLS)*TS*SCL,oy=Math.floor(i/COLS)*TS*SCL;g.save();g.translate(ox,oy);g.scale(SCL,SCL);g.beginPath();g.rect(0,0,TS,TS);g.clip();fn(g);g.restore();};
    const noise=(base,amp,n=2500)=>{for(let k=0;k<n;k++){const v=amp*(Math.random()-.5);g.fillStyle=v>0?`rgba(255,255,255,${v})`:`rgba(0,0,0,${-v})`;g.fillRect(Math.random()*TS,Math.random()*TS,2,2);}};
    const glass=(x,y,w,h,a='#7f97ad',b='#1f2a35')=>{const gr=g.createLinearGradient(0,y,0,y+h);gr.addColorStop(0,a);gr.addColorStop(1,b);g.fillStyle=gr;g.fillRect(x,y,w,h);g.fillStyle='rgba(255,255,255,.12)';g.beginPath();g.moveTo(x,y+h*.75);g.lineTo(x+w*.6,y);g.lineTo(x+w*.85,y);g.lineTo(x,y+h);g.fill();};
    const archPath=(x,y,w,h)=>{g.beginPath();g.moveTo(x,y+h);g.lineTo(x,y+w/2);g.arc(x+w/2,y+w/2,w/2,Math.PI,0);g.lineTo(x+w,y+h);g.closePath();};
    const pointPath=(x,y,w,h)=>{g.beginPath();g.moveTo(x,y+h);g.lineTo(x,y+w*.55);g.quadraticCurveTo(x,y+w*.05,x+w/2,y-w*.15);g.quadraticCurveTo(x+w,y+w*.05,x+w,y+w*.55);g.lineTo(x+w,y+h);g.closePath();};
    const stucco=(c='#f1e7cf')=>{g.fillStyle=c;g.fillRect(0,0,TS,TS);noise(0,.06);};
    const bricks=(c='#b5523b')=>{g.fillStyle=c;g.fillRect(0,0,TS,TS);for(let y=0;y<TS;y+=12){const off=(y/12)%2?12:0;for(let x=-off;x<TS;x+=24){const v=(Math.random()*30-15)|0;g.fillStyle=`rgb(${181+v},${82+v/2},${59+v/3})`;g.fillRect(x+1,y+1,22,10);}}g.fillStyle='rgba(230,215,200,.35)';for(let y=0;y<TS;y+=12)g.fillRect(0,y,TS,1);};
    // 0 plain stucco with rustication lines
    T(0,g=>{stucco();g.fillStyle='rgba(0,0,0,.06)';g.fillRect(0,250,TS,6);});
    // 1 classic window with pediment
    T(1,g=>{stucco();g.fillStyle='#fbf6ea';g.fillRect(70,56,116,168);g.beginPath();g.moveTo(60,58);g.lineTo(128,22);g.lineTo(196,58);g.closePath();g.fill();g.fillStyle='rgba(0,0,0,.12)';g.fillRect(60,56,136,5);
      glass(84,70,88,140);g.fillStyle='#f4efe3';g.fillRect(125,70,6,140);g.fillRect(84,120,88,5);g.fillStyle='#e6decb';g.fillRect(66,218,124,10);g.fillStyle='rgba(0,0,0,.08)';g.fillRect(0,246,TS,10);});
    // 2 arched window
    T(2,g=>{stucco();g.fillStyle='#fbf6ea';archPath(72,34,112,188);g.fill();g.save();archPath(86,48,84,168);g.clip();glass(86,48,84,168);g.restore();g.fillStyle='#f4efe3';g.fillRect(125,60,6,156);g.fillStyle='#e6decb';g.fillRect(66,218,124,10);g.fillStyle='#e8dcc0';g.fillRect(120,26,16,22);});
    // 3 soviet stone with fins + recessed window
    T(3,g=>{g.fillStyle='#cfc8bb';g.fillRect(0,0,TS,TS);noise(0,.07);glass(40,40,176,150,'#6f8296','#1e2832');g.fillStyle='#bdb5a6';g.fillRect(40,190,176,46);g.fillStyle='#d9d3c7';g.fillRect(0,0,30,TS);g.fillRect(226,0,30,TS);g.fillStyle='rgba(0,0,0,.18)';g.fillRect(30,0,6,TS);g.fillStyle='#c7c0b2';g.fillRect(124,40,8,150);});
    // 4 soviet plain fins
    T(4,g=>{g.fillStyle='#cfc8bb';g.fillRect(0,0,TS,TS);noise(0,.07);g.fillStyle='#d9d3c7';g.fillRect(0,0,30,TS);g.fillRect(226,0,30,TS);g.fillStyle='rgba(0,0,0,.15)';g.fillRect(30,0,6,TS);});
    // 5 gothic brick window with white trim
    T(5,g=>{bricks();g.fillStyle='#f3efe6';pointPath(74,52,108,172);g.fill();g.save();pointPath(88,66,80,150);g.clip();glass(88,40,80,180);g.restore();g.fillStyle='#f3efe6';g.fillRect(124,70,7,146);g.fillRect(64,222,128,10);g.fillRect(0,0,TS,8);});
    // 6 brick plain with white band
    T(6,g=>{bricks();g.fillStyle='#efe9de';g.fillRect(0,0,TS,8);g.fillRect(0,248,TS,8);});
    // 7 modern glass grid with white frames
    T(7,g=>{g.fillStyle='#eef0f0';g.fillRect(0,0,TS,TS);glass(14,22,228,170,'#93abc0','#2a3a4a');g.fillStyle='#eef0f0';g.fillRect(124,22,8,170);g.fillStyle='#dfe3e4';g.fillRect(0,196,TS,40);g.fillStyle='rgba(0,0,0,.1)';g.fillRect(0,192,TS,4);});
    // 8 opera white vertical slats
    T(8,g=>{g.fillStyle='#3d4c5c';g.fillRect(0,0,TS,TS);for(let x=0;x<TS;x+=32){const gr=g.createLinearGradient(x,0,x+24,0);gr.addColorStop(0,'#ffffff');gr.addColorStop(.6,'#f1f1ee');gr.addColorStop(1,'#cfcfca');g.fillStyle=gr;g.fillRect(x+2,0,24,TS);}g.fillStyle='rgba(0,0,0,.08)';g.fillRect(0,0,TS,6);});
    // 9 bell-tower arched opening (dark inside) with balustrade
    T(9,g=>{stucco('#f6f1e6');g.fillStyle='#ffffff';archPath(58,20,140,220);g.fill();g.fillStyle='#2a2622';archPath(74,36,108,204);g.fill();g.fillStyle='#4a3c2a';g.fillRect(100,70,56,40);
      g.fillStyle='#f6f1e6';g.fillRect(70,196,116,8);for(let x=78;x<182;x+=14)g.fillRect(x,204,8,30);g.fillRect(70,232,116,8);});
    // 10 cathedral tall arched window
    T(10,g=>{stucco('#f3ead6');g.fillStyle='#ffffff';archPath(80,26,96,206);g.fill();g.save();archPath(92,38,72,182);g.clip();glass(92,38,72,182,'#6f8193','#232c35');g.restore();g.fillStyle='#ffffff';g.fillRect(74,226,108,10);g.fillStyle='rgba(0,0,0,.07)';g.fillRect(0,0,14,TS);g.fillRect(242,0,14,TS);});
    // 11 classical door
    T(11,g=>{stucco();g.fillStyle='#fbf6ea';g.fillRect(56,30,144,226);g.fillStyle='#4a2f22';archPath(76,48,104,208);g.fill();g.fillStyle='#5d3c2b';g.fillRect(84,110,40,140);g.fillRect(132,110,40,140);g.fillStyle='#2a1b14';g.fillRect(126,100,4,156);glass(92,58,72,40,'#7f97ad','#2b3540');});
    // 12 clock face
    T(12,g=>{g.fillStyle='#e9dfc6';g.fillRect(0,0,TS,TS);g.fillStyle='#d4c6a2';g.beginPath();g.arc(128,128,124,0,TAU);g.fill();g.fillStyle='#fdfbf4';g.beginPath();g.arc(128,128,108,0,TAU);g.fill();
      g.strokeStyle='#222';g.lineWidth=6;g.beginPath();g.arc(128,128,108,0,TAU);g.stroke();g.fillStyle='#222';for(let i=0;i<12;i++){const a=i/12*TAU;g.save();g.translate(128+Math.sin(a)*90,128-Math.cos(a)*90);g.rotate(a);g.fillRect(-4,-12,8,24);g.restore();}
      g.lineCap='round';g.lineWidth=9;g.beginPath();g.moveTo(128,128);g.lineTo(128+52,128-20);g.stroke();g.lineWidth=6;g.beginPath();g.moveTo(128,128);g.lineTo(128-14,128-80);g.stroke();g.beginPath();g.arc(128,128,9,0,TAU);g.fill();});
    // 13 rusticated ground floor with arched opening
    T(13,g=>{stucco('#ebe0c6');g.fillStyle='rgba(0,0,0,.13)';for(let y=0;y<TS;y+=32)g.fillRect(0,y,TS,4);g.fillStyle='#fbf6ea';archPath(66,40,124,216);g.fill();g.save();archPath(80,54,96,202);g.clip();glass(80,54,96,202,'#6a7e90','#1b232b');g.restore();});
    // 14 gothic door in brick
    T(14,g=>{bricks();g.fillStyle='#f3efe6';pointPath(56,50,144,206);g.fill();g.fillStyle='#3b2419';pointPath(72,66,112,190);g.fill();g.fillStyle='#2a1810';g.fillRect(126,90,4,166);});
    // 15 frieze band
    T(15,g=>{g.fillStyle='#f1e8d2';g.fillRect(0,0,TS,TS);g.fillStyle='#d9ccb0';for(let x=0;x<TS;x+=32)g.fillRect(x+4,60,22,136);g.fillStyle='rgba(0,0,0,.12)';g.fillRect(0,40,TS,8);g.fillRect(0,210,TS,8);});
    // 16 drum window between columns
    T(16,g=>{stucco('#f3ead6');g.fillStyle='#ffffff';g.fillRect(0,0,40,TS);g.fillRect(216,0,40,TS);g.fillStyle='rgba(0,0,0,.12)';g.fillRect(40,0,6,TS);g.save();archPath(84,40,88,190);g.clip();glass(84,40,88,190,'#7a8c9c','#202a33');g.restore();g.strokeStyle='#ffffff';g.lineWidth=8;archPath(84,40,88,190);g.stroke();});
    // 17 national bank: white vertical strip windows
    T(17,g=>{g.fillStyle='#e9e8e2';g.fillRect(0,0,TS,TS);noise(0,.05);for(let x=24;x<TS;x+=72)glass(x,0,36,TS,'#8aa1b6','#2b3b4a');g.fillStyle='rgba(0,0,0,.12)';g.fillRect(0,0,TS,6);});
    // 18 museum eclectic window (balcony + rich surround)
    T(18,g=>{stucco('#efe2c4');g.fillStyle='#fffaf0';g.fillRect(66,36,124,186);g.fillStyle='#e2d3b1';g.fillRect(56,24,144,16);g.save();archPath(82,52,92,160);g.clip();glass(82,52,92,160);g.restore();g.fillStyle='#fffaf0';g.fillRect(124,60,8,150);
      g.fillStyle='#d8c9a6';g.fillRect(60,214,136,12);g.fillStyle='#5a5148';for(let x=66;x<192;x+=12)g.fillRect(x,226,4,26);g.fillRect(60,226,136,4);});
    // 19 opera glass lobby
    T(19,g=>{g.fillStyle='#f4f4f1';g.fillRect(0,0,TS,TS);glass(8,0,240,TS,'#a8bfd2','#33475a');g.fillStyle='#e8ecee';for(let x=0;x<TS;x+=64)g.fillRect(x,0,8,TS);g.fillRect(0,124,TS,8);});
    // 20 soviet entrance (dark glass doors between fins)
    T(20,g=>{g.fillStyle='#cfc8bb';g.fillRect(0,0,TS,TS);noise(0,.07);glass(36,20,184,236,'#57697a','#141b22');g.fillStyle='#b2aa9b';for(let x=36;x<220;x+=46)g.fillRect(x,20,6,236);g.fillStyle='#d9d3c7';g.fillRect(0,0,30,TS);g.fillRect(226,0,30,TS);});
    // 21 water tower: brick with small arched window + white string course
    T(21,g=>{bricks('#a9462f');g.fillStyle='#f3efe6';archPath(96,70,64,120);g.fill();g.save();archPath(104,78,48,108);g.clip();glass(104,78,48,108);g.restore();g.fillStyle='#f3efe6';g.fillRect(0,0,TS,12);g.fillRect(88,186,80,8);});
    // 22 copper/dome sheet (vertical seams)
    T(22,g=>{g.fillStyle='#4f6575';g.fillRect(0,0,TS,TS);g.fillStyle='rgba(255,255,255,.12)';for(let x=0;x<TS;x+=32)g.fillRect(x,0,4,TS);noise(0,.08);});
    // 23 parliament: white fins + deep dark windows
    T(23,g=>{g.fillStyle='#f0efea';g.fillRect(0,0,TS,TS);noise(0,.04);glass(30,26,196,166,'#8297a9','#1f2b36');g.fillStyle='#f0efea';g.fillRect(122,26,12,166);g.fillStyle='#e4e2da';g.fillRect(0,0,22,TS);g.fillRect(234,0,22,TS);g.fillStyle='rgba(0,0,0,.14)';g.fillRect(22,26,6,166);});
  },false);tex.anisotropy=renderer.capabilities.getMaxAnisotropy();tex.generateMipmaps=true;tex.minFilter=THREE.LinearMipmapLinearFilter;return tex;
}
function lm_uv(t){const c=t%8,r=Math.floor(t/8),e=.002;return [c/8+e,(c+1)/8-e,1-(r+1)/4+e,1-r/4-e];}

let lm_B=null;           // textured landmark bucket (atlas)
const lm_WHITE=new THREE.Color(1,1,1);
function lm_ccw(r){return sArea(r)<0?r.slice().reverse():r;}
// textured wall along a→c (world xz), outward normal (dz,-dx) for CCW rings; cells chosen by tileFn(row,col,nrows,ncols)
function lm_wall(a,c,y0,y1,fh,cw,tileFn,col){const dx=c[0]-a[0],dz=c[1]-a[1],L=Math.hypot(dx,dz);if(L<.05||y1-y0<.05)return;
  const nx=dz/L,nz=-dx/L,nc=Math.max(1,Math.round(L/cw)),nr=Math.max(1,Math.round((y1-y0)/fh));_c.set(col==null?0xffffff:col);const cr=_c.r,cg=_c.g,cb=_c.b;
  for(let j=0;j<nr;j++){const ya=y0+(y1-y0)*j/nr,yb=y0+(y1-y0)*(j+1)/nr;
    for(let i=0;i<nc;i++){const t=tileFn(j,i,nr,nc);const [u0,u1,v0,v1]=lm_uv(t);
      const ax=a[0]+dx*i/nc,az=a[1]+dz*i/nc,bx=a[0]+dx*(i+1)/nc,bz=a[1]+dz*(i+1)/nc;   // a-side cell edge (screen right) gets u1
      lm_B.v(ax,ya,az,nx,0,nz,cr,cg,cb,u1,v0);lm_B.v(ax,yb,az,nx,0,nz,cr,cg,cb,u1,v1);lm_B.v(bx,yb,bz,nx,0,nz,cr,cg,cb,u0,v1);
      lm_B.v(ax,ya,az,nx,0,nz,cr,cg,cb,u1,v0);lm_B.v(bx,yb,bz,nx,0,nz,cr,cg,cb,u0,v1);lm_B.v(bx,ya,bz,nx,0,nz,cr,cg,cb,u0,v0);}}}
function lm_ringWalls(ring,y0,y1,fh,cw,tileFn,col){const r=lm_ccw(ring);for(let i=0;i<r.length;i++){const a=r[i],c=r[(i+1)%r.length];lm_wall(a,c,y0,y1,fh,cw,(j,k,nr,nc)=>tileFn(j,k,nr,nc,i,Math.hypot(c[0]-a[0],c[1]-a[1])),col);}}
// textured decal quad facing outward normal n (unit, horizontal)
function lm_decal(cx,cy,cz,nx,nz,w,h,t,col){const rx=nz,rz=-nx,[u0,u1,v0,v1]=lm_uv(t);_c.set(col==null?0xffffff:col);const cr=_c.r,cg=_c.g,cb=_c.b;const o=.03;
  const Lx=cx-rx*w/2+nx*o,Lz=cz-rz*w/2+nz*o,Rx=cx+rx*w/2+nx*o,Rz=cz+rz*w/2+nz*o,yb=cy-h/2,yt=cy+h/2;
  lm_B.v(Lx,yb,Lz,nx,0,nz,cr,cg,cb,u0,v0);lm_B.v(Rx,yb,Rz,nx,0,nz,cr,cg,cb,u1,v0);lm_B.v(Rx,yt,Rz,nx,0,nz,cr,cg,cb,u1,v1);
  lm_B.v(Lx,yb,Lz,nx,0,nz,cr,cg,cb,u0,v0);lm_B.v(Rx,yt,Rz,nx,0,nz,cr,cg,cb,u1,v1);lm_B.v(Lx,yt,Lz,nx,0,nz,cr,cg,cb,u0,v1);}
// local frame: lx along "right", lz along "forward" of angle ang (same convention as part())
function lm_F(x,z,ang){const c=Math.cos(ang),s=Math.sin(ang);return{P:(lx,lz)=>[x+lx*c+lz*s,z-lx*s+lz*c],D:(lx,lz)=>[lx*c+lz*s,-lx*s+lz*c],ang};}
// textured box (walls only) in a local frame
function lm_tbox(F,lx,lz,w,d,y0,y1,fh,cw,tileFn,col){const r=[F.P(lx-w/2,lz-d/2),F.P(lx+w/2,lz-d/2),F.P(lx+w/2,lz+d/2),F.P(lx-w/2,lz+d/2)];lm_ringWalls(r,y0,y1,fh,cw,tileFn,col);return r;}
const lm_pg=(F,geo,lx,ly,lz,col,ry=0,rx=0)=>part(geo,F.P(0,0)[0],F.P(0,0)[1],F.ang,lx,ly,lz,col,ry,rx);
function lm_prism(len,r){let g=CYL(r,r,len,3);g.rotateX(-Math.PI/2);g.rotateY(Math.PI/2);g=g.toNonIndexed();g.computeVertexNormals();return g;} // triangular prism, apex up, axis along local x
// pediment: triangle of given base width/height facing local ±z, extruded `depth`; base sits at y=0 of the placement
function lm_pediment(width,height,depth){const r=width/Math.sqrt(3);let g=CYL(r,r,depth,3);g.rotateX(-Math.PI/2);const sy=height/(1.5*r);g.scale(1,sy,1);g.translate(0,r/2*sy,0);g=g.toNonIndexed();g.computeVertexNormals();return g;}
function lm_spandrel(w,h,depth){const s=new THREE.Shape();s.moveTo(-w/2,0);s.lineTo(-w/2,h);s.lineTo(w/2,h);s.lineTo(w/2,0);s.absarc(0,0,w/2,0,Math.PI,false);
  const g=new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:false,curveSegments:10});g.translate(0,0,-depth/2);return g;}
function lm_flute(r0,r1,h,n=24){const g=new THREE.CylinderGeometry(r0,r1,h,n,1,false);const p=g.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i),a=Math.atan2(z,x);const k=1-.06*Math.pow(Math.abs(Math.cos(a*n/2)),.6);p.setX(i,x*k);p.setZ(i,z*k);}g.computeVertexNormals();return g;}
// classical column: attic base, fluted shaft, capital (ionic: volutes; corinthian: flared bell)
function lm_col(F,lx,lz,y0,h,r,col,capCol,order='ionic',ry=0){const cc=capCol||col;
  lm_pg(F,BOX(r*2.5,r*.45,r*2.5),lx,y0+r*.22,lz,cc);lm_pg(F,CYL(r*1.2,r*1.3,r*.35,16),lx,y0+r*.62,lz,cc);lm_pg(F,CYL(r*1.05,r*1.15,r*.22,16),lx,y0+r*.9,lz,cc);
  const hs=h-r*1.0-r*1.1;lm_pg(F,lm_flute(r*.86,r,hs),lx,y0+r*1.0+hs/2,lz,col);const yc=y0+r*1.0+hs;
  if(order==='corinthian'){lm_pg(F,CYL(r*1.3,r*.88,r*.9,16),lx,yc+r*.45,lz,cc);for(let i=0;i<8;i++){const a=i/8*TAU;lm_pg(F,BOX(r*.25,r*.55,r*.25),lx+Math.cos(a)*r*.95,yc+r*.4,lz+Math.sin(a)*r*.95,cc);}lm_pg(F,BOX(r*2.7,r*.25,r*2.7),lx,yc+r*1.0,lz,cc);}
  else{lm_pg(F,CYL(r*1.0,r*.9,r*.3,16),lx,yc+r*.15,lz,cc);lm_pg(F,BOX(r*2.3,r*.35,r*1.2),lx,yc+r*.45,lz,cc,ry);
    for(const sd of[-1,1]){const cx=Math.cos(ry)*sd*r*1.05,cz=-Math.sin(ry)*sd*r*1.05;const vg=CYL(r*.3,r*.3,r*1.25,12);vg.rotateX(Math.PI/2);lm_pg(F,vg,lx+cx,yc+r*.38,lz+cz,cc,ry);}
    lm_pg(F,BOX(r*2.6,r*.25,r*2.6),lx,yc+r*.75,lz,cc);}}
// dentils/modillions along the outline of a ring at height y, pushed out by `out`
function lm_dentils(ring,y,out,col,step=.55,w=.25,h=.3,d=.35){const r=lm_ccw(ring);for(let i=0;i<r.length;i++){const a=r[i],c=r[(i+1)%r.length],dx=c[0]-a[0],dz=c[1]-a[1],L=Math.hypot(dx,dz);if(L<.5)continue;const nx=dz/L,nz=-dx/L,n=Math.max(1,Math.floor(L/step)),ang=Math.atan2(dx,dz);
  for(let k=0;k<n;k++){const t=(k+.5)/n;SB.add(BOX(d,h,w),M(a[0]+dx*t+nx*out,y,a[1]+dz*t+nz*out,ang),col);}}}
// cornice stack along a ring (fascia + dentils + overhanging corona)
function lm_cornice(ring,y,col,out=.25){lm_parapet(ring,y,.35,col,out*.6);lm_dentils(ring,y+.5,out+.12,col);lm_parapet(ring,y+.65,.3,col,out*2.2);}

// footprints of the replaced OSM buildings (baked from OSM so they're available before tiles stream in)
const lm_FP_DATA=[[32.6,0,0,"",[4056,-4553,4077,-4574,4609,-5102,4473,-5239,4467,-5233,4337,-5363,4253,-5280,4196,-5338,4078,-5223,4136,-5165,3790,-4821],[]],[29.4,0,0,"",[-4620,-2845,-4689,-2912,-4764,-3034,-4968,-3365,-5109,-3279,-5103,-3269,-5033,-3157,-5011,-3121,-4986,-3080,-4951,-3101,-4920,-3050,-4825,-2896,-4911,-2811,-4889,-2791,-4921,-2760,-4942,-2782,-4989,-2736,-5014,-2684,-5105,-2593,-5090,-2585,-5127,-2536,-5135,-2524,-5123,-2514,-5098,-2493,-5084,-2481,-5072,-2494,-5052,-2458,-5025,-2426,-4988,-2400,-4948,-2379,-4964,-2363,-4951,-2350,-4938,-2337,-4920,-2319,-4908,-2328,-4863,-2362,-4850,-2351,-4798,-2404,-4757,-2445,-4749,-2449,-4721,-2460,-4702,-2479,-4683,-2499,-4668,-2515,-4693,-2541,-4657,-2574,-4640,-2557,-4563,-2629,-4396,-2530,-4352,-2503,-4367,-2478,-4187,-2371,-4148,-2348,-4128,-2382,-4113,-2407,-4092,-2443,-4065,-2488,-4425,-2698,-4531,-2759],[]],[6.5,0,0,"",[-7764,5896,-7724,5894,-7641,5973,-7643,6015,-7670,6047,-7712,6047,-7795,5973,-7794,5925,-7778,5910],[]],[16,0,0,"",[2390,3864,2199,3678,2186,3664,2200,3649,2299,3544,2290,3534,2328,3494,2469,3344,2513,3297,2523,3306,2637,3185,2686,3234,2711,3207,2824,3315,2797,3344,2839,3385,2726,3506,2734,3514,2415,3855,2405,3848],[]],[7.6,0,0,"",[1781,2343,1787,2315,1789,2288,1458,1967,1415,1925,1190,1707,1090,1807,959,1934,973,1947,1030,2002,1077,1956,1096,1972,1143,1925,1528,2297,1557,2298,1568,2306,1570,2328,1558,2338,1525,2335,1327,2541,1272,2598,1226,2647,1221,2651,1261,2690,1346,2774,1361,2789,1423,2725,1414,2718,1671,2457,1676,2460,1743,2396,1736,2389],[]],[12.0,0,0,"",[-1943,-2895,-2175,-3128,-2408,-3361,-1660,-4096,-1603,-4038,-1619,-4011,-1546,-3938,-1525,-3959,-1417,-3851,-1317,-3752,-1341,-3729,-1273,-3661,-1254,-3680,-1200,-3626,-1498,-3333,-1589,-3243,-1622,-3211,-1860,-2977],[]],[28,0,0,"",[-1395,3462,-1509,3577,-1762,3329,-2018,3584,-2161,3446,-1903,3190,-1981,3117,-2007,3144,-2031,3119,-2164,3251,-2137,3279,-2231,3378,-2421,3194,-2403,3176,-2428,3150,-2393,3115,-2430,3076,-2298,2950,-2236,3013,-2291,3066,-2245,3112,-2287,3152,-2260,3180,-2070,2994,-2162,2905,-2064,2809,-2032,2840,-2036,2844,-1901,2976,-1897,2972,-1866,3002,-1888,3024,-1794,3116,-1772,3094,-1739,3127,-1736,3124,-1698,3161,-1701,3164,-1667,3196,-1690,3218,-1596,3310,-1574,3287,-1545,3316,-1548,3320,-1430,3436,-1426,3432],[]],[20.0,0,0,"",[-1514,281,-1403,169,-770,787,-139,1402,-256,1520,-570,1837,-692,1718,-651,1676,-634,1693,-394,1450,-370,1427,-1422,400,-1443,422,-1681,663,-1662,682,-1710,731,-1787,656,-1836,608],[]],[12,0,0,"",[-2684,-5129,-2671,-5126,-2657,-5121,-2644,-5112,-2631,-5101,-2622,-5090,-2615,-5079,-2610,-5067,-2605,-5053,-2664,-4994,-2661,-4990,-2666,-4992,-2680,-4978,-2676,-4974,-2681,-4976,-2692,-4965,-2688,-4962,-2693,-4964,-2707,-4949,-2704,-4946,-2709,-4948,-2731,-4926,-2728,-4922,-2732,-4924,-2746,-4910,-2743,-4906,-2748,-4908,-2759,-4897,-2755,-4894,-2760,-4895,-2774,-4881,-2771,-4878,-2776,-4879,-2782,-4873,-2780,-4868,-2783,-4867,-2783,-4849,-2779,-4848,-2784,-4839,-2785,-4832,-2788,-4825,-2790,-4818,-2794,-4812,-2797,-4806,-2801,-4800,-2805,-4795,-2810,-4790,-2815,-4786,-2821,-4780,-2827,-4777,-2833,-4773,-2839,-4770,-2845,-4768,-2856,-4766,-2873,-4749,-2873,-4744,-2876,-4744,-2877,-4750,-2893,-4766,-2900,-4767,-2908,-4769,-2915,-4772,-2922,-4775,-2928,-4779,-2934,-4784,-2939,-4788,-2944,-4793,-2948,-4797,-2952,-4802,-2955,-4808,-2959,-4814,-2964,-4825,-2965,-4831,-2966,-4837,-2984,-4854,-2991,-4854,-2991,-4858,-2982,-4858,-2966,-4874,-2965,-4885,-2960,-4896,-2957,-4903,-2953,-4909,-2949,-4914,-2945,-4920,-2939,-4925,-2934,-4929,-2927,-4934,-2920,-4938,-2914,-4942,-2907,-4944,-2900,-4946,-2895,-4946,-2878,-4963,-2878,-4971,-2874,-4971,-2874,-4964,-2861,-4949,-2855,-4956,-2858,-4959,-2853,-4957,-2839,-4972,-2842,-4975,-2837,-4974,-2829,-4982,-2832,-4985,-2827,-4984,-2813,-4998,-2816,-5001,-2811,-5000,-2788,-5024,-2791,-5027,-2786,-5025,-2772,-5040,-2776,-5043,-2770,-5042,-2762,-5050,-2765,-5053,-2760,-5052,-2746,-5066,-2750,-5069,-2745,-5068],[]]];
function lm_footprint(t){let best=null,bd=4;for(const b of (Array.isArray(D.b)&&D.b.length?D.b:lm_FP_DATA)){const r=dec(b[4]);let mx=0,mz=0;for(const p of r){mx+=p[0];mz+=p[1];}mx/=r.length;mz/=r.length;const d=Math.hypot(mx-t.x,mz-t.z);if(d<bd){bd=d;best={ring:lm_ccw(r),h:b[0],cx:mx,cz:mz};}}
  if(best){let L=0;for(let i=0;i<best.ring.length;i++){const a=best.ring[i],c=best.ring[(i+1)%best.ring.length],l=Math.hypot(c[0]-a[0],c[1]-a[1]);if(l>L){L=l;best.ang=Math.atan2(c[0]-a[0],c[1]-a[1]);}}}return best;}
// edge of ring facing the nearest drivable road (min distance from edge midpoint to road), among edges >= minLen
function lm_frontEdge(ring,minLen=8,filter){let best=null,bd=1e9;for(let i=0;i<ring.length;i++){const a=ring[i],c=ring[(i+1)%ring.length],L=Math.hypot(c[0]-a[0],c[1]-a[1]);if(L<minLen)continue;
  const mx=(a[0]+c[0])/2,mz=(a[1]+c[1])/2,ns=nearestSeg(mx,mz,120,filter);const d=ns?ns.d:500;if(d<bd){bd=d;best={a,c,L,mx,mz,nx:(c[1]-a[1])/L,nz:-(c[0]-a[0])/L,ux:(c[0]-a[0])/L,uz:(c[1]-a[1])/L,ang:Math.atan2(c[0]-a[0],c[1]-a[1])};}}return best;}
function lm_crenels(ring,y,col,step=1.6,w=.8,h=.9,d=.5){const r=lm_ccw(ring);for(let i=0;i<r.length;i++){const a=r[i],c=r[(i+1)%r.length],dx=c[0]-a[0],dz=c[1]-a[1],L=Math.hypot(dx,dz);if(L<1)continue;const n=Math.max(1,Math.floor(L/step)),ang=Math.atan2(dx,dz);
  for(let k=0;k<n;k++){const t=(k+.5)/n;SB.add(BOX(d,h,w),M(a[0]+dx*t,y+h/2,a[1]+dz*t,ang),col);}}}
function lm_parapet(ring,y,h,col,out=.25){const r=lm_ccw(ring);for(let i=0;i<r.length;i++){const a=r[i],c=r[(i+1)%r.length],dx=c[0]-a[0],dz=c[1]-a[1],L=Math.hypot(dx,dz);if(L<.3)continue;const nx=dz/L,nz=-dx/L;
  SB.add(BOX(.45,h,L+.45),M((a[0]+c[0])/2+nx*out*.5,y+h/2,(a[1]+c[1])/2+nz*out*.5,Math.atan2(dx,dz)),col);}}
function lm_flag(x,y,z,ang){SB.add(CYL(.07,.09,7,6),M(x,y+3.5,z),0xdddddd);const F=lm_F(x,z,ang);
  const cols=[0x0046ae,0xffd200,0xcc092f];for(let i=0;i<3;i++){const p=F.P(.42+i*.84,0);SB.add(BOX(.84,1.7,.04),M(p[0],y+6.05,p[1],ang+Math.PI/2),cols[i]);}
  const p=F.P(1.26,0);SB.add(BOX(.36,.5,.06),M(p[0],y+6.05,p[1],ang+Math.PI/2),0x8a6a2a);}

// ---- colliders for every landmark, registered right after buildBuildings so vegetation/agents avoid them ----
// ---- terrain: every landmark sits on the LOWEST ground under its footprint (nothing floats; uphill side is embedded) ----
const lm_BASE={};
const lm_KEYS=['arc','cathedral','belltower','statue','gov','parl','prim','opera','water','emin','art','bnm','cath2'];
function lm_sq(x,z,s,ang){const c=Math.cos(ang||0),n=Math.sin(ang||0);return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>[x+(a*c+b*n)*s/2,z+(-a*n+b*c)*s/2]);}
function lm_base(key){if(lm_BASE[key]!=null)return lm_BASE[key];const S=D.special||{};let ring=null;
  if(S[key]){const [x,z,ang,size]=S[key];ring=key==='statue'?lm_sq(x,z,6,ang):lm_sq(x,z,size*(key==='arc'?1.35:key==='cathedral'?1.15:1.1),ang);}
  else if(lm_TARGETS[key]&&lm_TARGETS[key].fp)ring=lm_TARGETS[key].fp.ring;
  const b=ring&&typeof groundRange==='function'?groundRange(ring)[0]:0;return lm_BASE[key]=b;}
function lm_posOf(key){const S=D.special||{};if(S[key])return [S[key][0],S[key][1]];const t=lm_TARGETS[key];return t?[t.x,t.z]:null;}
// nearest landmark key to a point (for collider bases)
function lm_keyNear(x,z){let bk=null,bd=1e9;for(const k of lm_KEYS){const p=lm_posOf(k);if(!p)continue;const d=Math.hypot(p[0]-x,p[1]-z);if(d<bd){bd=d;bk=k;}}return bk;}
let lm_colDone=false;
function lm_registerColliders(){if(lm_colDone)return;const n0=polys.length;lm_registerColliders0();
  for(let i=n0;i<polys.length;i++){const P=polys[i];const k=lm_keyNear((P.x0+P.x1)/2,(P.z0+P.z1)/2);P.y0=k?lm_base(k):0;}}
function lm_registerColliders0(){if(lm_colDone)return;lm_colDone=true;
  const S=D.special;
  if(S.arc){const [x,z,ang,size]=S.arc,k=size/10.2,F=lm_F(x,z,ang);for(const sx of[-1,1])for(const sz of[-1,1]){const p=F.P(sx*3.85*k,sz*3.85*k);addRect(p[0],p[1],2.5*k,2.5*k,ang,13*k);}}
  if(S.cathedral){const [x,z,ang,size]=S.cathedral,k=size/31;addRect(x,z,28*k,13*k,ang,30);addRect(x,z,13*k,28*k,ang,30);addRect(x,z,13*k,38*k,ang,12);addRect(x,z,38*k,13*k,ang,12);}
  if(S.belltower){const [x,z,ang,size]=S.belltower;addRect(x,z,size,size,ang,60);}
  if(S.statue){const [x,z,ang]=S.statue;addRect(x,z,4.6,4.6,ang,10);}
  for(const k in lm_TARGETS){const fp=lm_footprint(lm_TARGETS[k]);if(fp){lm_TARGETS[k].fp=fp;addPoly([fp.ring],40);}}
}
// make sure colliders exist before vegetation/streets run (buildBuildings is the first world builder called by game.js)
// world.js calls landmarksPreBuild() once before any tile is built
function landmarksPreBuild(){try{lm_registerColliders();}catch(e){console.error('lm colliders',e);}}

// ================= individual landmarks =================
const lm_CREAM=0xefe4c9,lm_WHITE2=0xf8f4ea,lm_DOME=0x4b6172,lm_GOLD=0xd8b24a,lm_BRONZE=0x3c4a3b;
function lm_arc(){const s=D.special.arc;if(!s)return;const [x,z,ang,size]=s;const k=size/10.2,F=lm_F(x,z,ang),A=lm_CREAM,W=lm_WHITE2;
  const P=(g,lx,ly,lz,col,ry=0,rx=0)=>lm_pg(F,g,lx*k,ly*k,lz*k,col,ry,rx);
  const S=10.2,ws=5.2,p=2.5;
  for(const sx of[-1,1])for(const sz of[-1,1]){const cx=sx*(ws/2+p/2),cz=sz*(ws/2+p/2);
    P(BOX((p+.7)*k,.9*k,(p+.7)*k),cx,.45,cz,0xd9ceb4);P(BOX(p*k,8.2*k,p*k),cx,.9+4.1,cz,A);
    P(BOX((p+.2)*k,.35*k,(p+.2)*k),cx,6.0,cz,W);}  // impost band at spring line
  for(let i=0;i<4;i++){const ry=i*Math.PI/2,sn=Math.sin(ry),cs=Math.cos(ry);const off=ws/2+p/2;
    const g=lm_spandrel(ws*k,3.1*k,p*k);g.rotateY(ry);P(g,sn*off,6.0,cs*off,A);
    // keystone
    P(BOX(.5*k,.9*k,(p+.1)*k),sn*off,6.0+2.75,cs*off,W,ry);
    // archivolt ring (thin)
    const ag=new THREE.TorusGeometry(ws/2*k,.12*k,4,14,Math.PI);ag.rotateY(ry);P(ag,sn*(S/2+.02),6.0,cs*(S/2+.02),W);
    // engaged columns, two per pylon face
    for(const side of[-1,1])for(const lo of[ws/2+.55,ws/2+p-.55]){const lat=side*lo;const px=sn*(S/2+.18)+cs*lat,pz=cs*(S/2+.18)-sn*lat;
      lm_col(F,px*k,pz*k,.9*k,8.15*k,.3*k,W,W,'corinthian');}}
  // entablature, cornice, attic, crown
  P(BOX((S+.6)*k,1.0*k,(S+.6)*k),0,9.55,0,A);P(BOX((S+.8)*k,.25*k,(S+.8)*k),0,9.15,0,W);P(BOX((S+1.3)*k,.38*k,(S+1.3)*k),0,10.2,0,W);
  P(BOX((S-.6)*k,2.3*k,(S-.6)*k),0,11.55,0,A);P(BOX((S-.2)*k,.3*k,(S-.2)*k),0,12.85,0,W);P(BOX((S-2.6)*k,.9*k,(S-2.6)*k),0,13.45,0,A);P(BOX((S-2.2)*k,.2*k,(S-2.2)*k),0,13.95,0,W);
  // clocks + panels on the attic (textured)
  for(let i=0;i<4;i++){const ry=i*Math.PI/2,d=F.D(Math.sin(ry),Math.cos(ry)),o=F.P(Math.sin(ry)*(S-.6)/2*k,Math.cos(ry)*(S-.6)/2*k);lm_decal(o[0],11.55*k,o[1],d[0],d[1],1.9*k,1.9*k,lm_AT.CLOCK);
    for(const side of[-1,1]){const q=F.P((Math.sin(ry)*(S-.6)/2+Math.cos(ry)*side*3)*k,(Math.cos(ry)*(S-.6)/2-Math.sin(ry)*side*3)*k);lm_decal(q[0],11.55*k,q[1],d[0],d[1],2.2*k,1.2*k,lm_AT.FRIEZE);}}
  // vault ceiling over the crossing (coffered)
  P(BOX(ws*k,.2*k,ws*k),0,8.8,0,0xd8ccb0);for(let i=0;i<3;i++)for(let j=0;j<3;j++)P(BOX(1.2*k,.12*k,1.2*k),(i-1)*1.65,8.66,(j-1)*1.65,0xc4b796);
  const sq=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>F.P(u*(S+.6)/2*k,v*(S+.6)/2*k));lm_dentils(sq,9.95*k,.15*k,W,.5*k,.22*k,.28*k,.3*k);
  const sq2=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>F.P(u*(S-.6)/2*k,v*(S-.6)/2*k));lm_dentils(sq2,12.65*k,.1*k,W,.45*k,.18*k,.22*k,.25*k);
  // bronze wreath medallions above the arches
  for(let i=0;i<4;i++){const ry=i*Math.PI/2;const tg=new THREE.TorusGeometry(.45*k,.1*k,6,14);tg.rotateY(ry);P(tg,Math.sin(ry)*(S/2+.08),9.55,Math.cos(ry)*(S/2+.08),0x6b6a3a);}
}
function lm_cathedral(){const s=D.special.cathedral;if(!s)return;const [x,z,ang,size]=s;const k=size/31,F=lm_F(x,z,ang),W=0xf3ead6,WT=lm_WHITE2;
  const a=6.5*k,e=14*k,H=13.5*k;
  const cross=[[-a,-e],[a,-e],[a,-a],[e,-a],[e,a],[a,a],[a,e],[-a,e],[-a,a],[-e,a],[-e,-a],[-a,-a]].map(([u,v])=>F.P(u,v));
  lm_ringWalls(cross,0,H,H/2,3.4*k,(j,i,nr,nc)=>j===0?(i===Math.floor(nc/2)&&nc>=3?lm_AT.DOOR:lm_AT.CLASSIC):lm_AT.CATHWIN,W);
  polyFill(SB,H+.9*k,cross,[],0x8d9aa3);lm_dentils(cross,H+.45*k,.45*k,WT,.6*k,.24*k,.3*k,.32*k);
  // wall pilasters between window bays + plinth band
  {const r=lm_ccw(cross);for(let i=0;i<r.length;i++){const a=r[i],c=r[(i+1)%r.length],dx=c[0]-a[0],dz=c[1]-a[1],L=Math.hypot(dx,dz),nx=dz/L,nz=-dx/L,n=Math.max(1,Math.round(L/(3.4*k))),an=Math.atan2(dx,dz);
    for(let q=0;q<=n;q++){const t=q/n;SB.add(BOX(.3,H,.7*k),M(a[0]+dx*t+nx*.15,H/2,a[1]+dz*t+nz*.15,an),WT);}SB.add(BOX(.5,1.0*k,L+.5),M((a[0]+c[0])/2+nx*.2,.5*k,(a[1]+c[1])/2+nz*.2,an),0xddd2bd);}}
  // cornices over arms
  for(const r of[0,Math.PI/2]){lm_pg(F,BOX(2*a+.8*k,.8*k,2*e+.8*k),0,H+.4*k,0,WT,r);lm_pg(F,BOX(2*a+1.3*k,.3*k,2*e+1.3*k),0,H+.95*k,0,WT,r);}
  // central raised block
  const c=7*k,cq=[[-c,-c],[c,-c],[c,c],[-c,c]].map(([u,v])=>F.P(u,v));lm_ringWalls(cq,H+.9*k,H+5*k,4.1*k,3.5*k,()=>lm_AT.PLAIN,W);
  lm_pg(F,BOX(2*c+.7*k,.5*k,2*c+.7*k),0,H+5.2*k,0,WT);polyFill(SB,H+5.45*k,cq,[],0x8d9aa3);
  // drum (16-gon) with windows, cornice, dome, lantern, cross
  const R=5.6*k,yd=H+5.45*k,hd=7*k,dr=[];for(let i=0;i<16;i++){const t=i/16*TAU;dr.push(F.P(Math.cos(t)*R,Math.sin(t)*R));}
  lm_ringWalls(dr,yd,yd+hd,hd,R*TAU/16,()=>lm_AT.DRUM,W);
  lm_pg(F,CYL(R+.45*k,R+.45*k,.6*k,24),0,yd+hd+.3*k,0,WT);
  const dome=new THREE.SphereGeometry(R+.2*k,32,12,0,TAU,0,Math.PI/2);dome.scale(1,1.05,1);lm_pg(F,dome,0,yd+hd+.6*k,0,lm_DOME);
  for(let i=0;i<16;i++){const a=i/16*TAU;for(let q=0;q<10;q++){const t0=q/10*Math.PI/2,t1=(q+1)/10*Math.PI/2,rr0=(R+.28*k),y0=Math.sin(t0)*rr0*1.05,y1=Math.sin(t1)*rr0*1.05,h0=Math.cos(t0)*rr0,h1=Math.cos(t1)*rr0,L=Math.hypot(y1-y0,h1-h0);
    lm_pg(F,BOX(.16*k,L,.16*k),Math.cos(a)*(h0+h1)/2,yd+hd+.6*k+(y0+y1)/2,Math.sin(a)*(h0+h1)/2,0x8c9aa3,-a+Math.PI/2,0);}}
  for(let i=0;i<16;i++){const a=(i+.5)/16*TAU;lm_col(F,Math.cos(a)*(R+.25*k),Math.sin(a)*(R+.25*k),yd,hd,.22*k,WT,WT,'corinthian');}
  const yt=yd+hd+.6*k+(R+.2*k)*1.05;lm_pg(F,CYL(1.15*k,1.25*k,2.6*k,10),0,yt+1.1*k,0,W);lm_pg(F,new THREE.SphereGeometry(1.4*k,12,6,0,TAU,0,Math.PI/2),0,yt+2.4*k,0,lm_DOME);
  lm_pg(F,new THREE.SphereGeometry(.35*k,8,6),0,yt+3.9*k,0,lm_GOLD);lm_pg(F,BOX(.22*k,3*k,.22*k),0,yt+5.4*k,0,lm_GOLD);lm_pg(F,BOX(1.5*k,.2*k,.2*k),0,yt+6.1*k,0,lm_GOLD);lm_pg(F,BOX(.9*k,.16*k,.16*k),0,yt+5.4*k,0,lm_GOLD,0,0);
  // four hexastyle porticos with pediments + steps
  for(let i=0;i<4;i++){const ry=i*Math.PI/2,sn=Math.sin(ry),cs=Math.cos(ry);const dep=4.6*k,pc=e+dep/2;
    for(let j=0;j<6;j++){const l=(-5+j*2)*k*1.02;const lx=sn*(e+dep-.7*k)+cs*l,lz=cs*(e+dep-.7*k)-sn*l;lm_col(F,lx,lz,.75*k,11.4*k,.5*k,0xfbf8f0,WT,'ionic',ry);}
    // two engaged pilasters at the wall
    lm_pg(F,BOX(13.2*k,1.25*k,dep+.3*k),sn*pc,12.75*k,cs*pc,WT,ry);lm_pg(F,BOX(13.8*k,.35*k,dep+.8*k),sn*pc,13.5*k,cs*pc,WT,ry);
    const pr=lm_pediment(13.8*k,3.0*k,dep+.6*k);lm_pg(F,pr,sn*pc,13.65*k,cs*pc,0xe9e0cc,ry);
    // pediment face (tympanum) slightly inset darker
    const tp=lm_pediment(12.2*k,2.4*k,dep+.7*k);lm_pg(F,tp,sn*(pc+.05*k),13.75*k,cs*(pc+.05*k),0xf6efdf,ry);
    for(let st=0;st<3;st++)lm_pg(F,BOX(13.6*k,.25*k,dep+(1.6-st*.5)*k),sn*(pc+.4*k),.125*k+st*.25*k,cs*(pc+.4*k),0xd5ccbb,ry);
    // gilded cross on each pediment apex
    lm_pg(F,BOX(.12*k,1.2*k,.12*k),sn*(e+dep),16.8*k,cs*(e+dep),lm_GOLD,ry);lm_pg(F,BOX(.6*k,.1*k,.1*k),sn*(e+dep),17.1*k,cs*(e+dep),lm_GOLD,ry);}
}
function lm_belltower(){const s=D.special.belltower;if(!s)return;const [x,z,ang,size]=s;const k=size/12.2,F=lm_F(x,z,ang),W=0xf5efe2,WT=lm_WHITE2;
  const tiers=[[12.2,15,lm_AT.CATHWIN],[10.2,12.5,lm_AT.BELL],[8.8,10.5,lm_AT.BELL],[7.4,9,lm_AT.BELL]];let y=0;
  lm_pg(F,BOX(13.2*k,.8,13.2*k),0,.4,0,0xd8cfbd);y=.8;
  tiers.forEach(([w,h,t],ti)=>{w*=k;const ring=lm_tbox(F,0,0,w,w,y,y+h,h,w/3.02,(j,i,nr,nc)=>ti===0&&i===1&&false?lm_AT.DOOR:t,W);
    if(ti===0){for(let q=0;q<4;q++){const ry=q*Math.PI/2,d=F.D(Math.sin(ry),Math.cos(ry)),o=F.P(Math.sin(ry)*w/2,Math.cos(ry)*w/2);lm_decal(o[0],y+2.6,o[1],d[0],d[1],2.6*k,4.6,lm_AT.DOOR);}}
    // corner pilasters/columns
    for(const sx of[-1,1])for(const sz of[-1,1]){if(ti===0)lm_pg(F,BOX(.9*k,h,.9*k),sx*(w/2+.1),y+h/2,sz*(w/2+.1),WT);else{lm_col(F,sx*(w/2+.32*k),sz*(w/2+.32*k),y,h-.4,.32*k,WT,WT,'corinthian');}}
    {const tr=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>F.P(u*w/2,v*w/2));lm_dentils(tr,y+h-.05,.35*k,WT,.5*k,.2*k,.25*k,.28*k);}
    lm_pg(F,BOX(w+.9*k,.5,w+.9*k),0,y+h+.25,0,WT);lm_pg(F,BOX(w+.5*k,.4,w+.5*k),0,y+h-.15,0,0xe7dcc6);
    // small corner urns on the cornice
    if(ti>0)for(const sx of[-1,1])for(const sz of[-1,1])lm_pg(F,CYL(.18*k,.32*k,.9,8),sx*(w/2+.1),y+h+.95,sz*(w/2+.1),WT);
    y+=h+.5;});
  // octagonal lantern + dome + spire + cross
  const R=2.8*k,oc=[];for(let i=0;i<8;i++){const t=(i+.5)/8*TAU;oc.push(F.P(Math.cos(t)*R,Math.sin(t)*R));}
  lm_ringWalls(oc,y,y+4,4,R*.77,()=>lm_AT.BELL,W);lm_pg(F,CYL(R+.4,R+.4,.4,16),0,y+4.2,0,WT);
  const dm=new THREE.SphereGeometry(R+.15,18,8,0,TAU,0,Math.PI/2);dm.scale(1,1.25,1);lm_pg(F,dm,0,y+4.4,0,lm_DOME);
  const ys=y+4.4+(R+.15)*1.25;lm_pg(F,CYL(.5,.7,1.4,8),0,ys+.5,0,lm_DOME);lm_pg(F,new THREE.SphereGeometry(.42,8,6),0,ys+1.5,0,lm_GOLD);lm_pg(F,CYL(.08,.25,3.2,6),0,ys+3.4,0,lm_GOLD);
  lm_pg(F,BOX(.16,2.4,.16),0,ys+6,0,lm_GOLD);lm_pg(F,BOX(1.2,.14,.14),0,ys+6.5,0,lm_GOLD);
}
function lm_statue(){const s=D.special.statue;if(!s)return;let [x,z,ang]=s;const ns=nearestSeg(x,z,120,q=>/Ștefan cel Mare/.test(q.r.name));if(ns)ang=Math.atan2(ns.qx-x,ns.qz-z);const F=lm_F(x,z,ang);const BR=lm_BRONZE,BR2=0x4d5c49,GR=0x7a5b52,GR2=0x6a4c44;
  const P=(g,lx,ly,lz,col,ry=0,rx=0)=>lm_pg(F,g,lx,ly,lz,col,ry,rx);
  P(BOX(5.6,.4,5.6),0,.2,0,0xa39d94);P(BOX(4.6,.9,4.6),0,.85,0,GR2);P(BOX(3.6,.5,3.6),0,1.55,0,GR);P(BOX(3.0,3.4,3.0),0,3.5,0,GR);P(BOX(3.4,.45,3.4),0,5.42,0,GR2);P(BOX(3.0,.3,3.0),0,5.8,0,GR);
  // relief plaque + inscription decal face (dark bronze)
  P(BOX(1.6,1.1,.08),0,3.6,1.53,BR2);
  // figure (≈4.4 m): boots, long robe/mantle, belt, torso, head with crown, raised right arm holding a cross, left hand on sword
  const y0=5.95;P(BOX(.75,.25,.5),0,y0+.12,.05,BR);
  const robe=CYL(.48,.78,2.3,20);P(robe,0,y0+1.4,0,BR);const mantle=CYL(.55,.95,2.0,12,1,true);P(new THREE.CylinderGeometry(.56,.98,2.05,12,1,true,Math.PI*.15,Math.PI*1.7),0,y0+1.55,-.03,BR2);
  P(CYL(.47,.5,.16,12),0,y0+2.55,0,BR2);P(CYL(.42,.48,.95,12),0,y0+3.05,0,BR);P(BOX(1.2,.32,.6),0,y0+3.45,0,BR);  // shoulders
  P(CYL(.13,.15,.2,8),0,y0+3.7,0,BR);P(new THREE.SphereGeometry(.27,12,10),0,y0+3.98,.02,BR);P(new THREE.SphereGeometry(.22,10,8,0,TAU,0,Math.PI*.6),0,y0+3.9,.12,BR2); // head + beard
  P(CYL(.25,.29,.22,10),0,y0+4.27,0,0x6a6a3a);for(let i=0;i<6;i++){const t=i/6*TAU;P(BOX(.07,.18,.07),Math.cos(t)*.25,y0+4.43,Math.sin(t)*.25,0x6a6a3a);}
  // raised right arm (lx negative = figure's right when facing +z)
  P(BOX(.24,.9,.24),-.62,y0+3.75,0,BR,0,0);P(BOX(.21,.85,.21),-.72,y0+4.55,.05,BR);P(new THREE.SphereGeometry(.13,8,6),-.74,y0+5.02,.06,BR);
  P(BOX(.11,2.1,.11),-.76,y0+5.45,.07,BR);P(BOX(.75,.1,.1),-.76,y0+6.1,.07,BR);P(BOX(.5,.09,.09),-.76,y0+5.85,.07,BR);
  // left arm down to the sword hilt
  P(BOX(.23,1.05,.23),.64,y0+3.0,.05,BR,0,-.15);P(BOX(.08,1.6,.08),.55,y0+1.7,.25,0x4b5a49,0,.12);P(BOX(.38,.07,.07),.55,y0+2.42,.32,BR2);
  // low chain fence around
  for(let i=0;i<8;i++){const t=i/8*TAU+Math.PI/8;P(CYL(.09,.11,.8,6),Math.cos(t)*3.6,.4,Math.sin(t)*3.6,0x2e2e2e);}
}
// ---- buildings on OSM footprints ----
function lm_gov(){const t=lm_TARGETS.gov,fp=t.fp;if(!fp)return;const H=30,ring=fp.ring;
  lm_ringWalls(ring,0,H,3.3,3.1,(j,i,nr,nc)=>j===0?lm_AT.SOVPLAIN:lm_AT.SOVIET,0xe6e1d6);polyFill(SB,H,ring,[],0x7d7a74);lm_parapet(ring,H,.9,0xcfc9bc);
  // central raised block on the main slab facing the Arc (local frame of the footprint)
  const F=lm_F(fp.cx,fp.cz,fp.ang);const toArc=F.D(0,0);const ax=-fp.cx,az=-fp.cz;const c=Math.cos(fp.ang),s=Math.sin(fp.ang);const lxA=ax*c-az*s;   // local x of the arc direction
  const side=lxA<0?-1:1;const x0=-35.4,x1=-17.6;const front=side<0?x0:x1;
  const tower=lm_tbox(F,(x0+x1)/2,-4,x1-x0+.6,40,H,H+11,3.3,3.1,()=>lm_AT.SOVIET,0xe9e4d8);polyFill(SB,H+11,tower,[],0x7d7a74);lm_parapet(tower,H+11,1.0,0xcfc9bc);
  // state emblem panel + flag on the tower
  const ep=F.P(front+side*.35,-4);const dn=F.D(side,0);lm_decal(ep[0],H+6.5,ep[1],dn[0],dn[1],6,3.2,lm_AT.FRIEZE,0xe0d2a8);
  const fpz=F.P((x0+x1)/2,-4);lm_flag(fpz[0],H+11,fpz[1],fp.ang+Math.PI/2);
  // monumental entrance colonnade (square pillars + canopy) in front of the main facade
  for(let i=0;i<10;i++){const lz=-22+i*4.4;lm_pg(F,BOX(1.1,9,1.1),front+side*3.2,4.5,lz,0xe9e5dc);}
  lm_pg(F,BOX(4.6,.8,44.6),front+side*2.3,9.3,-2.2,0xddd7cb);lm_pg(F,BOX(5.2,.25,45.4),front+side*2.3,9.8,-2.2,0xc9c2b4);
  for(let st=0;st<4;st++)lm_pg(F,BOX(6.5-st*1.1,.2,48),front+side*(4.5-st*.55),.1+st*.2,-2.2,0xbab3a6);
  // ground floor entrance doors decals
  for(let i=0;i<5;i++){const p=F.P(front+side*.03,-12+i*4.4);lm_decal(p[0],2.2,p[1],dn[0],dn[1],3,4.2,lm_AT.SOVDOOR);}
}
function lm_parl(){const t=lm_TARGETS.parl,fp=t.fp;if(!fp)return;const H=29,ring=fp.ring;
  lm_ringWalls(ring,0,H,3.4,3.0,(j)=>j===0?lm_AT.GLASS:lm_AT.PARL||23,0xffffff);
  // top attic band
  lm_ringWalls(ring,H,H+2.2,2.2,6,()=>lm_AT.SOVPLAIN,0xf2f1ec);polyFill(SB,H+2.2,ring,[],0x84817b);lm_parapet(ring,H+2.2,.6,0xe7e5de);
  const fe=lm_frontEdge(ring,15,s=>/Ștefan cel Mare/.test(s.r.name));if(fe){const ang=Math.atan2(fe.ux,fe.uz);lm_flag(fe.mx-fe.nx*6,H+2.2,fe.mz-fe.nz*6,ang);
    for(let i=0;i<8;i++){const t=(i+.5)/8;const px=fe.a[0]+(fe.c[0]-fe.a[0])*t+fe.nx*2.5,pz=fe.a[1]+(fe.c[1]-fe.a[1])*t+fe.nz*2.5;SB.add(BOX(.9,7,.9),M(px,3.5,pz,ang),0xf0efea);}
    SB.add(BOX(4,.6,fe.L*.95),M(fe.mx+fe.nx*1.8,7.3,fe.mz+fe.nz*1.8,ang),0xe2e0d8);}
}
function lm_prim(){const t=lm_TARGETS.prim,fp=t.fp;if(!fp)return;const H=15,ring=fp.ring;
  lm_ringWalls(ring,0,H,3.75,3.3,(j,i,nr,nc)=>j===0?(i%5===2?lm_AT.GOTHDOOR:lm_AT.GOTHIC):lm_AT.GOTHIC,0xffffff);
  lm_ringWalls(ring,H,H+1.2,1.2,3.3,()=>lm_AT.BRICK,0xffffff);for(const yy of[3.75,7.5,11.25])lm_parapet(ring,yy,.22,0xf2ede2,.25);lm_parapet(ring,H,.3,0xf2ede2,.4);polyFill(SB,H+1.2,ring,[],0x7e5a4a);lm_crenels(ring,H+1.2,0xa9472f);
  // clock tower at the middle of the facade facing bd. Ștefan cel Mare
  const fe=lm_frontEdge(ring,15,s=>/Ștefan cel Mare/.test(s.r.name))||lm_frontEdge(ring,15);if(!fe)return;
  const tw=7.5,cx=fe.mx-fe.nx*(tw/2-.6),cz=fe.mz-fe.nz*(tw/2-.6),ang=Math.atan2(fe.ux,fe.uz);const F=lm_F(cx,cz,ang);
  lm_tbox(F,0,0,tw,tw,0,26,3.7,tw/2,(j)=>j===0?lm_AT.GOTHDOOR:lm_AT.GOTHIC,0xffffff);
  lm_tbox(F,0,0,tw-.6,tw-.6,26,31,5,tw-.6,()=>lm_AT.BRICK,0xffffff);
  for(let q=0;q<4;q++){const ry=q*Math.PI/2,d=F.D(Math.sin(ry),Math.cos(ry)),o=F.P(Math.sin(ry)*(tw-.6)/2,Math.cos(ry)*(tw-.6)/2);lm_decal(o[0],28.6,o[1],d[0],d[1],3.4,3.4,lm_AT.CLOCK);}
  lm_pg(F,BOX(tw+.6,.5,tw+.6),0,26.2,0,0xf0ebe0);lm_pg(F,BOX(tw+.2,.4,tw+.2),0,31.2,0,0xf0ebe0);
  const tq=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>F.P(u*tw/2,v*tw/2));lm_crenels(tq,31.4,0xa9472f,1.2,.6,.8,.45);
  for(const sx of[-1,1])for(const sz of[-1,1]){lm_pg(F,CYL(.55,.55,5,8),sx*(tw/2),28.5,sz*(tw/2),0xa9472f);lm_pg(F,new THREE.ConeGeometry(.75,2.2,8),sx*(tw/2),32.1,sz*(tw/2),0x4e5a52);}
  const roof=new THREE.ConeGeometry(tw*.62,9,4);roof.rotateY(Math.PI/4);lm_pg(F,roof,0,35.9,0,0x4e5a52);lm_pg(F,CYL(.06,.06,3,6),0,41.8,0,0x333333);lm_flag(cx,40.4,cz,ang);
}
function lm_opera(){const t=lm_TARGETS.opera,fp=t.fp;if(!fp)return;const H=24,ring=fp.ring;
  const fe=lm_frontEdge(ring,20);
  lm_ringWalls(ring,0,H,H/4,4,(j,i,nr,nc,ei,L)=>lm_AT.SLATS,0xffffff);
  if(fe){const ang=Math.atan2(fe.ux,fe.uz);// glazed lobby volume projecting from the front
    const F=lm_F(fe.mx+fe.nx*3,fe.mz+fe.nz*3,ang);const lob=lm_tbox(F,0,0,6,fe.L*.8,0,12,6,4,()=>lm_AT.OPERAGLASS,0xffffff);polyFill(SB,12,lob,[],0xd9d9d4);
    lm_pg(F,BOX(9,.8,fe.L*.86),.8,12.4,0,0xf4f4f0);for(let i=0;i<10;i++)lm_pg(F,CYL(.35,.35,12,10),3.6,6,-fe.L*.39+i*fe.L*.78/9,0xf7f7f3);
    for(let st=0;st<4;st++)lm_pg(F,BOX(3,.22,fe.L*.86),4.5+st*.9,.11+st*.22*0,0,0xc9c5bd);
    // fly tower above stage at the back
    const B=lm_F(fp.cx-fe.nx*18,fp.cz-fe.nz*18,ang);const fly=lm_tbox(B,0,0,20,26,H,H+9,9,4,()=>lm_AT.SLATS,0xf4f4f0);polyFill(SB,H+9,fly,[],0x9a9893);}
  polyFill(SB,H,ring,[],0xa29f98);lm_parapet(ring,H,.8,0xf4f4f0);
}
function lm_water(){const t=lm_TARGETS.water,fp=t.fp;if(!fp)return;const ring=fp.ring,H=19;
  lm_ringWalls(ring,0,H,3.8,3,(j)=>j===0?lm_AT.GOTHDOOR:lm_AT.WATERWIN,0xffffff);polyFill(SB,H+.6,ring,[],0x6f4a3c);
  lm_parapet(ring,H,.6,0xf0ebe0);lm_crenels(ring,H+.6,0xa9462f,1.2,.6,.9,.45);
  // lookout pavilion on top
  const F=lm_F(fp.cx,fp.cz,fp.ang);const pv=lm_tbox(F,0,0,5,6,H+.6,H+3.6,3,2.5,()=>lm_AT.BELL,0xffffff);const r=new THREE.ConeGeometry(4.3,3,4);r.rotateY(Math.PI/4);lm_pg(F,r,0,H+5.1,0,0x56635b);lm_pg(F,CYL(.05,.05,2.5,6),0,H+7.6,0,0x333333);
}
function lm_emin(){const t=lm_TARGETS.emin,fp=t.fp;if(!fp)return;const ring=fp.ring,H=16;
  lm_ringWalls(ring,0,H,4,3.6,(j)=>j===0?lm_AT.RUST:lm_AT.CLASSIC,0xf6e7c8);polyFill(SB,H+1,ring,[],0x7e7a72);lm_cornice(ring,H,0xf6efdf);
  const fe=lm_frontEdge(ring,12,s=>/Ștefan cel Mare/.test(s.r.name))||lm_frontEdge(ring,12);if(!fe)return;const ang=Math.atan2(fe.ux,fe.uz)+Math.PI/2;
  const F=lm_F(fe.mx+fe.nx*2.4,fe.mz+fe.nz*2.4,ang);const w=Math.min(18,fe.L*.8);
  for(let i=0;i<6;i++){const l=-w/2+i*w/5;lm_col(F,l,0,.8,11,.5,0xfbf6ea,0xf6efdf,'corinthian');}
  lm_pg(F,BOX(w+2,1.2,4.6),0,12.4,-1.2,0xf6efdf);const pr=lm_pediment(w+2.6,3.4,5.0);lm_pg(F,pr,0,13.0,-1.2,0xede3cc);const pt=lm_pediment(w+1.2,2.6,5.2);lm_pg(F,pt,0,13.05,-1.2,0xf8f1e0);
  for(let st=0;st<3;st++)lm_pg(F,BOX(w+3,.27,5.6-st*1.2),0,.13+st*.27,.2+st*.6,0xd9d1c0);
}
function lm_art(){const t=lm_TARGETS.art,fp=t.fp;if(!fp)return;const ring=fp.ring,H=14;
  lm_ringWalls(ring,0,H,4.6,3.6,(j)=>j===0?lm_AT.RUST:lm_AT.ARTWIN,0xf3e3c3);polyFill(SB,H+.9,ring,[],0x6f6c66);lm_cornice(ring,H,0xfaf3e2);lm_parapet(ring,4.6,.35,0xfaf3e2,.3);
  const fe=lm_frontEdge(ring,15);if(fe){const ang=Math.atan2(fe.ux,fe.uz);const F=lm_F(fe.mx,fe.mz,ang);const dm=new THREE.SphereGeometry(3.2,16,8,0,TAU,0,Math.PI/2);dm.scale(1,1.2,1);
    const p=lm_F(fe.mx-fe.nx*4,fe.mz-fe.nz*4,ang);lm_pg(p,CYL(3.2,3.2,2.4,16),0,H+1.2,0,0xf3e3c3);lm_pg(p,dm,0,H+2.4,0,0x5d7468);lm_pg(p,new THREE.SphereGeometry(.4,8,6),0,H+6.4,0,lm_GOLD);}
}
function lm_bnm(){const t=lm_TARGETS.bnm,fp=t.fp;if(!fp)return;const ring=fp.ring,H=33;
  lm_ringWalls(ring,0,H,H/10,3.4,(j)=>j===0?lm_AT.GLASS:lm_AT.BNM,0xffffff);polyFill(SB,H,ring,[],0x7f7d78);lm_parapet(ring,H,1.2,0xe9e8e2);
}
function lm_cath2(){const t=lm_TARGETS.cath2,fp=t.fp;if(!fp)return;const ring=fp.ring,H=13;
  lm_ringWalls(ring,0,H,H/2,3.4,(j)=>j===0?lm_AT.CLASSIC:lm_AT.CATHWIN,0xf7eedb);
  // gable roof along the main axis
  const F=lm_F(fp.cx,fp.cz,fp.ang);const pr=lm_prism(42,6.3);lm_pg(F,pr,0,H+2.7,0,0x7a6d62,Math.PI/2);polyFill(SB,H,ring,[],0x7a6d62);
  // small belfry with dome above the entrance end
  lm_pg(F,BOX(4,5,4),0,H+5.5,-20,0xf7eedb);const dm=new THREE.SphereGeometry(2.2,12,6,0,TAU,0,Math.PI/2);lm_pg(F,dm,0,H+8,-20,0x55705f);lm_pg(F,BOX(.15,2,.15),0,H+11,-20,lm_GOLD);lm_pg(F,BOX(.9,.12,.12),0,H+11.5,-20,lm_GOLD);
}
lm_AT.PARL=23;

function buildLandmarks(){
  lm_registerColliders();   // no-op if already done after buildBuildings
  if(!lm_atlasTex)lm_atlasTex=lm_buildAtlas();
  lm_B=new Bk(new THREE.MeshLambertMaterial({map:lm_atlasTex,vertexColors:true}),true);
  const jobs=[[lm_arc,'arc'],[lm_cathedral,'cathedral'],[lm_belltower,'belltower'],[lm_statue,'statue'],[lm_gov,'gov'],[lm_parl,'parl'],[lm_prim,'prim'],[lm_opera,'opera'],[lm_water,'water'],[lm_emin,'emin'],[lm_art,'art'],[lm_bnm,'bnm'],[lm_cath2,'cath2']];
  for(const [j,key] of jobs){const s0=SB.p.length,b0=lm_B.p.length;try{j();}catch(e){console.error('landmark '+j.name,e);}
    const base=lm_base(key);if(base){for(let i=s0+1;i<SB.p.length;i+=3)SB.p[i]+=base;for(let i=b0+1;i<lm_B.p.length;i+=3)lm_B.p[i]+=base;}}
  const m=lm_B.mesh();m.name='landmarks';scene.add(m);
}
