require("dotenv").config();

const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");

const { AudioAnalyzer, DEFAULT_ANALYSIS_SETTINGS } = require("./audio/analyzer");
const { startFfmpegPcmStream, DEFAULT_SAMPLE_RATE } = require("./audio/ffmpegRunner");
const { resolveLiveStreamUrl, resolveVodStreamUrl } = require("./twitch");
const { AlertEngine, DEFAULT_ALERT_SETTINGS } = require("./alerts/rules");
const { Notifier } = require("./alerts/notifier");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const notifier = new Notifier({ wss, env: process.env });

const PORT = Number(process.env.PORT || 3030);

let liveSession = null;

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mergeAnalysisSettings(input = {}) {
  return {
    ...DEFAULT_ANALYSIS_SETTINGS,
    sampleRate: DEFAULT_SAMPLE_RATE,
    windowMs: num(input.windowMs, DEFAULT_ANALYSIS_SETTINGS.windowMs),
    silenceRmsDb: num(input.silenceRmsDb, DEFAULT_ANALYSIS_SETTINGS.silenceRmsDb),
    lowRmsDb: num(input.lowRmsDb, DEFAULT_ANALYSIS_SETTINGS.lowRmsDb),
    clipPeakDb: num(input.clipPeakDb, DEFAULT_ANALYSIS_SETTINGS.clipPeakDb),
  };
}

function mergeAlertSettings(input = {}) {
  return {
    ...DEFAULT_ALERT_SETTINGS,
    silenceMinSec: num(input.silenceMinSec, DEFAULT_ALERT_SETTINGS.silenceMinSec),
    lowMinSec: num(input.lowMinSec, DEFAULT_ALERT_SETTINGS.lowMinSec),
    clippingHits: num(input.clippingHits, DEFAULT_ALERT_SETTINGS.clippingHits),
    recoverySec: num(input.recoverySec, DEFAULT_ALERT_SETTINGS.recoverySec),
    cooldownSec: num(input.cooldownSec, DEFAULT_ALERT_SETTINGS.cooldownSec),
  };
}

function summarize(metrics, alerts) {
  if (!metrics.length) {
    return {
      durationSec: 0,
      avgRmsDb: null,
      peakDb: null,
      issues: { silent: 0, low: 0, clipping: 0 },
      alerts,
      points: metrics,
    };
  }

  const totalRms = metrics.reduce((sum, m) => sum + m.rmsDb, 0);
  const peakDb = metrics.reduce((max, m) => Math.max(max, m.peakDb), -100);
  const issues = alerts.reduce(
    (acc, a) => {
      if (a.type in acc) acc[a.type] += 1;
      return acc;
    },
    { silent: 0, low: 0, clipping: 0 }
  );

  return {
    durationSec: metrics[metrics.length - 1].timestampSec,
    avgRmsDb: totalRms / metrics.length,
    peakDb,
    issues,
    alerts,
    points: metrics,
  };
}

function stopLiveSession() {
  if (!liveSession) return;
  liveSession.runner.stop();
  notifier.broadcast("session", {
    state: "stopped",
    sourceType: "live",
    channel: liveSession.channel,
  });
  liveSession = null;
}

wss.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "system",
      at: new Date().toISOString(),
      payload: { level: "info", message: "Connected to StreamListen server" },
    })
  );
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, liveActive: Boolean(liveSession) });
});

app.post("/api/live/start", async (req, res) => {
  try {
    const { channel, quality = "best", settings = {}, alerts = {} } = req.body || {};
    if (!channel) {
      return res.status(400).json({ error: "channel is required" });
    }

    if (liveSession) stopLiveSession();

    const resolved = await resolveLiveStreamUrl(channel, quality);
    const analysisSettings = mergeAnalysisSettings(settings);
    const alertSettings = mergeAlertSettings(settings);

    const analyzer = new AudioAnalyzer(analysisSettings);
    const alertEngine = new AlertEngine(alertSettings);
    const chatEnabled = Boolean(alerts.chatEnabled);
    const chatChannel = String(alerts.chatChannel || channel).replace(/^@/, "").trim();

    const runner = startFfmpegPcmStream({
      inputUrl: resolved.streamUrl,
      sampleRate: analysisSettings.sampleRate,
      onSamples: async (samples) => {
        const metrics = analyzer.processSamples(samples);
        for (const metric of metrics) {
          notifier.broadcast("metric", metric);
          const newAlerts = alertEngine.processMetric(metric);
          for (const alert of newAlerts) {
            await notifier.notifyAlert(alert, { chatEnabled, chatChannel });
          }
        }
      },
      onError: (error) => {
        notifier.broadcast("system", { level: "error", message: error.message });
        stopLiveSession();
      },
      onEnd: ({ stopped }) => {
        if (!stopped) {
          notifier.broadcast("system", {
            level: "warn",
            message: "Live ingest ended unexpectedly",
          });
        }
        stopLiveSession();
      },
    });

    liveSession = { channel, runner, startedAt: Date.now() };
    notifier.broadcast("session", { state: "started", sourceType: "live", channel });

    return res.json({
      ok: true,
      source: resolved,
      analysisSettings,
      alertSettings,
      chatEnabled,
      chatChannel,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/live/stop", (_req, res) => {
  stopLiveSession();
  res.json({ ok: true });
});

app.post("/api/vod/analyze", async (req, res) => {
  try {
    const { vodUrl, quality = "best", settings = {} } = req.body || {};
    if (!vodUrl) {
      return res.status(400).json({ error: "vodUrl is required" });
    }

    const resolved = await resolveVodStreamUrl(vodUrl, quality);
    const analysisSettings = mergeAnalysisSettings(settings);
    const alertSettings = mergeAlertSettings(settings);
    const analyzer = new AudioAnalyzer(analysisSettings);
    const alertEngine = new AlertEngine(alertSettings);

    const metrics = [];
    const alerts = [];

    await new Promise((resolve, reject) => {
      startFfmpegPcmStream({
        inputUrl: resolved.streamUrl,
        sampleRate: analysisSettings.sampleRate,
        onSamples: (samples) => {
          const nextMetrics = analyzer.processSamples(samples);
          for (const metric of nextMetrics) {
            metrics.push(metric);
            alerts.push(...alertEngine.processMetric(metric));
          }
        },
        onError: reject,
        onEnd: ({ stopped }) => {
          if (!stopped) resolve();
        },
      });
    });

    return res.json({
      ok: true,
      source: resolved,
      summary: summarize(metrics, alerts),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`StreamListen running at http://localhost:${PORT}`);
});
