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

## Notes

- `streamlink` is used to resolve Twitch stream/VOD media URLs.
- If live ingest fails, check local `ffmpeg`/`streamlink` installation first.
- Twitch chat alerting is optional; dashboard alerting works without bot credentials.
