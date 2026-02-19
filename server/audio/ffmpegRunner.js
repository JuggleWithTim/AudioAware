const { spawn } = require("child_process");

const DEFAULT_SAMPLE_RATE = 48_000;

function startFfmpegPcmStream({
  inputUrl,
  sampleRate = DEFAULT_SAMPLE_RATE,
  onSamples,
  onError,
  onEnd,
}) {
  if (!inputUrl) {
    throw new Error("inputUrl is required for ffmpeg stream");
  }

  const ffmpegArgs = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputUrl,
    "-vn",
    "-ac",
    "1",
    "-ar",
    String(sampleRate),
    "-f",
    "s16le",
    "pipe:1",
  ];

  const ffmpeg = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  let leftover = Buffer.alloc(0);
  let stopped = false;

  ffmpeg.stdout.on("data", (chunk) => {
    const merged = Buffer.concat([leftover, chunk]);
    const fullBytes = merged.length - (merged.length % 2);

    if (fullBytes <= 0) {
      leftover = merged;
      return;
    }

    const sampleBuf = merged.subarray(0, fullBytes);
    leftover = merged.subarray(fullBytes);

    const samples = new Int16Array(
      sampleBuf.buffer,
      sampleBuf.byteOffset,
      sampleBuf.byteLength / 2
    );

    onSamples?.(samples);
  });

  ffmpeg.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  ffmpeg.on("error", (error) => {
    onError?.(error);
  });

  ffmpeg.on("close", (code, signal) => {
    if (stopped) {
      onEnd?.({ code, signal, stderr, stopped: true });
      return;
    }

    if (code === 0) {
      onEnd?.({ code, signal, stderr, stopped: false });
      return;
    }

    const err = new Error(
      `ffmpeg exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`
    );
    onError?.(err);
  });

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      ffmpeg.kill("SIGTERM");

      setTimeout(() => {
        if (!ffmpeg.killed) {
          ffmpeg.kill("SIGKILL");
        }
      }, 1000);
    },
  };
}

module.exports = {
  DEFAULT_SAMPLE_RATE,
  startFfmpegPcmStream,
};
