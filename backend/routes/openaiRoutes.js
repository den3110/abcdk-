import express from "express";
import { protect, authorize } from "../middleware/authMiddleware.js";
import fetch from "node-fetch";

// Giai đoạn 1
import { openaiExtractFromDataUrl } from "../services/telegram/telegramNotifyKyc.js";
import { geocodeTournamentLocation, geocodeClubLocation } from "../services/openaiGeocode.js";
import { discoverSeoNewsCandidates } from "../services/seoNewsDiscoveryService.js";
import { generateSeoNewsEvergreenArticles } from "../services/seoNewsEvergreenService.js";
import { reviewSeoNewsArticle } from "../services/seoNewsReviewService.js";
import { resolveSeoNewsImages, checkSeoNewsImageGenerationHealth } from "../services/seoNewsImageService.js";

// Giai đoạn 2
import { planWithAI } from "../services/aiTournamentPlanner.js";
import { normalizeArticleWithAI } from "../services/normalizeService.js";
import { runAgent } from "../services/bot/agentService.js";
import { chatWithPlanner } from "../services/bot/openaiService.js";
import { embedText } from "../services/bot/embeddingService.js";
import { discoverFeaturedArticles } from "../services/articleDiscoveryService.js";
import { previewAiRegistrationImport } from "../services/aiRegistrationImport.service.js";

const router = express.Router();

// Helper for KYC vision test
async function fetchImageAsDataUrl(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} when fetching ${url}`);
  const ct = r.headers.get("content-type") || "image/jpeg";
  const ab = await r.arrayBuffer();
  const b64 = Buffer.from(ab).toString("base64");
  return `data:${ct};base64,${b64}`;
}

// ============================================
// GIAI ĐOẠN 1
// ============================================

// 1. KYC Vision
/*
curl -X POST http://localhost:5001/api/openai/test-kyc-vision \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"imageUrl":"https://example.com/image.jpg","detail":"low"}'
*/
router.post("/test-kyc-vision", protect, authorize("admin"), async (req, res) => {
  try {
    const { imageUrl, dataUrl, detail = "low" } = req.body;
    let finalDataUrl = dataUrl;
    if (imageUrl) finalDataUrl = await fetchImageAsDataUrl(imageUrl);
    if (!finalDataUrl) return res.status(400).json({ error: "Missing imageUrl or dataUrl" });
    const result = await openaiExtractFromDataUrl(finalDataUrl, detail);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Geocode Tournament
/*
curl -X POST http://localhost:5001/api/openai/test-geocode-tournament \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"location":"Hà Nội", "countryHint":"VN"}'
*/
router.post("/test-geocode-tournament", protect, authorize("admin"), async (req, res) => {
  try {
    const { location, countryHint = "VN" } = req.body;
    const result = await geocodeTournamentLocation({ location, countryHint });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Geocode Club
/*
curl -X POST http://localhost:5001/api/openai/test-geocode-club \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"location":"Quận 1, TP.HCM", "countryHint":"VN"}'
*/
router.post("/test-geocode-club", protect, authorize("admin"), async (req, res) => {
  try {
    const { location, countryHint = "VN" } = req.body;
    const result = await geocodeClubLocation({ location, countryHint });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. SEO News Discovery
/*
curl -X POST http://localhost:5001/api/openai/test-seo-discovery \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"settings":{}, "provider":"openai"}'
*/
router.post("/test-seo-discovery", protect, authorize("admin"), async (req, res) => {
  try {
    const { settings, provider } = req.body;
    const result = await discoverSeoNewsCandidates({ settings, provider });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. SEO News Evergreen
/*
curl -X POST http://localhost:5001/api/openai/test-seo-evergreen \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"count": 1, "forcePublish": false}'
*/
router.post("/test-seo-evergreen", protect, authorize("admin"), async (req, res) => {
  try {
    const { count = 1, settings, forcePublish = false, runId } = req.body;
    const finalRunId = runId || `test-${Date.now()}`;
    const result = await generateSeoNewsEvergreenArticles({ count, settings, forcePublish, runId: finalRunId });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. SEO News Review
/*
curl -X POST http://localhost:5001/api/openai/test-seo-review \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Article", "summary":"Test summary", "contentHtml":"<p>hello</p>"}'
*/
router.post("/test-seo-review", protect, authorize("admin"), async (req, res) => {
  try {
    const { title, summary, contentHtml, origin, sourceName, sourceUrl, tags } = req.body;
    const result = await reviewSeoNewsArticle({ title, summary, contentHtml, origin, sourceName, sourceUrl, tags });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. SEO News Image
/*
curl -X POST http://localhost:5001/api/openai/test-seo-image \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"title":"News Title", "summary":"Summary"}'
*/
router.post("/test-seo-image", protect, authorize("admin"), async (req, res) => {
  try {
    const { title, summary, tags, sourceUrl, origin, preferredImageUrl, settings, articleKey } = req.body;
    const result = await resolveSeoNewsImages({ title, summary, tags, sourceUrl, origin, preferredImageUrl, settings, articleKey });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. SEO News Image Health
/*
curl -X GET http://localhost:5001/api/openai/test-seo-image-health \
  -H "Authorization: Bearer <TOKEN>"
*/
router.get("/test-seo-image-health", protect, authorize("admin"), async (req, res) => {
  try {
    const result = await checkSeoNewsImageGenerationHealth();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// GIAI ĐOẠN 2
// ============================================

// 9. AI Tournament Planner
/*
curl -X POST http://localhost:5001/api/openai/test-ai-planner \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"tournament":{"expected": 16, "eventType":"double"}}'
*/
router.post("/test-ai-planner", protect, authorize("admin"), async (req, res) => {
  try {
    const { tournament, preferences } = req.body;
    const result = await planWithAI({ tournament, preferences });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 10. Tiền xử lý bài viết với AI
/*
curl -X POST http://localhost:5001/api/openai/test-normalize-article \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"baseTitle":"Test News", "text":"Pickleball is popular in Vietnam", "contentHtml":"<p>Pickleball is popular in Vietnam</p>"}'
*/
router.post("/test-normalize-article", protect, authorize("admin"), async (req, res) => {
  try {
    const { url, sourceName, baseTitle, text, contentHtml, tags } = req.body;
    const result = await normalizeArticleWithAI({ url, sourceName, baseTitle, text, contentHtml, tags });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 11. Pikora AI Chatbot Agent
/*
curl -X POST http://localhost:5001/api/openai/test-bot-agent \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"message":"Có giải nào đang mở đăng ký", "context":{}}'
*/
router.post("/test-bot-agent", protect, authorize("admin"), async (req, res) => {
  try {
    const { message, context, userId } = req.body;
    const result = await runAgent(message, context || {}, userId || req.user?._id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 12. Bot Planner (Không dùng Agent)
/*
curl -X POST http://localhost:5001/api/openai/test-bot-planner \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}'
*/
router.post("/test-bot-planner", protect, authorize("admin"), async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Missing message" });
    const result = await chatWithPlanner(message);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 13. Text Embeddings
/*
curl -X POST http://localhost:5001/api/openai/test-embed-text \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"text":"Pickleball tournament"}'
*/
router.post("/test-embed-text", protect, authorize("admin"), async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Missing text payload" });
    const result = await embedText(text);
    res.json({ embeddedText: text, result: result }); // returns array of vector floats
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 14. Phân tích Article Discovery Candidate (Tìm nguồn bài gốc)
/*
curl -X POST http://localhost:5001/api/openai/test-article-discovery \
  -H "Authorization: Bearer <TOKEN>"
*/
router.post("/test-article-discovery", protect, authorize("admin"), async (req, res) => {
  try {
    const result = await discoverFeaturedArticles();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 15. Phân tích Đăng ký VĐV từ Raw Text (Preview)
/*
curl -X POST http://localhost:5001/api/openai/test-ai-registration-import \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"rawContent":"1. Nguyen Van A\n2. Tran Thi B", "fileType":"text"}'
*/
router.post("/test-ai-registration-import", protect, authorize("admin"), async (req, res) => {
  try {
    const { rawContent, fileType = "text", fileName, tournamentId, adminPrompt } = req.body;
    const result = await previewAiRegistrationImport({
      tempIdentityProviderProfile: null,
      tempEmailDomain: "pickletour.vn",
      fileType,
      rawContent,
      fileName,
      tournamentId,
      adminPrompt
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
