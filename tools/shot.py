"""Shared test harness. Usage:
  python3 dev/shot.py --port 8801 --out /tmp/myshots [--mobile] [--scenes all|title,foot,drive,trolley,aerial,street,cars,peds,night] [--eval "js"]
Starts its own http server for THIS folder (the folder containing dev/), loads test.html in headless Chrome (SwiftShader),
prints page errors + renderer.info, and saves screenshots for each scene to --out.
FPS in SwiftShader is NOT representative of a phone GPU; use triangles/draw calls as the perf budget."""
import asyncio,argparse,os,subprocess,sys,time,json
from playwright.async_api import async_playwright
ap=argparse.ArgumentParser();ap.add_argument('--port',type=int,default=8800);ap.add_argument('--out',default='/tmp/shots');ap.add_argument('--mobile',action='store_true')
ap.add_argument('--scenes',default='all');ap.add_argument('--eval',default='');ap.add_argument('--wait',type=int,default=1500)
A=ap.parse_args();os.makedirs(A.out,exist_ok=True)
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv=subprocess.Popen([sys.executable,'-m','http.server',str(A.port),'--directory',root],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(.8)
SC=['title','foot','drive','cars','street','trolley','aerial','peds']
want=SC if A.scenes=='all' else A.scenes.split(',')
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    vp=dict(viewport={'width':420,'height':860},has_touch=True,is_mobile=True) if A.mobile else dict(viewport={'width':1100,'height':680})
    pg=await b.new_page(**vp);errs=[]
    pg.on('pageerror',lambda e:errs.append('PAGEERROR '+str(e)+' '+(e.stack or '')[:400]))
    pg.on('console',lambda m:errs.append('console.'+m.type+': '+m.text) if m.type in('error',) else None)
    t0=time.time();await pg.goto(f'http://localhost:{A.port}/test.html',timeout=180000)
    try: await pg.wait_for_function("document.getElementById('play').disabled===false||document.getElementById('play').textContent.startsWith('Eroare')",timeout=180000)
    except Exception as e: errs.append('LOAD TIMEOUT')
    print('load_seconds',round(time.time()-t0,1),'button:',await pg.inner_text('#play',timeout=180000))
    async def shot(name):
      await pg.wait_for_timeout(A.wait);await pg.screenshot(path=f'{A.out}/{name}.png',timeout=180000);info=await pg.evaluate("JSON.stringify(__dbg.renderer.info.render)");print('shot',name,info)
    if 'title' in want: await shot('title')
    await pg.evaluate("document.getElementById('play').click()");await pg.wait_for_timeout(800)
    if A.eval: print('eval:',await pg.evaluate(A.eval))
    if 'foot' in want: await shot('foot')
    if 'drive' in want:
      await pg.evaluate("(()=>{const d=__dbg;const t=d.vehicles.filter(v=>v.mode==='parked'&&v.type==='taxi').sort((a,b)=>Math.hypot(a.x-d.player.x,a.z-d.player.z)-Math.hypot(b.x-d.player.x,b.z-d.player.z))[0];d.player.x=t.x+Math.cos(t.h)*1.8;d.player.z=t.z-Math.sin(t.h)*1.8;d.toggleCar();})()")
      await pg.keyboard.down('KeyW');await pg.wait_for_timeout(2500);await pg.keyboard.up('KeyW');await shot('drive')
      await pg.evaluate("__dbg.player.car&&__dbg.toggleCar()")
    if 'cars' in want:  # close-up of an AI car from a low side angle
      await pg.evaluate("(()=>{const d=__dbg;const vs=d.vehicles.filter(v=>v.mode==='parked'&&!v.g);vs.sort((a,b)=>Math.hypot(a.x-d.player.x,a.z-d.player.z)-Math.hypot(b.x-d.player.x,b.z-d.player.z));const v=vs[0];const s=Math.sin(v.h),c=Math.cos(v.h);d.camOverride=[v.x+c*4+s*4,1.6,v.z-s*4+c*4,v.x,0.8,v.z];})()")
      await shot('cars');await pg.evaluate("__dbg.camOverride=null")
    if 'street' in want:
      await pg.evaluate("(()=>{const d=__dbg;const p=d.player;d.camOverride=[p.x,1.7,p.z,p.x+Math.sin(p.h)*30,4,p.z+Math.cos(p.h)*30];})()");await shot('street');await pg.evaluate("__dbg.camOverride=null")
    if 'trolley' in want:
      await pg.evaluate("(()=>{const d=__dbg;const ts=d.vehicles.filter(v=>v.type==='trolley'&&v.mode==='ai');ts.sort((a,b)=>Math.hypot(a.x-d.player.x,a.z-d.player.z)-Math.hypot(b.x-d.player.x,b.z-d.player.z));const t=ts[0];const s=Math.sin(t.h),c=Math.cos(t.h);d.camOverride=[t.x+c*9+s*8,3,t.z-s*9+c*8,t.x,2,t.z];})()")
      await shot('trolley');await pg.evaluate("__dbg.camOverride=null")
    if 'aerial' in want:
      await pg.evaluate("(()=>{const d=__dbg;const p=d.player;d.camOverride=[p.x-120,90,p.z-120,p.x+60,0,p.z+60];})()");await shot('aerial');await pg.evaluate("__dbg.camOverride=null")
    if 'peds' in want:
      await pg.evaluate("(()=>{const d=__dbg;const ps=d.peds.slice().sort((a,b)=>Math.hypot(a.x-d.player.x,a.z-d.player.z)-Math.hypot(b.x-d.player.x,b.z-d.player.z));const q=ps[0];d.camOverride=[q.x+3,1.7,q.z+3,q.x,1.1,q.z];})()");await shot('peds');await pg.evaluate("__dbg.camOverride=null")
    fps=await pg.evaluate("new Promise(r=>{let n=0,t0=performance.now();function f(){n++;if(performance.now()-t0<2000)requestAnimationFrame(f);else r(n/2)}f()})")
    print('swiftshader_fps',fps,'(not representative)')
    print('ERRORS:' if errs else 'NO ERRORS');[print(' ',e) for e in errs[:30]]
    await b.close()
try: asyncio.run(main())
finally: srv.terminate()
