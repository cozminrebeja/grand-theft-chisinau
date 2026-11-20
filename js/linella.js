'use strict';
// Linella supermarkets: a lit LINELLA sign totem on the pavement next to every Chișinău store address from linella.md
// (geocoded with OpenStreetMap Nominatim; © OpenStreetMap contributors). Most stores sit on the ground floor of existing
// blocks, so we mark them with a roadside sign instead of adding buildings. Driven by game.js through hook('linellaUpdate',...).
// Positions: real-world local metres (x east, z south), scaled by WS at build time; see tools/WORLD.md.
const LINELLA_PTS=[-2909,-345,4469,-2139,1001,5213,2376,-2703,-4216,-1170,2744,3451,1462,684,2654,-3440,1243,-4234,3869,-509,4461,-3093,-4868,-1672,4515,-3467,4981,2585,-409,3799,4878,4729,-1859,3037,-5211,-1875,1458,4032,-2170,-800,2129,2682,-845,31,-1014,3564,-4686,-1958,2018,5463,3161,4221,1035,-3862,63,-1636,4486,-3086,-2484,343,812,-763,1589,3021,3917,-2093,-3490,-2173,1080,-287,4695,4480,2694,5179,2531,-964,1369,-1294,7014,9124,2567,-2835,2767,2456,-4188,-1276,2350,-2993,3844,-1045,1002,5024,-2447,387,3846,3796,7534,4544,1071,-4044,-3907,-639,549,-630,-2202,2621,-5192,-1442,3809,-1509,4472,-2760,-653,2031,1507,4715,1187,5539,3574,-485,-2886,-542,1714,-751,1168,1110,2397,-1327,-3541,3190,-3986,-705,235,-500,-4892,-1149,2044,5425,3873,266,-1416,2539,4373,-3438,2273,-3401,2413,3461,7700,8548,610,2245,1505,1052,534,350,3018,5335,-4770,-699,-4164,2573,-2380,-1927,2413,-3443,1372,4871,10602,-4323,2201,-1681,500,11585,894,-3204,8354,5136,3926,11230,243,334,-2091,-98,420,4762,277,5249,-5525,-200,-780,1451,7591,4684,7211,3937,324,-374,8303,-4345,-416,4036,8268,4519,10619,-5895,7409,3591,1932,5232,3283,499,681,320,-4484,-268,-6504,921,-5203,1945,-6134,-1888,1086,1447,8694,-5304,3532,-4304,8964,8745,10393,11444,7150,3757,986,252,-6206,7066,5060,11454,5991,-5900,1235,-2233,10283,11225,8824,-5225,-2831,148,-257,-868,-372,1061,-4515,236,7757,3315,105,-901,-998,425,3627,-4800,53,-2827,-4736,685,-4288,-47,8306,4388,8255,-4131,4835,11348,1062,647,-4899,211,899,903,879,1364,7748,3369];
let linella_list=null,linella_face=null;

function linella_tex(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);t.anisotropy=4;return t;}
function linella_build(){
  linella_list=[];const ws=typeof WS==='number'?WS:1;
  for(let i=0;i<LINELLA_PTS.length;i+=2){const px=LINELLA_PTS[i]*ws,pz=LINELLA_PTS[i+1]*ws;let x=px,z=pz,a=0,snx=0,snz=1;
    // stand on the pavement of the nearest road, on the store's side
    const ns=nearestSeg(px,pz,80);
    if(ns){const s=ns.s,dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1],l=Math.hypot(dx,dz)||1;a=Math.atan2(dx,dz);
      let nx=-dz/l,nz=dx/l;if((px-ns.qx)*nx+(pz-ns.qz)*nz<0){nx=-nx;nz=-nz;}const off=s.r.w/2+1.4;x=ns.qx+nx*off;z=ns.qz+nz*off;snx=nx;snz=nz;}
    linella_list.push({x,z,a,y:groundY(x,z),nx:snx,nz:snz,armed:true});}
  const N=linella_list.length;
  const face=linella_tex(512,256,(g,w,h)=>{const gr=g.createLinearGradient(0,0,0,h);gr.addColorStop(0,'#e4002b');gr.addColorStop(1,'#b0001f');g.fillStyle=gr;g.fillRect(0,0,w,h);
    g.fillStyle='#ffd200';g.fillRect(0,h*.8,w,h*.2);g.fillStyle='#fff';g.font='900 128px Anton, Impact, Arial Black, sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText('LINELLA',w/2,h*.42);
    g.fillStyle='#7a0016';g.font='800 30px Inter, Arial, sans-serif';g.fillText('SUPERMARKET · 08:00–22:00',w/2,h*.9);});
  linella_face=face;
  const signMat=new THREE.MeshLambertMaterial({map:face,emissive:0x5a0010,emissiveMap:face});
  const red=new THREE.MeshLambertMaterial({color:0xc4001f,emissive:0x220004}),pole=new THREE.MeshLambertMaterial({color:0x3a3a3c});
  // local frame: +z along the road, so the sign faces drivers coming from both directions (box faces +x,-x,+y,-y,+z,-z)
  const parts=[
    {geo:new THREE.BoxGeometry(.3,4.2,.3),mat:pole,at:[0,2.1,0]},
    {geo:new THREE.BoxGeometry(2.6,1.3,.35),mat:[red,red,red,red,signMat,signMat],at:[0,4.6,0],shadow:true},
    {geo:new THREE.BoxGeometry(.8,.25,.8),mat:pole,at:[0,.12,0]},
  ];
  const m4=new THREE.Matrix4(),st=new THREE.Matrix4(),lo=new THREE.Matrix4();
  for(const p of parts){const im=new THREE.InstancedMesh(p.geo,p.mat,N);
    linella_list.forEach((s,k)=>{st.makeRotationY(s.a).setPosition(s.x,s.y,s.z);lo.makeTranslation(p.at[0],p.at[1],p.at[2]);im.setMatrixAt(k,m4.multiplyMatrices(st,lo));});
    im.instanceMatrix.needsUpdate=true;im.castShadow=!!p.shadow;im.receiveShadow=true;im.frustumCulled=false;scene.add(im);}
}
function linellaUpdate(){if(linella_list){if(typeof lst_frontsUpdate==='function')lst_frontsUpdate();return;}if(typeof nearestSeg!=='function'||typeof groundY!=='function'||typeof scene==='undefined')return;linella_build();}
