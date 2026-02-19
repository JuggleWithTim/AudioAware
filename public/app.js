const els = {
  liveChannel: document.getElementById("liveChannel"),
  liveQuality: document.getElementById("liveQuality"),
  chatEnabled: document.getElementById("chatEnabled"),
  chatChannel: document.getElementById("chatChannel"),
  alertTypeSilent: document.getElementById("alertTypeSilent"),
  alertTypeLow: document.getElementById("alertTypeLow"),
  alertTypeClipping: document.getElementById("alertTypeClipping"),
  alertTypeRecovered: document.getElementById("alertTypeRecovered"),
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

const CHAT_ALERT_PREFS_KEY = "audioaware.chatAlertPrefs.v1";

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

function saveChatAlertPrefs() {
  try {
    const payload = {
      chatEnabled: els.chatEnabled.checked,
      chatChannel: els.chatChannel.value.trim(),
      enabledTypes: getEnabledAlertTypes(),
    };
    window.localStorage.setItem(CHAT_ALERT_PREFS_KEY, JSON.stringify(payload));
  } catch (_error) {
    // ignore localStorage issues
  }
}

function applyEnabledTypes(enabledTypes = {}) {
  if (typeof enabledTypes.silent === "boolean") {
    els.alertTypeSilent.checked = enabledTypes.silent;
  }
  if (typeof enabledTypes.low === "boolean") {
    els.alertTypeLow.checked = enabledTypes.low;
  }
  if (typeof enabledTypes.clipping === "boolean") {
    els.alertTypeClipping.checked = enabledTypes.clipping;
  }
  if (typeof enabledTypes.recovered === "boolean") {
    els.alertTypeRecovered.checked = enabledTypes.recovered;
  }
}

function loadChatAlertPrefs() {
  try {
    const raw = window.localStorage.getItem(CHAT_ALERT_PREFS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);

    if (typeof parsed.chatEnabled === "boolean") {
      els.chatEnabled.checked = parsed.chatEnabled;
    }
    if (typeof parsed.chatChannel === "string") {
      els.chatChannel.value = parsed.chatChannel;
    }
    applyEnabledTypes(parsed.enabledTypes);
  } catch (_error) {
    // ignore malformed localStorage data
  }
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

async function startLive() {
  const channel = els.liveChannel.value.trim();
  if (!channel) {
    appendSystem("Channel is required", "warn");
    return;
  }

  try {
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
    saveChatAlertPrefs();
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
        appendSystem(`Session ${msg.payload.state} (${msg.payload.sourceType})`);
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
els.chatEnabled.addEventListener("change", saveChatAlertPrefs);
els.chatChannel.addEventListener("change", saveChatAlertPrefs);
els.alertTypeSilent.addEventListener("change", saveChatAlertPrefs);
els.alertTypeLow.addEventListener("change", saveChatAlertPrefs);
els.alertTypeClipping.addEventListener("change", saveChatAlertPrefs);
els.alertTypeRecovered.addEventListener("change", saveChatAlertPrefs);

loadChatAlertPrefs();
initSocket();
