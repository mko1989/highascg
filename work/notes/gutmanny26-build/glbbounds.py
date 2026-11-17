import sys,json,struct,collections
import numpy as np
j=json.load(open(sys.argv[1]))
N=j['nodes']; M=j['meshes']; A=j['accessors']; mats=j['materials']
layers={l['identifier']:l['name'] for l in j['asset']['extensions']['CAPTURE_model']['layers']}
parent={}
for i,n in enumerate(N):
    for c in n.get('children',[]): parent[c]=i
def local(n):
    if 'matrix' in n: return np.array(n['matrix'],float).reshape(4,4).T
    m=np.eye(4)
    if 'translation' in n: m[:3,3]=n['translation']
    if 'rotation' in n or 'scale' in n:
        x,y,z,w=n.get('rotation',[0,0,0,1]); s=n.get('scale',[1,1,1])
        R=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
        m[:3,:3]=R*np.array(s)
    return m
W={}
def world(i):
    if i in W: return W[i]
    m=local(N[i])
    if i in parent: m=world(parent[i])@m
    W[i]=m; return m
def layer(i):
    while True:
        l=N[i].get('extensions',{}).get('CAPTURE_model',{}).get('layer_identifier')
        if l: return layers.get(l,l)
        if i not in parent: return None
        i=parent[i]
out=[]
for i,n in enumerate(N):
    if 'mesh' not in n: continue
    w=world(i); lo=np.full(3,1e9); hi=-lo; ms=set(); tris=0
    for p in M[n['mesh']]['primitives']:
        a=A[p['attributes']['POSITION']]
        mn=np.array(a['min']);mx=np.array(a['max'])
        for cx in (mn[0],mx[0]):
            for cy in (mn[1],mx[1]):
                for cz in (mn[2],mx[2]):
                    q=(w@np.array([cx,cy,cz,1]))[:3]; lo=np.minimum(lo,q); hi=np.maximum(hi,q)
        ms.add(mats[p['material']]['name'] if 'material' in p else '-')
        tris+=(A[p['indices']]['count'] if 'indices' in p else a['count'])//3
    out.append(dict(i=i,layer=layer(i),lo=lo.round(3).tolist(),hi=hi.round(3).tolist(),mats=sorted(ms),tris=tris,uuid=n.get('extensions',{}).get('CAPTURE_model',{}).get('identifier')))
json.dump(out,open(sys.argv[2],'w'))
by=collections.defaultdict(list)
for o in out: by[o['layer']].append(o)
for l,os in sorted(by.items(),key=lambda x:str(x[0])):
    lo=np.min([o['lo'] for o in os],0); hi=np.max([o['hi'] for o in os],0)
    mc=collections.Counter(m for o in os for m in o['mats'])
    print(f"{str(l):28s} n={len(os):5d} tris={sum(o['tris'] for o in os):8d} x[{lo[0]:.2f},{hi[0]:.2f}] y[{lo[1]:.2f},{hi[1]:.2f}] z[{lo[2]:.2f},{hi[2]:.2f}] {dict(mc.most_common(6))}")
