'use strict';
// Bemol gas stations: one at every real fuel station location in Chișinău (OpenStreetMap amenity=fuel, © OSM contributors),
// all rebranded "Bemol". Drawn with a few InstancedMeshes (canopy, pillars, pump islands, pumps, sign totem).
// Getting close shows "O cofe la Bemol?". Driven by game.js through hook('bemolUpdate',dt,player,say).
// Positions: local metres (x east, z south), see tools/WORLD.md.
const BEMOL_PTS=[1358,-3298,-954,3619,-1581,3226,1550,5897,152,4535,-427,-1626,850,-1096,819,2612,731,2592,-3541,-2,-4287,-2826,3189,4358,1556,-1889,4495,6819,-4362,-1164,-191,-1747,1638,274,-3465,3628,1818,-4398,1402,-3306,40,6247,3356,5292,-2506,3192,-3410,3664,-4733,5119,-4629,5109,783,-1751,-321,-1648,5260,4876,5141,4844,4432,5039,1146,5644,2960,5055,276,-1944,2076,283,-1768,-3306,-4865,-1530,4217,-789,4889,-1182,3634,-1655,3679,-1712,3548,-812,4910,-2494,277,1656,2490,-35,5150,-1377,4536,2654,5670,3448,5642,3298,5596,4139,-4652,-344,2025,1961,5844,3907,-5363,-3449,-5212,-3447,-4660,-3142,-5956,6936,-5042,8217,-1357,10329,2600,9285,-2985,3413,9841,10525,-2906,-1169,5432,-1802,2566,-3813,-5954,6858,1581,-256,1537,-284,7509,9490,4323,4273,-5014,-2511,1216,-4110,282,-3981,4126,6350,4846,11358,1606,-4176,-3740,-3598,4223,1394,9730,10501,-5076,5878,1954,-4754,-1368,-1571,3245,5643,3366,-4816,-4002,4284,5813,3749,5299,4369,3875,4202,-3861,11044,-4429,4634,4952,2922,452,-1961,1480,-3338,1488,-506,443,2522,760,4213,-4205,-3156,5321,3216,2057,-91,515,-1941,1970,-4799,2312,-626,2386,-566,1842,-4619,-4358,-169,3260,-448,-4814,5217,763,2374,4675,4972,3612,-4851,-4860,5275,7046,-2617,-535,-1405,1483,-1504,-79,7404,-4165,-3313,1235,-2233,3679,-4848,6732,7905,1987,3819,-1902,-1526,686,2363,4993,-1223,709,-1800,4996,-2072,3268,4833,968,-540,3123,1772,4340,-3027,3671,2562,3502,-563,-4737,-2317,2472,1869,-5515,-2045,3914,1989,-137,-2317,-6174,1165,-4074,4337,-6218,7192,-3512,3370,2181,39,1154,-2102,5062,4917,4141,450,9558,10283,863,-1654,5590,8571,1789,-4310,-6362,5147,-3442,-3768,10011,10823,662,2289,-408,897,7979,8833,4353,-784,1104,306,1009,3265,4239,3303,4320,3351,-3398,-3774,3048,2742,2154,1717];
const BEMOL_NEAR=32,BEMOL_FAR=70;
let bemol_list=null,bemol_inside=-1;

function bemol_tex(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);t.anisotropy=4;return t;}
function bemol_logo(g,w,h,bg){g.fillStyle=bg;g.fillRect(0,0,w,h);g.fillStyle='#ffd400';g.fillRect(0,h*.78,w,h*.1);
  g.fillStyle='#fff';g.font='900 '+Math.round(h*.52)+'px Anton, Impact, Arial Black, sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText('BEMOL',w/2,h*.44);}

function bemol_build(){
  bemol_list=[];
  // orient each station along its nearest road, and keep the canopy off the asphalt
  const ws=typeof WS==='number'?WS:1; // map scale (mapcore.js): stored points are real-world metres
  for(let i=0;i<BEMOL_PTS.length;i+=2){let x=BEMOL_PTS[i]*ws,z=BEMOL_PTS[i+1]*ws,a=0;
    const ns=typeof nearestSeg==='function'?nearestSeg(x,z,60):null;
    if(ns){const s=ns.s,dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1];a=Math.atan2(dx,dz);const min=s.r.w/2+7.5;
      if(ns.d<min){let nx=x-ns.qx,nz=z-ns.qz,l=Math.hypot(nx,nz);if(l<.01){nx=-dz;nz=dx;l=Math.hypot(nx,nz)||1;}x=ns.qx+nx/l*min;z=ns.qz+nz/l*min;}}
    bemol_list.push({x,z,a,y:groundY(x,z)});}
  const N=bemol_list.length;
  const white=new THREE.MeshLambertMaterial({color:0xf4f4f0});
  const band=bemol_tex(512,64,(g,w,h)=>{g.fillStyle='#c8102e';g.fillRect(0,0,w,h);g.fillStyle='#ffd400';g.fillRect(0,h*.82,w,h*.18);g.fillStyle='#fff';
    g.font='900 40px Anton, Impact, Arial Black, sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText('BEMOL',w*.25,h*.42);g.fillText('BEMOL',w*.75,h*.42);});
  const bandMat=new THREE.MeshLambertMaterial({map:band,emissive:0x330000});
  const under=new THREE.MeshLambertMaterial({color:0xffffff,emissive:0x8a8a80});
  const sign=new THREE.MeshLambertMaterial({map:bemol_tex(256,512,(g,w,h)=>{g.fillStyle='#c8102e';g.fillRect(0,0,w,h);
    g.save();g.translate(0,0);bemol_logo(g,w,h*.32,'#c8102e');g.restore();
    g.fillStyle='#fff';g.fillRect(w*.08,h*.38,w*.84,h*.56);g.fillStyle='#111';g.font='800 34px Inter, Arial, sans-serif';g.textAlign='left';g.textBaseline='middle';
    [['Benzină 95','25.49'],['Motorină','23.99'],['GPL','13.29']].forEach(([n,p],k)=>{const y=h*.46+k*h*.17;g.fillText(n,w*.12,y);g.fillStyle='#c8102e';g.textAlign='right';g.fillText(p,w*.88,y);g.fillStyle='#111';g.textAlign='left';});}),emissive:0x2a0000});
  const red=new THREE.MeshLambertMaterial({color:0xc8102e}),grey=new THREE.MeshLambertMaterial({color:0x9a9a96}),dark=new THREE.MeshLambertMaterial({color:0x2a2a2a});
  // canopy: textured band on the four sides, white top, lit underside (box face order: +x,-x,+y,-y,+z,-z)
  const parts=[
    {geo:new THREE.BoxGeometry(9,1.1,15),mat:[bandMat,bandMat,white,under,bandMat,bandMat],at:[[0,5.6,0]],shadow:true},
    {geo:new THREE.CylinderGeometry(.22,.22,5.1,8),mat:white,at:[[-2.6,2.55,-4.5],[2.6,2.55,-4.5],[-2.6,2.55,4.5],[2.6,2.55,4.5]]},
    {geo:new THREE.BoxGeometry(1.2,.22,4.2),mat:grey,at:[[-2.6,.11,-4.5],[2.6,.11,-4.5],[-2.6,.11,4.5],[2.6,.11,4.5]]},
    {geo:new THREE.BoxGeometry(.7,1.7,.5),mat:[red,red,white,white,dark,dark],at:[[-2.6,1.07,-5.6],[2.6,1.07,-5.6],[-2.6,1.07,3.4],[2.6,1.07,3.4]]},
    {geo:new THREE.BoxGeometry(1.6,6.5,.45),mat:[red,red,red,red,sign,sign],at:[[6.2,3.25,-8.5]],shadow:true},
  ];
  const m4=new THREE.Matrix4(),st=new THREE.Matrix4(),lo=new THREE.Matrix4();
  for(const p of parts){const im=new THREE.InstancedMesh(p.geo,p.mat,N*p.at.length);let k=0;
    for(const s of bemol_list){st.makeRotationY(s.a).setPosition(s.x,s.y,s.z);for(const o of p.at){lo.makeTranslation(o[0],o[1],o[2]);im.setMatrixAt(k++,m4.multiplyMatrices(st,lo));}}
    im.instanceMatrix.needsUpdate=true;im.castShadow=!!p.shadow;im.receiveShadow=true;im.computeBoundingSphere&&im.computeBoundingSphere();im.frustumCulled=false;scene.add(im);}
}

function bemolUpdate(dt,player,say){
  if(!bemol_list){if(typeof groundY!=='function'||typeof scene==='undefined')return;bemol_build();}
  // nearest station (cheap: 160 points)
  let best=-1,bd=1e9;for(let i=0;i<bemol_list.length;i++){const s=bemol_list[i],d=Math.abs(s.x-player.x)+Math.abs(s.z-player.z);if(d<bd){bd=d;best=i;}}
  if(best<0)return;const s=bemol_list[best],d=Math.hypot(s.x-player.x,s.z-player.z);
  if(bemol_inside<0&&d<BEMOL_NEAR){bemol_inside=best;say('O cofe la Bemol?','Benzinăria Bemol',3,'#ffd400');}
  else if(bemol_inside>=0){const c=bemol_list[bemol_inside];if(Math.hypot(c.x-player.x,c.z-player.z)>BEMOL_FAR)bemol_inside=-1;}}
