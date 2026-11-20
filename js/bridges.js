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
  const SPEC=D.bridge_spec||{};
  (D.bridges||[]).forEach(([w,layer,flat,kind],bi)=>{
    const pts=dec2(flat);if(pts.length<2)return;
    const cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
    const L=cum[cum.length-1];if(L<1)return;
    const side=kind===0?(w>=9?2.6:1.8):kind===4?0.8:0.35;   // sidewalk/edge beam each side
    const sp={pts,cum,L,w,side,kind,layer,prof:null,maxDepth:0,i:BR.spans.length,spec:SPEC[bi]||null};
    br_profile(sp);BR.spans.push(sp);
    // grid
    const pad=w/2+side+1;
    for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1];
      const x0=Math.floor((Math.min(a[0],b[0])-pad)/BR_CELL),x1=Math.floor((Math.max(a[0],b[0])+pad)/BR_CELL);
      const z0=Math.floor((Math.min(a[1],b[1])-pad)/BR_CELL),z1=Math.floor((Math.max(a[1],b[1])+pad)/BR_CELL);
      for(let gx=x0;gx<=x1;gx++)for(let gz=z0;gz<=z1;gz++){const k=gx*100000+gz;let c=BR.grid.get(k);if(!c){c=[];BR.grid.set(k,c);}c.push(sp.i,i);}}
  });
  for(const [w,layer,flat,kind] of (D.tunnels||[])){const pts=dec2(flat);if(pts.length>=2)BR.tunnels.push({pts,w,kind});}
  return BR;
}
// point at distance s along a span
function br_at(sp,s){const P=sp.pts,c=sp.cum;s=s<0?0:s>sp.L?sp.L:s;let i=1;while(i<c.length-1&&c[i]<s)i++;
  const l=c[i]-c[i-1]||1e-9,t=(s-c[i-1])/l;return [P[i-1][0]+(P[i][0]-P[i-1][0])*t,P[i-1][1]+(P[i][1]-P[i-1][1])*t,(P[i][0]-P[i-1][0])/l,(P[i][1]-P[i-1][1])/l];}
// distance along a span of the point nearest to (x,z)
function br_project(sp,x,z){let best=1e18,bs=0;const P=sp.pts;for(let i=0;i<P.length-1;i++){const a=P[i],b=P[i+1],dx=b[0]-a[0],dz=b[1]-a[1],l2=dx*dx+dz*dz||1e-9;
  let t=((x-a[0])*dx+(z-a[1])*dz)/l2;t=t<0?0:t>1?1:t;const d=(a[0]+dx*t-x)**2+(a[1]+dz*t-z)**2;if(d<best){best=d;bs=sp.cum[i]+Math.sqrt(l2)*t;}}return bs;}
function br_profile(sp){
  const n=Math.max(2,Math.ceil(sp.L/BR_STEP)+1),L=sp.L;
  // audited deck (tools/data/bridges → world.json bridge_spec): piecewise-linear surface height through the measured points
  const dk=sp.spec&&sp.spec.deck;
  if(dk&&dk.length>=2){const ctl=dk.map(p=>[br_project(sp,p[0]*WS,p[1]*WS),p[2]*WS]).sort((a,b)=>a[0]-b[0]);
    const prof=new Float32Array(n),g=new Float32Array(n);let md=0;
    for(let k=0;k<n;k++){const s=Math.min(L,k*BR_STEP),p=br_at(sp,s);g[k]=groundY(p[0],p[1]);let j=1;while(j<ctl.length-1&&ctl[j][0]<s)j++;
      const a=ctl[j-1],b=ctl[j],t=b[0]>a[0]?Math.min(1,Math.max(0,(s-a[0])/(b[0]-a[0]))):0;prof[k]=a[1]+(b[1]-a[1])*t;md=Math.max(md,prof[k]-g[k]);}
    const st=sp.spec.structure||{};sp.prof=prof;sp.ground=g;sp.n=n;sp.maxDepth=md;sp.th=st.deck_depth||null;
    sp.piers=(st.piers||[]).map(p=>br_project(sp,p[0]*WS,p[1]*WS)).filter(s=>s>1&&s<L-1);sp.pierType=st.pier_type||null;
    sp.railing=st.railing||null;return;}
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
// a pier would stand on a road passing under the span (crossing, not parallel)?
function br_onUnderRoad(p){if(typeof nearestSeg!=='function')return false;const ns=nearestSeg(p[0],p[1],25,q=>{if(!q.r||q.r.kind===3)return false;const dx=q.b[0]-q.a[0],dz=q.b[1]-q.a[1],l=Math.hypot(dx,dz)||1;return Math.abs((dx*p[2]+dz*p[3])/l)<.75;});return !!ns&&ns.d<ns.s.r.w/2+1.2;}
function br_box(B,cx,cy,cz,w,h,d,ry,col){B.add(BOX(w,h,d),M(cx,cy,cz,ry),col);}
// per-tile build: spans/pieces whose sample midpoints fall inside the tile (seams between tiles meet exactly)
function buildBridgesTile(t){
  if(t.lod!=='far')try{buildRiversTile(t);}catch(e){console.error('rivers',e);}
  if(!BR)bridgesInit();if(!BR||(!BR.spans.length&&!BR.tunnels.length))return;
  const B=new Bk(br_mat,false);let any=false;
  const inTile=(x,z)=>x>=t.x0&&x<t.x1&&z>=t.z0&&z<t.z1;
  for(const sp of BR.spans){
    // quick bbox reject
    let mnx=1e9,mxx=-1e9,mnz=1e9,mxz=-1e9;for(const p of sp.pts){if(p[0]<mnx)mnx=p[0];if(p[0]>mxx)mxx=p[0];if(p[1]<mnz)mnz=p[1];if(p[1]>mxz)mxz=p[1];}
    if(mxx<t.x0-1||mnx>t.x1+1||mxz<t.z0-1||mnz>t.z1+1)continue;
    const deep=sp.maxDepth>=2, half=sp.w/2+sp.side, foot=sp.kind>=3, th=sp.th||(deep?(sp.L>60?1.5:1.0):0.45);
    const metal=foot||sp.kind===4||sp.railing==='metal';
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
        if(metal){ // metal railing: top rail + post
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
      const PS=sp.piers?sp.piers:Array.from({length:np},(_,q)=>sp.L*(q+1)/(np+1));   // audited pier positions win
      for(const s of PS){const p=br_at(sp,s);if(!inTile(p[0],p[1]))continue;
        const yd=br_deck(sp,s)-th-(sp.L>40&&!foot?.7:0),g=groundY(p[0],p[1])-.5,hgt=yd-g;if(hgt<1.6||(!sp.piers&&br_onUnderRoad(p)))continue;any=true;   // no generated pier on a road passing under
        const ang=Math.atan2(p[2],p[3]);
        if(sp.pierType==='wall'&&!foot){br_box(B,p[0],g+hgt/2,p[1],half*2*.85,hgt,1.2,ang,BR_C.pier);br_box(B,p[0],yd-.45,p[1],(half*2)*.95,.9,1.6,ang,BR_C.pier);continue;}
        const cols=foot?[0]:sp.pierType==='single_column'?[0]:sp.pierType==='twin_column'||half>5?[-.6,.6]:[0];
        for(const f of cols){const cx=p[0]-p[3]*half*f,cz=p[1]+p[2]*half*f;
          B.add(CYL(foot?.25:.65,foot?.25:.75,hgt,foot?8:12),M(cx,g+hgt/2,cz,0),BR_C.pier);}
        if(!foot)br_box(B,p[0],yd-.45,p[1],(half*2)*.95,.9,1.6,ang,BR_C.pier);  // pier cap beam across
      }}
    // abutment walls where an end of a deep span meets the ground
    if(deep&&!foot)for(const s of [0,sp.L]){const p=br_at(sp,s);if(!inTile(p[0],p[1]))continue;any=true;
      const y=br_deck(sp,s),e=s?-1:1,g=Math.min(groundY(p[0],p[1]),groundY(p[0]+p[2]*e*2,p[1]+p[3]*e*2))-.5,h=Math.max(2.8,y-g);   // down to the ground under the span end
      br_box(B,p[0],y-h/2,p[1],half*2+.6,h,1.4,Math.atan2(p[2],p[3]),BR_C.pier);}
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
  // retaining walls along embankments / cuttings (world.json walls[], tools/make_earthworks.py): concrete face from the
  // natural ground (DEM) to the earthwork top, on both edges; segments belong to the tile holding their midpoint
  for(const wl of (D.walls||[])){const L=wl.line;for(let i=0;i<L.length-1;i++){const a=L[i],b=L[i+1];
    const n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/4));
    for(let k=0;k<n;k++){const t0=k/n,t1=(k+1)/n,mx=a[0]+(b[0]-a[0])*(t0+t1)/2*WS,mz=a[1]+(b[1]-a[1])*(t0+t1)/2*WS;if(!inTile(mx,mz))continue;any=true;
      const P0=[(a[0]+(b[0]-a[0])*t0)*WS,(a[1]+(b[1]-a[1])*t0)*WS,(a[2]+(b[2]-a[2])*t0)*WS],P1=[(a[0]+(b[0]-a[0])*t1)*WS,(a[1]+(b[1]-a[1])*t1)*WS,(a[2]+(b[2]-a[2])*t1)*WS];
      const dx=P1[0]-P0[0],dz=P1[1]-P0[1],l=Math.hypot(dx,dz)||1,ox=-dz/l*wl.half*WS,oz=dx/l*wl.half*WS;
      for(const sd of [1,-1]){const q0=[P0[0]+ox*sd,P0[1]+oz*sd],q1=[P1[0]+ox*sd,P1[1]+oz*sd];
        const d0=groundDemY(q0[0],q0[1]),d1=groundDemY(q1[0],q1[1]);
        const lo0=Math.min(d0,P0[2])-.5,lo1=Math.min(d1,P1[2])-.5,hi0=Math.max(d0,P0[2])+(wl.cut?.3:1.0),hi1=Math.max(d1,P1[2])+(wl.cut?.3:1.0);
        br_quad(B,[q0[0],lo0,q0[1]],[q1[0],lo1,q1[1]],[q1[0],hi1,q1[1]],[q0[0],hi0,q0[1]],BR_C.parapet);}}}}
  if(!any)return;
  const m=B.mesh();m.castShadow=true;m.receiveShadow=true;m.name='bridges_'+t.key;t.group.add(m);
}
function bridgesUnloadTile(t){}

// ================= river channels (Bîc): concrete trapezoid + water + rim coping + railing =================
// The cut itself lives in groundY (mapcore rv_*); this draws the lining exactly on that profile.
const RVC={bed:0x4a4a40,bank:0x8e8a82,grass:0x6a7d3a,wall:0xb5ab98,floor:0x6a6a66,cope:0xb0ada4,rail:0x2f3236};
let rv_sm=null,rv_wmat=null;
function rv_samples(){if(rv_sm)return rv_sm;rv_sm=[];if(typeof rv_init!=='function')return rv_sm;if(!RV)rv_init();
  // sample = [x,z,nx,nz,water y,depth,rim half-width,slope run,bed y] every ~4 m along each LINED audited channel
  for(const L of RV.lines){if(!L.lined)continue;const P=L.pts,S=[],li=(A,i,u)=>A[i]+(A[i+1]-A[i])*u;
    for(let i=0;i<P.length-1;i++){const a=P[i],b=P[i+1],l=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.ceil(l/4));
      for(let k=0;k<n;k++){const u=k/n,bed=li(L.bed,i,u);S.push([a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u,0,0,bed+L.wd,li(L.dep,i,u),li(L.hw,i,u),li(L.run,i,u),bed]);}}
    const j=P.length-1;S.push([P[j][0],P[j][1],0,0,L.bed[j]+L.wd,L.dep[j],L.hw[j],L.run[j],L.bed[j]]);
    // unit left normal from central differences
    for(let i=0;i<S.length;i++){const a=S[Math.max(0,i-1)],b=S[Math.min(S.length-1,i+1)],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz)||1;S[i][2]=-dz/l;S[i][3]=dx/l;}
    rv_sm.push({water:L.water,S});}
  return rv_sm;}
function buildRiversTile(t){const LS=rv_samples();if(!LS.length)return;
  const B=new Bk(br_mat,false),Wb=new Bk(rv_wmat||(rv_wmat=new THREE.MeshPhongMaterial({color:0x3b4232,specular:0x3a4436,shininess:40})),false);let any=false,anyW=false;
  const inTile=(x,z)=>x>=t.x0&&x<t.x1&&z>=t.z0&&z<t.z1;
  const roadAt=(x,z,m)=>{if(typeof nearestSeg!=='function')return false;const ns=nearestSeg(x,z,30,s=>s.r&&s.r.kind!==3);return ns&&ns.d<ns.s.r.w/2+m;};
  for(const {water,S} of LS){
    const cols=water?[RVC.cope,RVC.cope,RVC.bank,RVC.bed,RVC.bank,RVC.cope,RVC.cope]:[RVC.cope,RVC.cope,RVC.wall,RVC.floor,RVC.wall,RVC.cope,RVC.cope];
    // cross-section on the audited profile: coping on natural ground at the rim, lining down the slope to the bed
    const sec=p=>{const hw=p[6],hb=Math.max(.5,p[6]-p[7]),bed=p[8]-(water?0:.12);return [[hw+1.4,.12],[hw,.12],[hw,0],[hb,null],[-hb,null],[-hw,0],[-hw,.12],[-hw-1.4,.12]].map(([o,dy])=>{const x=p[0]+p[2]*o,z=p[1]+p[3]*o;return [x,dy===null?bed:hmY(x,z)+dy,z];});};
    let prev=null,prevP=null;
    for(let i=0;i<S.length;i++){const p=S[i],cur=sec(p);
      if(prev){const mx=(p[0]+prevP[0])/2,mz=(p[1]+prevP[1])/2,dep=(p[5]+prevP[5])/2;
        if(inTile(mx,mz)&&dep>.05){any=true;const road=roadAt(mx,mz,2.5),rim=dep>.6&&!(water&&road);
          // a wet canal (the Bîc) has slabs only on the bank away from the road beside it; that bank is grass and
          // shrubs, with no coping (Albișoara runs along the SW rim at Podul Circului, photo + 2020 ortho)
          const off=(prevP[6]+p[6])/2+1.5,rdP=water&&roadAt(mx+prevP[2]*off,mz+prevP[3]*off,2),rdN=water&&roadAt(mx-prevP[2]*off,mz-prevP[3]*off,2);
          for(let k=0;k<7;k++){if(!rim&&(k<2||k>4))continue;if(!water&&k===3&&dep<.3)continue;
            if((rdP&&k<2)||(rdN&&k>4))continue;
            const a=prev[k],b=prev[k+1],c=cur[k+1],d=cur[k];br_quad(B,a,d,c,b,(rdP&&k===2)||(rdN&&k===4)?RVC.grass:cols[k]);}
          if(water){anyW=true;const wl0=prevP[4],wl1=p[4];   // waterline sits up the slope by water depth × slope
            const ww=P=>Math.max(.5,P[6]-P[7])+(P[5]>.05?(P[4]-P[8])/P[5]*P[7]:0),w0=ww(prevP),w1=ww(p),q=(P,o,y)=>[P[0]+P[2]*o,y,P[1]+P[3]*o];
            br_quad(Wb,q(prevP,w0,wl0),q(p,w1,wl1),q(p,-w1,wl1),q(prevP,-w0,wl0),0xffffff);}
          // railings along both rims of dry channels only: none along the Bîc canal in photos
          if(rim&&!water)for(const sd of [1,-1]){const o=sd*((prevP[6]+p[6])/2+1.0),a=[prevP[0]+prevP[2]*o,0,prevP[1]+prevP[3]*o],b=[p[0]+p[2]*o,0,p[1]+p[3]*o];
            if(!water&&roadAt((a[0]+b[0])/2,(a[2]+b[2])/2,.5))continue;
            a[1]=hmY(a[0],a[2])+.12;b[1]=hmY(b[0],b[2])+.12;
            br_wall(B,[[a[0],a[1]+1.0,a[2]],[b[0],b[1]+1.0,b[2]]],.07,.07,RVC.rail,RVC.rail);br_wall(B,[[a[0],a[1]+.5,a[2]],[b[0],b[1]+.5,b[2]]],.04,.04,RVC.rail,RVC.rail);
            if(i%2===0)br_box(B,a[0],a[1]+.53,a[2],.08,1.06,.08,0,RVC.rail);}
        }}
      prev=cur;prevP=p;}}
  if(!any)return;
  const m=B.mesh();m.receiveShadow=true;m.name='river_'+t.key;t.group.add(m);
  if(!anyW)return;const w=Wb.mesh();w.name='riverw_'+t.key;if(rv_wmat===st_waterMat&&typeof st_waterUni!=='undefined')w.onBeforeRender=()=>{st_waterUni.uTime.value=performance.now()/1000;};t.group.add(w);
}
