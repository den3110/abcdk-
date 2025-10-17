// services/liveProviders/index.js
export { LiveProvider } from "./base.js";

// Import các provider cụ thể
import { FacebookProvider } from "./facebook.js";
import { YouTubeProvider } from "./youtube.js";
import { TikTokProvider } from "./tiktok.js";

// Registry trung tâm
export const PROVIDERS = {
  facebook: FacebookProvider,
  youtube: YouTubeProvider,
  tiktok: TikTokProvider,
};
