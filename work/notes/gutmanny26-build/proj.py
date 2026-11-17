"""proj.py — edit the live project through autosave: from proj import edit; edit(lambda doc: ...)"""
import json, urllib.request, datetime
API = 'http://127.0.0.1:4200'
def get(path='/api/project'):
    return json.load(urllib.request.urlopen(API + path))
def post(path, body):
    req = urllib.request.Request(API + path, json.dumps(body).encode(), {'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req))
def edit(fn):
    doc = get(); fn(doc)
    doc['savedAt'] = datetime.datetime.now(datetime.UTC).isoformat().replace('+00:00', 'Z')
    r = post('/api/project/autosave', {'project': doc}); print(r); return doc
