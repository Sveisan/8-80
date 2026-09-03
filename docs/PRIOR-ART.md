# Prior art

Repositories worth reading before building any part of 8&80 twice. The list is
organised by the question each group answers, not by popularity. Every entry says what
we would take from it and — more usefully — where it disagrees with a decision already
recorded in [DECISIONS.md](../DECISIONS.md).

Stars and licences were read from the repository pages in September 2026. Anything not
marked as read is a pointer, not a recommendation: the field moves fast enough that a
2025 turn-detection model may already be deprecated by its own maintainer.

---

## 1. Speaking breaks — the pause is the product

Our hardest requirement is holding the silence that a person needs to answer honestly,
which is exactly the silence every off-the-shelf VAD cuts. `src/turn/endpointer.ts` does
this with lexical context (trailing words, backchannels, per-user patience). These are
the four ways other people have attacked the same problem.

| Repo | What it is | Where it lands for us |
|---|---|---|
| [pipecat-ai/smart-turn](https://github.com/pipecat-ai/smart-turn) | BSD-2, 1.6k★. Whisper-tiny + a linear head, ~8M params, 23 languages. Takes up to 8s of **audio** and predicts whether the phrase has ended — prosody, not words. | The strongest complement to what we have. Ours reads the transcript; this reads the tone of voice. A trailing "...because" and a sentence spoken with falling pitch are different signals, and we currently only see one of them. int8 CPU build is 8MB — it fits in the voice service without a GPU. |
| [vogent/vogent-turn](https://github.com/vogent/vogent-turn) | Apache-2.0 inference, modified licence on weights, 52★. ~80M params: Whisper-tiny audio encoder **plus** a SmolLM-135M text encoder, taking the previous line and the current partial. | The closest architecture to our design intent — audio and context in one model, including *which question was just asked*. That is our `lastAgentTurnId`/`lastTurnWasHard` distinction, learned rather than hand-tuned. Bigger and heavier than smart-turn. |
| [TEN-framework/ten-turn-detection](https://github.com/TEN-framework/ten-turn-detection) | Apache-2.0 with additions, 608★. Qwen2.5-7B fine-tune classifying **finished / unfinished / wait**. | The three-state framing is the useful idea, not the model — 7B is far too heavy for a per-turn decision on a phone call. "Wait" is a state we do not have and probably need: "hold on", "let me think", "give me a second" is precisely the moment we must not speak. |
| [livekit/agents · turn-detector plugin](https://github.com/livekit/agents/tree/main/livekit-plugins/livekit-plugins-turn-detector) | Apache-2.0 plugin, LiveKit Model Licence on the weights. Qwen2.5-0.5B fine-tune, text-only EOU, 14 languages. **The maintainers have deprecated it** in favour of an audio detector built into `livekit-agents`. | Read it as a cautionary tale rather than a dependency: the industry's most-deployed text-only endpointer was retired because transcript-only endpointing hits a ceiling. We are on the same side of that ceiling today. |

### The research line underneath all four

- [ErikEkstedt/VoiceActivityProjection](https://github.com/ErikEkstedt/VoiceActivityProjection) — MIT, 118★. Voice Activity Projection: instead of classifying "has the turn ended", it continuously *forecasts* both speakers' voice activity over a 2s horizon, from stereo audio, self-supervised. Turn-shift, backchannel and pause fall out of the same prediction. Trained on Switchboard/Fisher/Candor (audio not redistributable). Companion repos: [ErikEkstedt/VAP](https://github.com/ErikEkstedt/VAP), [ErikEkstedt/vap_turn_taking](https://github.com/ErikEkstedt/vap_turn_taking).
  This is the framing our `longestPauseInTurnMs` and per-user patience offset are approximating by hand. Worth reading before the next endpointing change even if we never ship the model.
- [Linyx1125/MM-F2F](https://github.com/Linyx1125/MM-F2F) — ACL 2025. Turn-taking *and* backchannel prediction from linguistic + acoustic + visual signals, with a released dataset (~1.5M words, ~20M annotated frames). The vision half is irrelevant to a phone call; the backchannel annotations are not.
- The IPU / pause / gap vocabulary from this literature is the one we should be using in `runs/` metrics: silence over ~200ms is an *IPU boundary*, a **pause** if the same speaker resumes and a **gap** if the turn changes. Our "phantom endpoint" metric is measuring pause-vs-gap misclassification under a different name.

## 2. Full-duplex — where the field is going, and how it is scored

Our loop is half-duplex by construction, which is the right call for a 15-minute phone
call. But the benchmarks from the full-duplex world are directly reusable as the corpus
layer described in [DECISIONS.md](../DECISIONS.md) § *How silence gets tested*.

- [Ruiqi-Yan/Awesome-Full-Duplex-SDM](https://github.com/Ruiqi-Yan/Awesome-Full-Duplex-SDM) — the best-maintained index: datasets, models, benchmarks, surveys. Points at **Full-Duplex-Bench v1–v3**, **TurnBench** (turn-taking dynamics across domains), **Talking Turns**, **MTR-DuplexBench**, semantic interruption-detection metrics, and the **TURNS-2K** / **ConversationalVoice** annotation sets.
- [cyrta/awesome-full-duplex-speech-to-speech](https://github.com/cyrta/awesome-full-duplex-speech-to-speech) — same territory, categorised by architecture.
- [ASLP-lab/HumDial-FDBench](https://github.com/ASLP-lab/HumDial-FDBench) — the ICASSP 2026 challenge track, with a dual-channel dataset of *real human-recorded* conversations. Dual-channel human audio with turn annotations is exactly the fixture material our replay harness wants and cannot generate.
- [elpsykongloo/FD-SLMs](https://github.com/elpsykongloo/FD-SLMs), [ddlBoJack/Awesome-Speech-Language-Model](https://github.com/ddlBoJack/Awesome-Speech-Language-Model), [dreamtheater123/awesome-speechlm-survey](https://github.com/dreamtheater123/awesome-speechlm-survey) — survey-level reading.

**The caveat that matters.** Every one of these benchmarks rewards *fast* turn-taking.
Ours is the only product here that would score badly on purpose. If we adopt their
fixtures we must invert the sign on latency and keep our own asymmetry: a false cut
costs far more than a late response.

## 3. Runtimes and telephony — the parts we deliberately did not buy

We run a provider-neutral service with our own turn-taking because the chosen stack
offers silence timing only. These are the alternatives, and what they would have cost.

- [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat) — Python, v1.0, STT→LLM→TTS pipelines, 500–800ms round trip, the clearest pipeline model of the lot, and the same people who publish smart-turn.
- [livekit/agents](https://github.com/livekit/agents) — WebRTC-native, biggest plugin surface, commercial backing; SIP/telephony included.
- [TEN-framework](https://github.com/TEN-framework) and [vocodedev/vocode-core](https://github.com/vocodedev/vocode-core) — modular real-time agents; Vocode covers telephony, browser and custom transports in Python and TypeScript.
- [KoljaB/RealtimeVoiceChat](https://github.com/KoljaB/RealtimeVoiceChat) — MIT, 3.8k★, browser + Python backend. Its `turndetect.py` adapts the silence threshold to conversation pace: the same instinct as our per-user patience offset, implemented in ~200 readable lines. Small enough to read in one sitting, and the closest analogue to our own module.
- [yzfly/awesome-voice-agents](https://github.com/yzfly/awesome-voice-agents) — the index, when a new provider needs evaluating.
- [CALLE-AI/awesome-phone-call-agents](https://github.com/CALLE-AI/awesome-phone-call-agents) — scheduled/recurring outbound call recipes and safety patterns. Unvetted, but it is the only collection aimed at *recurring scheduled calls*, which is our exact shape.

Adopting any of these means adopting their turn-taking defaults, and the defaults are
200–500ms of silence. That is the decision already recorded — the framework is not the
problem, its patience is.

## 4. Accountability, coaching, empowerment

Thin on the ground: almost everything here is text-first and session-based rather than a
scheduled call you cannot postpone, which is the one mechanism 8&80 is actually built
on. Read them for the conversational structure, not the delivery.

- [ocdevel/gnothi](https://github.com/ocdevel/gnothi) — AGPL-3.0, 210★, **archived 2023**. AI journal and self-discovery toolkit; the longest-running serious attempt at this and worth reading precisely because it stopped.
- [tripathiarpan20/self-improvement-4all](https://github.com/tripathiarpan20/self-improvement-4all) — private coaching on local LLMs with an explicit **Plan → Act → Reflect** loop. That loop is our call structure: last week's commitment, what happened, the one thing next.
- [ericblue/habit-sprint](https://github.com/ericblue/habit-sprint) — a deterministic JSON state engine for sprint-based habits where the LLM is the interface, not the store. The right separation for us too: the commitment is data, the mentor is a renderer over it.
- [clairefro/obsidian-chat-cbt-plugin](https://github.com/clairefro/obsidian-chat-cbt-plugin) — CBT-shaped journaling, local models via Ollama.
- [thillai-c/CBT-Copilot](https://github.com/thillai-c/CBT-Copilot) — a small fine-tune for supportive CBT-style dialogue.

## 5. What the mentor is allowed to say

`SCRIPT.md` plus the adaptation table in DECISIONS.md is a *values* document as much as a
prompt. These are the repos that treat that as an object of study.

- [IanSteenstra/llm-alcohol-counselor](https://github.com/IanSteenstra/llm-alcohol-counselor) — the full prompt for an LLM running Motivational Interviewing toward one tangible step this week. MI's whole discipline is asking rather than advising, and tolerating silence while the person answers. The closest published thing to our mentor's stance.
- [Columbia-ICSL/CaiTI_dataset](https://github.com/Columbia-ICSL/CaiTI_dataset) — MI and CBT conversation data labelled by licensed psychotherapists, plus few-shot prompts for a Reasoner/Guide/Validator split.
- [hendrycks/ethics](https://github.com/hendrycks/ethics) — MIT, 327★, ICLR 2021. The ETHICS benchmark: justice, deontology, virtue ethics, utilitarianism, commonsense morality. Not a product dependency; the reference point if we ever need to argue that a mentor line is a judgement about a person rather than an observation about their week — the line DECISIONS.md draws and does not let the system cross on its own.
- [Sahandfer/EMPaper](https://github.com/Sahandfer/EMPaper) — empathetic dialogue papers with code links.
- [FreedomIntelligence/Awesome-LLM-Patient-Simulators](https://github.com/FreedomIntelligence/Awesome-LLM-Patient-Simulators) — simulated interlocutors. The stress test is n=1 and we know what is coming; simulated callers with different pause habits are the only cheap way past that.

## 6. Measuring how someone speaks

The per-user patience offset needs a pause distribution, and these compute one from audio
we already have.

- [Shahabks/my-voice-analysis](https://github.com/Shahabks/my-voice-analysis) — Praat-backed Python: syllable boundaries, f0 contours, formants, filler and pause counts, **without a transcript**. Directly applicable to building each caller's pause profile from privacy-cheap features.
- [michael-borck/speech-analyser](https://github.com/michael-borck/speech-analyser) — speaking rate, filler words, silence ratio per file. A batch version of the metrics `runs/` should carry.
- [Mrunal-G/Casual-turn-taking-and-backchannel-prediction](https://github.com/Mrunal-G/Casual-turn-taking-and-backchannel-prediction) — labelled backchannel behaviour; a check on our hand-written `BACKCHANNEL` set.

## Shortlist

If only three of these are ever read:

1. **smart-turn** — an audio second opinion alongside our lexical rules, small enough to run in-process.
2. **VoiceActivityProjection** — the correct mental model for pause-vs-gap, which our metrics currently name informally.
3. **HumDial-FDBench** — real dual-channel human conversation with turn annotations, i.e. the fixtures the replay harness needs and cannot invent.

None of them changes the decision to own turn-taking. All three make owning it cheaper.
