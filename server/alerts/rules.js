const DEFAULT_ALERT_SETTINGS = {
  silenceMinSec: 3,
  lowMinSec: 5,
  clippingHits: 3,
  recoverySec: 2,
  cooldownSec: 30,
};

class AlertEngine {
  constructor(settings = {}) {
    this.settings = { ...DEFAULT_ALERT_SETTINGS, ...settings };
    this.activeCondition = "ok";
    this.silentSec = 0;
    this.lowSec = 0;
    this.okSec = 0;
    this.clipHits = 0;
    this.lastAlertAt = {
      silent: 0,
      low: 0,
      clipping: 0,
    };
    this.lastTs = null;
  }

  processMetric(metric) {
    const alerts = [];
    const dt = this.computeDelta(metric.timestampSec);

    if (metric.status === "silent") {
      this.silentSec += dt;
    } else {
      this.silentSec = 0;
    }

    if (metric.status === "low") {
      this.lowSec += dt;
    } else {
      this.lowSec = 0;
    }

    if (metric.status === "clipping") {
      this.clipHits += 1;
    } else {
      this.clipHits = 0;
    }

    let candidate = "ok";
    if (this.clipHits >= this.settings.clippingHits) {
      candidate = "clipping";
    } else if (this.silentSec >= this.settings.silenceMinSec) {
      candidate = "silent";
    } else if (this.lowSec >= this.settings.lowMinSec) {
      candidate = "low";
    }

    if (candidate === "ok") {
      if (this.activeCondition !== "ok") {
        this.okSec += dt;
        if (this.okSec >= this.settings.recoverySec) {
          alerts.push({
            type: "recovered",
            severity: "info",
            from: this.activeCondition,
            timestampSec: metric.timestampSec,
            message: `Recovered from ${this.activeCondition}`,
          });
          this.activeCondition = "ok";
          this.okSec = 0;
        }
      }
      return alerts;
    }

    this.okSec = 0;
    if (candidate !== this.activeCondition && this.canEmit(candidate)) {
      this.activeCondition = candidate;
      this.lastAlertAt[candidate] = Date.now();

      alerts.push({
        type: candidate,
        severity: candidate === "clipping" ? "critical" : "warning",
        timestampSec: metric.timestampSec,
        message:
          candidate === "clipping"
            ? "Audio clipping detected"
            : candidate === "silent"
            ? "Extended silence detected"
            : "Audio level too low",
      });
    }

    return alerts;
  }

  computeDelta(tsSec) {
    if (this.lastTs == null) {
      this.lastTs = tsSec;
      return 0;
    }
    const dt = Math.max(0, tsSec - this.lastTs);
    this.lastTs = tsSec;
    return dt;
  }

  canEmit(condition) {
    const now = Date.now();
    const last = this.lastAlertAt[condition] || 0;
    return now - last >= this.settings.cooldownSec * 1000;
  }
}

module.exports = {
  AlertEngine,
  DEFAULT_ALERT_SETTINGS,
};
