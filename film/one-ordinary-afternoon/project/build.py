#!/usr/bin/env python3
"""Builds 'One ordinary afternoon' from project/edit.json.
   python3 project/build.py            -> out/one-ordinary-afternoon.mp4 (+ .srt/.vtt)
Needs: ffmpeg, numpy, node + playwright (end card). Source clips in clips/, VO in audio/."""
import json, os, subprocess, wave, sys
import numpy as np
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); os.chdir(ROOT)
E = json.load(open('project/edit.json')); SR = 48000; D = E['duration']; N = int(D*SR)
rng = np.random.default_rng(880)
def sh(*a): subprocess.run(a, check=True)
def db(x): return 10**(x/20)
def t_(n): return np.arange(n)/SR
def place(buf, sig, at, gain=1.0):
    i = int(at*SR); sig = sig[:max(0, len(buf)-i)]; buf[i:i+len(sig)] += sig*gain
def filt(x, lo=None, hi=None):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1/SR); g = np.ones_like(f)
    if lo: g *= 1/np.sqrt(1+(lo/np.maximum(f,1e-6))**4)
    if hi: g *= 1/np.sqrt(1+(f/hi)**4)
    return np.fft.irfft(X*g, len(x))
def ramp(n, a=0.01, r=0.01):
    e = np.ones(n); na, nr = min(int(a*SR), n//2), min(int(r*SR), n//2)
    if na: e[:na] = np.linspace(0,1,na)**2
    if nr: e[-nr:] = np.linspace(1,0,nr)**2
    return e
def reverb(x, secs=2.6, wet=0.3):
    n = int(secs*SR); ir = rng.standard_normal(n)*np.exp(-t_(n)*(6.9/secs)); ir = filt(ir, 200, 5000); ir[:int(.012*SR)] = 0
    L = len(x)+n; y = np.fft.irfft(np.fft.rfft(x, L)*np.fft.rfft(ir, L), L)[:len(x)]
    return x + wet*y/np.max(np.abs(y)+1e-9)*np.max(np.abs(x))

# ---------- voiceover ----------
w = wave.open(E['vo']['src']); vo_src = np.frombuffer(w.readframes(w.getnframes()), '<i2').astype(float)/32768
assert w.getframerate() == SR and w.getnchannels() == 1
vo = np.zeros(N)
for l in E['vo']['lines']:
    seg = vo_src[int(l['in']*SR):int(l['out']*SR)].copy(); seg *= ramp(len(seg), .03, .05); place(vo, seg, l['at'])
vo = filt(vo, lo=70); vo /= np.max(np.abs(vo)); vo *= db(-3)

# ---------- music: soft felt piano + pad, D major, 60 bpm ----------
def hz(m): return 440*2**((m-69)/12)
def piano(m, dur=5.0, vel=1.0):
    n = int(dur*SR); t = t_(n); f = hz(m); y = np.zeros(n)
    for k, a in enumerate([1, .45, .18, .08, .03], 1):
        y += a*np.sin(2*np.pi*f*k*(1+.0004*k*k)*t)*np.exp(-t*(0.9+0.55*k))
    return y*ramp(n, .012, .3)*vel
def pad(ms, dur):
    n = int(dur*SR); t = t_(n); y = sum(np.sin(2*np.pi*hz(m)*t+rng.uniform(0,6))+.5*np.sin(2*np.pi*hz(m)*1.003*t) for m in ms)
    return y/len(ms)*ramp(n, 1.6, 2.0)
chords = [  # (start, bass, arpeggio notes) — one bar = 4 s
 (0,  38, [62, 69, 66, 76]), (4,  35, [62, 66, 71, 74]), (8,  43, [59, 66, 71, 74]), (12, 45, [61, 64, 69, 76]),
 (16, 35, [62, 66, 69, 74]), (20, 43, [59, 62, 67, 69])]
mus = np.zeros(N+SR*6); padb = np.zeros(N+SR*6)
for s, b, arp in chords:
    last = s == 20
    place(mus, piano(b, 6, .8), s+.0); place(padb, pad([b+12]+arp[:3], 2.6 if last else 4.6), s, .5)
    for i, m in enumerate(arp[:2] if last else arp):
        place(mus, piano(m, 5, .55+.1*(i == 3)), s+.5+i*(1.0 if not last else .75)+rng.uniform(-.015, .015))
# resolution on the end card
ec = E['endcard']['start']+.25
for i, m in enumerate([38, 57, 62, 66, 69, 74]): place(mus, piano(m, 7, 1.5 if i == 0 else 1.15), ec+i*.13)
place(mus, piano(78, 6, .8), ec+2.6); place(mus, piano(74, 6, .7), ec+4.3); place(padb, pad([50, 57, 62, 66], 7.5), ec-.6, 1.6)
mus = reverb(filt(mus[:N]*.5+padb[:N]*.12, 60, 3200), 2.8, .35)
mus /= np.max(np.abs(mus)); mus *= db(E['music']['gain_db']+16)
env = np.abs(vo); k = int(.25*SR); env = np.convolve(env, np.ones(k)/k, 'same'); duck = np.clip(env/0.02, 0, 1)
k = int(.4*SR); duck = np.convolve(duck, np.ones(k)/k, 'same'); mus *= db(E['music']['duck_db']*duck)

# ---------- sound design ----------
sfx = np.zeros(N); S = E['sfx']
room = filt(np.cumsum(rng.standard_normal(N))/400, 40, 500); room /= np.max(np.abs(room))
re_ = np.ones(N); i0 = int((E['endcard']['start'])*SR); re_[i0:i0+SR] = np.linspace(1, 0, SR); re_[i0+SR:] = 0
sfx += room*db(-20)*re_
for a, b in S['buzz']:           # phone vibrating on wood
    n = int((b-a)*SR); t = t_(n); y = np.sign(np.sin(2*np.pi*172*t))*.5+np.sin(2*np.pi*86*t)
    y = filt(y, 60, 900)*(0.75+.25*np.sin(2*np.pi*23*t)) + filt(rng.standard_normal(n), 1200, 3500)*.12*(np.sin(2*np.pi*172*t) > .6)
    place(sfx, y/np.max(np.abs(y))*ramp(n, .03, .06), a, db(-25))
n = int(.35*SR); place(sfx, filt(rng.standard_normal(n), 500, 4000)*ramp(n, .12, .2), S['pickup'], db(-36))   # hand takes phone
a, b = S['pen']; n = int((b-a)*SR); strokes = np.zeros(n); p = 0   # pen on paper
while p < n-2000:
    L = int(rng.uniform(.09, .26)*SR); L = min(L, n-p); strokes[p:p+L] = ramp(L, .03, .05)*rng.uniform(.5, 1); p += L+int(rng.uniform(.03, .12)*SR)
y = filt(rng.standard_normal(n), 1800, 6500)*strokes; place(sfx, y/np.max(np.abs(y)), a, db(-26))
n = int(.18*SR); t = t_(n)
place(sfx, (np.sin(2*np.pi*95*t)*np.exp(-t*38)+filt(rng.standard_normal(n), 300, 2000)*.25*np.exp(-t*90)), S['pat'], db(-27))
for j, s in enumerate(S['steps']):
    place(sfx, (np.sin(2*np.pi*72*t)*np.exp(-t*30)+filt(rng.standard_normal(n), 400, 2500)*.3*np.exp(-t*70)), s, db(-25-2.5*j))
sfx = sfx + .25*(reverb(sfx, .5, .5)-sfx)

mix = vo + mus + sfx
fo = int(E['fade_out']*SR); mix[-fo:] *= np.linspace(1, 0, fo); mix[:int(.3*SR)] *= np.linspace(0, 1, int(.3*SR))
st = np.stack([mix + .15*np.roll(mus, 211), mix + .15*np.roll(mus, -167)], 1)  # slight width on music only
st /= max(1, np.max(np.abs(st))/.89)
os.makedirs('build', exist_ok=True); os.makedirs('out', exist_ok=True)
def wwav(p, x):
    x = np.atleast_2d(x.T).T if x.ndim == 1 else x; o = wave.open(p, 'wb'); o.setnchannels(x.shape[1]); o.setsampwidth(2); o.setframerate(SR)
    o.writeframes((np.clip(x, -1, 1)*32767).astype('<i2').tobytes()); o.close()
wwav('build/mix.wav', st)
for name, x in (('vo', vo), ('music', mus), ('sfx', sfx)): wwav(f'audio/stem-{name}.wav', x)

# static gain to -16 LUFS (no dynamic normalisation, so the mix balance is kept)
import re as _re
_m = subprocess.run(['ffmpeg','-hide_banner','-i','build/mix.wav','-af','ebur128','-f','null','-'],capture_output=True,text=True).stderr
gain = -16.0 - float(_re.findall(r'I:\s+(-?[\d.]+) LUFS', _m)[-1])

# ---------- captions ----------
def ts(x, sep): h = int(x//3600); m = int(x//60) % 60; s = x % 60; return f"{h:02d}:{m:02d}:{s:06.3f}".replace('.', sep)
cues = []
L = E['vo']['lines']
for i, l in enumerate(L):
    a = l['at']+.05; b = l['at']+(l['out']-l['in'])+.25; nxt = L[i+1]['at'] if i+1 < len(L) else D-.3
    cues.append((a, min(max(b, a+1.2), nxt), l['text']))
open('out/one-ordinary-afternoon.srt', 'w').write(''.join(f"{i}\n{ts(a, ',')} --> {ts(b, ',')}\n{x}\n\n" for i, (a, b, x) in enumerate(cues, 1)))
open('out/one-ordinary-afternoon.vtt', 'w').write("WEBVTT\n\n"+''.join(f"{ts(a, '.')} --> {ts(b, '.')}\n{x}\n\n" for a, b, x in cues))

# ---------- picture ----------
fps = E['fps']; ecs = E['endcard']['start']; xf = E['endcard']['crossfade']; ecd = D-ecs
os.makedirs('build/endcard', exist_ok=True)
if '--skip-endcard' not in sys.argv:
    npm = subprocess.run(['npm', 'root', '-g'], capture_output=True, text=True).stdout.strip()
    subprocess.run(['node', 'project/render_endcard.cjs', 'build/endcard', str(ecd+.1)], check=True, env={**os.environ, 'NODE_PATH': npm})
ins, fc = [], []
for i, v in enumerate(E['video']):
    d = v['end']-v['start']; ins += ['-ss', f"{v['in']:.3f}", '-t', f"{d+.2:.3f}", '-i', v['src']]
    fc.append(f"[{i}:v]fps={fps},trim=duration={d:.4f},setpts=PTS-STARTPTS,crop=1920:1080,setsar=1,format=yuv420p[v{i}]")
n = len(E['video'])
fc.append(''.join(f'[v{i}]' for i in range(n))+f"concat=n={n}:v=1:a=0,eq=contrast=1.03:saturation=0.94,vignette=PI/6,noise=alls=3:allf=t,fade=t=in:st=0:d={E["fade_in"]},fps={fps},settb=1/{fps}[pic]")
fc.append(f"[{n}:v]fps={fps},format=yuv420p,setsar=1,noise=alls=2:allf=t,settb=1/{fps}[ec]")
fc.append(f"[pic][ec]xfade=transition=fade:duration={xf}:offset={ecs:.3f},trim=duration={D},fade=t=out:st={D-E['fade_out']}:d={E['fade_out']}[vout]")
fc.append(f"[{n+1}:a]volume={gain:.2f}dB,alimiter=limit=0.84:attack=3:release=80:level=false,aresample=48000[aout]")
sh('ffmpeg', '-v', 'error', '-y', *ins, '-framerate', str(fps), '-start_number', '0', '-i', 'build/endcard/f%04d.png', '-i', 'build/mix.wav',
   '-i', 'out/one-ordinary-afternoon.srt', '-filter_complex', ';'.join(fc), '-map', '[vout]', '-map', '[aout]', '-map', f'{n+2}:s',
   '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-maxrate', '9M', '-bufsize', '18M', '-pix_fmt', 'yuv420p', '-r', str(fps), '-c:a', 'aac', '-b:a', '256k',
   '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng', '-metadata', f"title={E['title']}", '-movflags', '+faststart', '-t', str(D),
   'out/one-ordinary-afternoon.mp4')
print('built out/one-ordinary-afternoon.mp4')
