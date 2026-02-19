const tmi = require("tmi.js");

class Notifier {
  constructor({ wss, env }) {
    this.wss = wss;
    this.env = env;
    this.chatClient = null;
    this.chatReady = false;
  }

  broadcast(type, payload) {
    const msg = JSON.stringify({ type, payload, at: new Date().toISOString() });
    for (const client of this.wss.clients) {
      if (client.readyState === 1) {
        client.send(msg);
      }
    }
  }

  async ensureChatClient() {
    if (this.chatClient && this.chatReady) return;

    const username = this.env.TWITCH_BOT_USERNAME;
    const token = this.env.TWITCH_BOT_OAUTH_TOKEN;
    if (!username || !token) {
      throw new Error(
        "Missing TWITCH_BOT_USERNAME or TWITCH_BOT_OAUTH_TOKEN for chat alerts"
      );
    }

    this.chatClient = new tmi.Client({
      options: { debug: false },
      identity: {
        username,
        password: token,
      },
      connection: { reconnect: true, secure: true },
    });

    await this.chatClient.connect();
    this.chatReady = true;
  }

  async sendChatAlert({ channel, message }) {
    if (!channel || !message) return;
    await this.ensureChatClient();
    await this.chatClient.join(channel);
    await this.chatClient.say(channel, message);
  }

  async notifyAlert(alert, opts = {}) {
    this.broadcast("alert", alert);

    if (!opts.chatEnabled) return;
    const channel = opts.chatChannel;
    const text = `[AudioAware] ${alert.message} @ ${alert.timestampSec.toFixed(1)}s`;

    try {
      await this.sendChatAlert({ channel, message: text });
    } catch (error) {
      this.broadcast("system", {
        level: "error",
        message: `Failed to send Twitch chat alert: ${error.message}`,
      });
    }
  }
}

module.exports = {
  Notifier,
};
