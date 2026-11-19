'use strict';
// Road graph, lane agents, A*. Owner: integrator/gameplay.
let nodePos=[],adj=new Map(),edges=[],wiredEdges=[];const segEdge=new Map();
// spatial index of graph edges (by edge midpoint) so spawning/lookup stays O(local) on a city-wide graph
const EG=250,egrid=new Map();
function egAdd(e){const k=gk(Math.floor(e.mid[0]/EG),Math.floor(e.mid[1]/EG));let c=egrid.get(k);if(!c){c=[];egrid.set(k,c);}c.push(e);}
function buildGraph(){
for(const r of roads){if(r.kind!==0||!r.ids)continue;let start=0;
  for(let i=0;i<r.pts.length;i++){const id=r.ids[i];if(id>=0)nodePos[id]=r.pts[i];
    if(i>0&&id>=0){const pts=r.pts.slice(start,i+1);let len=0;for(let k=0;k<pts.length-1;k++)len+=Math.hypot(pts[k+1][0]-pts[k][0],pts[k+1][1]-pts[k][1]);
      if(len>0.5){const e={i:edges.length,a:r.ids[start],b:id,pts,w:r.w,ow:r.ow,tw:r.tw,name:r.name,len,mid:pts[Math.floor(pts.length/2)],cache:{}};
        e.nPer=e.ow?Math.max(1,Math.round(e.w/3.3)):Math.max(1,Math.floor(e.w/2/3.0));e.vmax=e.w>=11?17:e.w>=7.5?13.5:9.5;edges.push(e);
        for(const n of [e.a,e.b]){let l=adj.get(n);if(!l){l=[];adj.set(n,l);}l.push(e);}}
      start=i;}}}
wiredEdges=edges.filter(e=>e.tw);
for(const e of edges)egAdd(e);
}
function laneOff(e,kind,k){if(kind==='ped')return e.w/2+2.3;const n=e.nPer;
  if(kind==='trolley')k=n-1;return e.ow?-e.w/2+(k+.5)*e.w/n:(k+.5)*(e.w/2)/n;}
function edgePath(e,dir,off){const key=dir+'_'+off.toFixed(2);if(e.cache[key])return e.cache[key];
  const P=dir>0?e.pts:e.pts.slice().reverse();const n=P.length,out=[];
  for(let i=0;i<n;i++){let nx=0,nz=0;
    if(i>0){const dx=P[i][0]-P[i-1][0],dz=P[i][1]-P[i-1][1],l=Math.hypot(dx,dz)||1;nx+=-dz/l;nz+=dx/l;}
    if(i<n-1){const dx=P[i+1][0]-P[i][0],dz=P[i+1][1]-P[i][1],l=Math.hypot(dx,dz)||1;nx+=-dz/l;nz+=dx/l;}
    const l=Math.hypot(nx,nz)||1;out.push([P[i][0]+nx/l*off,P[i][1]+nz/l*off]);}
  return e.cache[key]=out;}
const edgeDir=(e,dir,end)=>{const P=e.pts,n=P.length;let a,b;if(dir>0){a=end?P[n-2]:P[0];b=end?P[n-1]:P[1];}else{a=end?P[1]:P[n-1];b=end?P[0]:P[n-2];}const dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz)||1;return [dx/l,dz/l];};
function chooseNext(a){const e=a.e,node=a.dir>0?e.b:e.a;const L=adj.get(node)||[];const [ix,iz]=edgeDir(e,a.dir,true);const c=[];
  for(const f of L){for(const d of [1,-1]){if((d>0?f.a:f.b)!==node)continue;if(a.kind!=='ped'&&((d>0&&f.ow===-1)||(d<0&&f.ow===1)))continue;
    if(a.kind==='trolley'&&!f.tw)continue;const back=f===e;const [ox,oz]=edgeDir(f,d,false);const cos=ix*ox+iz*oz;
    let w=back?(a.kind==='ped'?.15:0.0001):0.25+Math.max(0,cos)*2+(cos>.9?1:0);if(a.kind!=='ped'&&f.w<6&&e.w>8)w*=.3;c.push({e:f,dir:d,w,cos});}}
  if(!c.length&&a.kind==='trolley'&&!e.ow)return {e,dir:-a.dir,w:1,cos:-1};
  if(!c.length)return null;let tot=0;for(const o of c)tot+=o.w;let r=Math.random()*tot;for(const o of c){r-=o.w;if(r<=0)return o;}return c[0];}
function enterEdge(a,e,dir){a.e=e;a.dir=dir;if(a.kind==='car'){const n=e.tw&&e.nPer>1?e.nPer-1:e.nPer;a.k=a.k==null?Math.floor(Math.random()*n):Math.min(a.k,n-1);}else a.k=0;
  const P=edgePath(e,dir,laneOff(e,a.kind,a.k));a.path=[[a.x,a.z],...P];a.seg=0;a.next=chooseNext(a);a.turn=a.next?Math.acos(clamp(a.next.cos,-1,1)):0;a.rem=e.len+2;}
function placeAgent(a,e,dir,frac){a.e=e;a.dir=dir;a.k=a.kind==='car'?Math.floor(Math.random()*e.nPer):0;const P=edgePath(e,dir,laneOff(e,a.kind,a.k));
  const s=Math.min(P.length-2,Math.floor(frac*(P.length-1)));const t=Math.random();a.x=P[s][0]+(P[s+1][0]-P[s][0])*t;a.z=P[s][1]+(P[s+1][1]-P[s][1])*t;
  a.path=P;a.seg=s;a.next=chooseNext(a);a.turn=a.next?Math.acos(clamp(a.next.cos,-1,1)):0;a.rem=e.len*(1-frac);
  const dx=P[s+1][0]-P[s][0],dz=P[s+1][1]-P[s][1],l=Math.hypot(dx,dz)||1;a.hx=dx/l;a.hz=dz/l;}
function agentStep(a,d){let guard=0;a.rem-=d;
  while(d>1e-6&&guard++<40){const t=a.path[a.seg+1];
    if(!t){const n=a.next;if(!n){a.dead=true;return;}enterEdge(a,n.e,n.dir);continue;}
    const dx=t[0]-a.x,dz=t[1]-a.z,l=Math.hypot(dx,dz);if(l<1e-4){a.seg++;continue;}a.hx=dx/l;a.hz=dz/l;
    if(d<l){a.x+=a.hx*d;a.z+=a.hz*d;d=0;}else{a.x=t[0];a.z=t[1];d-=l;a.seg++;}}}
// random graph edge whose midpoint is dmin..dmax from (px,pz), inside a ready (streamed-in) tile. list: edges | wiredEdges | any array
function randEdgeNear(px,pz,dmin,dmax,list=edges,tries=80){
  if(list!==edges&&list!==wiredEdges){for(let t=0;t<tries;t++){const e=list[Math.floor(Math.random()*list.length)];const d=Math.hypot(e.mid[0]-px,e.mid[1]-pz);if(d>=dmin&&d<=dmax&&e.len>8&&worldReadyAt(e.mid[0],e.mid[1]))return e;}return null;}
  const wired=list===wiredEdges,cand=[];
  for(let i=Math.floor((px-dmax)/EG);i<=Math.floor((px+dmax)/EG);i++)for(let j=Math.floor((pz-dmax)/EG);j<=Math.floor((pz+dmax)/EG);j++){
    const cx=(i+.5)*EG-px,cz=(j+.5)*EG-pz,cd=Math.hypot(cx,cz);if(cd>dmax+EG*.71||cd<dmin-EG*.71)continue;const c=egrid.get(gk(i,j));if(!c)continue;
    for(const e of c){if(wired&&!e.tw)continue;cand.push(e);}}
  for(let t=0;t<tries&&cand.length;t++){const e=cand[Math.floor(Math.random()*cand.length)];const d=Math.hypot(e.mid[0]-px,e.mid[1]-pz);if(d>=dmin&&d<=dmax&&e.len>8&&worldReadyAt(e.mid[0],e.mid[1]))return e;}
  return null;}
function dirsFor(e,kind){const ds=[];if(kind==='ped'||e.ow!==-1)ds.push(1);if(kind==='ped'||e.ow!==1)ds.push(-1);return ds;}
// nearest graph node to (x,z) within ~maxd (via the edge grid)
function nodeNear(x,z,maxd=160){let best=null,bd=maxd*maxd;
  for(let i=Math.floor((x-maxd)/EG);i<=Math.floor((x+maxd)/EG);i++)for(let j=Math.floor((z-maxd)/EG);j<=Math.floor((z+maxd)/EG);j++){const c=egrid.get(gk(i,j));if(!c)continue;
    for(const e of c)for(const n of[e.a,e.b]){const p=nodePos[n],d=(p[0]-x)**2+(p[1]-z)**2;if(d<bd){bd=d;best=n;}}}
  return best;}
// A* (binary heap), bounded: max expansions + nodes must stay within (start-goal distance + slack) of the goal
function astar(s,g,maxExp=12000){if(s==null||g==null)return null;if(s===g)return [g];const gp=nodePos[g],sp=nodePos[s];const lim=Math.hypot(sp[0]-gp[0],sp[1]-gp[1])+600;
  const gs=new Map([[s,0]]),came=new Map(),closed=new Set();const H=[],hp=(f,n)=>{H.push([f,n]);let i=H.length-1;while(i>0){const p=(i-1)>>1;if(H[p][0]<=H[i][0])break;[H[p],H[i]]=[H[i],H[p]];i=p;}};
  const pop=()=>{const top=H[0],last=H.pop();if(H.length){H[0]=last;let i=0;for(;;){const l=2*i+1,r=l+1;let m=i;if(l<H.length&&H[l][0]<H[m][0])m=l;if(r<H.length&&H[r][0]<H[m][0])m=r;if(m===i)break;[H[m],H[i]]=[H[i],H[m]];i=m;}}return top;};
  hp(0,s);let it=0;
  while(H.length&&it++<maxExp){const [,n]=pop();if(n===g){const path=[n];let c=n;while(came.has(c)){c=came.get(c);path.push(c);}return path.reverse();}
    if(closed.has(n))continue;closed.add(n);
    for(const e of adj.get(n)||[]){const m=e.a===n?e.b:e.a;if(closed.has(m))continue;const p=nodePos[m],h=Math.hypot(p[0]-gp[0],p[1]-gp[1]);if(h>lim)continue;const ng=gs.get(n)+e.len;
      if(ng<(gs.has(m)?gs.get(m):1e18)){gs.set(m,ng);came.set(m,n);hp(ng+h,m);}}}
  return null;}

