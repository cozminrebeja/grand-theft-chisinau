'use strict';
// Shared utilities + merged-geometry builder (Bk). Owner: integrator.
// ================= utils =================
const TAU=Math.PI*2;
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const angDiff=(t,c)=>{let d=t-c;while(d>Math.PI)d-=TAU;while(d<-Math.PI)d+=TAU;return d;};
const lerpAng=(c,t,k)=>c+angDiff(t,c)*k;
let seed=1919;const R=()=>{seed=(seed*16807)%2147483647;return (seed-1)/2147483646;};
const rr=(a,b)=>a+R()*(b-a), pick=a=>a[Math.floor(R()*a.length)];
const mr=(a,b)=>a+Math.random()*(b-a), mpick=a=>a[Math.floor(Math.random()*a.length)];
// graphics quality: ?q=ultra|high|med (default high)
const GTC_Q=((/[?&]q=(ultra|high|med)/.exec(location.search)||/^#(ultra|high|med)$/.exec(location.hash)||[0,''])[1])||(()=>{try{return localStorage.getItem('gtc_q')}catch(e){return null}})()||'high';
{const qs=document.getElementById('qsel');if(qs){qs.querySelectorAll('button').forEach(b=>{b.classList.toggle('on',b.dataset.q===GTC_Q);b.addEventListener('click',()=>{try{localStorage.setItem('gtc_q',b.dataset.q)}catch(e){}location.hash=b.dataset.q;location.reload();});});}}
const isTouch=('ontouchstart' in window)||matchMedia('(pointer:coarse)').matches;
const $=id=>document.getElementById(id);
const playBtn=$('play');
const progress=t=>{playBtn.textContent=t;return new Promise(r=>setTimeout(r,16));};
if(isTouch)document.body.classList.add('touch');
if(isTouch){$('touch').style.display='block';$('keys').innerHTML='Joystick stânga — mers / condus · trage pe ecran — privește<br><b>INTRĂ</b> — urcă în orice vehicul · <b>FRÂNĂ</b> · <b>CLAXON</b>';}
// ================= mesh builder =================
const _v=new THREE.Vector3(),_n=new THREE.Vector3(),_nm=new THREE.Matrix3(),_c=new THREE.Color();
class Bk{
  constructor(mat,uv){this.mat=mat;this.p=[];this.n=[];this.c=[];this.u=uv?[]:null;}
  v(x,y,z,nx,ny,nz,r,g,b,u,w){this.p.push(x,y,z);this.n.push(nx,ny,nz);this.c.push(r,g,b);if(this.u)this.u.push(u||0,w||0);}
  add(geo,m,color,faces){
    const g=geo.index?geo.toNonIndexed():geo;const P=g.attributes.position,N=g.attributes.normal,U=g.attributes.uv;
    _nm.getNormalMatrix(m);const C=color==null?g.attributes.color:null;if(!C)_c.set(color);const ranges=faces?faces.map(f=>[f*6,6]):[[0,P.count]];
    for(const [s,cnt] of ranges)for(let i=s;i<s+cnt;i++){_v.fromBufferAttribute(P,i).applyMatrix4(m);_n.fromBufferAttribute(N,i).applyMatrix3(_nm).normalize();
      if(C)_c.setRGB(C.getX(i),C.getY(i),C.getZ(i));this.v(_v.x,_v.y,_v.z,_n.x,_n.y,_n.z,_c.r,_c.g,_c.b,U?U.getX(i):0,U?U.getY(i):0);}
  }
  geo(){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(this.p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(this.n,3));
    g.setAttribute('color',new THREE.Float32BufferAttribute(this.c,3));if(this.u)g.setAttribute('uv',new THREE.Float32BufferAttribute(this.u,2));g.computeBoundingSphere();return g;}
  mesh(){const m=new THREE.Mesh(this.geo(),this.mat);m.matrixAutoUpdate=false;m.updateMatrix();return m;}
}
const _q=new THREE.Quaternion(),_e=new THREE.Euler(),_s=new THREE.Vector3(),_p=new THREE.Vector3();
const M=(x,y,z,ry=0,rx=0,rz=0,sx=1,sy=1,sz=1)=>new THREE.Matrix4().compose(_p.set(x,y,z),_q.setFromEuler(_e.set(rx,ry,rz,'YXZ')),_s.set(sx,sy,sz));
const BOX=(w,h,d)=>new THREE.BoxGeometry(w,h,d), CYL=(a,b,h,s=12)=>new THREE.CylinderGeometry(a,b,h,s);
const VC=new THREE.MeshLambertMaterial({vertexColors:true});
const VC2=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide});

