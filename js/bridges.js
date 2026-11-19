'use strict';
// Bridges & tunnels/underpasses. Owner: BRIDGES agent. See TERRAIN.md.
// Data: D.bridges / D.tunnels = [[w, layer, flat dm, kind]] (kind 0 drivable,1 service,2 pedestrian,3 footway,4 rail), from
// Overture road_flags is_bridge / is_tunnel (dev/data/make_bridges.py).
//
// surfaceY(x,z,refY,hx,hz): height of the surface something TRAVELLING ON ROADS/PATHS stands on at x,z:
//   the bridge deck if (x,z) is on a bridge span and the traveller is on it, otherwise groundY(x,z).
//   refY (optional) = the object's current y: if it is well below the deck (> 3 m) the object is passing UNDER → ground.
//   hx,hz (optional) = travel direction: if given, only spans roughly parallel to it count (a road crossing under a bridge
//   at an angle is not on it). With neither refY nor direction, the highest deck at x,z wins.
// onBridge(x,z,hx,hz) → {y, w, side, kind, span, s} for the deck under x,z (deck incl. sidewalks) or null.
// Tunnels: roads in tunnels stay at ground level (no lowered roadway); portals / underpass entrances are rendered.
//
// Deck profile: straight line between the ground heights at the two abutments (surfaceY == groundY exactly at both ends),
// lifted where the ground would poke through (ground + clearance), smoothed; piers every ~24 m where the deck is ≥ 2 m up.

let BR=null;
const BR_STEP=2;      // profile sample spacing (m)
const BR_CELL=24;     // spatial grid cell (m)
function bridgesInit(){
  const empty={spans:[],grid:new Map(),tunnels:[]};
  // profiles depend on the heightmap: never cache before initHeight() has loaded it
  if(typeof D==='undefined'||!D||(D.height&&typeof HM!=='undefined'&&!HM)){BR=null;return empty;}
  BR=empty;
  const dec2=f=>{const o=[];for(let i=0;i<f.length;i+=2)o.push([f[i]*.1,f[i+1]*.1]);return o;};
  for(const [w,layer,flat,kind] of (D.bridges||[])){
    const pts=dec2(flat);if(pts.length<2)continue;
    const cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
    const L=cum[cum.length-1];if(L<1)continue;
    const side=kind===0?(w>=9?2.6:1.8):kind===4?0.8:0.35;   // sidewalk/edge beam each side
    const sp={pts,cum,L,w,side,kind,layer,prof:null,maxDepth:0,i:BR.spans.length};
    br_profile(sp);BR.spans.push(sp);
    // grid
    const pad=w/2+side+1;
    for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1];
      const x0=Math.floor((Math.min(a[0],b[0])-pad)/BR_CELL),x1=Math.floor((Math.max(a[0],b[0])+pad)/BR_CELL);
      const z0=Math.floor((Math.min(a[1],b[1])-pad)/BR_CELL),z1=Math.floor((Math.max(a[1],b[1])+pad)/BR_CELL);
      for(let gx=x0;gx<=x1;gx++)for(let gz=z0;gz<=z1;gz++){const k=gx*100000+gz;let c=BR.grid.get(k);if(!c){c=[];BR.grid.set(k,c);}c.push(sp.i,i);}}
  }
  for(const [w,layer,flat,kind] of (D.tunnels||[])){const pts=dec2(flat);if(pts.length>=2)BR.tunnels.push({pts,w,kind});}
  return BR;
}
// point at distance s along a span
function br_at(sp,s){const P=sp.pts,c=sp.cum;s=s<0?0:s>sp.L?sp.L:s;let i=1;while(i<c.length-1&&c[i]<s)i++;
  const l=c[i]-c[i-1]||1e-9,t=(s-c[i-1])/l;return [P[i-1][0]+(P[i][0]-P[i-1][0])*t,P[i-1][1]+(P[i][1]-P[i-1][1])*t,(P[i][0]-P[i-1][0])/l,(P[i][1]-P[i-1][1])/l];}
function br_profile(sp){
  const n=Math.max(2,Math.ceil(sp.L/BR_STEP)+1),L=sp.L;
  const a=groundY(sp.pts[0][0],sp.pts[0][1]),b=groundY(sp.pts[sp.pts.length-1][0],sp.pts[sp.pts.length-1][1]);
  const g=new Float32Array(n),line=new Float32Array(n);
  let depth=0;
  for(let k=0;k<n;k++){const s=Math.min(L,k*BR_STEP),p=br_at(sp,s);g[k]=groundY(p[0],p[1]);line[k]=a+(b-a)*s/L;depth=Math.max(depth,line[k]-g[k]);}
  // clearance: real bridges (deep) keep their structure depth above ground; culverts barely lift
  const clr=depth>2?1.2:0.15;
  let env=new Float32Array(n);for(let k=0;k<n;k++){const s=Math.min(L,k*BR_STEP);const endFade=Math.min(1,Math.min(s,L-s)/6);env[k]=Math.max(line[k],g[k]+clr*endFade);}
  // smooth (moving average ~16 m) a couple of times, keep ends pinned and stay above ground
  const R=Math.max(1,Math.round(8/BR_STEP));
  for(let it=0;it<3;it++){const o=new Float32Array(n);for(let k=0;k<n;k++){let sum=0,c=0;for(let j=Math.max(0,k-R);j<=Math.min(n-1,k+R);j++){sum+=env[j];c++;}o[k]=sum/c;}
    for(let k=0;k<n;k++){const s=Math.min(L,k*BR_STEP);const endFade=Math.min(1,Math.min(s,L-s)/6);o[k]=Math.max(o[k],line[k],g[k]+clr*endFade);}env=o;}
  env[0]=a;env[n-1]=b;
  sp.prof=env;sp.ground=g;sp.n=n;
  let md=0;for(let k=0;k<n;k++)md=Math.max(md,env[k]-g[k]);sp.maxDepth=md;
}
function br_deck(sp,s){const f=Math.max(0,Math.min(sp.n-1,s/BR_STEP)),i=Math.min(sp.n-2,f|0),u=f-i;return sp.prof[i]*(1-u)+sp.prof[i+1]*u;}
// all decks under (x,z) (within road width + sidewalks)
function br_query(x,z,hx,hz,out){out.length=0;if(!BR&&!bridgesInit().spans.length&&!BR)return out;const c=BR.grid.get(Math.floor(x/BR_CELL)*100000+Math.floor(z/BR_CELL));if(!c)return out;
  for(let q=0;q<c.length;q+=2){const sp=BR.spans[c[q]],i=c[q+1],a=sp.pts[i],b=sp.pts[i+1];
    const dx=b[0]-a[0],dz=b[1]-a[1],l2=dx*dx+dz*dz||1e-9;let t=((x-a[0])*dx+(z-a[1])*dz)/l2;
    // allow a little overshoot at interior joints only
    const lo=i===0?0:-.02,hi=i===sp.pts.length-2?1:1.02;if(t<lo||t>hi)continue;t=t<0?0:t>1?1:t;
    const qx=a[0]+dx*t,qz=a[1]+dz*t,lat=Math.hypot(x-qx,z-qz);if(lat>sp.w/2+sp.side+.25)continue;
    if(hx!=null){const l=Math.sqrt(l2),hl=Math.hypot(hx,hz)||1;if(Math.abs((dx*hx+dz*hz)/(l*hl))<.8)continue;}
    const s=sp.cum[i]+Math.sqrt(l2)*t;out.push({y:br_deck(sp,s),w:sp.w,side:sp.side,kind:sp.kind,span:sp,s,lat});}
  return out;}
const br_tmp=[];
function onBridge(x,z,hx,hz){br_query(x,z,hx,hz,br_tmp);if(!br_tmp.length)return null;let best=br_tmp[0];for(const c of br_tmp)if(c.y>best.y)best=c;return best;}
function surfaceY(x,z,refY,hx,hz){
  const g=groundY(x,z);br_query(x,z,hx,hz,br_tmp);if(!br_tmp.length)return g;
  if(refY==null){let y=-1e9;for(const c of br_tmp)if(c.y>y)y=c.y;return Math.max(y,g);}
  let best=null,bd=1e9;
  for(const c of br_tmp){if(refY<c.y-3)continue;               // well below this deck → passing under it
    const d=Math.abs(c.y-refY);if(d<bd){bd=d;best=c;}}
  return best&&best.y>g-0.05?best.y:g;}

// ---------------- rendering ----------------
const br_mat=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide});
const BR_C={slab:0x9a968e,slabTop:0x45464a,under:0x7d7a74,parapet:0xb3aea4,cap:0xc9c4b9,pier:0x8f8b83,rail:0x2f3236,railT:0x4a6b8a,portal:0x8b877f};
// emit a quad (a,b,c,d in order) with flat normal
function br_quad(B,a,b,c,d,col){_c.set(col);const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=d[0]-a[0],vy=d[1]-a[1],vz=d[2]-a[2];
  let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const l=Math.hypot(nx,ny,nz)||1;nx/=l;ny/=l;nz/=l;
  for(const p of [a,b,c,a,c,d])B.v(p[0],p[1],p[2],nx,ny,nz,_c.r,_c.g,_c.b);}
// a ribbon "wall" along a polyline of [x,y,z] (bottom) with height h (both faces) — used for parapets
function br_wall(B,P,h,th,col,capCol){for(let i=0;i<P.length-1;i++){const a=P[i],b=P[i+1];const dx=b[0]-a[0],dz=b[2]-a[2],l=Math.hypot(dx,dz)||1,nx=-dz/l*th/2,nz=dx/l*th/2;
  const a0=[a[0]+nx,a[1],a[2]+nz],b0=[b[0]+nx,b[1],b[2]+nz],a1=[a[0]-nx,a[1],a[2]-nz],b1=[b[0]-nx,b[1],b[2]-nz];
  const up=p=>[p[0],p[1]+h,p[2]];
  br_quad(B,a0,b0,up(b0),up(a0),col);br_quad(B,b1,a1,up(a1),up(b1),col);br_quad(B,up(a0),up(b0),up(b1),up(a1),capCol);}}
function br_box(B,cx,cy,cz,w,h,d,ry,col){B.add(BOX(w,h,d),M(cx,cy,cz,ry),col);}
// per-tile build: spans/pieces whose sample midpoints fall inside the tile (seams between tiles meet exactly)
function buildBridgesTile(t){
  if(!BR)bridgesInit();if(!BR||(!BR.spans.length&&!BR.tunnels.length))return;
  const B=new Bk(br_mat,false);let any=false;
  const inTile=(x,z)=>x>=t.x0&&x<t.x1&&z>=t.z0&&z<t.z1;
  for(const sp of BR.spans){
    // quick bbox reject
    let mnx=1e9,mxx=-1e9,mnz=1e9,mxz=-1e9;for(const p of sp.pts){if(p[0]<mnx)mnx=p[0];if(p[0]>mxx)mxx=p[0];if(p[1]<mnz)mnz=p[1];if(p[1]>mxz)mxz=p[1];}
    if(mxx<t.x0-1||mnx>t.x1+1||mxz<t.z0-1||mnz>t.z1+1)continue;
    const deep=sp.maxDepth>=2, half=sp.w/2+sp.side, foot=sp.kind>=3, th=deep?(sp.L>60?1.5:1.0):0.45;
    const n=sp.n;
    for(let k=0;k<n-1;k++){
      const s0=Math.min(sp.L,k*BR_STEP),s1=Math.min(sp.L,(k+1)*BR_STEP);if(s1-s0<1e-3)continue;
      const pm=br_at(sp,(s0+s1)/2);if(!inTile(pm[0],pm[1]))continue;any=true;
      const p0=br_at(sp,s0),p1=br_at(sp,s1);
      // miter-free: use the segment direction of each end (continuous at shared samples because br_at uses the same point)
      const y0=sp.prof[k],y1=sp.prof[k+1];
      const nx0=-p0[3]*half,nz0=p0[2]*half,nx1=-p1[3]*half,nz1=p1[2]*half;
      const L0=[p0[0]+nx0,y0-.03,p0[1]+nz0],R0=[p0[0]-nx0,y0-.03,p0[1]-nz0],L1=[p1[0]+nx1,y1-.03,p1[1]+nz1],R1=[p1[0]-nx1,y1-.03,p1[1]-nz1];
      const dn=p=>[p[0],p[1]-th,p[2]];
      // deck top (asphalt colour, below the road surface STREETS draws), sides, underside
      br_quad(B,L0,R0,R1,L1,BR_C.slabTop);
      if(deep||sp.maxDepth>.6){br_quad(B,dn(L0),L0,L1,dn(L1),BR_C.slab);br_quad(B,R0,dn(R0),dn(R1),R1,BR_C.slab);br_quad(B,dn(R0),dn(L0),dn(L1),dn(R1),BR_C.under);}
      // parapets / railings on both edges
      for(const sd of [1,-1]){const a=sd>0?L0:R0,b=sd>0?L1:R1;
        if(foot||sp.kind===4){ // metal railing: top rail + post
          const ra=[a[0],a[1]+1.0,a[2]],rb=[b[0],b[1]+1.0,b[2]];br_wall(B,[ra,rb],.06,.06,BR_C.railT,BR_C.railT);
          br_wall(B,[[a[0],a[1]+.45,a[2]],[b[0],b[1]+.45,b[2]]],.04,.04,BR_C.rail,BR_C.rail);
          if(k%1===0)br_box(B,a[0],a[1]+.5,a[2],.07,1.0,.07,0,BR_C.rail);
        }else{br_wall(B,[a,b],0.95,0.3,BR_C.parapet,BR_C.cap);}
      }
      // girders under long deep decks
      if(deep&&sp.L>40&&!foot){for(const f of [-.55,0,.55]){const g0=[p0[0]+nx0*f,y0-th,p0[1]+nz0*f],g1=[p1[0]+nx1*f,y1-th,p1[1]+nz1*f];
        const gw=.5,dx=g1[0]-g0[0],dz=g1[2]-g0[2],l=Math.hypot(dx,dz)||1,ox=-dz/l*gw/2,oz=dx/l*gw/2;
        const a=[g0[0]+ox,g0[1],g0[2]+oz],b=[g1[0]+ox,g1[1],g1[2]+oz],c=[g1[0]-ox,g1[1],g1[2]-oz],d=[g0[0]-ox,g0[1],g0[2]-oz];const dd=p=>[p[0],p[1]-.7,p[2]];
        br_quad(B,dd(a),a,b,dd(b),BR_C.under);br_quad(B,c,d,dd(d),dd(c),BR_C.under);br_quad(B,dd(d),dd(a),dd(b),dd(c),BR_C.under);}}
    }
    // piers every ~24 m where the deck is up high enough (positions by distance along span → deterministic, seam-safe)
    if(deep){const pitch=sp.L>200?30:24,np=Math.max(1,Math.floor(sp.L/pitch));
      for(let q=1;q<=np;q++){const s=sp.L*q/(np+1);const p=br_at(sp,s);if(!inTile(p[0],p[1]))continue;
        const yd=br_deck(sp,s)-th-(sp.L>40&&!foot?.7:0),g=groundY(p[0],p[1])-.5,hgt=yd-g;if(hgt<1.6)continue;any=true;
        const ang=Math.atan2(p[2],p[3]);const cols=foot?[0]:half>5?[-.6,.6]:[0];
        for(const f of cols){const cx=p[0]-p[3]*half*f,cz=p[1]+p[2]*half*f;
          B.add(CYL(foot?.25:.65,foot?.25:.75,hgt,foot?8:12),M(cx,g+hgt/2,cz,0),BR_C.pier);}
        if(!foot)br_box(B,p[0],yd-.45,p[1],(half*2)*.95,.9,1.6,ang,BR_C.pier);  // pier cap beam across
      }}
    // abutment walls where an end of a deep span meets the ground
    if(deep&&!foot)for(const s of [0,sp.L]){const p=br_at(sp,s);if(!inTile(p[0],p[1]))continue;any=true;
      const y=br_deck(sp,s);br_box(B,p[0],y-1.4,p[1],half*2+.6,2.8,1.4,Math.atan2(p[2],p[3]),BR_C.pier);}
  }
  // tunnel / underpass portals (roads stay at ground; pedestrian underpasses get a stair-pit parapet, road tunnels a portal frame)
  for(const tn of BR.tunnels){if(tn.kind===1)continue;   // service tunnels are passages through buildings
    for(const e of [0,1]){const P=tn.pts,a=e?P[P.length-1]:P[0],b=e?P[P.length-2]:P[1];if(!inTile(a[0],a[1]))continue;any=true;
      const dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz)||1,ux=dx/l,uz=dz/l,ang=Math.atan2(ux,uz),y=groundY(a[0],a[1]);
      if(tn.kind===3){const w=tn.w+1.2,len=6;const cx=a[0]-ux*len/2,cz=a[1]-uz*len/2;   // pit outline behind the entrance
        for(const sd of [-1,1])br_box(B,cx-uz*w/2*sd,y+.5,cz+ux*w/2*sd,.25,1.0,len,ang,BR_C.parapet);
        br_box(B,cx-ux*len/2,y+.5,cz-uz*len/2,w,1.0,.25,ang,BR_C.parapet);
        for(const sd of [-1,1])br_box(B,cx-uz*w/2*sd,y+1.05,cz+ux*w/2*sd,.08,.08,len,ang,BR_C.rail);}
      else{const w=tn.w+1.6;br_box(B,a[0],y+5.4,a[1],w+1.2,1.2,1.2,ang,BR_C.portal);
        for(const sd of [-1,1])br_box(B,a[0]-uz*(w/2+.3)*sd,y+2.4,a[1]+ux*(w/2+.3)*sd,.6,4.8,1.2,ang,BR_C.portal);}
    }}
  if(!any)return;
  const m=B.mesh();m.castShadow=true;m.receiveShadow=true;m.name='bridges_'+t.key;t.group.add(m);
}
function bridgesUnloadTile(t){}
