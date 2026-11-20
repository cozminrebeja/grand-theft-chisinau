'use strict';
// Blender-made PS2-style models: tools/blender/*.py → models/{cars,people,landmarks}.glb. Owner: integrator.
// main() awaits mdl_preload() before the world builds. Models are low-poly, smooth-shaded meshes with one small baked
// texture per model or atlas group (lp.bake: colour × AO, grime, painted detail); flat-colour meshes still work.
// Textures load as LINEAR (the game renders without sRGB output, so baked values = the colours the scripts chose).
// Bake models into merged buckets (mdl_meshes / mdl_bake) instead of adding the glTF meshes directly.
const MDL={},MDL_V='20261121ps2';   // bump MDL_V when a .glb changes (deployed clients cache them)
async function mdl_preload(){
  const CDN='https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/';
  if(!THREE.GLTFLoader)await world_script(CDN+'GLTFLoader.js');
  const L=new THREE.GLTFLoader();
  await Promise.all(['cars','people','landmarks'].map(n=>new Promise(ok=>L.load('models/'+n+'.glb?v='+MDL_V,
    g=>{g.scene.updateMatrixWorld(true);g.scene.traverse(o=>{const mt=o.material;if(mt&&mt.map){const t=mt.map;
      t.encoding=THREE.LinearEncoding;t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());t.needsUpdate=true;}});
      MDL[n]=g.scene;ok();},undefined,e=>{console.error('model '+n,e);ok();}))));
  if(typeof lm_glbPre==='function')lm_glbPre();
}
// named node from a loaded file: mdl_get('cars','logan')
function mdl_get(file,name){const r=MDL[file];return r?r.getObjectByName(name):null;}
// every mesh under root: cb(geometry, matrix relative to root, material, mesh)
function mdl_each(root,cb){root.updateMatrixWorld(true);const inv=new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse(o=>{if(o.isMesh)cb(o.geometry,new THREE.Matrix4().multiplyMatrices(inv,o.matrixWorld),o.material,o);});}
// bake root into a Bk bucket, optionally placed by matrix m. Vertex colour = material colour (white for textured
// materials, whose colour is in the map); create the Bk with uv=true to keep UVs: new Bk(mat,true)
function mdl_bake(root,bk,m){mdl_each(root,(g,mm,mt)=>bk.add(g,m?new THREE.Matrix4().multiplyMatrices(m,mm):mm,mt.map?0xffffff:mt.color.getHex()));return bk;}
// one merged BufferGeometry for root (position, normal, color, uv)
function mdl_geo(root){return mdl_bake(root,new Bk(null,true)).geo();}
// shared Lambert (per-vertex lighting, PS2-like) material per texture
const mdl_MATS=new Map();
function mdl_mat(map){let m=mdl_MATS.get(map||null);if(!m){m=map?new THREE.MeshLambertMaterial({map,vertexColors:true}):VC;mdl_MATS.set(map||null,m);}return m;}
// root as merged meshes, one per texture (untextured parts → the shared vertex-colour material), placed by matrix m
function mdl_meshes(root,m){const G=new Map();
  mdl_each(root,(g,mm,mt)=>{const k=mt.map||null;let b=G.get(k);if(!b)G.set(k,b=new Bk(mdl_mat(k),!!k));
    b.add(g,m?new THREE.Matrix4().multiplyMatrices(m,mm):mm,k?0xffffff:mt.color.getHex());});
  return [...G.values()].map(b=>b.mesh());}
