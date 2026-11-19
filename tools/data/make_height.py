import tifffile,numpy as np,json,math
from scipy import ndimage
W=json.load(open('/home/claude/gtc/app/world/world.json'))
LAT0,LON0=W['origin'];KX=111320*math.cos(math.radians(LAT0));KZ=110574
a=tifffile.imread('N47_00_E028_00.tif').astype(np.float32);b=tifffile.imread('N46_00_E028_00.tif').astype(np.float32)
print(a.shape,b.shape,a.min(),a.max())
dem=np.vstack([a,b])  # rows: lat 48 -> 46, cols lon 28 -> 29 ; pixel size 1/3600 deg
H,Wd=dem.shape;res=1/3600.0
# crop to region of interest for speed
X0,X1,Z0,Z1=W['bounds'];M=1500
lat_top=LAT0-(Z0-M)/KZ;lat_bot=LAT0-(Z1+M)/KZ;lon_l=LON0+(X0-M)/KX;lon_r=LON0+(X1+M)/KX
r0=int((48-lat_top)/res)-10;r1=int((48-lat_bot)/res)+10;c0=int((lon_l-28)/res)-10;c1=int((lon_r-28)/res)+10
sub=dem[r0:r1,c0:c1]
# bare-earth approximation: remove buildings/trees (DSM) via grey opening, then smooth
g=ndimage.grey_opening(sub,size=(7,7))
g=ndimage.gaussian_filter(g,2.0)
cell=20.0;gx0=X0-M;gz0=Z0-M;nx=int((X1-X0+2*M)/cell)+1;nz=int((Z1-Z0+2*M)/cell)+1
xs=gx0+np.arange(nx)*cell;zs=gz0+np.arange(nz)*cell
X,Z=np.meshgrid(xs,zs)
lon=LON0+X/KX;lat=LAT0-Z/KZ
rr=(48-lat)/res-0.5-r0;cc=(lon-28)/res-0.5-c0
h=ndimage.map_coordinates(g,[rr,cc],order=1,mode='nearest')
base=float(ndimage.map_coordinates(g,[[ (48-LAT0)/res-0.5-r0],[(LON0-28)/res-0.5-c0]],order=1)[0])
rel=np.round((h-base)*10).astype('<i2')
rel.tofile('/home/claude/gtc/app/world/height.bin')
W['height']={'file':'world/height.bin','x0':gx0,'z0':gz0,'cell':cell,'nx':nx,'nz':nz,'scale':0.1,'base':round(base,1),'source':'Copernicus GLO-30 DEM (© DLR/Airbus, ESA), ground-filtered'}
json.dump(W,open('/home/claude/gtc/app/world/world.json','w'),separators=(',',':'),ensure_ascii=False)
import base64;json.dump({'b64':base64.b64encode(rel.tobytes()).decode()},open('/home/claude/gtc/app/world/height.json','w'));W['height']['file']='world/height.json';json.dump(W,open('/home/claude/gtc/app/world/world.json','w'),separators=(',',':'),ensure_ascii=False)
print('grid',nx,nz,'base(m)',round(base,1),'rel range',rel.min()/10,rel.max()/10, 'bytes',rel.nbytes)
def at(x,z):
    i=(x-gx0)/cell;j=(z-gz0)/cell;return float(ndimage.map_coordinates(h,[[j],[i]],order=1)[0])
for n,(x,z) in {'Arc':(0,0),'ValeaMorilor lake':(-1107,689),'Botanica':(2600,4200),'Riscani':(1500,-3500),'Ciocana':(5500,-1000),'Buiucani':(-3500,-800),'Bic river? (Gara)':(1100,1300)}.items(): print(n,round(at(x,z),1))
