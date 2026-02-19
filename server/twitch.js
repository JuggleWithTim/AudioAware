const { spawn } = require("child_process");

function normalizeChannelName(input) {
  return String(input || "")
    .trim()
    .replace(/^https?:\/\/www\.twitch\.tv\//i, "")
    .replace(/^https?:\/\/twitch\.tv\//i, "")
    .replace(/\/.*/, "")
    .replace(/^@/, "");
}

function toTwitchLiveUrl(channelOrUrl) {
  const raw = String(channelOrUrl || "").trim();
  if (!raw) throw new Error("Channel is required");
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://twitch.tv/${normalizeChannelName(raw)}`;
}

function runStreamlinkGetStreamUrl(targetUrl, quality = "best") {
  return new Promise((resolve, reject) => {
    const args = ["--stream-url", targetUrl, quality];
    const child = spawn("streamlink", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `streamlink failed (code ${code}). Ensure streamlink is installed and URL is valid. ${stderr.trim()}`
          )
        );
        return;
      }

      const streamUrl = stdout.trim().split("\n").pop()?.trim();
      if (!streamUrl) {
        reject(new Error("streamlink did not return a stream URL"));
        return;
      }

      resolve(streamUrl);
    });
  });
}

async function resolveLiveStreamUrl(channelOrUrl, quality = "best") {
  const liveUrl = toTwitchLiveUrl(channelOrUrl);
  const streamUrl = await runStreamlinkGetStreamUrl(liveUrl, quality);
  return { sourceType: "live", input: liveUrl, streamUrl };
}

async function resolveVodStreamUrl(vodUrl, quality = "best") {
  const raw = String(vodUrl || "").trim();
  if (!/^https?:\/\//i.test(raw)) {
    throw new Error("VOD URL must be a full Twitch URL");
  }

  const streamUrl = await runStreamlinkGetStreamUrl(raw, quality);
  return { sourceType: "vod", input: raw, streamUrl };
}

module.exports = {
  normalizeChannelName,
  resolveLiveStreamUrl,
  resolveVodStreamUrl,
};
