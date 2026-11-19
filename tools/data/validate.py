"""Validate a dataset against WORLD.md. Usage: python3 dev/data/validate.py /home/claude/gtc/citydata/world"""
import json,sys,os,glob,collections,math
D=sys.argv[1] if len(sys.argv)>1 else '/home/claude/gtc/citydata/world'
W=json.load(open(f'{D}/world.json'));err=collections.Counter();ex={}
def bad(k,msg):
    err[k]+=1;ex.setdefault(k,msg)
for k in ('version','origin','bounds','tile','tiles','r','names','pois','stops','special','districts','attribution'):
    if k not in W: bad('missing',k)
N=len(W['names'])
for r in W['r']:
    if len(r)!=7: bad('r_len',r[:5]);continue
    kind,w,ow,ni,tw,ids,f=r
    if kind not in (0,1,2): bad('r_kind',kind)
    if not (0<=ni<N): bad('r_name',ni)
    if len(f)%2 or len(f)<4: bad('r_flat',len(f))
    if len(ids)*2!=len(f): bad('r_ids_len',(len(ids),len(f)))
    elif ids[0]<0 or ids[-1]<0: bad('r_end_ids',ids[:2])
    if any(type(v) is not int for v in f): bad('r_int','')
sizes=[];cnt=collections.Counter()
for key,meta in W['tiles'].items():
    p=f'{D}/tiles/{key}.json'
    if not os.path.exists(p): bad('tile_missing',key);continue
    t=json.load(open(p));sizes.append(os.path.getsize(p))
    i,j=map(int,key.split('_'))
    for b in t['b']:
        cnt['b']+=1
        if not (6<=len(b)<=7): bad('b_len',len(b))
        if len(b[4])<6 or len(b[4])%2: bad('b_ring',len(b[4]))
        xs=b[4][0::2];zs=b[4][1::2];cx=sum(xs)/len(xs)/10;cz=sum(zs)/len(zs)/10
        if (math.floor(cx/500),math.floor(cz/500))!=(i,j): bad('b_tile',key)
        if b[2] not in (0,1,2,3,4): bad('b_style',b[2])
    for r in t['r']:
        cnt['r']+=1
        if len(r)!=7 or r[5] is not None or r[0] not in (0,1,2,3) or len(r[6])<4 or len(r[6])%2: bad('piece',r[:6])
        if not (0<=r[3]<N): bad('piece_name',r[3])
    for a in t['a']:
        cnt['a']+=1
        if a[0] not in ('park','water','plaza','parking') or len(a[1])<6: bad('area',a[0])
        xs=a[1][0::2];zs=a[1][1::2]
        if min(xs)<i*5000-5 or max(xs)>(i+1)*5000+5 or min(zs)<j*5000-5 or max(zs)>(j+1)*5000+5: bad('area_clip',key)
    if len(t['trees'])%2 or len(t['cross'])%2: bad('pts','')
    if meta[0]!=len(t['b']) or meta[1]!=len(t['r']): bad('index_counts',key)
for s in W['stops']:
    if len(s)!=3: bad('stop',s)
for p in W['pois']:
    if len(p)!=3: bad('poi',p)
sizes.sort()
print('tiles',len(sizes),'total MB',round(sum(sizes)/1e6,1),'median KB',sizes[len(sizes)//2]//1024,'p95 KB',sizes[int(len(sizes)*.95)]//1024,'max KB',sizes[-1]//1024)
print('counts',dict(cnt),'roads',len(W['r']),'stops',len(W['stops']),'pois',len(W['pois']),'world.json MB',round(os.path.getsize(f'{D}/world.json')/1e6,2))
print('ERRORS' if err else 'VALID',dict(err),ex)
