// services/liveProviders/base.js
export class LiveProvider {
  constructor(credDoc) {
    this.cred = credDoc;
  }
  static providerName = "abstract";

  static async listChannels(/* credDoc */) {
    throw new Error("not implemented");
  }

  static async refreshCredential(credDoc) {
    return credDoc;
  }

  async getChannelLiveState(/* channelDoc */) {
    throw new Error("not implemented");
  }

  async createLive(/* { channelDoc, title, description, privacy, options } */) {
    throw new Error("not implemented");
  }

  async endLive(/* { platformLiveId } */) {
    return;
  }

  async postComment(/* { platformLiveId, message } */) {
    return;
  }
}
