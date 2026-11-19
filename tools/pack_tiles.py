"""Bundle world/tiles/i_j.json into world/packs/p_I_J.json (I=floor(i/4), J=floor(j/4)); map key->tile object.
world.js fetches packs if world.json has "packs":4 (fewer files to publish/fetch)."""
import json,os,math,sys,collections
W=sys.argv[1] if len(sys.argv)>1 else 'world';N=4
packs=collections.defaultdict(dict)
for f in os.listdir(W+'/tiles'):
    k=f[:-5];i,j=map(int,k.split('_'));packs[(math.floor(i/N),math.floor(j/N))][k]=json.load(open(f'{W}/tiles/{f}'))
os.makedirs(W+'/packs',exist_ok=True)
for (I,J),d in packs.items(): open(f'{W}/packs/p_{I}_{J}.json','w').write(json.dumps(d,separators=(',',':'),ensure_ascii=False))
w=json.load(open(W+'/world.json'));w['packs']=N;json.dump(w,open(W+'/world.json','w'),separators=(',',':'),ensure_ascii=False)
print(len(packs),'packs')
