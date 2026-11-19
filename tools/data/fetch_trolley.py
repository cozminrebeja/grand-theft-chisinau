"""Fetch Chișinău trolleybus route relations (/relation/<id>/full) from the OSM API — ~60 polite requests, 1 s apart.
Relation ids come from the centre OSM extract (osm.pkl) route_master=trolleybus members."""
import pickle,os,time,urllib.request
OUT='/home/claude/gtc/citydata/raw/osm_rel';os.makedirs(OUT,exist_ok=True)
nodes,ways,rels=pickle.load(open('/home/claude/gtc/osm.pkl','rb'))
ids=set(i for i,(m,t) in rels.items() if t.get('route')=='trolleybus')
ids|=set(ref for i,(m,t) in rels.items() if t.get('route_master')=='trolleybus' for ty,ref,ro in m if ty=='relation')
print(len(ids),'relations')
for i in sorted(ids):
    p=f'{OUT}/{i}.osm'
    if os.path.exists(p) and os.path.getsize(p)>500: continue
    req=urllib.request.Request(f'https://api.openstreetmap.org/api/0.6/relation/{i}/full',headers={'User-Agent':'GrandTheftChisinau-dataprep/1.0 (one-off; ~60 requests)'})
    for a in range(3):
        try: open(p,'wb').write(urllib.request.urlopen(req,timeout=60).read());break
        except Exception as e: print('retry',i,e);time.sleep(5)
    time.sleep(1.1)
print('done',len(os.listdir(OUT)))
