require("dotenv").config();

const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");

const { AudioAnalyzer, DEFAULT_ANALYSIS_SETTINGS } = require("./audio/analyzer");
const { startFfmpegPcmStream, DEFAULT_SAMPLE_RATE } = require("./audio/ffmpegRunner");
const {
  isChannelLive,
  normalizeChannelName,
  resolveLiveStreamUrl,
  resolveVodStreamUrl,
} = require("./twitch");
const { AlertEngine, DEFAULT_ALERT_SETTINGS } = require("./alerts/rules");
const { Notifier } = require("./alerts/notifier");
const { SettingsStore } = require("./settingsStore");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const notifier = new Notifier({ wss, env: process.env });
const settingsStore = new SettingsStore();

const PORT = Number(process.env.PORT || 3030);
const ALERT_TYPES = ["silent", "low", "clipping", "recovered"];

let liveSession = null;
let autoMonitorTimer = null;
let autoCheckInProgress = false;
let nextSessionId = 1;

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

function normalizeAlertTypeSettings(input = {}) {
  return ALERT_TYPES.reduce((acc, type) => {
    acc[type] = input[type] !== false;
    return acc;
  }, {});
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

function buildLiveConfig(body = {}) {
  const saved = settingsStore.get();
  const settings = body.settings || {};
  const alerts = body.alerts || {};

  const channel = normalizeChannelName(body.channel || saved.live.channel);
  const quality = String(body.quality || saved.live.quality || "best").trim() || "best";
  const analysisSettings = mergeAnalysisSettings({ ...saved.analysis, ...settings });
  const alertSettings = mergeAlertSettings({ ...saved.alertRules, ...settings });
  const chatEnabled =
    typeof alerts.chatEnabled === "boolean" ? alerts.chatEnabled : Boolean(saved.chat.enabled);
  const chatChannel = normalizeChannelName(alerts.chatChannel || saved.chat.channel || channel);
  const enabledTypes = normalizeAlertTypeSettings(alerts.enabledTypes || saved.chat.enabledTypes);

  return {
    channel,
    quality,
    analysisSettings,
    alertSettings,
    chatEnabled,
    chatChannel,
    enabledTypes,
  };
}

function buildVodConfig(body = {}) {
  const saved = settingsStore.get();
  const settings = body.settings || {};

  return {
    quality: String(body.quality || "best").trim() || "best",
    analysisSettings: mergeAnalysisSettings({ ...saved.analysis, ...settings }),
    alertSettings: mergeAlertSettings({ ...saved.alertRules, ...settings }),
  };
}

function persistLiveConfig(config) {
  settingsStore.update({
    live: {
      channel: config.channel,
      quality: config.quality,
    },
    analysis: config.analysisSettings,
    alertRules: config.alertSettings,
    chat: {
      enabled: config.chatEnabled,
      channel: config.chatChannel,
      enabledTypes: config.enabledTypes,
    },
  });
}

function stopLiveSession({ reason = "manual", initiatedBy = "manual" } = {}) {
  if (!liveSession) return;

  const session = liveSession;
  liveSession = null;
  session.runner.stop();

  notifier.broadcast("session", {
    state: "stopped",
    sourceType: "live",
    channel: session.channel,
    reason,
    initiatedBy,
  });
}

async function startLiveSession(config, { initiatedBy = "manual" } = {}) {
  if (!config.channel) {
    throw new Error("channel is required");
  }

  if (liveSession) stopLiveSession({ reason: "replaced", initiatedBy });

  const resolved = await resolveLiveStreamUrl(config.channel, config.quality);
  const analyzer = new AudioAnalyzer(config.analysisSettings);
  const alertEngine = new AlertEngine(config.alertSettings);
  const sessionId = nextSessionId;
  nextSessionId += 1;

  const runner = startFfmpegPcmStream({
    inputUrl: resolved.streamUrl,
    sampleRate: config.analysisSettings.sampleRate,
    onSamples: async (samples) => {
      const metrics = analyzer.processSamples(samples);
      for (const metric of metrics) {
        notifier.broadcast("metric", metric);
        const newAlerts = alertEngine.processMetric(metric);
        for (const alert of newAlerts) {
          await notifier.notifyAlert(alert, {
            chatEnabled: config.chatEnabled,
            chatChannel: config.chatChannel,
            enabledTypes: config.enabledTypes,
          });
        }
      }
    },
    onError: (error) => {
      if (!liveSession || liveSession.id !== sessionId) return;
      notifier.broadcast("system", { level: "error", message: error.message });
      stopLiveSession({ reason: "ingest-error", initiatedBy: "system" });
    },
    onEnd: ({ stopped }) => {
      if (!liveSession || liveSession.id !== sessionId) return;

      if (!stopped) {
        notifier.broadcast("system", {
          level: "warn",
          message: "Live ingest ended unexpectedly",
        });
      }
      stopLiveSession({ reason: stopped ? "manual" : "ingest-ended", initiatedBy: "system" });
    },
  });

  liveSession = {
    id: sessionId,
    channel: config.channel,
    quality: config.quality,
    startedAt: Date.now(),
    initiatedBy,
    runner,
  };

  notifier.broadcast("session", {
    state: "started",
    sourceType: "live",
    channel: config.channel,
    initiatedBy,
  });

  return {
    source: resolved,
    analysisSettings: config.analysisSettings,
    alertSettings: config.alertSettings,
    chatEnabled: config.chatEnabled,
    chatChannel: config.chatChannel,
    enabledTypes: config.enabledTypes,
  };
}

async function runAutoMonitorCheck() {
  if (autoCheckInProgress) return;

  const settings = settingsStore.get();
  if (!settings.autoMonitor.enabled) return;
  if (!settings.live.channel) return;

  autoCheckInProgress = true;
  try {
    const channel = settings.live.channel;
    const quality = settings.live.quality || "best";
    const online = await isChannelLive(channel, quality);

    if (online && !liveSession) {
      notifier.broadcast("system", {
        level: "info",
        message: `Auto-monitor detected ${channel} is live. Starting monitoring.`,
      });

      const config = buildLiveConfig({ channel, quality });
      await startLiveSession(config, { initiatedBy: "auto" });
      return;
    }

    if (!online && liveSession && liveSession.channel === channel) {
      notifier.broadcast("system", {
        level: "warn",
        message: `${channel} appears offline. Stopping monitoring.`,
      });
      stopLiveSession({ reason: "stream-offline", initiatedBy: "auto" });
    }
  } catch (error) {
    notifier.broadcast("system", {
      level: "warn",
      message: `Auto-monitor check failed: ${error.message}`,
    });
  } finally {
    autoCheckInProgress = false;
  }
}

function restartAutoMonitor() {
  if (autoMonitorTimer) {
    clearInterval(autoMonitorTimer);
    autoMonitorTimer = null;
  }

  const settings = settingsStore.get();
  if (!settings.autoMonitor.enabled) return;

  const intervalMs = Math.max(15, Number(settings.autoMonitor.intervalSec || 45)) * 1000;
  autoMonitorTimer = setInterval(runAutoMonitorCheck, intervalMs);

  runAutoMonitorCheck();
}

wss.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "system",
      at: new Date().toISOString(),
      payload: { level: "info", message: "Connected to AudioAware server" },
    })
  );
});

app.get("/api/health", (_req, res) => {
  const settings = settingsStore.get();
  res.json({
    ok: true,
    liveActive: Boolean(liveSession),
    autoMonitorEnabled: settings.autoMonitor.enabled,
    channel: settings.live.channel,
  });
});

app.get("/api/settings", (_req, res) => {
  res.json({ ok: true, settings: settingsStore.get() });
});

app.post("/api/settings", (req, res) => {
  const next = settingsStore.update(req.body || {});
  restartAutoMonitor();
  res.json({ ok: true, settings: next });
});

app.post("/api/live/start", async (req, res) => {
  try {
    const config = buildLiveConfig(req.body || {});
    if (!config.channel) {
      return res.status(400).json({ error: "channel is required" });
    }

    persistLiveConfig(config);
    restartAutoMonitor();

    const data = await startLiveSession(config, { initiatedBy: "manual" });
    return res.json({ ok: true, ...data });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/live/stop", (_req, res) => {
  stopLiveSession({ reason: "manual", initiatedBy: "manual" });
  res.json({ ok: true });
});

app.post("/api/vod/analyze", async (req, res) => {
  try {
    const { vodUrl } = req.body || {};
    if (!vodUrl) {
      return res.status(400).json({ error: "vodUrl is required" });
    }

    const config = buildVodConfig(req.body || {});
    const resolved = await resolveVodStreamUrl(vodUrl, config.quality);
    const analyzer = new AudioAnalyzer(config.analysisSettings);
    const alertEngine = new AlertEngine(config.alertSettings);

    const metrics = [];
    const alerts = [];

    await new Promise((resolve, reject) => {
      startFfmpegPcmStream({
        inputUrl: resolved.streamUrl,
        sampleRate: config.analysisSettings.sampleRate,
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

restartAutoMonitor();

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`AudioAware running at http://localhost:${PORT}`);
});
