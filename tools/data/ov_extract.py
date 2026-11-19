"""Extract Overture Maps features inside the Chișinău bbox to local parquet caches (row-group pruning on bbox stats).
Usage: python3 dev/data/ov_extract.py <theme> <type> [cols...]"""
import sys,os,time,concurrent.futures as cf
import pyarrow as pa,pyarrow.parquet as pq,pyarrow.fs as pfs,pyarrow.compute as pc
REL='overturemaps-us-west-2/release/2026-11-18.0'
BB=(28.735,46.912,28.982,47.088)  # lon0,lat0,lon1,lat1 (generous; cropped later)
OUT='/home/claude/gtc/citydata/raw'
fs=pfs.S3FileSystem(anonymous=True,region='us-west-2')
def rg_hits(md,names):
    idx={}
    for i in range(md.num_columns):
        p=md.schema.column(i).path
        if p in('bbox.xmin','bbox.xmax','bbox.ymin','bbox.ymax'):idx[p]=i
    hits=[]
    for r in range(md.num_row_groups):
        rg=md.row_group(r);st={k:rg.column(i).statistics for k,i in idx.items()}
        try:
            if st['bbox.xmin'].min>BB[2] or st['bbox.xmax'].max<BB[0] or st['bbox.ymin'].min>BB[3] or st['bbox.ymax'].max<BB[1]:continue
        except Exception: pass
        hits.append(r)
    return hits
def one(path,cols):
    for attempt in range(4):
        try:
            f=pq.ParquetFile(fs.open_input_file(path));hits=rg_hits(f.metadata,cols)
            if not hits:return None
            t=f.read_row_groups(hits,columns=cols)
            b=t.column('bbox');xmin=pc.struct_field(b,'xmin');xmax=pc.struct_field(b,'xmax');ymin=pc.struct_field(b,'ymin');ymax=pc.struct_field(b,'ymax')
            m=pc.and_(pc.and_(pc.less_equal(xmin,BB[2]),pc.greater_equal(xmax,BB[0])),pc.and_(pc.less_equal(ymin,BB[3]),pc.greater_equal(ymax,BB[1])))
            t=t.filter(m);return t if t.num_rows else None
        except Exception as e:
            err=e;time.sleep(2)
    print('FAIL',path,err);return None
def main():
    theme,typ=sys.argv[1],sys.argv[2];cols=sys.argv[3:] or None
    base=f'{REL}/theme={theme}/type={typ}/'
    files=[i.path for i in fs.get_file_info(pfs.FileSelector(base)) if i.path.endswith('.parquet') or 'part' in i.path]
    print(theme,typ,len(files),'files');t0=time.time()
    if cols is None: cols=pq.ParquetFile(fs.open_input_file(files[0])).schema_arrow.names
    tabs=[];done=0
    with cf.ThreadPoolExecutor(12) as ex:
        for r in ex.map(lambda p:one(p,cols),files):
            done+=1
            if r is not None:tabs.append(r)
            if done%50==0:print(done,'/',len(files),'hits',sum(x.num_rows for x in tabs),round(time.time()-t0),'s',flush=True)
    t=pa.concat_tables(tabs) if tabs else None
    os.makedirs(OUT,exist_ok=True)
    if t is not None: pq.write_table(t,f'{OUT}/{theme}_{typ}.parquet')
    print('rows',0 if t is None else t.num_rows,'secs',round(time.time()-t0))
main()
