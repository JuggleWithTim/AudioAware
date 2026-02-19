const DEFAULT_ANALYSIS_SETTINGS = {
  sampleRate: 48_000,
  windowMs: 500,
  silenceRmsDb: -50,
  lowRmsDb: -30,
  clipPeakDb: -1,
};

function toDbfs(normalized) {
  if (!normalized || normalized <= 0) return -100;
  return 20 * Math.log10(Math.min(1, normalized));
}

class AudioAnalyzer {
  constructor(settings = {}) {
    this.settings = { ...DEFAULT_ANALYSIS_SETTINGS, ...settings };
    this.windowSamples = Math.max(
      1,
      Math.floor((this.settings.sampleRate * this.settings.windowMs) / 1000)
    );
    this.pending = new Int16Array(0);
    this.totalSamplesProcessed = 0;
  }

  processSamples(samples) {
    if (!(samples instanceof Int16Array) || samples.length === 0) return [];

    const merged = new Int16Array(this.pending.length + samples.length);
    merged.set(this.pending, 0);
    merged.set(samples, this.pending.length);

    const metrics = [];
    let offset = 0;

    while (offset + this.windowSamples <= merged.length) {
      const frame = merged.subarray(offset, offset + this.windowSamples);
      metrics.push(this.analyzeFrame(frame));
      offset += this.windowSamples;
    }

    this.pending = merged.subarray(offset);
    return metrics;
  }

  analyzeFrame(frame) {
    let sumSquares = 0;
    let peak = 0;

    for (let i = 0; i < frame.length; i += 1) {
      const normalized = Math.abs(frame[i]) / 32768;
      sumSquares += normalized * normalized;
      if (normalized > peak) peak = normalized;
    }

    const rms = Math.sqrt(sumSquares / frame.length);
    const rmsDb = toDbfs(rms);
    const peakDb = toDbfs(peak);
    const timestampSec = this.totalSamplesProcessed / this.settings.sampleRate;

    this.totalSamplesProcessed += frame.length;

    let status = "ok";
    if (peakDb >= this.settings.clipPeakDb) {
      status = "clipping";
    } else if (rmsDb <= this.settings.silenceRmsDb) {
      status = "silent";
    } else if (rmsDb <= this.settings.lowRmsDb) {
      status = "low";
    }

    return {
      timestampSec,
      rmsDb,
      peakDb,
      status,
    };
  }
}

module.exports = {
  AudioAnalyzer,
  DEFAULT_ANALYSIS_SETTINGS,
};
