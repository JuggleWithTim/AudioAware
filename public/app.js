const els = {
  liveChannel: document.getElementById("liveChannel"),
  liveQuality: document.getElementById("liveQuality"),
  chatEnabled: document.getElementById("chatEnabled"),
  chatChannel: document.getElementById("chatChannel"),
  alertTypeSilent: document.getElementById("alertTypeSilent"),
  alertTypeLow: document.getElementById("alertTypeLow"),
  alertTypeClipping: document.getElementById("alertTypeClipping"),
  alertTypeRecovered: document.getElementById("alertTypeRecovered"),
  autoMonitorEnabled: document.getElementById("autoMonitorEnabled"),
  autoMonitorIntervalSec: document.getElementById("autoMonitorIntervalSec"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  startLiveBtn: document.getElementById("startLiveBtn"),
  stopLiveBtn: document.getElementById("stopLiveBtn"),
  vodUrl: document.getElementById("vodUrl"),
  vodQuality: document.getElementById("vodQuality"),
  analyzeVodBtn: document.getElementById("analyzeVodBtn"),
  statusBadge: document.getElementById("statusBadge"),
  rmsDb: document.getElementById("rmsDb"),
  peakDb: document.getElementById("peakDb"),
  tsSec: document.getElementById("tsSec"),
  meterFill: document.getElementById("meterFill"),
  liveAlerts: document.getElementById("liveAlerts"),
  systemLog: document.getElementById("systemLog"),
  vodSummary: document.getElementById("vodSummary"),
};

const settingIds = [
  "silenceRmsDb",
  "lowRmsDb",
  "clipPeakDb",
  "windowMs",
  "silenceMinSec",
  "lowMinSec",
  "clippingHits",
  "recoverySec",
  "cooldownSec",
];

function getSettings() {
  return settingIds.reduce((acc, id) => {
    const el = document.getElementById(id);
    if (!el) return acc;
    acc[id] = Number(el.value);
    return acc;
  }, {});
}

function pushListItem(listEl, text) {
  const li = document.createElement("li");
  li.textContent = text;
  listEl.prepend(li);
  if (listEl.children.length > 100) {
    listEl.removeChild(listEl.lastChild);
  }
}

function setBadge(status) {
  const map = {
    ok: ["OK", "ok"],
    low: ["LOW", "warning"],
    silent: ["SILENT", "warning"],
    clipping: ["CLIPPING", "critical"],
  };
  const [label, klass] = map[status] || [String(status).toUpperCase(), "warning"];
  els.statusBadge.textContent = label;
  els.statusBadge.className = `badge ${klass}`;
}

function updateMetric(metric) {
  els.rmsDb.textContent = metric.rmsDb.toFixed(1);
  els.peakDb.textContent = metric.peakDb.toFixed(1);
  els.tsSec.textContent = metric.timestampSec.toFixed(1);
  setBadge(metric.status);

  const normalized = Math.max(0, Math.min(1, (metric.peakDb + 60) / 60));
  els.meterFill.style.width = `${Math.round(normalized * 100)}%`;
}

function appendSystem(message, level = "info") {
  pushListItem(els.systemLog, `[${new Date().toLocaleTimeString()}] (${level}) ${message}`);
}

function getEnabledAlertTypes() {
  return {
    silent: els.alertTypeSilent.checked,
    low: els.alertTypeLow.checked,
    clipping: els.alertTypeClipping.checked,
    recovered: els.alertTypeRecovered.checked,
  };
}

function applyEnabledTypes(enabledTypes = {}) {
  if (typeof enabledTypes.silent === "boolean") els.alertTypeSilent.checked = enabledTypes.silent;
  if (typeof enabledTypes.low === "boolean") els.alertTypeLow.checked = enabledTypes.low;
  if (typeof enabledTypes.clipping === "boolean") {
    els.alertTypeClipping.checked = enabledTypes.clipping;
  }
  if (typeof enabledTypes.recovered === "boolean") {
    els.alertTypeRecovered.checked = enabledTypes.recovered;
  }
}

function setNumericValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (typeof value === "number" && Number.isFinite(value)) {
    el.value = String(value);
  }
}

function buildPersistedSettingsPayload() {
  const s = getSettings();

  return {
    live: {
      channel: els.liveChannel.value.trim(),
      quality: els.liveQuality.value.trim() || "best",
    },
    analysis: {
      silenceRmsDb: s.silenceRmsDb,
      lowRmsDb: s.lowRmsDb,
      clipPeakDb: s.clipPeakDb,
      windowMs: s.windowMs,
    },
    alertRules: {
      silenceMinSec: s.silenceMinSec,
      lowMinSec: s.lowMinSec,
      clippingHits: s.clippingHits,
      recoverySec: s.recoverySec,
      cooldownSec: s.cooldownSec,
    },
    chat: {
      enabled: els.chatEnabled.checked,
      channel: els.chatChannel.value.trim(),
      enabledTypes: getEnabledAlertTypes(),
    },
    autoMonitor: {
      enabled: els.autoMonitorEnabled.checked,
      intervalSec: Number(els.autoMonitorIntervalSec.value || 45),
    },
  };
}

function applyServerSettings(settings = {}) {
  if (settings.live) {
    if (typeof settings.live.channel === "string") els.liveChannel.value = settings.live.channel;
    if (typeof settings.live.quality === "string") els.liveQuality.value = settings.live.quality;
  }

  if (settings.analysis) {
    setNumericValue("silenceRmsDb", settings.analysis.silenceRmsDb);
    setNumericValue("lowRmsDb", settings.analysis.lowRmsDb);
    setNumericValue("clipPeakDb", settings.analysis.clipPeakDb);
    setNumericValue("windowMs", settings.analysis.windowMs);
  }

  if (settings.alertRules) {
    setNumericValue("silenceMinSec", settings.alertRules.silenceMinSec);
    setNumericValue("lowMinSec", settings.alertRules.lowMinSec);
    setNumericValue("clippingHits", settings.alertRules.clippingHits);
    setNumericValue("recoverySec", settings.alertRules.recoverySec);
    setNumericValue("cooldownSec", settings.alertRules.cooldownSec);
  }

  if (settings.chat) {
    if (typeof settings.chat.enabled === "boolean") els.chatEnabled.checked = settings.chat.enabled;
    if (typeof settings.chat.channel === "string") els.chatChannel.value = settings.chat.channel;
    applyEnabledTypes(settings.chat.enabledTypes);
  }

  if (settings.autoMonitor) {
    if (typeof settings.autoMonitor.enabled === "boolean") {
      els.autoMonitorEnabled.checked = settings.autoMonitor.enabled;
    }
    if (typeof settings.autoMonitor.intervalSec === "number") {
      els.autoMonitorIntervalSec.value = String(settings.autoMonitor.intervalSec);
    }
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

async function apiPost(path, body) {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

async function loadSettings() {
  try {
    const data = await api("/api/settings");
    applyServerSettings(data.settings);
    appendSystem("Loaded settings from server");
  } catch (error) {
    appendSystem(`Failed to load settings: ${error.message}`, "warn");
  }
}

async function saveSettings() {
  try {
    const payload = buildPersistedSettingsPayload();
    const data = await apiPost("/api/settings", payload);
    applyServerSettings(data.settings);
    appendSystem("Settings saved");
  } catch (error) {
    appendSystem(error.message, "error");
  }
}

async function startLive() {
  const channel = els.liveChannel.value.trim();
  if (!channel) {
    appendSystem("Channel is required", "warn");
    return;
  }

  try {
    await saveSettings();

    const payload = {
      channel,
      quality: els.liveQuality.value.trim() || "best",
      settings: getSettings(),
      alerts: {
        chatEnabled: els.chatEnabled.checked,
        chatChannel: els.chatChannel.value.trim(),
        enabledTypes: getEnabledAlertTypes(),
      },
    };
    const data = await apiPost("/api/live/start", payload);
    appendSystem(`Live monitoring started for ${channel}`);
    if (data.chatEnabled) {
      appendSystem(`Twitch chat alerts enabled (${data.chatChannel})`);
    }
  } catch (error) {
    appendSystem(error.message, "error");
  }
}

async function stopLive() {
  try {
    await apiPost("/api/live/stop", {});
    appendSystem("Live monitoring stopped");
    setBadge("ok");
  } catch (error) {
    appendSystem(error.message, "error");
  }
}

async function analyzeVod() {
  const vodUrl = els.vodUrl.value.trim();
  if (!vodUrl) {
    appendSystem("VOD URL is required", "warn");
    return;
  }

  els.vodSummary.textContent = "Analyzing VOD... this can take a while.";

  try {
    const payload = {
      vodUrl,
      quality: els.vodQuality.value.trim() || "best",
      settings: getSettings(),
    };
    const data = await apiPost("/api/vod/analyze", payload);
    const s = data.summary;
    els.vodSummary.textContent = [
      `Duration: ${s.durationSec?.toFixed?.(1) ?? 0}s`,
      `Average RMS: ${s.avgRmsDb?.toFixed?.(1) ?? "n/a"} dBFS`,
      `Peak: ${s.peakDb?.toFixed?.(1) ?? "n/a"} dBFS`,
      `Issues -> silent: ${s.issues.silent}, low: ${s.issues.low}, clipping: ${s.issues.clipping}`,
      `Alerts: ${s.alerts.length}`,
    ].join("\n");
    appendSystem("VOD analysis completed");
  } catch (error) {
    els.vodSummary.textContent = "";
    appendSystem(error.message, "error");
  }
}

function initSocket() {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${window.location.host}`);

  ws.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "metric") {
        updateMetric(msg.payload);
      } else if (msg.type === "alert") {
        const a = msg.payload;
        pushListItem(
          els.liveAlerts,
          `[${a.severity}] ${a.message} @ ${a.timestampSec.toFixed(1)}s`
        );
      } else if (msg.type === "system") {
        appendSystem(msg.payload.message, msg.payload.level);
      } else if (msg.type === "session") {
        const reason = msg.payload.reason ? `, reason: ${msg.payload.reason}` : "";
        const by = msg.payload.initiatedBy ? `, by: ${msg.payload.initiatedBy}` : "";
        appendSystem(`Session ${msg.payload.state} (${msg.payload.sourceType}${reason}${by})`);
      }
    } catch (error) {
      appendSystem(`Socket parse error: ${error.message}`, "error");
    }
  });

  ws.addEventListener("open", () => appendSystem("WebSocket connected"));
  ws.addEventListener("close", () => appendSystem("WebSocket closed", "warn"));
}

els.startLiveBtn.addEventListener("click", startLive);
els.stopLiveBtn.addEventListener("click", stopLive);
els.analyzeVodBtn.addEventListener("click", analyzeVod);
els.saveSettingsBtn.addEventListener("click", saveSettings);

loadSettings();
initSocket();
