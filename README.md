# Ra

Nobody has the map anymore, not for work and not for meaning. Ra is a voice you talk to at dusk. It listens for where your voice lifts, finds the real question under your worry, and leaves you one small step for tomorrow. Every session (a Ray) ends in a ring kept in your own words, so over months you can see who you're becoming.

Ra doesn't teach, test or flatter. Before it says anything, a Muse Spark judge checks the line against Ra's promises.

## Built on Meta's Muse models

Ra uses three Meta Muse models, and nothing else, for language and speech. All model calls are in `apps/worker/src`:

| Feature | Model | Where |
| --- | --- | --- |
| Hearing you in a Ray, live | **Muse Transcribe** `muse-voice-transcribe-1.0` (realtime socket) | `transcribe/muse.ts` |
| Hearing a clip: walkie, Speak, Bring back, the Ear | **Muse Transcribe**, one clip at a time | `transcribe/museClip.ts` |
| Ra's spoken lines in a Ray | **Muse Spark** `muse-spark-1.3` | `mind/turns.ts`, `mind/MindDO.ts` |
| Promise check on every line, the hurting check (care), every moment decision | **Muse Spark** as a strict-schema judge | `mind/museJudge.ts`, `mind/check.ts` |
| Your question, drafted while the stage before runs | **Muse Spark** | `mind/moments.ts` |
| Choosing your Horizon field | **Muse Spark** judge | `mind/MindDO.ts` (`chooseWindow`) |
| Reading a photo you bring back | **Muse Spark** with image input | `muse/http.ts` (`see`) |
| Ask the Chart, with exact quotes | **Muse Spark** | `mind/chartAsk.ts` |
| Next island (route proposals) | **Muse Spark** | `mind/routes.ts` |
| The Dial: questions, forecasts, outcomes | **Muse Spark** | `mind/dialModel.ts` |
| The Watch: overnight memories backed by your quotes | **Muse Spark** | `workflows/watch.ts` |
| The Horizon: where your field is going, from cited sources | **Muse Wonder** `muse-wonder-1.0` with web search | `workflows/horizon.ts` |
| Scouting trips | **Muse Wonder** designs them; a **Muse Spark** judge keeps only those you can do today with what you have | `workflows/trips.ts` |

Not Meta models: Ra's voice is ElevenLabs Flash v2.5 (`voice/index.ts`), and beacon matching uses bge-m3 embeddings on Workers AI (`embeddings.ts`). No model runs on the phone.

## How it fits together

```
apps/
  web/       the screens: Vite, Preact, TypeScript, three.js
  worker/    Cloudflare Worker: a Durable Object Mind per person, the Horizon, Workflows, Muse, voice
  android/   a thin shell: one origin-restricted WebView, Keystore vault, encrypted captures
packages/
  core/      event schemas, the append-only log, the shared reducer, the live socket protocol
  prompts/   Ra's promises and per-stage instructions, versioned
seed/        the starting Horizon signals
```

The phone streams 16 kHz audio over a socket to the person's Mind (a Durable Object). Muse Transcribe turns it into words; Muse Spark drafts Ra's reply, a Spark judge checks it, and ElevenLabs speaks it. Everything the person says is sealed at rest with their own data key. Workflows design trips with Muse Wonder, read each field's Horizon weekly, and run the overnight Watch.

## Run it

Needs Node 22+ and pnpm.

```bash
pnpm install
```

```bash
pnpm dev
```

Put `MUSE_KEY` (and optionally `ELEVENLABS_KEY`) in `apps/worker/.dev.vars`. `pnpm dev` builds the web app and starts the Worker on <http://127.0.0.1:8787>. Open it, tap the sun-coloured button and talk.

To see Amani's story from the demo, load her mind on the local Worker and open it as her:

```bash
curl -X POST "http://127.0.0.1:8787/dev/seed?person=amani"
```

Then open <http://127.0.0.1:8787/?as=amani>.

### Android shell

With `pnpm dev` running and a phone or emulator on USB:

```bash
adb reverse tcp:8787 tcp:8787
```

```bash
cd apps/android && ./gradlew installDebug
```

To point the shell at a deployed Worker instead, build with `-Pra.url=https://<your-worker>/`.

## Keys

Keys never go in code, the repo or the phone. A deployed Worker reads `MUSE_KEY` and `ELEVENLABS_KEY` from Cloudflare Secrets Store. A live provider without its key fails loudly instead of falling back to fake output.
