# AudioAware

AudioAware is a Node.js dashboard for monitoring Twitch audio quality in real time and analyzing VODs after stream.

## Features (MVP)

- Live Twitch channel audio monitoring
- Real-time metrics over WebSocket (RMS dBFS, peak dBFS, status)
- Alert rules for silence, low volume, clipping, and recovery
- Visual dashboard alerts
- Optional Twitch chat alerts from a bot account
- VOD post-analysis with summary output

## Tech Stack

- Backend: Node.js, Express, ws
- Audio ingest/decoding: `streamlink` + `ffmpeg`
- Frontend: Vanilla HTML/CSS/JS

## Prerequisites

Install these locally:

- Node.js 18+
- `ffmpeg`
- `streamlink`

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment:

```bash
cp .env.example .env
```

If you want Twitch chat alerts, add:

- `TWITCH_BOT_USERNAME`
- `TWITCH_BOT_OAUTH_TOKEN` (format: `oauth:...`)

3. Start the app:

```bash
npm start
```

4. Open:

`http://localhost:3030`

## How to Use

### Live monitoring

1. Enter Twitch channel name
2. Optionally enable chat alerts and set channel
3. Click **Start Live Monitoring**
4. Watch status, meter, and alert feed
5. Click **Stop** when done

### VOD analysis

1. Paste Twitch VOD URL (e.g. `https://www.twitch.tv/videos/...`)
2. Click **Analyze VOD**
3. Review duration, average RMS, peak, and issue counts

## Settings Guide

This app checks audio in small chunks and classifies each chunk as:

- **ok** = healthy audio
- **low** = audible but quiet
- **silent** = very quiet / effectively no audio
- **clipping** = too loud / distorted peak

Then it applies timing rules to decide when to raise alerts.

---

### 1) Level thresholds (how audio is classified)

These settings decide what counts as low/silent/clipping.

- **Silence RMS (dB)** (default: `-50`)
  - If RMS is at or below this, status becomes **silent**.
  - Move closer to 0 (for example `-45`) to detect silence sooner.
  - Move lower (for example `-55`) to be less sensitive to silence.

- **Low RMS (dB)** (default: `-30`)
  - If RMS is at or below this (but not silent), status becomes **low**.
  - Move closer to 0 (for example `-25`) to detect quiet audio sooner.
  - Move lower (for example `-35`) to reduce low-volume warnings.

- **Clipping Peak (dB)** (default: `-1`)
  - If peak reaches or exceeds this, status becomes **clipping**.
  - Lowering this to `-2` makes clipping detection stricter.
  - Raising toward `0` makes clipping alerts less frequent.

---

### 2) Analysis speed

- **Window (ms)** (default: `500`)
  - Audio is analyzed once per window.
  - `500 ms` means ~2 checks per second.
  - Smaller window = faster reaction, but can be noisier.
  - Larger window = smoother behavior, but slower reaction.

---

### 3) Alert timing rules (when alerts are fired)

These settings control when the app turns status changes into alerts.

- **Silence min sec** (default: `3`)
  - Silent status must continue for this many seconds before a **silent alert** is sent.

- **Low min sec** (default: `5`)
  - Low status must continue for this many seconds before a **low alert** is sent.

- **Clipping hits** (default: `3`)
  - Clipping status must appear this many consecutive analysis windows before a **clipping alert** is sent.
  - With `windowMs = 500`, `3` hits is about `1.5s`.

- **Recovery sec** (default: `2`)
  - After being in a problem state (silent/low/clipping), audio must stay **ok** for this long before a **recovered alert** is sent.

- **Cooldown sec** (default: `30`)
  - Minimum time between repeated alerts of the **same type** (`silent`, `low`, `clipping`).
  - Prevents spam during ongoing problems.
  - Cooldown is tracked per type (silent has its own timer, low its own, clipping its own).

---

### 4) Twitch chat alert settings

In Live Monitor you can also control chat behavior:

- **Twitch chat alerts**: enable/disable sending alerts to chat
- **Chat channel**: where bot messages go (defaults to monitored channel)
- **Twitch alert types**: choose which alert types can be posted (`Silent`, `Low`, `Clipping`, `Recovered`)

Dashboard alerts still appear even if chat alerts are disabled.

---

### 5) Easy starter presets

If you are new, start with one of these:

- **Balanced (recommended)**
  - Keep defaults.

- **Less noisy (fewer alerts)**
  - Increase `silenceMinSec`, `lowMinSec`, and `cooldownSec`.
  - Optionally lower sensitivity by moving `silenceRmsDb` and `lowRmsDb` down.

- **More sensitive (catch issues fast)**
  - Decrease `silenceMinSec` and `lowMinSec`.
  - Decrease `clippingHits`.
  - Optionally increase sensitivity by moving `silenceRmsDb` and `lowRmsDb` closer to 0.

Tip: change one setting at a time and test for a few minutes before adjusting more.

## Notes

- `streamlink` is used to resolve Twitch stream/VOD media URLs.
- If live ingest fails, check local `ffmpeg`/`streamlink` installation first.
- Twitch chat alerting is optional; dashboard alerting works without bot credentials.
