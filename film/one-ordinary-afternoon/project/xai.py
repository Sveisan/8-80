import json,os,sys,time,urllib.request,base64
K=os.environ["XAI_API_KEY"]
def call(path,body=None,method=None):
    req=urllib.request.Request("https://api.x.ai/v1/"+path,data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization":"Bearer "+K,"Content-Type":"application/json","User-Agent":"curl/8"},method=method)
    try: return json.loads(urllib.request.urlopen(req,timeout=300).read())
    except urllib.error.HTTPError as e: return {"error":e.code,"body":e.read().decode()[:600]}
def dl(url,path):
    req=urllib.request.Request(url,headers={"User-Agent":"curl/8"})
    open(path,'wb').write(urllib.request.urlopen(req,timeout=300).read())
def datauri(p):
    return "data:image/jpeg;base64,"+base64.b64encode(open(p,'rb').read()).decode()
STYLE=("Photorealistic cinematic film still, 35mm lens, shallow depth of field, natural soft warm late-afternoon window light with long shadows, "
"muted palette of cream, pale oak, deep pine green and one small accent of mustard gold, quiet lived-in Scandinavian home, subtle film grain. "
"No face visible anywhere. No text, no logos, no watermark.")
def image(name,prompt,ref=None,n=1):
    body={"model":"grok-imagine-image-2.0","prompt":prompt+" "+STYLE,"aspect_ratio":"16:9","n":n}
    if ref:
        body["image"]={"url":datauri(ref),"type":"image_url"}; r=call("images/edits",body)
    else: r=call("images/generations",body)
    if "data" not in r: print(name,r); return
    for i,d in enumerate(r["data"]):
        p=f"stills/{name}_{chr(97+i)}.jpg"; dl(d["url"],p); print(p)
