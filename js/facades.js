'use strict';
// Building facades + extrusion. Owner: BUILDINGS agent.
// One 2048² facade atlas (+ mask: R = tint by building colour, G = glass) sampled by a custom Lambert shader that tiles
// sub-rectangles of the atlas (per-vertex attribute `atl`), plus real geometry: cornices, string courses, parapets,
// pitched tin roofs, rooftop clutter, shop signs/awnings, loggia balconies on Soviet panel blocks.
const TILE=[[3.6,3.6],[3.2,2.85],[3.0,3.5],[3.4,3.0],[3.8,4.4]];
const STYLE_NAMES=['classic','panel','glass','plain','church'];
const TEX={};
const FAC_S=256,FAC_N=8,FAC_A=FAC_S*FAC_N,FAC_HI=2;
const FAC_C={CLA:0,CLB:1,CLC:2,CLD:3,HOUSE:4,CHURCH:5,PLAIN:6,BLANK:7,PA:8,PB:9,PC:10,PD:11,GLA:12,GLB:13,PARA:14,WHITE:15,
  GSHOP:16,GGOODS:17,GCAFE:18,GLOBBY:19,GDOOR:20,GGATE:21,GPLINTH:22,GPANEL:23,GROLL:24,GGARAGE:25,GPDOOR:26,GHOUSE:27,GPANELG:42,
  SIGN:28,AWN:32,BALP:33,BALG:34,RFLAT:35,RTIN:36,AC:38,DARK:39,CONC:40,DISH:41};
let fac_rs=12345;const fac_r=()=>{fac_rs=(fac_rs*16807)%2147483647;return (fac_rs-1)/2147483646;};
const fac_rp=a=>a[Math.floor(fac_r()*a.length)];
function fac_rect(i,sub=0,nsub=1){const cx=i%FAC_N,cy=Math.floor(i/FAC_N);const px=cx*FAC_S,py=cy*FAC_S+sub*FAC_S/nsub,ph=FAC_S/nsub;return [px/FAC_A,1-(py+ph)/FAC_A,FAC_S/FAC_A,ph/FAC_A];}

// ======================= atlas painting =======================
function fac_paintAtlas(){
  const cv=document.createElement('canvas'),mv=document.createElement('canvas');cv.width=cv.height=FAC_A*FAC_HI;mv.width=mv.height=FAC_A;
  const g=cv.getContext('2d'),m=mv.getContext('2d');g.setTransform(FAC_HI,0,0,FAC_HI,0,0);const S=FAC_S;
  const mk=(t,gl)=>`rgb(${Math.round(t*255)},${Math.round(gl*255)},0)`;
  const R=(x,y,w,h,col,t=0,gl=0)=>{g.fillStyle=col;g.fillRect(x,y,w,h);m.fillStyle=mk(t,gl);m.fillRect(x,y,w,h);};
  const shade=(x,y,w,h,a)=>{g.fillStyle=`rgba(0,0,0,${a})`;g.fillRect(x,y,w,h);};
  const lite=(x,y,w,h,a)=>{g.fillStyle=`rgba(255,255,255,${a})`;g.fillRect(x,y,w,h);};
  const noise=(x,y,w,h,n,a,dark=true)=>{for(let i=0;i<n;i++){const v=dark?0:255;g.fillStyle=`rgba(${v},${v},${v},${Math.random()*a})`;g.fillRect(x+Math.random()*w,y+Math.random()*h,1+Math.random()*2.5,1+Math.random()*2.5);}};
  const stucco=(x,y,w,h,col='#f6f4f0',t=1)=>{R(x,y,w,h,col,t);noise(x,y,w,h,w*h/60,.05);noise(x,y,w,h,w*h/120,.06,false);};
  const streaks=(x,y,w,h,n=4,a=.06)=>{for(let i=0;i<n;i++){const sx=x+Math.random()*w,sw=2+Math.random()*6;const gr=g.createLinearGradient(0,y,0,y+h);gr.addColorStop(0,`rgba(40,35,30,${a})`);gr.addColorStop(1,'rgba(40,35,30,0)');g.fillStyle=gr;g.fillRect(sx,y,sw,h*(0.4+Math.random()*.6));}};
  const glass=(x,y,w,h,tone=0,gl=1)=>{const gr=g.createLinearGradient(0,y,0,y+h);const tops=['#8ea6bb','#a3b6c2','#7d93a3','#93a9a0'],bots=['#2a3540','#34404a','#26303a','#2c3a36'];
    gr.addColorStop(0,tops[tone%4]);gr.addColorStop(.55,'#4b5c6b');gr.addColorStop(1,bots[tone%4]);g.fillStyle=gr;g.fillRect(x,y,w,h);m.fillStyle=mk(0,gl);m.fillRect(x,y,w,h);
    g.save();g.beginPath();g.rect(x,y,w,h);g.clip();g.fillStyle='rgba(255,255,255,.10)';g.beginPath();g.moveTo(x+w*.15,y+h);g.lineTo(x+w*.55,y);g.lineTo(x+w*.75,y);g.lineTo(x+w*.35,y+h);g.fill();g.restore();};
  const curtain=(x,y,w,h,col)=>{g.fillStyle=col;g.globalAlpha=.75;g.fillRect(x,y,w,h);g.globalAlpha=1;m.fillStyle=mk(0,.35);m.fillRect(x,y,w,h);};
  // classic window with surround; returns nothing
  const cwin=(x,y,w,h,o={})=>{const fr=o.frame||'#f4f1ea';
    if(o.surround!==false){R(x-7,y-7,w+14,h+14,'#eee7da',.35);shade(x-7,y+h+5,w+14,2,.12);}
    if(o.arch){g.save();m.save();for(const c of[g,m]){c.beginPath();c.moveTo(x,y+h);c.lineTo(x,y+w/2);c.arc(x+w/2,y+w/2,w/2,Math.PI,0);c.lineTo(x+w,y+h);c.closePath();c.clip();}}
    R(x,y,w,h,fr,0);glass(x+4,y+4,w-8,h-8,o.tone||0);
    if(Math.random()<.35)curtain(x+4,y+4,(w-8)*.32,h-8,fac_rp(['#efe6d0','#d9cbb0','#e8e0ea','#cfd8c8']));
    g.fillStyle=fr;const mt=o.mull||'t';if(mt==='t'||mt==='cross'){g.fillRect(x+w/2-2,y+4,4,h-8);g.fillRect(x+4,y+h*(mt==='t'?.3:.5)-2,w-8,4);}if(mt==='v')g.fillRect(x+w/2-2,y+4,4,h-8);
    shade(x+4,y+4,w-8,5,.35);shade(x+4,y+4,4,h-8,.25);
    if(o.arch){g.restore();m.restore();}
    R(x-10,y+h+1,w+20,7,'#e4ddce',.3);shade(x-10,y+h+8,w+20,3,.18);streaks(x,y+h+10,w,30,2,.05);};
  const cell=(i,fn)=>{const x=(i%FAC_N)*S,y=Math.floor(i/FAC_N)*S;g.save();m.save();g.translate(x,y);m.translate(x,y);g.beginPath();g.rect(0,0,S,S);g.clip();m.beginPath();m.rect(0,0,S,S);m.clip();fn(S);g.restore();m.restore();};
  const C=FAC_C;
  // ---- classic bays (1 bay x 1 floor = 3.6 x 3.6 m) ----
  cell(C.CLA,S=>{stucco(0,0,S,S);R(0,0,16,S,'#fbfaf7',.55);R(S-16,0,16,S,'#fbfaf7',.55);shade(16,0,2,S,.07);shade(S-18,0,2,S,.05);
    R(0,S-12,S,12,'#ebe6dc',.85);shade(0,S-12,S,2,.1);const x=S*.31,w=S*.38,y=S*.27,h=S*.55;
    g.fillStyle='#ece5d8';m.fillStyle=mk(.3,0);for(const c of[g,m]){c.beginPath();c.moveTo(x-14,y-12);c.lineTo(x+w/2,y-38);c.lineTo(x+w+14,y-12);c.closePath();c.fill();}shade(x-14,y-12,w+28,3,.15);
    cwin(x,y,w,h);});
  cell(C.CLB,S=>{stucco(0,0,S,S);for(let yy=8;yy<S;yy+=22)shade(0,yy,S,1.5,.05);R(0,S-10,S,10,'#e9e3d8',.85);
    const x=S*.32,w=S*.36,y=S*.2,h=S*.62;R(x-12,y-10,w+24,h+18,'#f0eadf',.35);R(x+w/2-7,y-14,14,20,'#e6dfd1',.3);cwin(x,y,w,h,{arch:true,surround:false,mull:'v',tone:1});});
  cell(C.CLC,S=>{stucco(0,0,S,S);R(0,S-12,S,12,'#ece6db',.85);const x=S*.3,w=S*.4,y=S*.18,h=S*.62;
    R(x-10,y-22,w+20,14,'#ebe4d6',.3);shade(x-10,y-8,w+20,3,.15);cwin(x,y,w,h,{mull:'cross',tone:2});
    R(x-22,y+h*.62,w+44,6,'#2c2c2c');for(let k=0;k<=12;k++)R(x-22+k*(w+44)/12,y+h*.62,2.5,h*.38+8,'#2c2c2c');R(x-26,y+h+6,w+52,8,'#cfc7b8',.3);shade(x-26,y+h+14,w+52,6,.2);});
  cell(C.CLD,S=>{stucco(0,0,S,S);R(0,S-12,S,12,'#ebe6dc',.85);R(S*.17,S*.16,S*.66,12,'#efe8db',.35);shade(S*.17,S*.16+12,S*.66,3,.15);
    cwin(S*.22,S*.26,S*.22,S*.54,{mull:'v',surround:false});cwin(S*.56,S*.26,S*.22,S*.54,{mull:'v',surround:false,tone:3});});
  cell(C.HOUSE,S=>{stucco(0,0,S,S,'#f7f5f1');R(0,S-26,S,26,'#d9d2c6',.6);noise(0,S-26,S,26,200,.1);
    const x=S*.33,w=S*.34,y=S*.24,h=S*.46;R(x-6,y-6,w+12,h+12,'#f2efe8',.2);R(x,y,w,h,'#3d79b8');glass(x+6,y+6,w-12,h-12,1);R(x+w/2-3,y,6,h,'#3d79b8');R(x,y+h*.35,w,5,'#3d79b8');
    for(const sx of[x-w*.48,x+w+3]){R(sx,y-2,w*.45,h+4,'#5d7f4a');for(let k=0;k<7;k++)shade(sx,y+k*h/7,w*.45,2,.2);}R(x-8,y+h+6,w+16,8,'#e1dbcf',.3);});
  cell(C.CHURCH,S=>{stucco(0,0,S,S,'#fbfaf6');R(0,S-14,S,14,'#ece6da',.6);cwin(S*.36,S*.14,S*.28,S*.68,{arch:true,mull:'v',tone:1});});
  cell(C.PLAIN,S=>{stucco(0,0,S,S,'#efece6');streaks(0,0,S,S,6,.07);R(S*.82,0,8,S,'#8d8f90');R(S*.82-2,S*.3,12,4,'#6d6f70');
    R(S*.3,S*.2,S*.3,S*.18,'#d8d3c9',.2);glass(S*.3+4,S*.2+4,S*.3-8,S*.18-8,2);});
  cell(C.BLANK,S=>{stucco(0,0,S,S);streaks(0,0,S,S,5,.06);for(let i=0;i<3;i++){const x=Math.random()*S,y=Math.random()*S;g.fillStyle='rgba(120,110,95,.06)';g.beginPath();g.ellipse(x,y,20+Math.random()*40,10+Math.random()*30,0,0,7);g.fill();}});
  // ---- panel blocks (2 bays x 2 floors per cell) ----
  const panelBase=S=>{stucco(0,0,S,S,'#f1f0ec');const q=S/2;for(let i=0;i<=2;i++){R(i*q-1.5,0,3,S,'#a9a59c',.35);R(0,i*q-1.5,S,3,'#a9a59c',.35);}for(let i=0;i<2;i++)shade(0,i*q+q*.08,S,2,.05);};
  const pwin=(x,y,w,h,fr)=>{R(x-3,y-3,w+6,h+6,'#d9d6cf',.2);R(x,y,w,h,fr);glass(x+5,y+5,w-10,h-10,(Math.random()*4)|0);R(x+w*.42,y+5,4,h-10,fr);R(x+5,y+h*.32,w*.42-5,4,fr);
    if(Math.random()<.4)curtain(x+5,y+5,(w-10)*.4,h-10,fac_rp(['#efe6d0','#e8dfcf','#f0e3e3']));shade(x+5,y+5,w-10,4,.3);R(x-4,y+h+2,w+8,5,'#cfccc4',.2);};
  const ac=(x,y)=>{R(x,y,30,20,'#e9e9e6');shade(x,y+17,30,3,.2);g.strokeStyle='#999';g.lineWidth=1.5;g.beginPath();g.arc(x+10,y+10,7,0,7);g.stroke();for(let k=0;k<4;k++)R(x+20,y+4+k*4,8,1.5,'#aaa');};
  const loggia=(x,y,w,h,kind)=>{// painted enclosed balcony in a q x q quadrant
    R(x,y,w,h,'#3a3f45');shade(x,y,w,h,.2);const py=y+h*.55;
    const pc=['#f0efea','#7da0c4','#b25b46','#e2d6b5','#c8cbc9'][kind%5];R(x,py,w,h*.45,pc,0);for(let k=0;k<w;k+=6)shade(x+k,py,2,h*.45,.08);
    if(kind%3!==2){const fr=kind%2?'#f5f5f2':'#6b4a33';R(x,y+3,w,py-y-3,fr);const n=3;for(let k=0;k<n;k++)glass(x+4+k*(w-8)/n+2,y+7,(w-8)/n-4,py-y-12,k);}
    else{for(let k=0;k<4;k++)R(x+8+k*(w-16)/4,y+h*.25,(w-16)/5,h*.2,fac_rp(['#c94a4a','#eee','#4a7ac9','#e0c040','#7a4']));R(x+4,y+h*.25-2,w-8,2,'#ddd');}
    shade(x,y+h-6,w,6,.35);R(x-3,y+h-4,w+6,4,'#bdb9b0',.2);};
  cell(C.PA,S=>{panelBase(S);const q=S/2;for(let i=0;i<2;i++)for(let j=0;j<2;j++)pwin(i*q+q*.22,j*q+q*.2,q*.56,q*.55,Math.random()<.7?'#f4f4f1':'#7a5536');});
  cell(C.PB,S=>{panelBase(S);const q=S/2;for(let j=0;j<2;j++){loggia(6,j*q+8,q-12,q-14,j*2+1);pwin(q+q*.22,j*q+q*.2,q*.56,q*.55,'#f4f4f1');}});
  cell(C.PC,S=>{panelBase(S);const q=S/2;loggia(6,8,q-12,q-14,0);pwin(q+q*.22,q*.2,q*.56,q*.55,'#f4f4f1');ac(q+q*.62,q*.78);pwin(q*.22,q+q*.2,q*.56,q*.55,'#7a5536');loggia(q+6,q+8,q-12,q-14,2);});
  cell(C.PD,S=>{panelBase(S);const q=S/2;for(let i=0;i<2;i++)for(let j=0;j<2;j++){pwin(i*q+q*.12,j*q+q*.22,q*.34,q*.52,'#f4f4f1');pwin(i*q+q*.54,j*q+q*.22,q*.34,q*.52,'#f4f4f1');}ac(q*.6,q*.05);ac(q*1.6,q*1.08);});
  // ---- modern ----
  cell(C.GLA,S=>{R(0,0,S,S,'#dfe3e6',.2);const q=S/2;for(let i=0;i<2;i++)for(let j=0;j<2;j++){glass(i*q+4,j*q+4,q-8,q*.78,(i+j)%4);R(i*q,j*q+q*.82,q,q*.18,'#3e4852',.1);}});
  cell(C.GLB,S=>{R(0,0,S,S,'#e8e6e1',1);noise(0,0,S,S,500,.05);glass(0,S*.08,S,S*.52,2);for(let k=0;k<=4;k++)R(k*S/4-2,S*.08,4,S*.52,'#c9ccce');shade(0,S*.6,S,4,.15);});
  cell(C.PARA,S=>{stucco(0,0,S,S);R(0,0,S,S*.16,'#c9c6bf',.3);shade(0,S*.16,S,4,.12);streaks(0,S*.2,S,S*.8,6,.06);});
  cell(C.WHITE,S=>{R(0,0,S,S,'#f5f5f3',1);noise(0,0,S,S,600,.05);});
  // ---- ground floors (1 bay x ground height) ----
  const fascia=S=>{R(0,0,S,S*.2,'#33363b');lite(0,0,S,3,.15);shade(0,S*.2,S,4,.3);};
  const plinth=S=>{R(0,S*.9,S,S*.1,'#77716a');noise(0,S*.9,S,S*.1,200,.15);};
  cell(C.GSHOP,S=>{fascia(S);plinth(S);R(6,S*.22,S-12,S*.68,'#2b2e33');glass(12,S*.25,S-24,S*.62,0,.8);R(S/2-2,S*.25,4,S*.62,'#2b2e33');});
  cell(C.GGOODS,S=>{fascia(S);plinth(S);R(6,S*.22,S-12,S*.68,'#3b3e43');glass(12,S*.25,S-24,S*.62,1,.55);
    for(let r=0;r<4;r++){R(14,S*.4+r*S*.12,S-28,3,'#cfc9be');for(let k=0;k<9;k++)R(16+k*(S-32)/9,S*.4+r*S*.12-12,(S-40)/11,11,fac_rp(['#c84','#4a8','#d33','#36c','#eb4','#fff','#a5c']));}lite(12,S*.25,S-24,S*.62,.06);});
  cell(C.GCAFE,S=>{fascia(S);plinth(S);R(6,S*.22,S-12,S*.68,'#5a3a24');glass(14,S*.26,S-28,S*.58,3,.5);g.fillStyle='rgba(255,190,110,.18)';g.fillRect(14,S*.26,S-28,S*.58);
    for(let k=0;k<3;k++){R(26+k*70,S*.66,40,4,'#3a2a20');R(44+k*70,S*.66,4,S*.18,'#3a2a20');}R(S/2-2,S*.26,4,S*.58,'#5a3a24');});
  cell(C.GLOBBY,S=>{R(0,0,S,S,'#d9dcdf',.2);glass(4,S*.06,S-8,S*.86,0,.9);R(S/2-3,S*.06,6,S*.86,'#9aa0a5');R(4,S*.06,S-8,6,'#9aa0a5');plinth(S);});
  cell(C.GDOOR,S=>{fascia(S);plinth(S);R(S*.2,S*.22,S*.6,S*.7,'#2d3035');glass(S*.24,S*.26,S*.25,S*.64,1,.8);glass(S*.51,S*.26,S*.25,S*.64,1,.8);R(S*.46,S*.55,4,26,'#aaa');R(S*.52,S*.55,4,26,'#aaa');stucco(0,S*.2,S*.2,S*.7,'#efece6');stucco(S*.8,S*.2,S*.2,S*.7,'#efece6');});
  cell(C.GGATE,S=>{stucco(0,0,S,S);for(let yy=10;yy<S;yy+=24)shade(0,yy,S,2,.07);const x=S*.18,w=S*.64,y=S*.18;
    g.fillStyle='#4a2f1e';m.fillStyle=mk(0,0);for(const c of[g,m]){c.beginPath();c.moveTo(x,S);c.lineTo(x,y+w/2);c.arc(x+w/2,y+w/2,w/2,Math.PI,0);c.lineTo(x+w,S);c.closePath();c.fill();}
    for(let k=1;k<6;k++)shade(x+k*w/6,y+20,2,S-y,.25);R(x+w/2-2,y+w/2,4,S,'#2a1a10');R(S*.45,y-6,S*.1,16,'#e5ddcf',.3);});
  cell(C.GPLINTH,S=>{stucco(0,0,S,S,'#eeebe5',.9);for(let yy=0;yy<S;yy+=26){shade(0,yy,S,2,.12);for(let xx=(yy/26%2)*40;xx<S;xx+=80)shade(xx,yy,2,26,.08);}
    const x=S*.3,w=S*.4,y=S*.3,h=S*.42;R(x-6,y-6,w+12,h+12,'#e9e2d4',.3);R(x,y,w,h,'#f2efe8');glass(x+4,y+4,w-8,h-8,2);R(x+w/2-2,y,4,h,'#f2efe8');R(x,y+h*.3,w,4,'#f2efe8');
    R(S*.38,S*.86,S*.24,S*.1,'#3a3d40');for(let k=0;k<5;k++)R(S*.38+k*S*.06,S*.86,2,S*.1,'#777');});
  const gpanel=(gr)=>S=>{stucco(0,0,S,S,'#e7e5df');R(0,S*.5-1.5,S,3,'#a9a59c',.35);R(S*.3,S*.18,S*.4,S*.3,'#efefec');glass(S*.3+4,S*.18+4,S*.4-8,S*.3-8,2);R(0,S*.92,S,S*.08,'#8a857d');streaks(0,S*.5,S,S*.42,3,.05);
    if(gr){g.strokeStyle=fac_rp(['#c33','#33a','#222','#2a7']);g.lineWidth=5;g.beginPath();g.moveTo(20,S*.8);g.bezierCurveTo(60,S*.6,80,S*.95,130,S*.72);g.bezierCurveTo(150,S*.65,170,S*.8,200,S*.7);g.stroke();}};cell(C.GPANEL,gpanel(false));cell(C.GPANELG,gpanel(true));
  cell(C.GROLL,S=>{fascia(S);plinth(S);R(8,S*.22,S-16,S*.68,'#9b9fa3');for(let yy=S*.22;yy<S*.9;yy+=7){shade(8,yy,S-16,2,.18);lite(8,yy+3,S-16,1,.15);}
    g.fillStyle='rgba(30,30,160,.55)';g.font='bold 34px Arial';g.fillText('#ZG',40,S*.62);});
  cell(C.GGARAGE,S=>{stucco(0,0,S,S,'#ece9e2');R(S*.1,S*.25,S*.8,S*.75,'#6f8a7a',.4);for(let k=0;k<8;k++)shade(S*.1,S*.25+k*S*.094,S*.8,2,.15);R(S*.08,S*.22,S*.84,6,'#555');});
  cell(C.GPDOOR,S=>{stucco(0,0,S,S,'#e7e5df');R(S*.28,S*.32,S*.44,S*.6,'#5b3b2a');R(S*.3,S*.36,S*.4,S*.18,'#2e3238');R(S*.62,S*.62,12,22,'#aaa');R(S*.15,S*.26,S*.7,10,'#bdb8ae',.3);
    R(S*.74,S*.5,16,26,'#555');R(S*.2,S*.92,S*.6,S*.08,'#8a857d');g.fillStyle='#fff';g.font='bold 22px Arial';g.fillText(String(1+(Math.random()*6|0)),S*.47,S*.3);});
  cell(C.GHOUSE,S=>{stucco(0,0,S,S,'#f5f3ee');R(0,S*.85,S,S*.15,'#bbb3a6',.5);R(S*.38,S*.3,S*.24,S*.58,'#6b4a33');R(S*.41,S*.34,S*.18,S*.18,'#2c3238');});
  // ---- signs (4 strips per cell, 256x64, drawn horizontally compressed) ----
  const SIGNS=[['FARMACIE','#1f8a4c','#fff','+'],['ALIMENTARA','#1d4f9a','#fff'],['CAFENEA','#4b2e1f','#f5d7a1'],['BANCĂ','#13294b','#e3c46b'],['OPTICĂ','#f4f4f2','#222'],['FLORĂRIE','#c2477a','#fff'],
    ['COVRIGI','#e07b1f','#fff'],['BRUTĂRIE','#efe1c0','#6b3b1c'],['MARKET','#c4161c','#fff'],['BAR','#111','#ff3fb4'],['PIZZERIE','#1e7a3a','#fff'],['TELEFOANE','#1653a8','#ffd200'],
    ['SCHIMB VALUTAR','#111','#ffd200'],['LIBRĂRIE','#6b1d2a','#f2e3c6'],['SALON','#f2f2f2','#b0306a'],['CARNE','#8c1a14','#fff']];
  SIGNS.forEach((s,k)=>{const ci=C.SIGN+(k>>2),sub=k&3;const x=(ci%FAC_N)*S,y=Math.floor(ci/FAC_N)*S+sub*S/4,hh=S/4;
    g.fillStyle=s[1];g.fillRect(x,y,S,hh);m.fillStyle=mk(0,0);m.fillRect(x,y,S,hh);g.fillStyle='rgba(255,255,255,.18)';g.fillRect(x,y+2,S,3);g.fillStyle='rgba(0,0,0,.3)';g.fillRect(x,y+hh-4,S,4);
    g.save();g.font='900 40px Arial,Helvetica,sans-serif';const tw=g.measureText(s[0]).width,maxW=(S-(s[3]?60:24))/.42;g.translate(x+S/2+(s[3]?12:0),y+hh/2+2);g.scale(.42*Math.min(1,maxW/tw),1);g.fillStyle=s[2];g.textAlign='center';g.textBaseline='middle';g.fillText(s[0],0,0);
    g.restore();if(s[3]){g.fillStyle='#3cff7a';g.fillRect(x+12,y+hh/2-4,24,8);g.fillRect(x+20,y+hh/2-12,8,24);}});
  const AW=[['#c8202a','#f4f1ea'],['#1e7a3a','#f4f1ea'],['#1d4f9a','#f4f1ea'],['#6b1d2a','#6b1d2a']];
  AW.forEach((c,k)=>{const x=(C.AWN%FAC_N)*S,y=Math.floor(C.AWN/FAC_N)*S+k*S/4,hh=S/4;for(let i=0;i<8;i++){g.fillStyle=c[i%2];g.fillRect(x+i*S/8,y,S/8,hh);}m.fillStyle=mk(0,0);m.fillRect(x,y,S,hh);
    g.fillStyle='rgba(0,0,0,.15)';g.fillRect(x,y+hh-10,S,10);});
  const BP=['#eeeeea','#6d93bd','#a6523f','#cfd6d6'];BP.forEach((c,k)=>{const x=(C.BALP%FAC_N)*S,y=Math.floor(C.BALP/FAC_N)*S+k*S/4,hh=S/4;g.fillStyle=c;g.fillRect(x,y,S,hh);m.fillStyle=mk(k===0?.25:0,0);m.fillRect(x,y,S,hh);
    if(k===2){for(let r=0;r<6;r++)for(let q=0;q<10;q++){g.fillStyle=`rgba(0,0,0,${.06+Math.random()*.08})`;g.fillRect(x+q*26+(r%2)*13,y+r*11,24,9);}}else for(let q=0;q<S;q+=8){g.fillStyle='rgba(0,0,0,.07)';g.fillRect(x+q,y,3,hh);}
    g.fillStyle='rgba(0,0,0,.25)';g.fillRect(x,y,S,3);g.fillStyle='rgba(60,50,40,.12)';g.fillRect(x,y+hh-12,S,12);});
  for(let k=0;k<4;k++){const x=(C.BALG%FAC_N)*S,y=Math.floor(C.BALG/FAC_N)*S+k*S/4,hh=S/4;
    if(k===2){g.fillStyle='#2e3338';g.fillRect(x,y,S,hh);m.fillStyle=mk(0,0);m.fillRect(x,y,S,hh);g.fillStyle='#ddd';g.fillRect(x,y+10,S,2);for(let q=0;q<9;q++){g.fillStyle=fac_rp(['#c94a4a','#eee','#4a7ac9','#e0c040','#6a4','#d9a']);g.fillRect(x+10+q*27,y+12,18,22+Math.random()*16);}}
    else{const fr=['#f5f5f2','#6b4a33','#3a3a3a','#c0c4c8'][k];g.fillStyle=fr;g.fillRect(x,y,S,hh);m.fillStyle=mk(0,0);m.fillRect(x,y,S,hh);for(let q=0;q<4;q++){const gx=x+6+q*S/4,gw=S/4-12;
      const gr=g.createLinearGradient(0,y,0,y+hh);gr.addColorStop(0,'#9fb3c4');gr.addColorStop(1,'#34404b');g.fillStyle=gr;g.fillRect(gx,y+6,gw,hh-12);m.fillStyle=mk(0,1);m.fillRect(gx,y+6,gw,hh-12);}}}
  cell(C.RFLAT,S=>{R(0,0,S,S,'#8f8c87',.25);noise(0,0,S,S,2500,.12);for(let i=0;i<10;i++){g.fillStyle=`rgba(0,0,0,${.05+Math.random()*.08})`;g.fillRect(Math.random()*S,Math.random()*S,30+Math.random()*80,20+Math.random()*60);}for(let k=0;k<S;k+=64)shade(0,k,S,2,.1);});
  cell(C.RTIN,S=>{R(0,0,S,S,'#f2f2f0',1);for(let k=0;k<S;k+=21){shade(k,0,3,S,.18);lite(k+3,0,2,S,.25);}noise(0,0,S,S,800,.08);for(let i=0;i<5;i++){g.fillStyle='rgba(120,60,30,.08)';g.fillRect(Math.random()*S,Math.random()*S,40,90);}});
  cell(C.AC,S=>{R(0,0,S,S,'#ecebe8');noise(0,0,S,S,400,.05);g.strokeStyle='#8d8d8d';g.lineWidth=6;g.beginPath();g.arc(S*.38,S*.5,S*.3,0,7);g.stroke();for(let k=0;k<8;k++)R(S*.74,S*.18+k*S*.08,S*.2,6,'#a0a0a0');});
  cell(C.DARK,S=>{R(0,0,S,S,'#2c2d2f');noise(0,0,S,S,300,.1,false);});
  cell(C.CONC,S=>{R(0,0,S,S,'#e9e7e2',1);noise(0,0,S,S,1500,.08);streaks(0,0,S,S,4,.05);});
  cell(C.DISH,S=>{R(0,0,S,S,'#f2f2f0');g.fillStyle='rgba(0,0,0,.08)';g.beginPath();g.arc(S/2,S/2,S*.4,0,7);g.fill();});
  const tex=new THREE.CanvasTexture(cv),mask=new THREE.CanvasTexture(mv);
  for(const t of[tex,mask]){t.anisotropy=Math.min(16,renderer.capabilities.getMaxAnisotropy());t.minFilter=THREE.LinearMipmapLinearFilter;}
  return {tex,mask};
}

// ======================= material =======================
function fac_material(atlas){
  const mat=new THREE.MeshLambertMaterial({map:atlas.tex,vertexColors:true});
  const pad=(4/FAC_A).toFixed(6),w2=renderer.capabilities.isWebGL2;
  mat.onBeforeCompile=sh=>{
    sh.uniforms.facMask={value:atlas.mask};
    sh.vertexShader='attribute vec4 atl;\nvarying vec4 vAtl;\nvarying vec3 vFacWP;\nvarying vec3 vFacN;\n'+sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvAtl=atl;vec4 facWP4=modelMatrix*vec4(transformed,1.0);vFacWP=facWP4.xyz;vFacN=normalize(mat3(modelMatrix)*objectNormal);');
    sh.fragmentShader='uniform sampler2D facMask;\nvarying vec4 vAtl;\nvarying vec3 vFacWP;\nvarying vec3 vFacN;\n'+sh.fragmentShader
      .replace('#include <map_fragment>',`
  vec2 fT=vUv;vec2 fF=fract(fT);vec2 fP=vec2(${pad});vec2 fA=vAtl.xy+fP+fF*(vAtl.zw-2.0*fP);
  ${w2?'vec2 fGx=dFdx(fT)*vAtl.zw,fGy=dFdy(fT)*vAtl.zw;vec4 fC=textureGrad(map,fA,fGx,fGy);vec4 fM=textureGrad(facMask,fA,fGx,fGy);':'vec4 fC=texture2D(map,fA);vec4 fM=texture2D(facMask,fA);'}
  fC=mapTexelToLinear(fC);float facGlass=fM.g;
  diffuseColor.rgb*=fC.rgb*mix(vec3(1.0),vColor,fM.r);`)
      .replace('#include <color_fragment>','')
      .replace('#include <envmap_fragment>',`#include <envmap_fragment>
  {vec3 V=normalize(vFacWP-cameraPosition);vec3 N=normalize(vFacN);vec3 Rf=reflect(V,N);
   float fres=0.18+0.82*pow(1.0-clamp(dot(-V,N),0.0,1.0),3.0);
   vec3 sky=mix(vec3(0.70,0.76,0.80),vec3(0.36,0.55,0.80),clamp(Rf.y*1.6,0.0,1.0));
   sky=mix(vec3(0.22,0.23,0.22),sky,smoothstep(-0.12,0.06,Rf.y));
   float sun=pow(max(dot(Rf,normalize(vec3(-0.62,0.52,0.58))),0.0),80.0)*2.5;
   outgoingLight=mix(outgoingLight,sky*0.85+sun,facGlass*fres*0.7);}`);
  };
  mat.customProgramCacheKey=()=>'facades_v1';
  return mat;
}

// ======================= geometry buckets =======================
class fac_Bk{constructor(cap=4096){this.cap=0;this.n=0;this.grow(cap);}
  reset(){this.n=0;return this;}
  grow(c){const o=this;const P=new Float32Array(c*3),N=new Float32Array(c*3),Cc=new Float32Array(c*3),U=new Float32Array(c*2),A=new Float32Array(c*4);
    if(o.cap){P.set(o.P.subarray(0,o.n*3));N.set(o.N.subarray(0,o.n*3));Cc.set(o.C.subarray(0,o.n*3));U.set(o.U.subarray(0,o.n*2));A.set(o.A.subarray(0,o.n*4));}o.P=P;o.N=N;o.C=Cc;o.U=U;o.A=A;o.cap=c;}
  v(x,y,z,nx,ny,nz,col,u,w,rc){if(this.n>=this.cap)this.grow(this.cap*2);const i=this.n++,i3=i*3,i2=i*2,i4=i*4;
    const P=this.P,N=this.N,C=this.C,A=this.A;P[i3]=x;P[i3+1]=y;P[i3+2]=z;N[i3]=nx;N[i3+1]=ny;N[i3+2]=nz;C[i3]=col[0];C[i3+1]=col[1];C[i3+2]=col[2];
    this.U[i2]=u;this.U[i2+1]=w;A[i4]=rc[0];A[i4+1]=rc[1];A[i4+2]=rc[2];A[i4+3]=rc[3];}
  // compact copy: Float32 pos/uv, Int8 normals, Uint8 colours, Uint16 atlas rects (all normalized) -> ~34 B/vertex
  mesh(mat){const n=this.n,g=new THREE.BufferGeometry();const N8=new Int8Array(n*3),C8=new Uint8Array(n*3),A16=new Uint16Array(n*4),Nf=this.N,Cf=this.C,Af=this.A;
    for(let i=0;i<n*3;i++){N8[i]=Math.round(Nf[i]*127);const c=Cf[i];C8[i]=c<=0?0:c>=1?255:Math.round(c*255);}
    for(let i=0;i<n*4;i++){const a=Af[i];A16[i]=a<=0?0:a>=1?65535:Math.round(a*65535);}
    const rel=function(){this.array=null;};
    g.setAttribute('position',new THREE.BufferAttribute(this.P.slice(0,n*3),3));
    g.setAttribute('normal',new THREE.BufferAttribute(N8,3,true).onUpload(rel));g.setAttribute('color',new THREE.BufferAttribute(C8,3,true).onUpload(rel));
    g.setAttribute('uv',new THREE.BufferAttribute(this.U.slice(0,n*2),2).onUpload(rel));g.setAttribute('atl',new THREE.BufferAttribute(A16,4,true).onUpload(rel));
    g.computeBoundingSphere();const m=new THREE.Mesh(g,mat);m.matrixAutoUpdate=false;m.updateMatrix();m.userData.facades=true;return m;}}
const fac_tileBk=new fac_Bk(1<<17);
const fac_chunks=new Map();
const fac_dbg={shops:[],bal:[],pitch:[],t:{}};
function fac_bk(x,z){const k=chunk(x,z);let b=fac_chunks.get(k);if(!b){b=new fac_Bk();fac_chunks.set(k,b);}return b;}
// generic quad: P = 4 points [x,y,z] in CCW order seen from the side the normal points to; T = 4 uv; cols = 4 rgb
const fac_t1=new THREE.Vector3(),fac_t2=new THREE.Vector3();
function fac_quad(b,P,T,n,cols,rc){
  fac_t1.set(P[1][0]-P[0][0],P[1][1]-P[0][1],P[1][2]-P[0][2]);fac_t2.set(P[2][0]-P[0][0],P[2][1]-P[0][1],P[2][2]-P[0][2]);fac_t1.cross(fac_t2);
  const ord=(fac_t1.x*n[0]+fac_t1.y*n[1]+fac_t1.z*n[2])>=0?[0,1,2,0,2,3]:[0,2,1,0,3,2];
  for(const i of ord){const p=P[i];b.v(p[0],p[1],p[2],n[0],n[1],n[2],cols[i]||cols[0],T[i][0],T[i][1],rc);}}
function fac_tri(b,P,T,n,col,rc){fac_t1.set(P[1][0]-P[0][0],P[1][1]-P[0][1],P[1][2]-P[0][2]);fac_t2.set(P[2][0]-P[0][0],P[2][1]-P[0][1],P[2][2]-P[0][2]);fac_t1.cross(fac_t2);
  const ord=(fac_t1.x*n[0]+fac_t1.y*n[1]+fac_t1.z*n[2])>=0?[0,1,2]:[0,2,1];for(const i of ord){const p=P[i];b.v(p[0],p[1],p[2],n[0],n[1],n[2],col,T[i][0],T[i][1],rc);}}
// vertical wall quad from xz point a to c (outward normal n2=[nx,nz]) between heights y0..y1
function fac_wall(b,a,c,y0,y1,n2,u0,u1,v0,v1,colB,colT,rc){const n=[n2[0],0,n2[1]];
  fac_quad(b,[[a[0],y0,a[1]],[c[0],y0,c[1]],[c[0],y1,c[1]],[a[0],y1,a[1]]],[[u1,v0],[u0,v0],[u0,v1],[u1,v1]],n,[colB,colB,colT,colT],rc);}
function fac_fill(b,y,outer,holes,rc,col,us=6,ny=1){const c=outer.map(p=>new THREE.Vector2(p[0],p[1])),h=(holes||[]).map(r=>r.map(p=>new THREE.Vector2(p[0],p[1])));
  let tris;try{tris=THREE.ShapeUtils.triangulateShape(c,h);}catch(e){return;}const all=c.concat(...h);
  for(const t of tris){const A=all[t[0]],B=all[t[1]],Cc=all[t[2]];if(!A||!B||!Cc)continue;fac_tri(b,[[A.x,y,A.y],[B.x,y,B.y],[Cc.x,y,Cc.y]],[[A.x/us,A.y/us],[B.x/us,B.y/us],[Cc.x/us,Cc.y/us]],[0,ny,0],col,rc);}}
function fac_addGeo(b,geo,m,col,rc){const g=geo.index?geo.toNonIndexed():geo;const P=g.attributes.position,N=g.attributes.normal,U=g.attributes.uv;_nm.getNormalMatrix(m);
  for(let i=0;i<P.count;i++){_v.fromBufferAttribute(P,i).applyMatrix4(m);_n.fromBufferAttribute(N,i).applyMatrix3(_nm).normalize();b.v(_v.x,_v.y,_v.z,_n.x,_n.y,_n.z,col,U?U.getX(i):0,U?U.getY(i):0,rc);}}
// outward edge normals & mitred offset of a CCW ring (positive d = outward)
function fac_offset(r,d){const n=r.length,out=[];for(let i=0;i<n;i++){const p0=r[(i-1+n)%n],p1=r[i],p2=r[(i+1)%n];
    let ax=p1[0]-p0[0],az=p1[1]-p0[1],al=Math.hypot(ax,az)||1,bx=p2[0]-p1[0],bz=p2[1]-p1[1],bl=Math.hypot(bx,bz)||1;
    const n1x=az/al,n1z=-ax/al,n2x=bz/bl,n2z=-bx/bl;const dt=1+n1x*n2x+n1z*n2z;let mx,mz;
    if(dt<0.25){mx=n2x;mz=n2z;}else{mx=(n1x+n2x)/dt;mz=(n1z+n2z)/dt;}out.push([p1[0]+mx*d,p1[1]+mz*d]);}return out;}

// ======================= street-facing test (own road grid; streets module is built later) =======================
let fac_rg=null;const FAC_RG=30;
function fac_buildRoadGrid(){fac_rg=new Map();for(const r of D.r){if(r[0]!==0&&r[0]!==2)continue;const pts=dec(r[6]),w=r[1];
  for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1],s={a,b,w};const x0=Math.min(a[0],b[0]),x1=Math.max(a[0],b[0]),z0=Math.min(a[1],b[1]),z1=Math.max(a[1],b[1]);
    for(let x=Math.floor(x0/FAC_RG);x<=Math.floor(x1/FAC_RG);x++)for(let z=Math.floor(z0/FAC_RG);z<=Math.floor(z1/FAC_RG);z++){const k=x*100000+z;let c=fac_rg.get(k);if(!c){c=[];fac_rg.set(k,c);}c.push(s);}}}}
function fac_facesStreet(mx,mz,nx,nz){const ci=Math.floor(mx/FAC_RG),cj=Math.floor(mz/FAC_RG);
  for(let i=ci-1;i<=ci+1;i++)for(let j=cj-1;j<=cj+1;j++){const c=fac_rg.get(i*100000+j);if(!c)continue;
    for(const s of c){const dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1],l2=dx*dx+dz*dz||1e-9;let t=((mx-s.a[0])*dx+(mz-s.a[1])*dz)/l2;t=t<0?0:t>1?1:t;
      const qx=s.a[0]+dx*t-mx,qz=s.a[1]+dz*t-mz,d=Math.hypot(qx,qz);if(d<s.w/2+11&&d>0.5&&(qx*nx+qz*nz)/d>0.55)return true;}}return false;}

// ======================= colours =======================
const FAC_CLASSIC=[0xf3e3b8,0xeed39a,0xf0d9c9,0xf4efe4,0xdfe6cc,0xe9c597,0xe6d6c8,0xf1d9ae,0xe8d2cf,0xd9d5c4,0xf2e6cf,0xe6c9a8,0xcfdbe0,0xead8b0];
const FAC_PANEL=[0xe9e7e0,0xdedad0,0xefe7d6,0xd8dde0,0xf1e8cf,0xe6ddd0,0xd6d1c7,0xf0e2c9,0xeed9cf,0xdde6d6,0xe8e4da];
const FAC_GLASS=[0xb7c7d4,0xa9bccb,0xc9d3da,0xd2d2cc];
const FAC_ROOFS=[0x8b8e90,0x8b8e90,0x7d8184,0x9a4b33,0x8a3f2c,0x4f6e58,0x6b5a4c,0x5d6063];
const fac_parse=s=>{if(!s)return null;try{const c=new THREE.Color();c.setStyle(s.startsWith('#')||/^[a-z]+$/i.test(s)?s:'#'+s);return c.getHex();}catch(e){return null;}};
const fac_rgb=(hex,k=1)=>{_c.set(hex);return [Math.min(1,_c.r*k),Math.min(1,_c.g*k),Math.min(1,_c.b*k)];};

// ======================= shared state (created once) =======================
let fac_ready=false,fac_mat=null,RC=null,signRC,awnRC,balpRC,balgRC,SHOP_CELLS,boxG,cylG,dishG;
const fac_stats={shops:0,bal:0,tiles:0,ms:[]};
function fac_init(){if(fac_ready)return;fac_ready=true;const t0=performance.now();
  const atlas=fac_paintAtlas();fac_dbg.t.atlas=Math.round(performance.now()-t0);TEX.atlas=atlas.tex;fac_mat=fac_material(atlas);fac_buildRoadGrid();
  const C=FAC_C;RC={};for(const k in C)RC[k]=fac_rect(C[k]);
  signRC=[];for(let k=0;k<16;k++)signRC.push(fac_rect(C.SIGN+(k>>2),k&3,4));
  awnRC=[0,1,2,3].map(k=>fac_rect(C.AWN,k,4));balpRC=[0,1,2,3].map(k=>fac_rect(C.BALP,k,4));balgRC=[0,1,2,3].map(k=>fac_rect(C.BALG,k,4));
  SHOP_CELLS=[RC.GSHOP,RC.GGOODS,RC.GGOODS,RC.GCAFE];
  boxG=new THREE.BoxGeometry(1,1,1);{const p=boxG.attributes.position;for(let i=0;i<p.count;i++)p.setY(i,p.getY(i)+.5);}boxG=boxG.toNonIndexed();
  cylG=new THREE.CylinderGeometry(.5,.5,1,10);cylG.translate(0,.5,0);cylG=cylG.toNonIndexed();
  dishG=new THREE.ConeGeometry(.45,.25,10,1,true).toNonIndexed();}
const fac_hash=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0)%2147483600+1;};
// one building -> bucket b. ent = [h,minH,style,colour,ring,holes,extra?]; lod 'far' = cheap version
function fac_buildOne(b,ent,seed,lod,tile){const [h,mh,style,col0,ring,holes]=ent;const ex=ent[6]||null;const far=lod==='far';
    let col=col0||(ex&&(ex.fc||ex.facade_color))||'';
    let outer=dec(ring);if(outer.length<3)return;if(sArea(outer)<0)outer.reverse();
    const hs=holes.map(dec).filter(r=>r.length>=3).map(r=>sArea(r)>0?r.reverse():r);
    let mx=0,mz=0;for(const p of outer){mx+=p[0];mz+=p[1];}mx/=outer.length;mz/=outer.length;if(landmarkSkipped(mx,mz))return;
    // ---- terrain: base = lowest ground under the footprint; on slopes the layout is lifted onto a visible plinth ----
    let gLo=0,gHi=0;if(typeof groundRange==='function'){const gr=groundRange(outer);gLo=gr[0];gHi=gr[1];}
    const gD=gHi-gLo,standing=mh<1,lift=standing&&gD>0.6?Math.min(gD-0.3,3.5):0,Y0=gLo+lift;
    const vStart=b.n;
    fac_rs=seed;const rnd=fac_r();
    const area=Math.abs(sArea(outer)),H=h-mh;
    // ---- archetype ----
    let kind=['classic','panel','glass','small','church'][style]||'classic';
    const outskirts=Math.hypot(mx,mz)>2600;
    if(kind==='classic'&&H<=8.5&&(area<260||(outskirts&&area<420)))kind='house';
    const industrial=(kind==='small'||kind==='classic')&&area>700&&H<=12&&(style===3||outskirts);if(industrial)kind='small';
    const roofTag=ex&&(ex.roof||ex.roof_shape)||'';const wantPitch=/gabled|hipped|pyramid|gambrel|mansard|saltbox|half|skillion|round|dome/.test(roofTag),wantFlat=roofTag==='flat';
    const panelGeoBal=!far&&kind==='panel'&&H>12;
    let color=fac_parse(col);
    if(color==null)color=kind==='panel'?fac_rp(FAC_PANEL):kind==='glass'?fac_rp(FAC_GLASS):kind==='church'?0xf7f3ea:kind==='small'?fac_rp([0xe8e2d6,0xd9d3c7,0xefe6d3,0xcfc9bd]):fac_rp(FAC_CLASSIC);
    const bright=.94+fac_r()*.1;const wc=fac_rgb(color,bright),wcD=fac_rgb(color,bright*.78),wcG=fac_rgb(color,bright*.9),wcT=fac_rgb(color,bright*1.02);
    const [bw0,fh0]=kind==='panel'?TILE[1]:kind==='glass'?TILE[2]:kind==='church'?TILE[4]:kind==='small'?TILE[3]:TILE[0];
    let upCell,cellW=1,cellH=1;
    if(kind==='classic')upCell=fac_rp([RC.CLA,RC.CLA,RC.CLB,RC.CLC,RC.CLD,RC.CLC]);
    else if(kind==='house')upCell=fac_r()<.55?RC.HOUSE:fac_rp([RC.CLA,RC.CLD,RC.CLB]);
    else if(kind==='panel'){upCell=panelGeoBal?fac_rp([RC.PA,RC.PD,RC.PA]):fac_rp([RC.PB,RC.PC,RC.PC,RC.PA]);cellW=2;cellH=2;}
    else if(kind==='glass'){upCell=fac_r()<.6?RC.GLA:RC.GLB;if(upCell===RC.GLA){cellW=2;cellH=2;}}
    else if(kind==='church')upCell=RC.CHURCH;
    else upCell=industrial?RC.PLAIN:(fac_r()<.5?RC.PLAIN:RC.HOUSE);
    const gh=kind==='panel'?3.0:kind==='glass'?4.5:4.2;
    const hasGround=!far&&(kind==='classic'||kind==='panel'||kind==='glass')&&H>=gh+2.6&&mh<1;
    const oneStoreyShops=!far&&!industrial&&(kind==='house'||kind==='small')&&mh<1&&H>=3.2&&H<=6.5;
    // ---- roof type ----
    const roofCol=fac_rgb(fac_parse(ex&&(ex.rc||ex.roof_color))||(kind==='house'&&outskirts?fac_rp([0x9a4b33,0x8a3f2c,0x7a5a46,0x8b8e90,0x6e2f26,0x4f6e58]):industrial?fac_rp([0x8b8e90,0x9aa0a3,0x7d8184]):fac_rp(FAC_ROOFS)),.95+fac_r()*.1);
    let pitched=null;
    if(!wantFlat&&!industrial&&(wantPitch||kind==='classic'||kind==='house'||kind==='church'||(kind==='small'&&upCell===RC.HOUSE))&&!hs.length&&outer.length<=14&&area<4000&&H<=(wantPitch?40:19)&&(wantPitch||fac_r()<(outskirts&&kind==='house'?.97:.9))){
      let per=0;for(let i=0;i<outer.length;i++){const a=outer[i],c=outer[(i+1)%outer.length];per+=Math.hypot(c[0]-a[0],c[1]-a[1]);}
      const inr=2*area/per;let d=outer.length===4?Math.min(inr*.98,7):Math.min(inr*.62,4.5);if(d>0.8){
      for(let tries=0;tries<2&&!pitched;tries++,d*=.55){const q=fac_offset(outer,-d);let ok=true;
        for(let i=0;i<outer.length&&ok;i++){const j=(i+1)%outer.length;const ex=outer[j][0]-outer[i][0],ez=outer[j][1]-outer[i][1],fx=q[j][0]-q[i][0],fz=q[j][1]-q[i][1];
          if(ex*fx+ez*fz<-0.05*(ex*ex+ez*ez))ok=false;if(Math.hypot(q[i][0]-outer[i][0],q[i][1]-outer[i][1])>d*3.2)ok=false;if(!pip(q[i][0],q[i][1],outer))ok=false;}
        if(ok&&Math.abs(sArea(q))>-1){const pitch=(20+fac_r()*14)*Math.PI/180;pitched={q,rise:Math.min(d*Math.tan(pitch),6)};}}}}
    const parapet=!far&&!pitched&&H>6.5&&kind!=='small';
    const cornice=!far&&(kind==='classic'||kind==='church')&&H>5.5;
    const yTop=h;
    // ---- walls ----
    const rings=[outer,...hs];
    const corn=cornice?fac_offset(outer,pitched?.26:.38):null,string=hasGround&&kind==='classic'?fac_offset(outer,.12):null;
    rings.forEach((r,ri)=>{const isOuter=ri===0;
      for(let i=0;i<r.length;i++){const a=r[i],c=r[(i+1)%r.length];const dx=c[0]-a[0],dz=c[1]-a[1],l=Math.hypot(dx,dz);if(l<0.05)continue;
        const n2=[dz/l,-dx/l],tx=dx/l,tz=dz/l;const nb=Math.max(1,Math.round(l/bw0));
        let yg=mh;
        const street=isOuter&&l>=4.5&&(hasGround||oneStoreyShops)&&fac_facesStreet((a[0]+c[0])/2,(a[1]+c[1])/2,n2[0],n2[1]);
        let gTop=hasGround?mh+gh:oneStoreyShops&&street?mh+Math.min(H-.4,4.0):mh;
        if(gTop>mh){
          const shopProb=kind==='panel'?.55:kind==='glass'?.7:kind==='classic'?.75:.6;
          if(street&&fac_r()<shopProb){ // ---- storefront bays ----
            fac_stats.shops++;if(fac_dbg.shops.length<400)fac_dbg.shops.push([(a[0]+c[0])/2,(a[1]+c[1])/2,n2[0],n2[1]]);const bwE=l/nb;let j=0;const GH=gTop-mh;
            while(j<nb){let k=Math.min(nb-j,fac_rp([1,2,2,3,3,4]));
              const P0=j*bwE,P1=(j+k)*bwE;
              if(k===1&&fac_r()<.45){const gc=kind==='classic'?RC.GGATE:RC.GDOOR;const A2=[a[0]+tx*P0,a[1]+tz*P0],C2=[a[0]+tx*P1,a[1]+tz*P1];fac_wall(b,A2,C2,mh,gTop,n2,0,1,0,1,wcD,wcG,gc);j+=k;continue;}
              const closed=fac_r()<.12,sType=Math.floor(fac_r()*16),cells=sType===2?RC.GCAFE:fac_rp(SHOP_CELLS),door=Math.floor(fac_r()*k);
              for(let q=0;q<k;q++){const s0=(j+q)*bwE,s1=(j+q+1)*bwE;const A2=[a[0]+tx*s0,a[1]+tz*s0],C2=[a[0]+tx*s1,a[1]+tz*s1];
                fac_wall(b,A2,C2,mh,gTop,n2,0,1,0,1,wcD,wcG,closed?RC.GROLL:q===door?RC.GDOOR:cells);}
              const sw=Math.min(k*bwE-.5,7.4),sc=(P0+P1)/2,ox=n2[0]*.08,oz=n2[1]*.08,sy0=mh+GH*.8-.45,sy1=mh+GH*.8+.28;
              if(k*bwE>5.6&&!closed){const A3=[a[0]+tx*(sc-sw/2)+ox,a[1]+tz*(sc-sw/2)+oz],C3=[a[0]+tx*(sc+sw/2)+ox,a[1]+tz*(sc+sw/2)+oz];
                fac_wall(b,A3,C3,sy0,sy1,n2,.002,.998,.02,.98,[1,1,1],[1,1,1],signRC[sType]);}
              if(!closed&&fac_r()<.4){const aw=k*bwE-.3,a0=P0+.15,ay=sy0-.12,out=1.25,drop=.55,A4=[a[0]+tx*a0,a[1]+tz*a0],C4=[a[0]+tx*(a0+aw),a[1]+tz*(a0+aw)];
                const arc=awnRC[Math.floor(fac_r()*4)],col1=[1,1,1];const nUp=[n2[0]*.4,.92,n2[1]*.4];
                fac_quad(b,[[A4[0],ay,A4[1]],[C4[0],ay,C4[1]],[C4[0]+n2[0]*out,ay-drop,C4[1]+n2[1]*out],[A4[0]+n2[0]*out,ay-drop,A4[1]+n2[1]*out]],[[0,1],[aw/1.4,1],[aw/1.4,.25],[0,.25]],nUp,[col1],arc);
                fac_wall(b,[A4[0]+n2[0]*out,A4[1]+n2[1]*out],[C4[0]+n2[0]*out,C4[1]+n2[1]*out],ay-drop-.3,ay-drop,n2,0,aw/1.4,0,.3,col1,col1,arc);}
              j+=k;}
          }else{
            const gcell=kind==='classic'?(fac_r()<.25&&nb>=3?null:RC.GPLINTH):kind==='panel'?null:kind==='glass'?RC.GLOBBY:RC.GHOUSE;
            if(gcell)fac_wall(b,a,c,mh,gTop,n2,0,nb,0,1,wcD,wcG,gcell);
            else{const bwE=l/nb,doorEvery=kind==='panel'?4:3;for(let q=0;q<nb;q++){const s0=q*bwE,s1=(q+1)*bwE;const A2=[a[0]+tx*s0,a[1]+tz*s0],C2=[a[0]+tx*s1,a[1]+tz*s1];
              const isDoor=nb>=3&&q%doorEvery===1&&isOuter;const cc=kind==='panel'?(isDoor?RC.GPDOOR:fac_r()<.18?RC.GPANELG:RC.GPANEL):(isDoor?RC.GGATE:RC.GPLINTH);fac_wall(b,A2,C2,mh,gTop,n2,0,1,0,1,wcD,wcG,cc);
              if(isDoor&&kind==='panel'){const cy=mh+2.55,o=1.1,A3=[A2[0]+tx*.2,A2[1]+tz*.2],C3=[C2[0]-tx*.2,C2[1]-tz*.2],cc2=[.72,.71,.69];
                fac_quad(b,[[A3[0],cy,A3[1]],[C3[0],cy,C3[1]],[C3[0]+n2[0]*o,cy,C3[1]+n2[1]*o],[A3[0]+n2[0]*o,cy,A3[1]+n2[1]*o]],[[0,0],[1,0],[1,1],[0,1]],[0,1,0],[cc2],RC.CONC);
                fac_wall(b,[A3[0]+n2[0]*o,A3[1]+n2[1]*o],[C3[0]+n2[0]*o,C3[1]+n2[1]*o],cy-.2,cy,n2,0,1,0,.1,cc2,cc2,RC.CONC);
                fac_quad(b,[[A3[0],cy-.2,A3[1]],[C3[0],cy-.2,C3[1]],[C3[0]+n2[0]*o,cy-.2,C3[1]+n2[1]*o],[A3[0]+n2[0]*o,cy-.2,A3[1]+n2[1]*o]],[[0,0],[1,0],[1,1],[0,1]],[0,-1,0],[[.4,.4,.4]],RC.CONC);}}}
          }
          yg=gTop;
        }
        // ---- upper wall ----
        if(h-yg>0.3){const nf=Math.max(1,Math.round((h-yg)/fh0));
          const cellU=(!isOuter||l<2.2)?RC.BLANK:(l<bw0*.8&&kind!=='panel')?RC.BLANK:upCell;const cw=cellU===upCell?cellW:1,ch=cellU===upCell?cellH:1;
          const topV=cellU===RC.BLANK?(h-yg)/3.6:nf/ch;fac_wall(b,a,c,yg,h,n2,0,cellU===RC.BLANK?l/3.6:nb/cw,0,topV,yg===mh?wcD:wc,wcT,cellU);}
        // ---- parapet ----
        if(parapet){const ph=kind==='panel'?1.0:.8;fac_wall(b,a,c,h,h+ph,n2,0,l/4,0,.25*ph,wc,wc,RC.PARA);
          const ai=[a[0]-n2[0]*.25,a[1]-n2[1]*.25],ci=[c[0]-n2[0]*.25,c[1]-n2[1]*.25];fac_wall(b,ci,ai,h,h+ph,[-n2[0],-n2[1]],0,l/4,0,.2,wcG,wcG,RC.CONC);
          const ct=[.74,.73,.71];fac_quad(b,[[a[0],h+ph,a[1]],[c[0],h+ph,c[1]],[ci[0],h+ph,ci[1]],[ai[0],h+ph,ai[1]]],[[0,0],[l/4,0],[l/4,.1],[0,.1]],[0,1,0],[ct],RC.CONC);}
        // ---- cornice (classic) ----
        if(cornice&&isOuter){const j2=(i+1)%r.length,ca=corn[i],cc=corn[j2],y1=h-(pitched?.18:0),y0=y1-.45,cw2=fac_rgb(0xf1ece2,bright);
          fac_wall(b,ca,cc,y0+.12,y1,n2,0,l/4,0,.15,cw2,cw2,RC.WHITE);
          fac_quad(b,[[a[0],y0-.12,a[1]],[c[0],y0-.12,c[1]],[cc[0],y0+.12,cc[1]],[ca[0],y0+.12,ca[1]]],[[0,0],[l/4,0],[l/4,.1],[0,.1]],[n2[0]*.5,-.86,n2[1]*.5],[fac_rgb(0xd9d3c6,bright*.85)],RC.WHITE);
          fac_quad(b,[[ca[0],y1,ca[1]],[cc[0],y1,cc[1]],[c[0],y1,c[1]],[a[0],y1,a[1]]],[[0,0],[l/4,0],[l/4,.1],[0,.1]],[0,1,0],[cw2],RC.WHITE);}
        if(string&&isOuter&&hasGround){const j2=(i+1)%r.length,sa=string[i],sc2=string[j2],y=mh+gh,sw2=fac_rgb(0xefe9dd,bright);
          fac_wall(b,sa,sc2,y-.08,y+.18,n2,0,l/4,0,.1,sw2,sw2,RC.WHITE);fac_quad(b,[[a[0],y-.08,a[1]],[c[0],y-.08,c[1]],[sc2[0],y-.08,sc2[1]],[sa[0],y-.08,sa[1]]],[[0,0],[1,0],[1,.1],[0,.1]],[0,-1,0],[fac_rgb(0xcfc9bc,bright*.8)],RC.WHITE);
          fac_quad(b,[[sa[0],y+.18,sa[1]],[sc2[0],y+.18,sc2[1]],[c[0],y+.18,c[1]],[a[0],y+.18,a[1]]],[[0,0],[1,0],[1,.1],[0,.1]],[0,1,0],[sw2],RC.WHITE);}
        // ---- loggia balconies (Soviet panel blocks) ----
        if(panelGeoBal&&isOuter&&l>=9){if(fac_dbg.bal.length<200)fac_dbg.bal.push([(a[0]+c[0])/2,(a[1]+c[1])/2,n2[0],n2[1],h]);const bwE=l/nb,nf=Math.max(1,Math.round((h-yg)/fh0)),fhE=(h-yg)/nf;
          const colP=.1+fac_r()*.2;for(let q=0;q<nb;q++){if(fac_r()>colP)continue;const s0=q*bwE+.25,s1=(q+1)*bwE-.25,dep=1.0+fac_r()*.25;const A2=[a[0]+tx*s0,a[1]+tz*s0],C2=[a[0]+tx*s1,a[1]+tz*s1];
            const A3=[A2[0]+n2[0]*dep,A2[1]+n2[1]*dep],C3=[C2[0]+n2[0]*dep,C2[1]+n2[1]*dep],bwid=s1-s0;
            for(let f=(hasGround?0:1);f<nf;f++){if(fac_r()<.08)continue;fac_stats.bal++;const y0=yg+f*fhE,yp=y0+1.05,y1=y0+fhE-.12;
              const pr=balpRC[Math.floor(fac_r()*4)],gr=balgRC[Math.floor(fac_r()*4)],pcol=pr===balpRC[0]?wc:[1,1,1];
              fac_wall(b,A3,C3,y0,yp,n2,0,1,0,1,pcol,pcol,pr);
              fac_wall(b,A3,C3,yp,y1,n2,0,1,0,1,[1,1,1],[1,1,1],gr);
              const sc=[.8,.79,.77];fac_wall(b,A2,A3,y0,y1,[-tx,-tz],0,1,0,1,sc,sc,RC.CONC);fac_wall(b,C3,C2,y0,y1,[tx,tz],0,1,0,1,sc,sc,RC.CONC);
              fac_quad(b,[[A2[0],y0,A2[1]],[C2[0],y0,C2[1]],[C3[0],y0,C3[1]],[A3[0],y0,A3[1]]],[[0,0],[1,0],[1,1],[0,1]],[0,-1,0],[[.55,.55,.53]],RC.CONC);
              if(f===nf-1)fac_quad(b,[[A2[0],y1,A2[1]],[C2[0],y1,C2[1]],[C3[0],y1,C3[1]],[A3[0],y1,A3[1]]],[[0,0],[1,0],[1,1],[0,1]],[0,1,0],[[.75,.74,.72]],RC.CONC);}}}
      }});
    // ---- roof ----
    if(pitched){const {q,rise}=pitched;if(fac_dbg.pitch.length<300)fac_dbg.pitch.push([mx,mz,h]);const eave=fac_offset(outer,.45),ye=h-.1,yr=h+rise;const n=outer.length;
      for(let i=0;i<n;i++){const j=(i+1)%n;const A=[eave[i][0],ye,eave[i][1]],B=[eave[j][0],ye,eave[j][1]],Cq=[q[j][0],yr,q[j][1]],Dq=[q[i][0],yr,q[i][1]];
        const ex=B[0]-A[0],ez=B[2]-A[2],el=Math.hypot(ex,ez)||1;fac_t1.set(ex,0,ez);fac_t2.set(Dq[0]-A[0],Dq[1]-A[1],Dq[2]-A[2]);const nn=new THREE.Vector3().crossVectors(fac_t2,fac_t1).normalize();if(nn.y<0)nn.negate();
        const sl=Math.hypot(Dq[0]-A[0],rise+.12,Dq[2]-A[2]);const pu=(p)=>((p[0]-A[0])*ex+(p[2]-A[2])*ez)/el/2.5;
        fac_quad(b,[A,B,Cq,Dq],[[pu(A),0],[pu(B),0],[pu(Cq),sl/2.5],[pu(Dq),sl/2.5]],[nn.x,nn.y,nn.z],[roofCol],RC.RTIN);
        // eave underside strip
        fac_quad(b,[[outer[i][0],h-.12,outer[i][1]],[outer[j][0],h-.12,outer[j][1]],B,A],[[0,0],[1,0],[1,.1],[0,.1]],[0,-1,0],[[.35,.34,.33]],RC.DARK);}
      if(Math.abs(sArea(q))>1)fac_fill(b,yr,q,[],RC.RTIN,roofCol,2.5);
      // chimney
      if(!far&&fac_r()<.55){const k=Math.floor(fac_r()*q.length),p=q[k],pc=[.62,.38,.3];fac_addGeo(b,boxG,M(p[0]*.8+mx*.2,h+rise*.5,p[1]*.8+mz*.2,fac_r()*3,0,0,.6,rise*.5+1.2,.6),pc,RC.CONC);}
    }else{
      fac_fill(b,h+.02,outer,hs,RC.RFLAT,fac_rgb(0x9b9893,.9+fac_r()*.15),6);
      // rooftop clutter
      if(!far&&H>6&&area>60){const inner=fac_offset(outer,-1.6);let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;for(const p of outer){x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);z0=Math.min(z0,p[1]);z1=Math.max(z1,p[1]);}
        const nItems=Math.min(9,1+Math.floor(area/180));const ang=Math.atan2(outer[1][0]-outer[0][0],outer[1][1]-outer[0][1]);
        for(let it=0,tries=0;it<nItems&&tries<nItems*6;tries++){const x=x0+fac_r()*(x1-x0),z=z0+fac_r()*(z1-z0);if(!pip(x,z,inner)||hs.some(r=>pip(x,z,r)))continue;it++;
          const t=fac_r(),y=h+.02;
          if(it===1&&H>14){fac_addGeo(b,boxG,M(x,y,z,ang,0,0,3.2,2.6,3.8),wcG,RC.CONC);fac_addGeo(b,boxG,M(x,y+2.6,z,ang,0,0,3.5,.15,4.1),[.5,.5,.5],RC.DARK);}
          else if(t<.5){fac_addGeo(b,boxG,M(x,y,z,ang+(fac_r()<.5?0:Math.PI/2),0,0,1.0,.75,.45),[1,1,1],RC.AC);}
          else if(t<.62){fac_addGeo(b,cylG,M(x,y,z,0,0,0,1.6,1.9,1.6),[.78,.78,.76],RC.CONC);fac_addGeo(b,boxG,M(x,y,z,0,0,0,.12,.4,.12),[.3,.3,.3],RC.DARK);}
          else if(t<.8){fac_addGeo(b,boxG,M(x,y,z,0,0,0,.07,3.5,.07),[.35,.35,.35],RC.DARK);fac_addGeo(b,boxG,M(x,y+2.6,z,fac_r()*3,0,0,1.6,.05,.05),[.35,.35,.35],RC.DARK);fac_addGeo(b,boxG,M(x,y+3.1,z,fac_r()*3,0,0,1.1,.05,.05),[.35,.35,.35],RC.DARK);}
          else{fac_addGeo(b,boxG,M(x,y,z,0,0,0,.08,.9,.08),[.4,.4,.4],RC.DARK);fac_addGeo(b,dishG,M(x,y+1.05,z,fac_r()*6,-.9,0),[1,1,1],RC.DISH);}}}
    }
    if(Y0!==0){const P=b.P;for(let i=vStart*3+1,e=b.n*3;i<e;i+=3)P[i]+=Y0;}
    // plinth (downhill basement band) + skirt below grade so no gaps appear between footprint vertices on uneven ground
    if(standing&&(gD>0.15||lift>0)){const pc=kind==='panel'||kind==='small'?RC.CONC:RC.GPLINTH,pcol=fac_rgb(color,bright*.62),yb=gLo-0.8,yt=Y0+0.03;
      for(let i=0;i<outer.length;i++){const a=outer[i],c=outer[(i+1)%outer.length];const dx=c[0]-a[0],dz=c[1]-a[1],l=Math.hypot(dx,dz);if(l<0.05)continue;
        fac_wall(b,a,c,yb,yt,[dz/l,-dx/l],0,pc===RC.CONC?l/4:Math.max(1,Math.round(l/bw0)),0,pc===RC.CONC?(yt-yb)/4:Math.min(1,(yt-yb)/4.2),pcol,pcol,pc);}}
    if(mh<2.5){const P=addPoly([outer,...hs],h+lift,tile);if(P)P.y0=gLo;}
  
}
// ======================= streaming API =======================
function buildBuildingsTile(t){fac_init();const t0=performance.now();const list=(t.data&&t.data.b)||[];const b=fac_tileBk.reset();const base=fac_hash(t.key||'');
  for(let k=0;k<list.length;k++)fac_buildOne(b,list[k],(base+k*7919)%2147483646+1,t.lod,t);
  if(b.n){const me=b.mesh(fac_mat);me.name='buildings_'+t.key;t.group.add(me);t.facMesh=me;}
  const ms=performance.now()-t0;fac_stats.tiles++;fac_stats.ms.push([t.key,Math.round(ms*10)/10,list.length,b.n/3|0]);return ms;}
function buildingsUnloadTile(t){t.facMesh=null;}
// legacy: whole D.b into chunked buckets
function buildBuildings(){fac_init();const t0=performance.now();let bi=0;
  for(const ent of D.b){bi++;const o=ent[4];fac_buildOne(fac_bk(o[0]*SC,o[1]*SC),ent,(bi*7919+13)%2147483646+1,null,null);}
  fac_dbg.t.geo=Math.round(performance.now()-t0);let tris=0;for(const b of fac_chunks.values()){const me=b.mesh(fac_mat);tris+=b.n/3;scene.add(me);}
  console.log('[facades] buildings',bi,'shops',fac_stats.shops,'balconies',fac_stats.bal,'chunks',fac_chunks.size,'tris',tris|0,'ms',Math.round(performance.now()-t0),JSON.stringify(fac_dbg.t));}
