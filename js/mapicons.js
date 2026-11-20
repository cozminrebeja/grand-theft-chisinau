'use strict';
// Map icons for places added by other modules (Bemol gas stations, Linella stores), drawn on the minimap and the big map (Tab).
// Called from game.js: hook('mapIcons', ctx, P, 'mini'|'big', opts). P(x,z) -> canvas coords.
const MAPICON_KINDS=[
  {list:()=>typeof bemol_list!=='undefined'?bemol_list:null,bg:'#0a8a43',fg:'#ffd400',ch:'B',name:'Bemoll'},
  {list:()=>typeof linella_list!=='undefined'?linella_list:null,bg:'#e4002b',fg:'#fff',ch:'L',name:'Lenella'},
  {list:()=>typeof APT_ICON!=='undefined'?APT_ICON:null,bg:'#1e5aa8',fg:'#fff',ch:'✈',name:'Aeroport'},
  {list:()=>typeof PH_HOME_ICON!=='undefined'?PH_HOME_ICON:null,bg:'#ff9ecb',fg:'#1a1305',ch:'🏠',name:'Acasă'},
  {list:()=>typeof CC_ICON!=='undefined'?CC_ICON():null,bg:'#f59e0b',fg:'#1a1305',ch:'🔧',name:'Vulcanizare'},
];
function mapicon_draw(g,x,y,r,k,rot,label){
  g.save();g.translate(x,y);if(rot)g.rotate(-rot);
  g.fillStyle=k.bg;g.strokeStyle='#fff';g.lineWidth=Math.max(1.2,r*.22);
  const s=r*1.7;g.beginPath();if(g.roundRect)g.roundRect(-s/2,-s/2,s,s,r*.45);else g.rect(-s/2,-s/2,s,s);g.fill();g.stroke();
  if(r>=4){g.fillStyle=k.fg;g.font=`900 ${Math.round(r*1.25)}px Inter, Arial, sans-serif`;g.textAlign='center';g.textBaseline='middle';g.fillText(k.ch,0,r*.06);}
  if(label){g.font='700 11px Inter';g.lineWidth=3;g.strokeStyle='#000';g.fillStyle='#fff';g.strokeText(k.name,0,-s/2-8);g.fillText(k.name,0,-s/2-8);}
  g.restore();}
function mapIcons(g,P,mode,o){
  for(const k of MAPICON_KINDS){const L=k.list();if(!L)continue;
    if(mode==='mini'){for(const s of L){const [x,y]=P(s.x,s.z);if(x*x+y*y>o.R*o.R)continue;mapicon_draw(g,x,y,5.5,k,o.rot,false);}}
    else{const r=o.sc<.06?2.6:o.sc<.2?4.5:6.5,lab=o.sc>.6;
      for(const s of L){const [x,y]=P(s.x,s.z);if(x<-10||x>o.W+10||y<-10||y>o.H+10)continue;mapicon_draw(g,x,y,r,k,0,lab);}}}
  // legend on the big map
  if(mode==='big'){g.save();g.font='700 12px Inter';g.textAlign='left';g.textBaseline='middle';let y=o.H-40;
    for(const k of MAPICON_KINDS){mapicon_draw(g,22,y,6,k,0,false);g.fillStyle='#fff';g.strokeStyle='#000';g.lineWidth=3;g.strokeText(k.name,36,y);g.fillText(k.name,36,y);y-=20;}g.restore();}
}
