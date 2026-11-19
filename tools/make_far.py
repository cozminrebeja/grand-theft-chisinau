"""Builds <world>/far.json — coarse distant-city silhouette (one box per 100 m cell) from the tile files.
usage: python3 dev/make_far.py [worlddir=world]   Run after (re)generating tiles."""
import json,os,sys,math,collections
W=sys.argv[1] if len(sys.argv)>1 else 'world';C=100.0
cells=collections.defaultdict(lambda:[0.0,0.0,0.0])  # area, area*h, maxh
for f in os.listdir(W+'/tiles'):
  d=json.load(open(f'{W}/tiles/{f}'))
  for b in d.get('b',[]):
    r=b[4];xs=r[0::2];zs=r[1::2];n=len(xs)
    if n<3: continue
    a=abs(sum(xs[i]*zs[(i+1)%n]-xs[(i+1)%n]*zs[i] for i in range(n)))/200.0   # dm² → m²
    cx=sum(xs)/n/10;cz=sum(zs)/n/10;h=b[0]
    c=cells[(math.floor(cx/C),math.floor(cz/C))];c[0]+=a;c[1]+=a*h;c[2]=max(c[2],h)
boxes=[]
for (i,j),(a,ah,mx) in cells.items():
  if a<250: continue
  s=max(18,min(92,math.sqrt(a)*1.25));h=0.55*mx+0.45*ah/a
  boxes.append([round((i+.5)*C),round((j+.5)*C),round(s),round(h,1)])
json.dump({'cell':C,'boxes':boxes},open(W+'/far.json','w'),separators=(',',':'))
print(len(boxes),'far boxes ->',W+'/far.json',os.path.getsize(W+'/far.json'),'bytes')
