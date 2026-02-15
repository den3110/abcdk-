import puppeteer from "puppeteer";
import NodeCache from "node-cache";

const cache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour

const BOT_USER_AGENTS = [
  "facebookexternalhit",
  "facebot",
  "twitterbot",
  "pinterest",
  "linkedinbot",
  "whatsapp",
  "skypeuripreview",
  "zalo", // Zalo server
  "telegrambot",
  "discordbot",
  "googlebot",
  "bingbot",
  "yandexbot",
  "baiduspider",
  "duckduckbot",
  "slurp",
  "yahoo",
];

const IGNORE_EXTENSIONS = [
  ".js",
  ".css",
  ".xml",
  ".less",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".pdf",
  ".doc",
  ".txt",
  ".ico",
  ".rss",
  ".zip",
  ".mp3",
  ".rar",
  ".exe",
  ".wmv",
  ".doc",
  ".avi",
  ".ppt",
  ".mpg",
  ".mpeg",
  ".tif",
  ".wav",
  ".mov",
  ".psd",
  ".ai",
  ".xls",
  ".mp4",
  ".m4a",
  ".swf",
  ".dat",
  ".dmg",
  ".iso",
  ".flv",
  ".m4v",
  ".torrent",
  ".woff",
  ".ttf",
  ".svg",
  ".webmanifest",
];

export const prerenderMiddleware = async (req, res, next) => {
  const userAgent = req.headers["user-agent"]?.toLowerCase();
  if (!userAgent) return next();

  // 1. Check if it's a bot
  const isBot = BOT_USER_AGENTS.some((bot) => userAgent.includes(bot));

  // 2. Check if it's a static file request
  const isStatic = IGNORE_EXTENSIONS.some((ext) => req.url.endsWith(ext));

  if (!isBot || isStatic) {
    return next();
  }

  // 3. Construct full URL
  const protocol = req.protocol;
  const host = req.get("host");
  const url = `${protocol}://${host}${req.url}`;

  console.log(`[SSR] Bot detected (${userAgent}). Prerendering: ${url}`);

  // 4. Check Cache
  const cachedContent = cache.get(url);
  if (cachedContent) {
    console.log(`[SSR] Serving from cache: ${url}`);
    return res.send(cachedContent);
  }

  // 5. Render with Puppeteer
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });

    const page = await browser.newPage();

    // Set viewport for consistent rendering
    await page.setViewport({ width: 1280, height: 800 });

    // Enable request interception to block images/fonts for speed
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const resourceType = req.resourceType();
      if (
        resourceType === "image" ||
        resourceType === "stylesheet" ||
        resourceType === "font"
      ) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Go to URL and wait for network idle (meaning React has finished initial fetching)
    // 'networkidle0' is safer for SPAs
    await page.goto(url, { waitUntil: "networkidle0", timeout: 20000 });

    const html = await page.content();

    // Cache the result
    cache.set(url, html);
    console.log(`[SSR] Rendered & Cached: ${url} (${html.length} bytes)`);

    res.send(html);
  } catch (error) {
    console.error("[SSR] Error rendering:", error);
    // Fallback to normal CSR if SSR fails
    next();
  } finally {
    if (browser) await browser.close();
  }
};
