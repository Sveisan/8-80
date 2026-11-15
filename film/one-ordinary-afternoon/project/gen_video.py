import sys,json,time; sys.path.insert(0,'project'); from xai import *
from concurrent.futures import ThreadPoolExecutor
A=" Photorealistic, natural real-time motion, steady camera, consistent lighting. Natural quiet room sound only, no music, no voices, no speech."
shots={
"s1":(6,"Locked-off static shot. Dust motes drift slowly through the sunbeam, faint steam rises from the mug, leaves outside the window sway gently. Then the face-down phone vibrates slightly on the wood."),
"s2":(6,"Static close-up. The face-down phone buzzes and trembles on the wooden table; the hand closes around it, lifts it smoothly up and out of the top of the frame. The table is left with sunlight and the mug."),
"s3":(6,"Very slow gentle push-in from behind. The person stands still at the window holding the phone to their ear, listening, shifting their weight slightly and nodding a little; they never turn around, the face is never seen. Leaves move outside."),
"s4":(6,"Static overhead shot. The hand slowly slides across the page and the index finger gently taps the handwritten notes at the top twice, then rests. Sunlight flickers softly as leaves move outside."),
"s5":(6,"Static macro shot. The hand writes one single short line of cursive handwriting in black ink across the cream page, slowly and deliberately, then lifts the pen tip off the paper and pauses."),
"s6":(6,"Static close-up. The hand gently sets the phone face down on the table, lets go, pats it once lightly, then withdraws out of the left of the frame. Dust motes drift in the golden light."),
"s7":(6,"Static camera. The person walks calmly away from the camera, through the open garden door and out into the bright golden afternoon light, carrying the mug; head stays out of frame; the curtain moves a little in the breeze."),
}
def run(k):
    d,p=shots[k]
    r=call("videos/generations",{"model":"grok-imagine-video-1.5","prompt":p+A,"image":{"url":datauri(f"stills/{k}.jpg")},"duration":d,"aspect_ratio":"16:9","resolution":"1080p"})
    if "request_id" not in r: print(k,r); return
    t0=time.time()
    while time.time()-t0<900:
        s=call("videos/"+r["request_id"])
        if s.get("status")=="done": 
            out=f"clips/{k}{SUF}.mp4"; dl(s["video"]["url"],out); print(out,flush=True); return
        if s.get("status") in ("failed","expired") or "error" in s: print(k,s,flush=True); return
        time.sleep(8)
    print(k,"timeout")
SUF=sys.argv[2] if len(sys.argv)>2 else ""
if __name__=="__main__":
    with ThreadPoolExecutor(6) as ex: list(ex.map(run,sys.argv[1].split(",")))
