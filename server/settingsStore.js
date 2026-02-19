const fs = require("fs");
const path = require("path");

const { DEFAULT_ANALYSIS_SETTINGS } = require("./audio/analyzer");
const { DEFAULT_ALERT_SETTINGS } = require("./alerts/rules");
const { normalizeChannelName } = require("./twitch");

const SETTINGS_FILE =
  process.env.SETTINGS_FILE || path.join(__dirname, "..", "data", "settings.json");

const DEFAULT_SETTINGS = {
  live: {
    channel: "",
    quality: "best",
  },
  analysis: {
    ...DEFAULT_ANALYSIS_SETTINGS,
  },
  alertRules: {
    ...DEFAULT_ALERT_SETTINGS,
  },
  chat: {
    enabled: false,
    channel: "",
    enabledTypes: {
      silent: true,
      low: true,
      clipping: true,
      recovered: true,
    },
  },
  autoMonitor: {
    enabled: true,
    intervalSec: 45,
  },
};

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function str(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.trim();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSettings(input = {}) {
  const live = input.live || {};
  const analysis = input.analysis || {};
  const alertRules = input.alertRules || {};
  const chat = input.chat || {};
  const enabledTypes = chat.enabledTypes || {};
  const autoMonitor = input.autoMonitor || {};

  return {
    live: {
      channel: normalizeChannelName(live.channel || DEFAULT_SETTINGS.live.channel),
      quality: str(live.quality, DEFAULT_SETTINGS.live.quality) || "best",
    },
    analysis: {
      ...DEFAULT_ANALYSIS_SETTINGS,
      windowMs: num(analysis.windowMs, DEFAULT_ANALYSIS_SETTINGS.windowMs),
      silenceRmsDb: num(analysis.silenceRmsDb, DEFAULT_ANALYSIS_SETTINGS.silenceRmsDb),
      lowRmsDb: num(analysis.lowRmsDb, DEFAULT_ANALYSIS_SETTINGS.lowRmsDb),
      clipPeakDb: num(analysis.clipPeakDb, DEFAULT_ANALYSIS_SETTINGS.clipPeakDb),
    },
    alertRules: {
      ...DEFAULT_ALERT_SETTINGS,
      silenceMinSec: num(alertRules.silenceMinSec, DEFAULT_ALERT_SETTINGS.silenceMinSec),
      lowMinSec: num(alertRules.lowMinSec, DEFAULT_ALERT_SETTINGS.lowMinSec),
      clippingHits: num(alertRules.clippingHits, DEFAULT_ALERT_SETTINGS.clippingHits),
      recoverySec: num(alertRules.recoverySec, DEFAULT_ALERT_SETTINGS.recoverySec),
      cooldownSec: num(alertRules.cooldownSec, DEFAULT_ALERT_SETTINGS.cooldownSec),
    },
    chat: {
      enabled: bool(chat.enabled, DEFAULT_SETTINGS.chat.enabled),
      channel: normalizeChannelName(chat.channel || ""),
      enabledTypes: {
        silent: bool(enabledTypes.silent, DEFAULT_SETTINGS.chat.enabledTypes.silent),
        low: bool(enabledTypes.low, DEFAULT_SETTINGS.chat.enabledTypes.low),
        clipping: bool(enabledTypes.clipping, DEFAULT_SETTINGS.chat.enabledTypes.clipping),
        recovered: bool(enabledTypes.recovered, DEFAULT_SETTINGS.chat.enabledTypes.recovered),
      },
    },
    autoMonitor: {
      enabled: bool(autoMonitor.enabled, DEFAULT_SETTINGS.autoMonitor.enabled),
      intervalSec: clamp(num(autoMonitor.intervalSec, DEFAULT_SETTINGS.autoMonitor.intervalSec), 15, 300),
    },
  };
}

function mergeSettings(base, patch) {
  return {
    live: { ...(base.live || {}), ...(patch.live || {}) },
    analysis: { ...(base.analysis || {}), ...(patch.analysis || {}) },
    alertRules: { ...(base.alertRules || {}), ...(patch.alertRules || {}) },
    chat: {
      ...(base.chat || {}),
      ...(patch.chat || {}),
      enabledTypes: {
        ...((base.chat || {}).enabledTypes || {}),
        ...((patch.chat || {}).enabledTypes || {}),
      },
    },
    autoMonitor: { ...(base.autoMonitor || {}), ...(patch.autoMonitor || {}) },
  };
}

class SettingsStore {
  constructor(filePath = SETTINGS_FILE) {
    this.filePath = filePath;
    this.settings = this.loadFromDisk();
  }

  loadFromDisk() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return normalizeSettings(DEFAULT_SETTINGS);
      }

      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return normalizeSettings(mergeSettings(DEFAULT_SETTINGS, parsed));
    } catch (_error) {
      return normalizeSettings(DEFAULT_SETTINGS);
    }
  }

  get() {
    return JSON.parse(JSON.stringify(this.settings));
  }

  update(patch = {}) {
    this.settings = normalizeSettings(mergeSettings(this.settings, patch));
    this.persist();
    return this.get();
  }

  persist() {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(this.settings, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, this.filePath);
  }
}

module.exports = {
  DEFAULT_SETTINGS,
  SettingsStore,
};