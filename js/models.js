'use strict';
// Blender-made low-poly models: tools/blender/*.py → models/{cars,people,landmarks}.glb. Owner: integrator.
// main() awaits mdl_preload() before the world builds. Models are flat-colour meshes (material colour = the hex the
// Blender script chose, no textures); bake them into the game's merged buckets instead of adding glTF meshes directly.
const MDL={},MDL_V='20261121u';   // bump MDL_V when a .glb changes (deployed clients cache them)
async function mdl_preload(){
  const CDN='https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/';
  if(!THREE.GLTFLoader)await world_script(CDN+'GLTFLoader.js');
  const L=new THREE.GLTFLoader();
  await Promise.all(['cars','people','landmarks'].map(n=>new Promise(ok=>L.load('models/'+n+'.glb?v='+MDL_V,
    g=>{g.scene.updateMatrixWorld(true);MDL[n]=g.scene;ok();},undefined,e=>{console.error('model '+n,e);ok();}))));
  if(typeof lm_glbPre==='function')lm_glbPre();
}
// named node from a loaded file: mdl_get('cars','logan')
function mdl_get(file,name){const r=MDL[file];return r?r.getObjectByName(name):null;}
// every mesh under root: cb(geometry, matrix relative to root, material, mesh)
function mdl_each(root,cb){root.updateMatrixWorld(true);const inv=new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse(o=>{if(o.isMesh)cb(o.geometry,new THREE.Matrix4().multiplyMatrices(inv,o.matrixWorld),o.material,o);});}
// bake root into a Bk bucket (vertex colours from the materials), optionally placed by matrix m
function mdl_bake(root,bk,m){mdl_each(root,(g,mm,mt)=>bk.add(g,m?new THREE.Matrix4().multiplyMatrices(m,mm):mm,mt.color.getHex()));return bk;}
// one merged vertex-coloured BufferGeometry for root (position, normal, color)
function mdl_geo(root){return mdl_bake(root,new Bk(null)).geo();}
