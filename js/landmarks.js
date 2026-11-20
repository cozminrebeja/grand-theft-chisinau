'use strict';
// Landmark models (Arc, Cathedral, Bell tower, Statue, Government House, Parliament, Primăria, Opera, theatres, museum, bank,
// water tower, Catholic cathedral, Circus + the landmarks_new set). Owner: LANDMARKS agent. Top-level names prefixed lm_
// (except buildLandmarks / landmarksPreBuild, the public API called by world.js).
//
// The models are low-poly Blender meshes: tools/blender/landmarks.py (landmarks_core.py + landmarks_new.py) → models/landmarks.glb,
// preloaded by js/models.js into MDL.landmarks before the world builds. One top-level glTF node per landmark, named by its key,
// userData.lm = JSON {x,z, fp:[ring,...], h, hs?:[h per ring], skip:[[x,z],...], base?:ring, clear?:[ring,...]}:
//  - geometry is relative to (x, base, z), base = lowest ground under `base` (default fp[0]): the uphill side embeds, nothing floats;
//  - fp rings ([[x,z],...] world metres) become colliders of height hs[i] (default h);
//  - skip = vertex-mean centroids of the generic OSM footprints the model replaces (removed from facades.js via LANDMARK_SKIP).
// All landmarks bake into ONE vertex-coloured mesh (1 draw call).
const lm_BASE={};
function lm_ccw(r){return sArea(r)<0?r.slice().reverse():r;}
function lm_glbList(){const r=MDL.landmarks;return r?r.children.filter(o=>o.userData&&o.userData.lm).map(o=>[o,o.userData._lm||(o.userData._lm=JSON.parse(o.userData.lm))]):[];}
function lm_glbBase(e){const r=e.base||(e.fp&&e.fp[0]);return lm_BASE[e.x+','+e.z]??=(r?groundRange(r)[0]:groundY(e.x,e.z));}
// mdl_preload, before any tile builds: hide the generic OSM buildings the models replace
function lm_glbPre(){for(const [,e] of lm_glbList()){for(const s of e.skip||[])LANDMARK_SKIP.push({x:s[0],z:s[1],r:2.5});
  for(const r of e.clear||[])VEG_CLEAR.push((x,z)=>pip(x,z,r));}}  // clear = walkable areas kept free of trees (stadium pitch)
let lm_colDone=false;
function lm_glbColliders(){if(lm_colDone)return;lm_colDone=true;
  for(const [,e] of lm_glbList()){const n0=polys.length;(e.fp||[]).forEach((r,i)=>addPoly([lm_ccw(r)],(e.hs&&e.hs[i])||e.h||12));
    const b=lm_glbBase(e);for(let i=n0;i<polys.length;i++)polys[i].y0=b;}}
// world.js calls landmarksPreBuild() once before any tile is built, so vegetation/agents/streets avoid the colliders
function landmarksPreBuild(){try{lm_glbColliders();}catch(e){console.error('lm colliders',e);}}
function buildLandmarks(){landmarksPreBuild();
  const bk=new Bk(VC);for(const [o,e] of lm_glbList())mdl_bake(o,bk,M(e.x,lm_glbBase(e),e.z));
  if(bk.p.length){const m=bk.mesh();m.name='landmarks';m.castShadow=m.receiveShadow=true;scene.add(m);}}
