# One ordinary afternoon — 29 s film

Finished film: `out/one-ordinary-afternoon.mp4` · captions: `out/*.srt`, `out/*.vtt` · brief: `START-HERE.txt`

## Rebuild / edit

```bash
python3 project/build.py                  # full build (renders the end card with Chromium)
python3 project/build.py --skip-endcard   # reuse rendered end-card frames
```

Needs `ffmpeg`, Python 3 with `numpy`, and Node with `playwright`.

- `project/edit.json` — the timeline: every cut (source in-point, start, end), each voiceover
  line's position, sound-effect cues, music level. Change a number, rebuild.
- `project/endcard.html` — end card, built from `brand/assets` and `brand/fonts`.
- `project/build.py` — synthesises music and sound design, mixes, assembles, encodes, writes captions.
- `project/gen_stills.py`, `gen_video.py`, `xai.py` — how the footage was generated (needs `XAI_API_KEY`
  and xAI credits; not needed to rebuild from the committed clips).
- `clips/` — generated source footage (6 s each, 1920x1088). `stills/` — the keyframes they started from,
  with unused alternates (`*_a`, `*_b`).
- `audio/vo-master.wav` — the voiceover take. Stems (`audio/stem-*.wav`) are written on build.

## How it was made

| Part | Tool |
| --- | --- |
| Keyframe stills | xAI `grok-imagine-image-2.0`; shots 2–7 generated as edits of shot 1 for continuity |
| Motion | xAI `grok-imagine-video-1.5`, image-to-video, 1080p |
| Voiceover | xAI text-to-speech, voice `sal` (the "Cedar" voice named in the request is not an xAI voice) |
| Music, sound design | synthesised in `build.py` (no library or generated music) |
| End card | brand SVG mark animation rendered frame by frame in Chromium |
| Edit, mix, encode | ffmpeg |
