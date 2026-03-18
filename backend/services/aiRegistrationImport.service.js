import OpenAI from "openai";
import fetch from "node-fetch";
import { promises as fs } from "fs";
import mongoose from "mongoose";
import os from "os";
import path from "path";
import pLimit from "p-limit";
import slugify from "slugify";
import { openai, OPENAI_DEFAULT_MODEL } from "../lib/openaiClient.js";
import Registration from "../models/registrationModel.js";
import Tournament from "../models/tournamentModel.js";
import User from "../models/userModel.js";

// Model riêng cho AI Import Đăng Ký:
// dùng để phân tích bố cục file, gom dòng thành hồ sơ, và tách VĐV/cặp/đội.
function normalizeImportProvider(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "catgpt" || normalized === "legacy"
    ? normalized
    : "";
}

function normalizeGatewayBaseUrl(value) {
  const base = String(value || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  return /\/v1$/i.test(base) ? base : `${base}/v1`;
}

const CATGPT_GATEWAY_BASE_URL = normalizeGatewayBaseUrl(
  process.env.CATGPT_GATEWAY_BASE_URL || ""
);
const CATGPT_GATEWAY_API_TOKEN = String(
  process.env.CATGPT_GATEWAY_API_TOKEN || process.env.CLIPROXY_API_KEY || ""
).trim();
const CATGPT_GATEWAY_MODEL =
  String(process.env.CATGPT_GATEWAY_MODEL || "catgpt-browser").trim() ||
  "catgpt-browser";
const CATGPT_GATEWAY_TIMEOUT_MS = Math.max(
  60_000,
  Math.min(
    1_800_000,
    Number(process.env.CATGPT_GATEWAY_TIMEOUT_MS || 960_000)
  )
);
const AI_IMPORT_PROVIDER =
  normalizeImportProvider(process.env.AI_IMPORT_PROVIDER) ||
  (CATGPT_GATEWAY_BASE_URL ? "catgpt" : "legacy");

const IMPORT_MODEL =
  process.env.OPENAI_REG_IMPORT_MODEL || OPENAI_DEFAULT_MODEL;

// Model fallback khi proxy local lỗi và luồng import phải gọi thẳng OpenAI
// bằng OPENAI_API_KEY.
const IMPORT_DIRECT_MODEL =
  process.env.OPENAI_REG_IMPORT_DIRECT_MODEL ||
  process.env.OPENAI_NORMALIZE_MODEL ||
  "gpt-4.1";
const USE_COMPACT_PROXY_PROFILE =
  /localhost:5024/i.test(String(process.env.CLIPROXY_BASE_URL || "")) &&
  /deepseek/i.test(String(IMPORT_MODEL || ""));
const PREVIEW_MAX_ROWS = Math.max(
  1,
  Math.min(200, Number(process.env.AI_REG_IMPORT_MAX_ROWS || 100))
);
const AI_BATCH_SIZE = Math.max(
  1,
  Math.min(
    20,
    Number(process.env.AI_REG_IMPORT_BATCH_SIZE || (USE_COMPACT_PROXY_PROFILE ? 6 : 12))
  )
);
const AI_CONCURRENCY = Math.max(
  1,
  Math.min(
    4,
    Number(process.env.AI_REG_IMPORT_CONCURRENCY || (USE_COMPACT_PROXY_PROFILE ? 1 : 2))
  )
);
const AI_CONTEXT_SAMPLE_ROWS = Math.max(
  8,
  Math.min(
    24,
    Number(process.env.AI_REG_IMPORT_CONTEXT_ROWS || (USE_COMPACT_PROXY_PROFILE ? 10 : 18))
  )
);
const AI_GROUPING_CHUNK_SIZE = Math.max(
  8,
  Math.min(
    40,
    Number(process.env.AI_REG_IMPORT_GROUPING_CHUNK_SIZE || (USE_COMPACT_PROXY_PROFILE ? 18 : 32))
  )
);
const TEMP_EMAIL_DOMAIN = "pickletour.vn";
const MIN_READY_CONFIDENCE = 0.65;
const directOpenAI =
  process.env.OPENAI_API_KEY && process.env.CLIPROXY_BASE_URL
    ? new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        timeout: 15000,
      })
    : null;

function compactList(list) {
  return Array.from(new Set((list || []).filter(Boolean)));
}

function reportPreviewProgress(onProgress, payload = {}) {
  if (typeof onProgress !== "function") return;
  try {
    onProgress({
      ...payload,
      step: payload.step || "working",
      progress: Math.max(0, Math.min(100, Number(payload.progress) || 0)),
      message: String(payload.message || "").trim(),
    });
  } catch {
    // ignore progress callback errors
  }
}

function extractResponsesText(response) {
  return (
    response?.output_text || response?.output?.[0]?.content?.[0]?.text || ""
  );
}

function extractChatText(response) {
  const msg = response?.choices?.[0]?.message;
  if (typeof msg?.content === "string") return msg.content;
  if (Array.isArray(msg?.content)) {
    return (
      msg.content.find(
        (part) => part?.type === "output_text" || part?.type === "text"
      )?.text || ""
    );
  }
  return "";
}

function parseJsonLoose(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    // continue
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // continue
    }
  }

  const objectMatch = raw.match(/\{[\s\S]*\}$/);
  if (objectMatch?.[0]) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      // continue
    }
  }

  const arrayMatch = raw.match(/\[[\s\S]*\]$/);
  if (arrayMatch?.[0]) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {
      // continue
    }
  }

  return null;
}

function formatUserInput(input) {
  return typeof input === "string" ? input : JSON.stringify(input);
}

function normalizeAdminPrompt(value) {
  return truncate(
    String(value || "")
      .replace(/\r\n/g, "\n")
      .trim(),
    2000
  );
}

function buildAdminPromptSection(adminPrompt) {
  const normalized = normalizeAdminPrompt(adminPrompt);
  if (!normalized) return "";
  return `

Ghi chú bổ sung từ admin:
${normalized}

Chỉ áp dụng các ghi chú này khi trong file thực sự có dấu hiệu tương ứng.
Nếu file không giữ được thông tin màu sắc, định dạng, hoặc ghi chú trực quan thì không được tự suy diễn.
  `.trim();
}

function buildTempAccountRulesObject() {
  return {
    userModelFields: ["name/fullName", "nickname", "phone", "email", "password"],
    aiOutputUsesFullNameField: true,
    backendMapsFullNameToUserName: true,
    minimumIdentityForAutoCreate: "fullName",
    missingEmailPhoneNicknamePasswordDoesNotBlockRegistration: true,
    backendWillCreateTempIdentityFromAvailableData: true,
    tempIdentityDerivedFrom: ["fullName", "sourceRowNumber", "playerSlot"],
    tempEmailDomain: TEMP_EMAIL_DOMAIN,
    aiMustNotInventNicknamePhoneEmailPassword: true,
  };
}

function buildTempAccountRulesText() {
  return `
Quy tắc tài khoản tạm của hệ thống:
- User model nội bộ gồm: name/fullName, nickname, phone, email, password.
- Trong output của AI, hãy dùng trường fullName; backend sẽ map fullName vào field name của user.
- Nếu file thiếu email, phone, nickname hoặc password thì không được xem đó là lỗi chặn đăng ký.
- Chỉ cần vẫn nhận ra được fullName thì cứ giữ hồ sơ đăng ký để backend xử lý tiếp.
- Backend sẽ tự sinh tài khoản tạm từ dữ liệu có thật như fullName, dòng nguồn và slot VĐV.
- AI không được tự bịa nickname, password, email hoặc phone khi file không có.
- Email tạm do backend sinh sẽ luôn theo định dạng xxxx@${TEMP_EMAIL_DOMAIN}.
- Nếu thiếu luôn fullName thì phải đánh needsReview và nêu rõ lý do thiếu tên người chơi.
  `.trim();
}

function buildImportClientAttempts() {
  const attempts = [
    { label: "configured", client: openai, model: IMPORT_MODEL },
  ];
  if (directOpenAI) {
    attempts.push({
      label: "direct_openai",
      client: directOpenAI,
      model: IMPORT_DIRECT_MODEL,
    });
  }
  return attempts;
}

function buildAiDiagnostics() {
  const provider =
    AI_IMPORT_PROVIDER === "catgpt" && CATGPT_GATEWAY_BASE_URL
      ? "catgpt"
      : "legacy";
  const isCatgpt = provider === "catgpt";
  return {
    provider,
    responseMode: "",
    fileType: "",
    completionId: "",
    artifactManifestAvailable: false,
    artifactSource: "",
    artifactKeys: [],
    availableModels: [],
    environment: {
      provider,
      configuredBaseUrl: isCatgpt
        ? CATGPT_GATEWAY_BASE_URL
        : process.env.CLIPROXY_BASE_URL || "",
      configuredModel: isCatgpt ? CATGPT_GATEWAY_MODEL : IMPORT_MODEL,
      directFallbackEnabled: !isCatgpt && Boolean(directOpenAI),
      directFallbackModel:
        !isCatgpt && directOpenAI ? IMPORT_DIRECT_MODEL : "",
      apiTokenConfigured: isCatgpt
        ? Boolean(CATGPT_GATEWAY_API_TOKEN)
        : Boolean(process.env.CLIPROXY_API_KEY || process.env.OPENAI_API_KEY),
      gatewayStatusUrl: isCatgpt ? `${getCatgptGatewayRootUrl()}/status` : "",
      gatewayStatusChecked: false,
      gatewayReachable: null,
      gatewayHealthy: null,
      gatewayLoggedIn: null,
      gatewayStatusSummary: "",
    },
    hasErrors: false,
    hasWarnings: false,
    summary: "",
    stages: [],
  };
}

function buildStructuredRoutePlan(attempt) {
  const model = String(attempt?.model || "").toLowerCase();
  const usesConfiguredCliproxy =
    attempt?.label === "configured" &&
    /localhost:5024/i.test(String(process.env.CLIPROXY_BASE_URL || ""));

  if (model.includes("deepseek-chat")) {
    return compactList([
      "chat_json_object",
      "chat_json_schema",
      ...(usesConfiguredCliproxy ? [] : ["responses"]),
    ]);
  }

  if (model.includes("deepseek-reasoner")) {
    return compactList([
      "chat_json_schema",
      "chat_json_object",
      ...(usesConfiguredCliproxy ? [] : ["responses"]),
    ]);
  }

  return [];
}

function classifyAiDiagnosticSummary(diagnostics) {
  const text = diagnostics.stages
    .flatMap((stage) => stage.attempts || [])
    .map((attempt) => attempt.error || "")
    .join(" | ")
    .toLowerCase();

  if (text.includes("404")) {
    return "Endpoint AI hiện tại trả 404. Kiểm tra CLIPROXY_BASE_URL hoặc proxy OpenAI-compatible.";
  }
  if (text.includes("401") || text.includes("unauthorized")) {
    return "AI từ chối xác thực. Kiểm tra API key hoặc quyền model.";
  }
  if (text.includes("403") || text.includes("forbidden")) {
    return "AI từ chối truy cập model hoặc route hiện tại.";
  }
  if (text.includes("429") || text.includes("rate limit")) {
    return "AI đang bị giới hạn tốc độ hoặc quota.";
  }
  if (
    text.includes("econnrefused") ||
    text.includes("fetch failed") ||
    text.includes("network") ||
    text.includes("socket")
  ) {
    return "Không kết nối được tới dịch vụ AI. Kiểm tra proxy local hoặc mạng ra ngoài.";
  }
  if (diagnostics.hasErrors) {
    return "AI import đang lỗi cấu hình hoặc route. Kiểm tra proxy/model hiện tại.";
  }
  if (diagnostics.hasWarnings) {
    return "AI vẫn chạy được nhưng đang phải fallback sang đường gọi khác. Nên kiểm tra lại cấu hình proxy/model.";
  }
  return "AI import đang hoạt động bình thường.";
}

function classifyImportDiagnosticSummary(diagnostics) {
  const text = diagnostics.stages
    .flatMap((stage) => stage.attempts || [])
    .map((attempt) => attempt.error || "")
    .join(" | ")
    .toLowerCase();
  const provider = diagnostics?.environment?.provider || AI_IMPORT_PROVIDER;
  const gatewayReachable = diagnostics?.environment?.gatewayReachable;
  const gatewayHealthy = diagnostics?.environment?.gatewayHealthy;
  const gatewayLoggedIn = diagnostics?.environment?.gatewayLoggedIn;

  if (provider === "catgpt") {
    if (gatewayLoggedIn === false) {
      return "CatGPT-Gateway đang chạy nhưng chưa đăng nhập ChatGPT. Mở http://localhost:6080/vnc.html rồi đăng nhập lại.";
    }
    if (gatewayReachable === false) {
      return "CatGPT-Gateway local đang không sẵn sàng hoặc container đang unhealthy. Kiểm tra Docker `catgpt`; nếu cần hãy đăng nhập lại qua http://localhost:6080/vnc.html.";
    }
    if (gatewayHealthy === false && text.includes("socket")) {
      return "CatGPT-Gateway local đang tự đóng kết nối trong lúc xử lý. Kiểm tra container `catgpt` và phiên ChatGPT bên trong.";
    }
    if (
      text.includes("timed out") ||
      text.includes("timeout") ||
      text.includes("aborterror")
    ) {
      return `CatGPT-Gateway đã nhận request nhưng ChatGPT xử lý quá lâu. Hãy tăng CATGPT_GATEWAY_TIMEOUT_MS hoặc rút gọn file/prompt. Timeout hiện tại: ${Math.round(
        CATGPT_GATEWAY_TIMEOUT_MS / 1000
      )}s.`;
    }
    if (text.includes("401") || text.includes("unauthorized")) {
      return "CatGPT-Gateway từ chối xác thực. Hãy kiểm tra CATGPT_GATEWAY_API_TOKEN.";
    }
    if (text.includes("403") || text.includes("forbidden")) {
      return "CatGPT-Gateway đang chặn request này hoặc session ChatGPT không đủ quyền.";
    }
    if (text.includes("404")) {
      return "CatGPT-Gateway không tìm thấy route `/v1/chat/completions`. Hãy kiểm tra CATGPT_GATEWAY_BASE_URL.";
    }
    if (
      text.includes("503") ||
      text.includes("chatgpt client not initialized") ||
      text.includes("not initialized")
    ) {
      return "CatGPT-Gateway chưa sẵn sàng hoặc phiên ChatGPT chưa đăng nhập.";
    }
    if (text.includes("upload") && text.includes("file")) {
      return "CatGPT-Gateway không tải được file đính kèm lên ChatGPT.";
    }
    if (text.includes("parse") || text.includes("json") || text.includes("csv")) {
      return "ChatGPT đã phản hồi nhưng không đúng định dạng JSON/CSV mong muốn.";
    }
    if (
      text.includes("econnrefused") ||
      text.includes("fetch failed") ||
      text.includes("network") ||
      text.includes("socket") ||
      text.includes("econnreset") ||
      text.includes("connection was closed unexpectedly") ||
      text.includes("underlying connection was closed")
    ) {
      return "Không kết nối được tới CatGPT-Gateway local. Kiểm tra container `catgpt`, endpoint `http://localhost:8000`, hoặc đăng nhập lại ChatGPT qua http://localhost:6080/vnc.html.";
    }
    if (diagnostics.hasErrors) {
      return "CatGPT-Gateway đang lỗi cấu hình, upload file, hoặc phiên ChatGPT.";
    }
    if (diagnostics.hasWarnings) {
      return "CatGPT-Gateway vẫn chạy được nhưng đã phải dùng đường parse dự phòng.";
    }
    return "CatGPT-Gateway đang hoạt động bình thường.";
  }

  return classifyAiDiagnosticSummary(diagnostics);
}

function getCatgptGatewayRootUrl() {
  return CATGPT_GATEWAY_BASE_URL.replace(/\/v1$/i, "");
}

function buildCatgptGatewayHeaders(accept = "application/json") {
  return {
    accept,
    ...(CATGPT_GATEWAY_API_TOKEN
      ? { authorization: `Bearer ${CATGPT_GATEWAY_API_TOKEN}` }
      : {}),
  };
}

function isCatgptGatewayNetworkError(error) {
  const text = String(error?.message || error || "")
    .trim()
    .toLowerCase();
  return (
    text.includes("socket hang up") ||
    text.includes("econnreset") ||
    text.includes("econnrefused") ||
    text.includes("fetch failed") ||
    text.includes("network") ||
    text.includes("underlying connection was closed") ||
    text.includes("connection was closed unexpectedly")
  );
}

function attachAiDiagnosticsToError(error, diagnostics, fallbackMessage = "") {
  const finalMessage =
    String(classifyImportDiagnosticSummary(diagnostics) || "").trim() ||
    String(fallbackMessage || error?.message || "AI import failed").trim();
  const wrappedError =
    error instanceof Error && error.message === finalMessage
      ? error
      : new Error(finalMessage);
  wrappedError.aiDiagnostics = diagnostics;
  wrappedError.rawMessage = String(error?.message || fallbackMessage || "").trim();
  return wrappedError;
}

async function probeCatgptGatewayStatus(
  diagnostics,
  { stage = "gateway_status", timeoutMs = 6000, silent = false } = {}
) {
  if (!CATGPT_GATEWAY_BASE_URL) return null;

  const rootUrl = getCatgptGatewayRootUrl();
  const statusUrl = `${rootUrl}/status`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  diagnostics.environment.gatewayStatusUrl = statusUrl;

  try {
    const response = await fetch(statusUrl, {
      headers: buildCatgptGatewayHeaders("application/json"),
      signal: controller.signal,
    });
    const rawBody = await response.text();
    const payload = parseJsonLoose(rawBody) || {};
    const loggedIn =
      typeof payload?.logged_in === "boolean"
        ? payload.logged_in
        : typeof payload?.loggedIn === "boolean"
        ? payload.loggedIn
        : null;
    const healthy = Boolean(response.ok) && loggedIn !== false;

    diagnostics.environment.gatewayStatusChecked = true;
    diagnostics.environment.gatewayReachable = true;
    diagnostics.environment.gatewayHealthy = healthy;
    diagnostics.environment.gatewayLoggedIn = loggedIn;
    diagnostics.environment.gatewayStatusSummary =
      typeof payload?.message === "string" && payload.message.trim()
        ? payload.message.trim()
        : response.ok
        ? loggedIn === false
          ? "Gateway đang chạy nhưng chưa đăng nhập ChatGPT."
          : "Gateway đang phản hồi bình thường."
        : `Gateway trả trạng thái ${response.status}.`;

    if (!silent) {
      diagnostics.stages.push({
        stage,
        ok: response.ok && loggedIn !== false,
        model: CATGPT_GATEWAY_MODEL,
        route: "catgpt/status",
        attempts: response.ok
          ? []
          : [
              {
                route: "catgpt/status",
                model: CATGPT_GATEWAY_MODEL,
                error: `HTTP ${response.status}: ${truncate(
                  rawBody || response.statusText,
                  240
                )}`,
              },
            ],
        message: diagnostics.environment.gatewayStatusSummary,
      });
    }

    return {
      reachable: true,
      healthy,
      loggedIn,
      statusCode: response.status,
      payload,
    };
  } catch (error) {
    diagnostics.environment.gatewayStatusChecked = true;
    diagnostics.environment.gatewayReachable = false;
    diagnostics.environment.gatewayHealthy = false;
    diagnostics.environment.gatewayLoggedIn = null;
    diagnostics.environment.gatewayStatusSummary =
      "Không gọi được /status từ CatGPT-Gateway local.";

    if (!silent) {
      diagnostics.hasWarnings = true;
      diagnostics.stages.push({
        stage,
        ok: false,
        model: CATGPT_GATEWAY_MODEL,
        route: "catgpt/status",
        attempts: [
          {
            route: "catgpt/status",
            model: CATGPT_GATEWAY_MODEL,
            error:
              error?.name === "AbortError"
                ? `status probe timed out after ${Math.round(timeoutMs / 1000)}s`
                : String(error?.message || error || "status probe failed"),
          },
        ],
        message: diagnostics.environment.gatewayStatusSummary,
      });
    }

    return {
      reachable: false,
      healthy: false,
      loggedIn: null,
      error: String(error?.message || error || "status probe failed"),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function shouldInlineChatInstructions(attempt) {
  const model = String(attempt?.model || "").toLowerCase();
  return (
    attempt?.label === "configured" &&
    /localhost:5024/i.test(String(process.env.CLIPROXY_BASE_URL || "")) &&
    model.includes("deepseek")
  );
}

function buildChatMessages(
  attempt,
  instructions,
  userContent,
  forceJsonOnly = false
) {
  const jsonTail = forceJsonOnly
    ? "\n\nTrả về JSON hợp lệ, không thêm giải thích ngoài JSON."
    : "";

  if (shouldInlineChatInstructions(attempt)) {
    return [
      {
        role: "user",
        content: `${instructions}\n\nDữ liệu đầu vào:\n${userContent}${jsonTail}`,
      },
    ];
  }

  if (forceJsonOnly) {
    return [
      { role: "system", content: instructions },
      { role: "user", content: `${userContent}${jsonTail}` },
    ];
  }

  return [
    { role: "system", content: instructions },
    { role: "user", content: userContent },
  ];
}

async function createStructuredJson({
  schemaName,
  schema,
  instructions,
  input,
  maxOutputTokens = 4000,
  stage = "unknown",
  diagnostics = null,
}) {
  const userContent = formatUserInput(input);
  const attempts = buildImportClientAttempts();
  const errors = [];
  const stageDiagnostics = {
    stage,
    ok: false,
    model: "",
    route: "",
    attempts: [],
    message: "",
  };

  for (const attempt of attempts) {
    const chatMessages = buildChatMessages(attempt, instructions, userContent);
    const jsonOnlyMessages = buildChatMessages(
      attempt,
      instructions,
      userContent,
      true
    );
    const preferredRoutes = buildStructuredRoutePlan(attempt);

    if (preferredRoutes.length > 0) {
      const routeErrors = {};

      for (const route of preferredRoutes) {
        try {
          let parsed = null;

          if (route === "chat_json_schema") {
            const response = await attempt.client.chat.completions.create({
              model: attempt.model,
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: schemaName,
                  strict: true,
                  schema,
                },
              },
              messages: chatMessages,
              temperature: 0.1,
            });

            parsed = parseJsonLoose(extractChatText(response));
            if (parsed === null) {
              throw new Error(
                "Chat Completions json_schema trả về dữ liệu không parse được"
              );
            }
          }

          if (route === "chat_json_object") {
            const response = await attempt.client.chat.completions.create({
              model: attempt.model,
              response_format: { type: "json_object" },
              messages: jsonOnlyMessages,
              temperature: 0.1,
            });

            parsed = parseJsonLoose(extractChatText(response));
            if (parsed === null) {
              throw new Error(
                "Chat Completions json_object trả về dữ liệu không parse được"
              );
            }
          }

          if (route === "responses") {
            const response = await attempt.client.responses.create({
              model: attempt.model,
              instructions,
              input: userContent,
              text: {
                format: {
                  type: "json_schema",
                  name: schemaName,
                  strict: true,
                  schema,
                },
              },
              temperature: 0.1,
              max_output_tokens: maxOutputTokens,
            });

            parsed = parseJsonLoose(extractResponsesText(response));
            if (parsed === null) {
              throw new Error(
                "Responses API trả về dữ liệu không parse được"
              );
            }
          }

          stageDiagnostics.ok = true;
          stageDiagnostics.model = attempt.model;
          stageDiagnostics.route = `${attempt.label}/${route}`;
          stageDiagnostics.message =
            stageDiagnostics.attempts.length > 0
              ? "Đã fallback thành công ở route khác"
              : "OK";
          if (diagnostics) {
            if (stageDiagnostics.attempts.length > 0) {
              diagnostics.hasWarnings = true;
            }
            diagnostics.stages.push(stageDiagnostics);
          }
          return parsed;
        } catch (error) {
          routeErrors[route] = error.message;
          stageDiagnostics.attempts.push({
            route: `${attempt.label}/${route}`,
            model: attempt.model,
            error: error.message,
          });
        }
      }

      errors.push(
        `${attempt.label}/${attempt.model}: ${preferredRoutes
          .map((route) => `${route}=${routeErrors[route] || "failed"}`)
          .join("; ")}`
      );
      continue;
    }

    try {
      const response = await attempt.client.responses.create({
        model: attempt.model,
        instructions,
        input: userContent,
        text: {
          format: {
            type: "json_schema",
            name: schemaName,
            strict: true,
            schema,
          },
        },
        temperature: 0.1,
        max_output_tokens: maxOutputTokens,
      });

      const parsed = parseJsonLoose(extractResponsesText(response));
      if (parsed !== null) {
        stageDiagnostics.ok = true;
        stageDiagnostics.model = attempt.model;
        stageDiagnostics.route = `${attempt.label}/responses`;
        stageDiagnostics.message =
          stageDiagnostics.attempts.length > 0
            ? "Đã fallback thành công ở route khác"
            : "OK";
        if (diagnostics) {
          if (stageDiagnostics.attempts.length > 0)
            diagnostics.hasWarnings = true;
          diagnostics.stages.push(stageDiagnostics);
        }
        return parsed;
      }
      throw new Error("Responses API trả về dữ liệu không parse được");
    } catch (responsesError) {
      stageDiagnostics.attempts.push({
        route: `${attempt.label}/responses`,
        model: attempt.model,
        error: responsesError.message,
      });
      try {
        const response = await attempt.client.chat.completions.create({
          model: attempt.model,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: schemaName,
              strict: true,
              schema,
            },
          },
          messages: chatMessages,
          temperature: 0.1,
        });

        const parsed = parseJsonLoose(extractChatText(response));
        if (parsed !== null) {
          stageDiagnostics.ok = true;
          stageDiagnostics.model = attempt.model;
          stageDiagnostics.route = `${attempt.label}/chat_json_schema`;
          stageDiagnostics.message =
            stageDiagnostics.attempts.length > 0
              ? "Đã fallback thành công ở route khác"
              : "OK";
          if (diagnostics) {
            if (stageDiagnostics.attempts.length > 0)
              diagnostics.hasWarnings = true;
            diagnostics.stages.push(stageDiagnostics);
          }
          return parsed;
        }
        throw new Error(
          "Chat Completions json_schema trả về dữ liệu không parse được"
        );
      } catch (chatSchemaError) {
        stageDiagnostics.attempts.push({
          route: `${attempt.label}/chat_json_schema`,
          model: attempt.model,
          error: chatSchemaError.message,
        });
        try {
          const response = await attempt.client.chat.completions.create({
            model: attempt.model,
            response_format: { type: "json_object" },
            messages: [
              chatMessages[0],
              {
                role: "user",
                content: `${userContent}\n\nTrả về JSON hợp lệ, không thêm giải thích ngoài JSON.`,
              },
            ],
            temperature: 0.1,
          });

          const parsed = parseJsonLoose(extractChatText(response));
          if (parsed !== null) {
            stageDiagnostics.ok = true;
            stageDiagnostics.model = attempt.model;
            stageDiagnostics.route = `${attempt.label}/chat_json_object`;
            stageDiagnostics.message =
              stageDiagnostics.attempts.length > 0
                ? "Đã fallback thành công ở route khác"
                : "OK";
            if (diagnostics) {
              if (stageDiagnostics.attempts.length > 0)
                diagnostics.hasWarnings = true;
              diagnostics.stages.push(stageDiagnostics);
            }
            return parsed;
          }
          throw new Error(
            "Chat Completions json_object trả về dữ liệu không parse được"
          );
        } catch (chatJsonError) {
          stageDiagnostics.attempts.push({
            route: `${attempt.label}/chat_json_object`,
            model: attempt.model,
            error: chatJsonError.message,
          });
          errors.push(
            `${attempt.label}/${attempt.model}: responses=${responsesError.message}; chat_json_schema=${chatSchemaError.message}; chat_json_object=${chatJsonError.message}`
          );
        }
      }
    }
  }

  stageDiagnostics.message =
    "Không gọi được AI ở bước này. Kiểm tra endpoint, model hoặc API key.";
  if (diagnostics) {
    diagnostics.hasErrors = true;
    diagnostics.stages.push(stageDiagnostics);
  }
  console.error("[AI Import] all model attempts failed:", errors.join(" | "));
  throw new Error(
    "Không gọi được AI import. Kiểm tra proxy AI hiện tại hoặc cấu hình OPENAI_REG_IMPORT_MODEL."
  );
}

function normalizeName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizePhone(value) {
  let raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("+84")) raw = `0${raw.slice(3)}`;
  raw = raw.replace(/[^\d]/g, "");
  if (raw.startsWith("84") && raw.length === 11) {
    raw = `0${raw.slice(2)}`;
  }
  return raw;
}

function isLikelyPhone(value) {
  return /^0\d{8,10}$/.test(String(value || ""));
}

function truncate(value, max = 240) {
  const s = String(value || "");
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function compactPromptCells(cells = [], maxCells = 8, maxCellLength = 80) {
  return (cells || [])
    .map((cell) => truncate(String(cell || "").trim(), maxCellLength))
    .filter(Boolean)
    .slice(0, maxCells);
}

function compactPromptObject(object = {}, maxEntries = 8, maxValueLength = 100) {
  return Object.fromEntries(
    Object.entries(object || {})
      .filter(([, value]) => String(value || "").trim())
      .slice(0, maxEntries)
      .map(([key, value]) => [key, truncate(String(value || "").trim(), maxValueLength)])
  );
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function hashText(value) {
  const s = String(value || "");
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) % 100;
  }
  return h;
}

function buildTempBase(name, rowNumber, slot) {
  const base =
    slugify(name || "temp-user", { lower: true, strict: true }) || "temp-user";
  const suffix = `${String(rowNumber || 0).padStart(4, "0")}${slot}${String(
    hashText(name)
  ).padStart(2, "0")}`;
  return {
    emailBase: `${base}.${suffix}`,
    nicknameBase: `${base}.${suffix}`,
    phoneBase: `099${suffix.slice(-7)}`,
  };
}

async function valueExists(model, field, value, session = null) {
  if (!value) return false;
  let query = model.exists({ [field]: value });
  if (session) query = query.session(session);
  const result = await query;
  return !!result;
}

async function uniqueValue({
  model,
  field,
  baseValue,
  formatter,
  session = null,
  reservedSet,
}) {
  let attempt = 0;
  while (attempt < 200) {
    const value = formatter(baseValue, attempt);
    if (
      !reservedSet.has(value) &&
      !(await valueExists(model, field, value, session))
    ) {
      reservedSet.add(value);
      return value;
    }
    attempt += 1;
  }
  throw new Error(`Không tạo được ${field} duy nhất cho import`);
}

function maskEmail(email) {
  const s = normalizeEmail(email);
  const [local, domain] = s.split("@");
  if (!local || !domain) return s;
  if (local.length <= 2) return `${local[0] || ""}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

function buildRawPreview(row, max = 400) {
  if (row.object && Object.keys(row.object).length) {
    return truncate(
      Object.entries(row.object)
        .map(([key, value]) => `${key}: ${value}`)
        .join(" | "),
      max
    );
  }
  return truncate((row.cells || []).filter(Boolean).join(" | "), max);
}

function isBlankRow(cells = []) {
  return !cells.some((cell) => String(cell || "").trim());
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += ch;
  }

  row.push(cell);
  rows.push(row);

  return rows.map((cols) =>
    cols.map((col, index) =>
      index === 0
        ? String(col || "")
            .replace(/^\uFEFF/, "")
            .trim()
        : String(col || "").trim()
    )
  );
}

function detectDelimiter(text) {
  if (text.includes("\t")) return "\t";
  const candidates = [",", ";", "|"];
  const sample = text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(0, 8)
    .join("\n");

  let best = { delimiter: ",", score: 0 };
  for (const delimiter of candidates) {
    const parsed = parseDelimited(sample, delimiter).filter(
      (row) => !isBlankRow(row)
    );
    const widths = parsed
      .map((row) => row.filter(Boolean).length)
      .filter((n) => n > 1);
    const score =
      widths.length > 0
        ? widths.reduce((sum, n) => sum + n, 0) / widths.length
        : 0;
    if (score > best.score) best = { delimiter, score };
  }

  return best.score >= 2 ? best.delimiter : null;
}

function looksLikeHeader(firstRow = [], secondRow = []) {
  const first = firstRow
    .map((cell) => String(cell || "").trim())
    .filter(Boolean);
  if (first.length < 2) return false;

  const uniqueCount = new Set(first.map((cell) => cell.toLowerCase())).size;
  const alphaCount = first.filter((cell) => /[A-Za-zÀ-ỹ]/u.test(cell)).length;
  const numericCount = first.filter((cell) =>
    /^\d+([.,]\d+)?$/.test(cell)
  ).length;
  const secondFilled = secondRow
    .map((cell) => String(cell || "").trim())
    .filter(Boolean).length;

  return (
    uniqueCount >= Math.ceil(first.length * 0.7) &&
    alphaCount >= Math.ceil(first.length * 0.5) &&
    numericCount <= Math.floor(first.length * 0.4) &&
    secondFilled > 0
  );
}

function buildHeaders(rawHeaders = []) {
  const used = new Map();
  return rawHeaders.map((value, index) => {
    const base =
      slugify(String(value || ""), { lower: true, strict: true }) ||
      `column_${index + 1}`;
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    return count ? `${base}_${count + 1}` : base;
  });
}

function parseTextToRows(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return { headers: [], rows: [] };

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const rawRows = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.rows)
        ? parsed.rows
        : [];
      const rows = rawRows
        .map((item, index) => {
          const object =
            item && typeof item === "object" && !Array.isArray(item)
              ? item
              : null;
          const cells = Array.isArray(item)
            ? item.map((cell) => String(cell || "").trim())
            : object
            ? Object.values(object).map((cell) => String(cell || "").trim())
            : [String(item || "").trim()];

          if (isBlankRow(cells)) return null;
          return {
            rowNumber: index + 1,
            cells,
            object,
            sourcePreview: buildRawPreview({ cells, object }),
          };
        })
        .filter(Boolean);
      return {
        headers: rows[0]?.object ? Object.keys(rows[0].object) : [],
        rows,
      };
    } catch {
      // fallback sang dạng text thường
    }
  }

  const delimiter = detectDelimiter(trimmed);
  const matrix = delimiter
    ? parseDelimited(trimmed, delimiter)
    : trimmed.split(/\r?\n/).map((line) => [String(line || "").trim()]);

  const rawRows = matrix.filter((row) => !isBlankRow(row));
  if (!rawRows.length) return { headers: [], rows: [] };

  let headers = [];
  let dataRows = rawRows;

  if (looksLikeHeader(rawRows[0], rawRows[1] || [])) {
    headers = buildHeaders(rawRows[0]);
    dataRows = rawRows.slice(1);
  }

  const rows = dataRows
    .map((cells, index) => {
      const object =
        headers.length > 0
          ? Object.fromEntries(
              headers.map((key, cellIndex) => [
                key,
                String(cells[cellIndex] || "").trim(),
              ])
            )
          : null;

      return {
        rowNumber: headers.length > 0 ? index + 2 : index + 1,
        cells: cells.map((cell) => String(cell || "").trim()),
        object,
        sourcePreview: buildRawPreview({ cells, object }),
      };
    })
    .filter((row) => !isBlankRow(row.cells));

  return { headers, rows };
}

function sampleContextRows(rows, limit = AI_CONTEXT_SAMPLE_ROWS) {
  if (!Array.isArray(rows) || rows.length <= limit) return rows || [];

  const picked = [];
  const seen = new Set();
  const addIndex = (index) => {
    if (index < 0 || index >= rows.length || seen.has(index)) return;
    seen.add(index);
    picked.push(rows[index]);
  };

  const headCount = Math.min(8, limit);
  for (let i = 0; i < headCount; i += 1) addIndex(i);

  const remaining = limit - picked.length;
  if (remaining > 2) {
    const span = rows.length - headCount - 2;
    const step = span > 0 ? span / (remaining - 2) : 0;
    for (let i = 0; i < remaining - 2; i += 1) {
      addIndex(Math.round(headCount + i * step));
    }
  }

  addIndex(rows.length - 2);
  addIndex(rows.length - 1);

  return picked.sort((a, b) => a.rowNumber - b.rowNumber).slice(0, limit);
}

function buildTableContext(headers, rows) {
  return {
    totalRows: rows.length,
    headers,
    sampleRows: sampleContextRows(rows).map((row) => ({
      sourceRowNumber: row.rowNumber,
      raw: buildRawPreview({ cells: row.cells, object: row.object }, 220),
      cells: compactPromptCells(row.cells, 6, 60),
      objectKeys: Object.keys(row.object || {}).slice(0, 8),
      nonEmptyCells: row.cells.filter((cell) => String(cell || "").trim())
        .length,
    })),
  };
}

function resolveGoogleSheetExportUrl(url, format = "csv") {
  const value = String(url || "").trim();
  if (!value) return "";
  if (new RegExp(`/export\\?format=${format}`, "i").test(value)) return value;

  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return value;

  const gidMatch = value.match(/[?&#]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : "0";
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=${format}&gid=${gid}`;
}

function resolveGoogleSheetCsvUrl(url) {
  return resolveGoogleSheetExportUrl(url, "csv");
}

function resolveGoogleSheetXlsxUrl(url) {
  return resolveGoogleSheetExportUrl(url, "xlsx");
}

async function resolveSourceText({ sheetUrl, rawText }) {
  if (String(rawText || "").trim()) {
    return {
      sourceType: "paste",
      sourceLabel: "Dữ liệu dán thủ công",
      text: String(rawText || ""),
    };
  }

  if (!String(sheetUrl || "").trim()) {
    throw new Error("Thiếu Google Sheet URL hoặc dữ liệu để import");
  }

  const exportUrl = resolveGoogleSheetCsvUrl(sheetUrl);
  const response = await fetch(exportUrl, {
    headers: {
      "user-agent": "PickleTourAdminImporter/1.0",
      accept: "text/csv,text/plain,application/json,text/html",
    },
  });

  if (!response.ok) {
    throw new Error(`Không tải được sheet (${response.status})`);
  }

  const text = await response.text();
  if (!String(text || "").trim()) {
    throw new Error("Sheet không có dữ liệu");
  }
  if (/^\s*</.test(text) && /<html/i.test(text)) {
    throw new Error(
      "Sheet chưa public hoặc Google trả về trang HTML, hãy bật quyền xem hoặc dán dữ liệu trực tiếp"
    );
  }

  return {
    sourceType: "sheet",
    sourceLabel: String(sheetUrl || "").trim(),
    originalUrl: String(sheetUrl || "").trim(),
    parseCsvUrl: exportUrl,
    exportCsvUrl: exportUrl,
    exportXlsxUrl: resolveGoogleSheetXlsxUrl(sheetUrl),
    text,
  };
}

function buildPromptRows(batchRows, allRows) {
  const rowIndexMap = new Map(
    allRows.map((row, index) => [row.groupId || row.rowNumber, index])
  );
  return batchRows.map((row, idx) => {
    const groupKey = row.groupId || row.rowNumber;
    const sourceIndex = rowIndexMap.get(groupKey) ?? -1;
    const previous = sourceIndex > 0 ? allRows[sourceIndex - 1] : null;
    const next =
      sourceIndex >= 0 && sourceIndex < allRows.length - 1
        ? allRows[sourceIndex + 1]
        : null;
    const memberRows =
      Array.isArray(row.rows) && row.rows.length ? row.rows : [row];

    return {
      rowIndex: idx,
      sourceRowNumber: row.rowNumber,
      sourceRowNumbers: row.rowNumbers || [row.rowNumber],
      sourceRowLabel: row.rowLabel || String(row.rowNumber),
      raw: truncate(row.sourcePreview, 220),
      rawExpanded: buildGroupedSourcePreview(memberRows, 420),
      cells: compactPromptCells(
        memberRows.flatMap((item) => item.cells || []),
        10,
        60
      ),
      object: compactPromptObject(row.object || {}, 8, 80),
      memberRows: memberRows.map((item) => ({
        sourceRowNumber: item.rowNumber,
        raw: buildRawPreview({ cells: item.cells, object: item.object }, 220),
        cells: compactPromptCells(item.cells, 6, 60),
        object: compactPromptObject(item.object || {}, 6, 80),
      })),
      previousRow: previous
        ? {
            sourceRowNumber: previous.rowNumber,
            sourceRowLabel: previous.rowLabel || String(previous.rowNumber),
            raw:
              previous.sourcePreview ||
              buildGroupedSourcePreview(previous.rows || [previous], 180),
          }
        : null,
      nextRow: next
        ? {
            sourceRowNumber: next.rowNumber,
            sourceRowLabel: next.rowLabel || String(next.rowNumber),
            raw:
              next.sourcePreview ||
              buildGroupedSourcePreview(next.rows || [next], 180),
          }
        : null,
    };
  });
}

function buildAiPrompt(
  tournament,
  batchRows,
  tableContext,
  allRows,
  documentAnalysis,
  adminPrompt = ""
) {
  const isSingles = String(tournament?.eventType || "double") === "single";
  return JSON.stringify({
    tournament: {
      name: tournament?.name || "",
      eventType: isSingles ? "single" : "double",
      location: tournament?.location || "",
    },
    adminInstructions: normalizeAdminPrompt(adminPrompt),
    accountProvisioning: buildTempAccountRulesObject(),
    documentAnalysis,
    tableContext,
    instructions: {
      oneItemMeansOneCandidateRegistration: true,
      honorAdminInstructionsWhenPresent: Boolean(normalizeAdminPrompt(adminPrompt)),
      doNotInventData: true,
      leaveBlankIfMissing: true,
      ratingUnknownValue: -1,
      secondaryPlayerRequired: !isSingles,
      useTableContextToInferStructure: true,
      useAdjacentRowsOnlyForContext: true,
      rowMayContainTwoPlayersInOneCell: true,
      rowMayContainTeamOrCompanyNameSeparateFromPlayers: true,
      candidateItemMayContainMultipleSourceRows: true,
      missingContactFieldsDoNotBlockRegistration: true,
      fullNameIsEnoughForTempUserCreation: true,
      missingFullNameMustBeMarkedForReview: true,
      doNotInventNicknamePasswordOrContactFields: true,
    },
    rows: buildPromptRows(batchRows, allRows),
  });
}

function buildAiSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["rows"],
    properties: {
      rows: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "rowIndex",
            "isRegistrationRow",
            "confidence",
            "primaryName",
            "primaryPhone",
            "primaryEmail",
            "primaryRating",
            "secondaryName",
            "secondaryPhone",
            "secondaryEmail",
            "secondaryRating",
            "paidStatus",
            "notes",
            "reasons",
          ],
          properties: {
            rowIndex: { type: "integer", minimum: 0 },
            isRegistrationRow: { type: "boolean" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            primaryName: { type: "string" },
            primaryPhone: { type: "string" },
            primaryEmail: { type: "string" },
            primaryRating: { type: "number", minimum: -1, maximum: 10 },
            secondaryName: { type: "string" },
            secondaryPhone: { type: "string" },
            secondaryEmail: { type: "string" },
            secondaryRating: { type: "number", minimum: -1, maximum: 10 },
            paidStatus: {
              type: "string",
              enum: ["paid", "unpaid", "unknown"],
            },
            notes: { type: "string" },
            reasons: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
      },
    },
  };
}

function buildDocumentAnalysisSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "layoutType",
      "registrationStyle",
      "containsMultiPlayerCells",
      "containsTeamColumns",
      "likelyHeaderRows",
      "columnHints",
      "registrationHints",
      "ignoreHints",
      "playerSplitHints",
      "paymentHints",
      "notes",
      "confidence",
    ],
    properties: {
      layoutType: {
        type: "string",
        enum: ["tabular", "sectioned", "free_text", "mixed", "unknown"],
      },
      registrationStyle: {
        type: "string",
        enum: [
          "one_row_one_registration",
          "one_row_contains_pair",
          "grouped_rows",
          "mixed",
          "unknown",
        ],
      },
      containsMultiPlayerCells: { type: "boolean" },
      containsTeamColumns: { type: "boolean" },
      likelyHeaderRows: {
        type: "array",
        items: { type: "integer", minimum: 1 },
      },
      columnHints: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["columnKey", "kind", "meaning"],
          properties: {
            columnKey: { type: "string" },
            kind: {
              type: "string",
              enum: [
                "player",
                "partner",
                "team",
                "payment",
                "rating",
                "contact",
                "meta",
                "noise",
                "unknown",
              ],
            },
            meaning: { type: "string" },
          },
        },
      },
      registrationHints: {
        type: "array",
        items: { type: "string" },
      },
      ignoreHints: {
        type: "array",
        items: { type: "string" },
      },
      playerSplitHints: {
        type: "array",
        items: { type: "string" },
      },
      paymentHints: {
        type: "array",
        items: { type: "string" },
      },
      notes: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
  };
}

function buildDocumentAnalysisPrompt(tournament, headers, rows, adminPrompt = "") {
  const isSingles = String(tournament?.eventType || "double") === "single";
  return JSON.stringify({
    tournament: {
      name: tournament?.name || "",
      eventType: isSingles ? "single" : "double",
      location: tournament?.location || "",
    },
    adminInstructions: normalizeAdminPrompt(adminPrompt),
    headers,
    rows: sampleContextRows(rows, Math.min(Math.max(AI_CONTEXT_SAMPLE_ROWS, 12), 16)).map(
      (row) => ({
        sourceRowNumber: row.rowNumber,
        raw: buildRawPreview({ cells: row.cells, object: row.object }, 260),
        cells: compactPromptCells(row.cells, 6, 60),
        object: compactPromptObject(row.object || {}, 6, 80),
      })
    ),
  });
}

function buildFallbackDocumentAnalysis(headers, rows, reason = "") {
  return {
    layoutType: headers.length ? "tabular" : "unknown",
    registrationStyle: "mixed",
    containsMultiPlayerCells: true,
    containsTeamColumns: true,
    likelyHeaderRows: headers.length ? [1] : [],
    columnHints: headers.map((header) => ({
      columnKey: header,
      kind: "unknown",
      meaning: "Chưa xác định",
    })),
    registrationHints: [],
    ignoreHints: [],
    playerSplitHints: [
      "A / B",
      "A - B",
      "A + B",
      "A & B",
      "nhiều dòng trong cùng một ô",
    ],
    paymentHints: [],
    notes:
      reason ||
      `Chưa xác định chắc bố cục file, sẽ ưu tiên để AI đọc theo ngữ cảnh từng vùng trong ${rows.length} dòng đầu.`,
    confidence: 0.35,
  };
}

function buildRowGroupingSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["rows"],
    properties: {
      rows: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "rowIndex",
            "sourceRowNumber",
            "isRegistrationRow",
            "mergeWithPrevious",
            "confidence",
            "reasons",
          ],
          properties: {
            rowIndex: { type: "integer", minimum: 0 },
            sourceRowNumber: { type: "integer", minimum: 1 },
            isRegistrationRow: { type: "boolean" },
            mergeWithPrevious: { type: "boolean" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            reasons: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
      },
    },
  };
}

function buildRowGroupingPrompt(
  tournament,
  rows,
  documentAnalysis,
  adminPrompt = ""
) {
  const isSingles = String(tournament?.eventType || "double") === "single";
  return JSON.stringify({
    tournament: {
      name: tournament?.name || "",
      eventType: isSingles ? "single" : "double",
      location: tournament?.location || "",
    },
    adminInstructions: normalizeAdminPrompt(adminPrompt),
    documentAnalysis,
    rows: rows.map((row, idx) => ({
      rowIndex: idx,
      sourceRowNumber: row.rowNumber,
      raw: buildRawPreview({ cells: row.cells, object: row.object }, 260),
      cells: compactPromptCells(row.cells, 6, 60),
      object: compactPromptObject(row.object || {}, 6, 80),
    })),
  });
}

async function analyzeRowGroupingWithAI(
  tournament,
  rows,
  documentAnalysis,
  diagnostics,
  adminPrompt = ""
) {
  const instructions = `
Bạn là bộ phân nhóm dữ liệu đăng ký PickleTour.

Mục tiêu:
- Quyết định dòng nào thực sự là dòng đăng ký.
- Nếu một hồ sơ đăng ký trải trên nhiều dòng liên tiếp, hãy đánh dấu mergeWithPrevious = true ở các dòng tiếp theo.
- Chỉ được gộp các dòng LIỀN KỀ nhau.
- Nếu gặp tiêu đề, dòng ngăn cách, ghi chú, tên đội, tên công ty, số thứ tự, tổng kết thì đặt isRegistrationRow = false.
- mergeWithPrevious chỉ true khi dòng hiện tại thực sự bổ sung cho hồ sơ của dòng ngay trước đó.
- Không bịa dữ liệu.
- Nếu không chắc, hạ confidence và ghi rõ reasons.

Trả về JSON đúng schema, không thêm giải thích.
  `.trim();

  try {
    const parsed = await createStructuredJson({
      schemaName: "registration_import_row_grouping",
      schema: buildRowGroupingSchema(),
      instructions,
      input: buildRowGroupingPrompt(
        tournament,
        rows,
        documentAnalysis,
        adminPrompt
      ),
      maxOutputTokens: 3000,
      stage: "row_grouping",
      diagnostics,
    });
    const items = Array.isArray(parsed?.rows) ? parsed.rows : [];
    return rows.map((row, idx) => {
      const matched = items.find((item) => Number(item?.rowIndex) === idx);
      return (
        matched || {
          rowIndex: idx,
          sourceRowNumber: row.rowNumber,
          isRegistrationRow: true,
          mergeWithPrevious: false,
          confidence: 0.4,
          reasons: ["AI chưa phân nhóm rõ dòng này"],
        }
      );
    });
  } catch (error) {
    console.error("[AI Import] analyze grouping error:", error.message);
    return rows.map((row, idx) => ({
      rowIndex: idx,
      sourceRowNumber: row.rowNumber,
      isRegistrationRow: true,
      mergeWithPrevious: false,
      confidence: 0.35,
      reasons: ["AI chưa phân nhóm được các dòng trong file này"],
    }));
  }
}

async function analyzeRowGroupingCompact(
  tournament,
  rows,
  documentAnalysis,
  diagnostics,
  adminPrompt = ""
) {
  const instructions = `
Bạn là bộ phân nhóm dữ liệu đăng ký PickleTour.

Mục tiêu:
- Quyết định dòng nào thực sự là dòng đăng ký.
- Nếu một hồ sơ đăng ký trải trên nhiều dòng liên tiếp, hãy đánh dấu \`mergeWithPrevious = true\` ở các dòng tiếp theo.
- Chỉ được gom các dòng liền kề nhau.
- Nếu gặp tiêu đề, dòng ngăn cách, ghi chú, tên đội, tên công ty, số thứ tự, dòng tổng kết thì đặt \`isRegistrationRow = false\`.
- \`mergeWithPrevious\` chỉ được để \`true\` khi dòng hiện tại thực sự bổ sung cho hồ sơ của dòng ngay trước đó.
- Không bịa dữ liệu.
- Nếu không chắc, hãy hạ \`confidence\` và ghi rõ \`reasons\`.

Trả về JSON đúng schema, không thêm giải thích.
  `.trim();

  try {
    const combined = [];
    const chunkSize = Math.max(8, AI_GROUPING_CHUNK_SIZE);

    for (let start = 0; start < rows.length; start += chunkSize) {
      const overlapStart = start > 0 ? start - 1 : start;
      const chunkRows = rows.slice(overlapStart, start + chunkSize);
      const parsed = await createStructuredJson({
        schemaName: "registration_import_row_grouping",
        schema: buildRowGroupingSchema(),
        instructions,
        input: buildRowGroupingPrompt(
          tournament,
          chunkRows,
          documentAnalysis,
          adminPrompt
        ),
        maxOutputTokens: 2200,
        stage: `row_grouping_${chunkRows[0]?.rowNumber || 0}_${
          chunkRows.at(-1)?.rowNumber || 0
        }`,
        diagnostics,
      });
      const items = Array.isArray(parsed?.rows) ? parsed.rows : [];
      const contextOffset = start > 0 ? 1 : 0;

      for (let idx = contextOffset; idx < chunkRows.length; idx += 1) {
        const row = chunkRows[idx];
        const matched = items.find((item) => Number(item?.rowIndex) === idx);
        combined.push(
          matched || {
            rowIndex: combined.length,
            sourceRowNumber: row.rowNumber,
            isRegistrationRow: true,
            mergeWithPrevious: false,
            confidence: 0.4,
            reasons: ["AI chưa phân nhóm rõ dòng này"],
          }
        );
      }
    }

    return rows.map((row, idx) => {
      const matched = combined[idx];
      return (
        matched || {
          rowIndex: idx,
          sourceRowNumber: row.rowNumber,
          isRegistrationRow: true,
          mergeWithPrevious: false,
          confidence: 0.4,
          reasons: ["AI chưa phân nhóm rõ dòng này"],
        }
      );
    });
  } catch (error) {
    console.error("[AI Import] analyze compact grouping error:", error.message);
    return rows.map((row, idx) => ({
      rowIndex: idx,
      sourceRowNumber: row.rowNumber,
      isRegistrationRow: true,
      mergeWithPrevious: false,
      confidence: 0.35,
      reasons: ["AI chưa phân nhóm được các dòng trong file này"],
    }));
  }
}

function buildGroupedSourcePreview(rows, max = 1000) {
  return truncate(
    rows
      .map(
        (row) =>
          `row ${row.rowNumber}: ${buildRawPreview(
            { cells: row.cells, object: row.object },
            320
          )}`
      )
      .join(" || "),
    max
  );
}

function buildSourceGroups(rows, groupingRows) {
  const groups = [];
  let current = null;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const grouping = groupingRows[i] || {};
    const isRegistrationRow = Boolean(grouping.isRegistrationRow);
    const mergeWithPrevious = Boolean(grouping.mergeWithPrevious);
    const confidence = safeNumber(grouping.confidence, 0);
    const reasons = compactList(grouping.reasons);

    if (!isRegistrationRow) {
      current = null;
      groups.push({
        groupId: `group-${row.rowNumber}`,
        rowNumber: row.rowNumber,
        rowNumbers: [row.rowNumber],
        rowLabel: String(row.rowNumber),
        rows: [row],
        sourcePreview: row.sourcePreview,
        isRegistrationGroup: false,
        groupConfidence: confidence,
        groupReasons: reasons,
      });
      continue;
    }

    if (mergeWithPrevious && current) {
      current.rows.push(row);
      current.rowNumbers.push(row.rowNumber);
      current.groupConfidence = Math.min(
        current.groupConfidence,
        confidence || 1
      );
      current.groupReasons = compactList([...current.groupReasons, ...reasons]);
      current.rowLabel =
        current.rowNumbers.length > 1
          ? `${current.rowNumbers[0]}-${
              current.rowNumbers[current.rowNumbers.length - 1]
            }`
          : String(current.rowNumbers[0]);
      current.sourcePreview = buildGroupedSourcePreview(current.rows);
      continue;
    }

    current = {
      groupId: `group-${row.rowNumber}`,
      rowNumber: row.rowNumber,
      rowNumbers: [row.rowNumber],
      rowLabel: String(row.rowNumber),
      rows: [row],
      sourcePreview: row.sourcePreview,
      isRegistrationGroup: true,
      groupConfidence: confidence,
      groupReasons: reasons,
    };
    groups.push(current);
  }

  return groups;
}

async function analyzeDocumentLayoutWithAI(
  tournament,
  headers,
  rows,
  diagnostics,
  adminPrompt = ""
) {
  const instructions = `
Bạn là bộ phân tích bố cục file đăng ký PickleTour.

Mục tiêu:
- Chưa trích xuất người chơi ngay.
- Hãy nhìn toàn bộ file mẫu để hiểu file này đang được tổ chức theo kiểu nào.
- File có thể rất bẩn, không theo mẫu cố định, nhiều vùng bảng khác nhau, tiêu đề chen giữa dữ liệu, cột team/công ty/sponsor trộn với tên người chơi.
- Có thể 2 VĐV nằm chung 1 ô, hoặc tên đội nằm riêng 1 cột, hoặc header kiểu "nam-nam", "nu-nu", "mixed", "team", "captain", "player 1", "player 2".
- Hãy chỉ ra quy luật đọc hợp lý nhất để bước sau trích xuất từng dòng theo đúng ngữ cảnh.

Quy tắc:
- Không bịa dữ liệu.
- Nếu không chắc, cứ nói unknown/mixed và hạ confidence.
- likelyHeaderRows là số dòng gốc có vẻ là header/section title.
- columnHints chỉ mô tả các cột bạn thực sự nhìn ra ý nghĩa.
- notes viết ngắn gọn, đủ để bước sau biết nên đọc file theo cách nào.

Trả về JSON đúng schema, không thêm giải thích ngoài schema.
  `.trim();

  try {
    const parsed = await createStructuredJson({
      schemaName: "registration_import_document_analysis",
      schema: buildDocumentAnalysisSchema(),
      instructions,
      input: buildDocumentAnalysisPrompt(
        tournament,
        headers,
        rows,
        adminPrompt
      ),
      maxOutputTokens: 2500,
      stage: "document_analysis",
      diagnostics,
    });
    return {
      ...buildFallbackDocumentAnalysis(headers, rows),
      ...parsed,
      likelyHeaderRows: compactList(parsed?.likelyHeaderRows || []).slice(
        0,
        10
      ),
      columnHints: Array.isArray(parsed?.columnHints)
        ? parsed.columnHints.slice(0, 20)
        : [],
      registrationHints: compactList(parsed?.registrationHints || []).slice(
        0,
        12
      ),
      ignoreHints: compactList(parsed?.ignoreHints || []).slice(0, 12),
      playerSplitHints: compactList(parsed?.playerSplitHints || []).slice(
        0,
        12
      ),
      paymentHints: compactList(parsed?.paymentHints || []).slice(0, 12),
      confidence: safeNumber(parsed?.confidence, 0.35),
      notes:
        String(parsed?.notes || "").trim() ||
        buildFallbackDocumentAnalysis(headers, rows).notes,
    };
  } catch (error) {
    console.error("[AI Import] analyze document error:", error.message);
    return buildFallbackDocumentAnalysis(
      headers,
      rows,
      "AI chưa phân tích rõ bố cục file này."
    );
  }
}

async function analyzeBatchWithAI(
  tournament,
  batchRows,
  tableContext,
  allRows,
  documentAnalysis,
  diagnostics,
  adminPrompt = ""
) {
  const instructions = `
Bạn là bộ phân tích dữ liệu đăng ký giải PickleTour cho admin.

Nhiệm vụ:
- File đầu vào có thể rất bẩn, không theo mẫu cố định, có nhiều kiểu bảng khác nhau trong cùng một file.
- Trước hết hãy dùng documentAnalysis và tableContext để hiểu cấu trúc chung của file, tên cột, ý nghĩa từng vùng dữ liệu, rồi mới đọc từng row.
- documentAnalysis là kết luận bước 1 ở cấp toàn file. Hãy bám theo đó trước khi quyết định row hiện tại là gì.
- Mỗi item đầu vào có thể tương ứng với 1 dòng hoặc một nhóm nhiều dòng đã được gom lại thành một hồ sơ ứng viên.
- Dữ liệu có thể rất tự do, nhiều thông tin dồn vào một ô, hoặc 2 VĐV nằm chung một ô.
- Hãy rút ra dữ liệu đăng ký từ chính item đó.
- KHÔNG được bịa thêm người, số điện thoại, email hay rating.

${buildTempAccountRulesText()}

- Nếu row chỉ là tiêu đề/tổng kết/ghi chú không phải đăng ký, đặt isRegistrationRow = false.
- Tên đội, tên công ty, tên nhà tài trợ, mã đơn hàng, STT, số thứ tự, tên cột không phải là tên người chơi.
- Nếu một ô chứa cả cặp đôi, hãy tách ra primary và secondary khi có đủ dấu hiệu hợp lý.
- Có thể gặp các dạng như:
  - "A / B"
  - "A - B"
  - "A + B"
  - "A & B"
  - nhiều dòng trong cùng một ô
  - ô team riêng, ô player riêng
  - header kiểu "nam-nam", "nu-nu", "mixed", "doi nam", "doi nu"
- Chỉ dùng previousRow / nextRow / tableContext để hiểu cấu trúc và ngữ nghĩa cột. Không được lấy người chơi từ item khác sang item hiện tại.
- confidence:
  - 0.9-1.0: gần như chắc chắn
  - 0.65-0.89: khá chắc
  - dưới 0.65: mơ hồ, cần admin xem lại
- primaryName / secondaryName: tên người chơi nếu có.
- primaryPhone / secondaryPhone: chỉ điền khi thực sự có trong row.
- primaryEmail / secondaryEmail: chỉ điền khi thực sự có trong row.
- primaryRating / secondaryRating:
  - nếu row có trình/rating rõ ràng thì điền số 0..10
  - nếu không rõ, điền -1
- paidStatus:
  - "paid" nếu row thể hiện đã chuyển khoản / đã thanh toán
  - "unpaid" nếu row nói chưa thanh toán
  - "unknown" nếu không rõ
- Với giải đôi:
  - ưu tiên tách đủ 2 người nếu cùng row thực sự có một cặp
  - nếu chỉ thấy 1 người thì để secondary trống và hạ confidence
- Nếu row có tên người rõ nhưng không có phone/email thì vẫn là row đăng ký hợp lệ.
- Nếu row có 2 tên người rõ trong cùng row, vẫn có thể cho confidence cao dù thiếu phone/email.
- Nếu row thiếu luôn fullName của một người chơi thì không được tự đặt tên tạm trong output; hãy để trống và thêm lý do cần xem lại.

Trả về JSON đúng schema, không thêm giải thích.
  `.trim();

  const parsed = await createStructuredJson({
    schemaName: "registration_import_batch",
    schema: buildAiSchema(),
    instructions,
    input: buildAiPrompt(
      tournament,
      batchRows,
      tableContext,
      allRows,
      documentAnalysis,
      adminPrompt
    ),
    maxOutputTokens: 4000,
    stage: `row_extraction_${batchRows[0]?.rowNumber || 0}_${
      batchRows.at(-1)?.rowNumber || 0
    }`,
    diagnostics,
  });
  const items = Array.isArray(parsed?.rows) ? parsed.rows : [];
  return batchRows.map((_row, idx) => {
    const matched = items.find((item) => Number(item?.rowIndex) === idx);
    return (
      matched || {
        rowIndex: idx,
        isRegistrationRow: true,
        confidence: 0,
        primaryName: "",
        primaryPhone: "",
        primaryEmail: "",
        primaryRating: -1,
        secondaryName: "",
        secondaryPhone: "",
        secondaryEmail: "",
        secondaryRating: -1,
        paidStatus: "unknown",
        notes: "",
        reasons: ["AI không trả đủ dữ liệu cho row này"],
      }
    );
  });
}

async function analyzeRows(
  tournament,
  sourceRows,
  tableContext,
  documentAnalysis,
  diagnostics,
  onProgress,
  adminPrompt = ""
) {
  const chunks = [];
  for (let i = 0; i < sourceRows.length; i += AI_BATCH_SIZE) {
    chunks.push(sourceRows.slice(i, i + AI_BATCH_SIZE));
  }

  reportPreviewProgress(onProgress, {
    step: "row_extraction",
    progress: 58,
    message: `Đang tách ${sourceRows.length} cụm hồ sơ để xử lý.`,
    totalChunks: chunks.length,
    completedChunks: 0,
    totalGroups: sourceRows.length,
  });

  const limit = pLimit(AI_CONCURRENCY);
  let completedChunks = 0;
  const chunkResults = await Promise.all(
    chunks.map((chunk, chunkIndex) =>
      limit(async () => {
        try {
          const result = await analyzeBatchWithAI(
            tournament,
            chunk,
            tableContext,
            sourceRows,
            documentAnalysis,
            diagnostics,
            adminPrompt
          );
          completedChunks += 1;
          reportPreviewProgress(onProgress, {
            step: "row_extraction",
            progress:
              58 + Math.round((completedChunks / Math.max(chunks.length, 1)) * 24),
            message: `Đã tách xong ${completedChunks}/${chunks.length} đợt dữ liệu.`,
            totalChunks: chunks.length,
            completedChunks,
            currentChunk: chunkIndex + 1,
            currentRange: `${chunk[0]?.rowLabel || chunk[0]?.rowNumber || "?"} -> ${
              chunk.at(-1)?.rowLabel || chunk.at(-1)?.rowNumber || "?"
            }`,
          });
          return result;
        } catch (error) {
          console.error("[AI Import] analyze batch error:", error.message);
          completedChunks += 1;
          reportPreviewProgress(onProgress, {
            step: "row_extraction",
            progress:
              58 + Math.round((completedChunks / Math.max(chunks.length, 1)) * 24),
            message: `Một đợt dữ liệu gặp lỗi, đang tiếp tục ${completedChunks}/${chunks.length}.`,
            totalChunks: chunks.length,
            completedChunks,
            currentChunk: chunkIndex + 1,
            currentRange: `${chunk[0]?.rowLabel || chunk[0]?.rowNumber || "?"} -> ${
              chunk.at(-1)?.rowLabel || chunk.at(-1)?.rowNumber || "?"
            }`,
          });
          return chunk.map((row, idx) => ({
            rowIndex: idx,
            isRegistrationRow: true,
            confidence: 0,
            primaryName: "",
            primaryPhone: "",
            primaryEmail: "",
            primaryRating: -1,
            secondaryName: "",
            secondaryPhone: "",
            secondaryEmail: "",
            secondaryRating: -1,
            paidStatus: "unknown",
            notes: "",
            reasons: ["AI chưa tách được dữ liệu đăng ký từ cụm này"],
          }));
        }
      })
    )
  );

  return chunkResults.flat();
}

function csvEscapeCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function serializeCsv(rows = []) {
  return rows
    .map((row) => row.map((cell) => csvEscapeCell(cell)).join(","))
    .join("\n");
}

function buildCsvFromParsed(parsed) {
  const rows = [];
  if (Array.isArray(parsed?.headers) && parsed.headers.length) {
    rows.push(parsed.headers);
  }
  (parsed?.rows || []).forEach((row) => {
    rows.push((row?.cells || []).map((cell) => String(cell ?? "").trim()));
  });
  return serializeCsv(rows);
}

async function materializeSourceFile({ source, parsed }) {
  const dir = path.join(os.tmpdir(), "pickletour-ai-import");
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await fs.mkdir(dir, { recursive: true });

  // Google Sheet URL: app vẫn dùng CSV snapshot để parse nội bộ và dựng preview,
  // nhưng file gửi sang CatGPT sẽ ưu tiên giữ nguyên dạng .xlsx.
  if (source?.sourceType === "sheet" && source?.exportXlsxUrl) {
    try {
      const response = await fetch(source.exportXlsxUrl, {
        headers: {
          "user-agent": "PickleTourAdminImporter/1.0",
          accept:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream",
        },
      });
      if (response.ok) {
        const contentType = String(response.headers.get("content-type") || "");
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const looksHtml =
          /text\/html/i.test(contentType) ||
          /^\s*</.test(buffer.toString("utf8", 0, Math.min(buffer.length, 120)));

        if (buffer.length > 0 && !looksHtml) {
          const filename = `ai-import-${stamp}.xlsx`;
          const filePath = path.join(dir, filename);
          await fs.writeFile(filePath, buffer);
          return {
            filePath,
            filename,
            fileType: "xlsx",
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            content: String(source?.text || ""),
            base64: buffer.toString("base64"),
            sourceMode: "google-sheet-xlsx",
            originalUrl: source?.originalUrl || source?.sourceLabel || "",
          };
        }
      }
    } catch {
      // fallback below
    }
  }

  const hasTabularShape =
    Array.isArray(parsed?.headers) && parsed.headers.length > 0
      ? true
      : (parsed?.rows || []).some((row) => (row?.cells || []).length > 1);
  const preferTextSnapshot = true;
  const csvContent = !preferTextSnapshot && hasTabularShape ? buildCsvFromParsed(parsed) : "";
  const textSnapshot =
    source?.sourceType === "sheet"
      ? [
          `Nguồn gốc: Google Sheet`,
          source?.originalUrl ? `Google Sheet URL: ${source.originalUrl}` : "",
          source?.exportCsvUrl ? `CSV export URL: ${source.exportCsvUrl}` : "",
          "",
          `Nội dung snapshot:`,
          String(source?.text || ""),
        ]
          .filter(Boolean)
          .join("\n")
      : String(source?.text || "");
  const fileType = csvContent.trim() ? "csv" : "txt";
  const mimeType = fileType === "csv" ? "text/csv" : "text/plain";
  const content = fileType === "csv" ? csvContent : textSnapshot;
  const filename = `ai-import-${stamp}.${fileType}`;
  const filePath = path.join(dir, filename);

  await fs.writeFile(filePath, content, "utf8");

  return {
    filePath,
    filename,
    fileType,
    mimeType,
    content,
    base64: Buffer.from(content, "utf8").toString("base64"),
    sourceMode:
      source?.sourceType === "sheet" ? "google-sheet-text-snapshot" : "text-snapshot",
    originalUrl: source?.originalUrl || source?.sourceLabel || "",
  };
}

async function cleanupMaterializedSource(materializedSource) {
  if (!materializedSource?.filePath) return;
  try {
    await fs.unlink(materializedSource.filePath);
  } catch {
    // ignore temp cleanup errors
  }
}

function extractRowNumbersFromSourceLabel(sourceLabel) {
  const text = String(sourceLabel || "")
    .trim()
    .replace(/[–—]/g, "-");
  if (!text) return [];

  const rowNumbers = new Set();
  const rangePattern = /(\d+)\s*-\s*(\d+)/g;
  let rangeMatch = rangePattern.exec(text);
  while (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      const [minValue, maxValue] = start <= end ? [start, end] : [end, start];
      for (
        let current = minValue;
        current <= maxValue && rowNumbers.size < 100;
        current += 1
      ) {
        rowNumbers.add(current);
      }
    }
    rangeMatch = rangePattern.exec(text);
  }

  (text.match(/\d+/g) || []).forEach((value) => {
    const number = Number(value);
    if (Number.isFinite(number)) rowNumbers.add(number);
  });

  return Array.from(rowNumbers).sort((a, b) => a - b);
}

function coerceBoolean(value) {
  if (typeof value === "boolean") return value;
  const text = String(value || "")
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "y", "review", "can xem lai"].includes(text);
}

function normalizeGatewayPaymentStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "paid") return "paid";
  if (normalized === "unpaid") return "unpaid";
  return "unknown";
}

function normalizeGatewayRating(value) {
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating < 0) return -1;
  return Math.min(10, rating);
}

function buildGatewaySourcePreview(registration) {
  const players = Array.isArray(registration?.players)
    ? registration.players
    : [];
  const names = players
    .map((player) => normalizeName(player?.fullName))
    .filter(Boolean)
    .join(" / ");
  return truncate(
    [
      registration?.sourceLabel
        ? `rows ${registration.sourceLabel}`
        : "row ?",
      names || "chua tach duoc ten",
      registration?.eventGuess ? `event: ${registration.eventGuess}` : null,
      registration?.paymentStatus
        ? `payment: ${normalizeGatewayPaymentStatus(registration.paymentStatus)}`
        : null,
      registration?.notes ? `notes: ${registration.notes}` : null,
    ]
      .filter(Boolean)
      .join(" | "),
    320
  );
}

function buildCatgptJsonPrompt(tournament, materializedSource, adminPrompt = "") {
  const isSingles = String(tournament?.eventType || "double") === "single";
  const adminSection = buildAdminPromptSection(adminPrompt);
  return `
Bạn là hệ thống AI hỗ trợ admin PickleTour nhập danh sách đăng ký giải.

Nguồn chính là FILE đính kèm. Hãy đọc file đó và trả về DUY NHẤT 1 JSON object hợp lệ.
Ưu tiên hiểu trực quan file đính kèm trước. Nếu file là Excel, Google Sheet snapshot, hoặc bảng dán giữ nguyên bố cục thì hãy tận dụng chính bố cục đó, không cần ép suy luận theo CSV.

Thông tin giải:
- tournamentName: ${tournament?.name || ""}
- eventType: ${isSingles ? "single" : "double"}
- location: ${tournament?.location || ""}
- uploadedFileType: ${materializedSource?.fileType || "unknown"}
- uploadedSourceMode: ${materializedSource?.sourceMode || "unknown"}
- originalSourceUrl: ${materializedSource?.originalUrl || ""}

Yêu cầu bắt buộc:
- Không bịa người chơi, số điện thoại, email, rating, hay trạng thái thanh toán.
- Được phép tách 2 VĐV nằm chung 1 ô hoặc 1 dòng.
- Phải phân biệt tên đội, tên công ty, sponsor, mã đơn, STT với tên người chơi.
- \`sourceLabel\` phải tham chiếu dòng gốc trong file, ví dụ: \`"2"\`, \`"5-6"\`, \`"8,10"\`.
- \`rating\` dùng số \`0..10\`, nếu không rõ thì \`-1\`.
- \`paymentStatus\` chỉ được là: \`"paid"\`, \`"unpaid"\`, \`"unknown"\`.
- \`needsReview = true\` nếu dữ liệu mơ hồ, thiếu đội, không chắc bố cục, hoặc dễ nhầm team với tên người.
- \`registrations\` chỉ gồm các mục trông giống một hồ sơ đăng ký.
- Các phần không parse được đưa vào \`unparsedSections\`.
- Giữ \`notes\` và \`warnings\` ngắn gọn để admin dễ đọc.
- Nếu chỉ có fullName mà thiếu email/phone thì vẫn giữ hồ sơ đăng ký; backend sẽ tự tạo tài khoản tạm.
- Nếu thiếu luôn fullName thì không được tự đặt tên tạm, phải đánh needsReview và nêu lý do thiếu tên.
- Không trả ra nickname hoặc password trong output; backend sẽ tự cấp các trường này khi cần.
- Nếu file không có email/phone thì không được tự bịa; email tạm sẽ do backend sinh với domain \`@${TEMP_EMAIL_DOMAIN}\`.

${buildTempAccountRulesText()}

${adminSection ? `${adminSection}\n` : ""}

JSON phải đúng shape này:
{
  "documentAnalysis": {
    "layoutType": "tabular|sectioned|free_text|mixed|unknown",
    "registrationStyle": "one_row_one_registration|one_row_contains_pair|grouped_rows|mixed|unknown",
    "summary": "string",
    "notes": "string",
    "confidence": 0.0
  },
  "warnings": ["string"],
  "unparsedSections": [
    {
      "sourceLabel": "string",
      "reason": "string"
    }
  ],
  "registrations": [
    {
      "sourceLabel": "string",
      "players": [
        {
          "slot": 1,
          "fullName": "string",
          "phone": "string",
          "email": "string",
          "rating": -1
        },
        {
          "slot": 2,
          "fullName": "string",
          "phone": "string",
          "email": "string",
          "rating": -1
        }
      ],
      "eventGuess": "string",
      "paymentStatus": "paid|unpaid|unknown",
      "notes": "string",
      "confidence": 0.0,
      "needsReview": true,
      "reasons": ["string"]
    }
  ]
}

Chỉ trả về JSON object. Không markdown. Không giải thích thêm.
  `.trim();
}

function buildCatgptCsvFallbackPrompt(
  tournament,
  materializedSource,
  adminPrompt = ""
) {
  const isSingles = String(tournament?.eventType || "double") === "single";
  const adminSection = buildAdminPromptSection(adminPrompt);
  return `
Bạn vừa nhận 1 FILE đăng ký giải PickleTour.
Ưu tiên đọc trực quan file đính kèm. Nếu file là Excel, Google Sheet snapshot, hoặc bảng dán giữ nguyên bố cục thì hãy bám theo chính bố cục đó.

Nếu không thể trả về JSON sạch, hãy trả về DUY NHẤT CSV với đúng header sau:
sourceLabel,confidence,needsReview,paymentStatus,eventGuess,notes,reasons,primaryName,primaryPhone,primaryEmail,primaryRating,secondaryName,secondaryPhone,secondaryEmail,secondaryRating

Yêu cầu:
- eventType của giải: ${isSingles ? "single" : "double"}
- fileType: ${materializedSource?.fileType || "unknown"}
- sourceMode: ${materializedSource?.sourceMode || "unknown"}
- originalSourceUrl: ${materializedSource?.originalUrl || ""}
- \`sourceLabel\` phải tham chiếu dòng gốc, ví dụ \`"2"\` hoặc \`"5-6"\`
- \`paymentStatus\` chỉ được là \`paid\`, \`unpaid\`, hoặc \`unknown\`
- \`needsReview\` chỉ được là \`true\` hoặc \`false\`
- \`rating\` là số \`0..10\`, nếu không rõ thì \`-1\`
- \`reasons\` phải ngắn gọn; nếu có nhiều lý do thì ngăn cách bằng \`"; "\`
- Nếu chỉ có fullName mà thiếu email/phone thì vẫn giữ hồ sơ; backend sẽ tự tạo tài khoản tạm.
- Nếu thiếu luôn fullName thì không được tự đặt tên tạm; hãy để trống tên và nêu lý do cần xem lại.
- Không được điền nickname hoặc password vào CSV output.
- Nếu file không có email/phone thì không được tự bịa; email tạm sẽ do backend sinh với domain \`@${TEMP_EMAIL_DOMAIN}\`.
- Không markdown, không code fence, không giải thích thêm

${buildTempAccountRulesText()}

${adminSection ? `${adminSection}\n` : ""}

Chỉ trả về CSV.
  `.trim();
}

async function requestCatgptGateway({
  prompt,
  materializedSource,
  diagnostics,
  stage,
}) {
  if (!CATGPT_GATEWAY_BASE_URL) {
    throw new Error("Thieu CATGPT_GATEWAY_BASE_URL cho AI import.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    CATGPT_GATEWAY_TIMEOUT_MS
  );

  try {
    const response = await fetch(
      `${CATGPT_GATEWAY_BASE_URL}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...buildCatgptGatewayHeaders("application/json"),
        },
        body: JSON.stringify({
          model: CATGPT_GATEWAY_MODEL,
          stream: false,
          temperature: 0.1,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "file",
                  file: {
                    filename: materializedSource.filename,
                    data: materializedSource.base64,
                    mime_type: materializedSource.mimeType,
                  },
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
      }
    );

    const rawBody = await response.text();
    if (!response.ok) {
      const error = new Error(
        `HTTP ${response.status}: ${truncate(rawBody || response.statusText, 320)}`
      );
      error.status = response.status;
      throw error;
    }

    const payload = JSON.parse(rawBody);
    const content = extractChatText(payload);
    if (!String(content || "").trim()) {
      throw new Error("Gateway trả về phản hồi rỗng.");
    }
    diagnostics.completionId = String(payload?.id || "").trim();

    diagnostics.stages.push({
      stage,
      ok: true,
      model: CATGPT_GATEWAY_MODEL,
      route: "catgpt/chat_completions",
      attempts: [],
      message: "Đã nhận phản hồi từ CatGPT-Gateway.",
    });

    return {
      completionId: String(payload?.id || "").trim(),
      model: String(payload?.model || CATGPT_GATEWAY_MODEL),
      usage: payload?.usage || null,
      text: String(content || "").trim(),
      messageContent: payload?.choices?.[0]?.message?.content ?? null,
      payload,
      rawBody,
    };
  } catch (error) {
    const normalizedError =
      error?.name === "AbortError"
        ? new Error(
            `Gateway timed out after ${Math.round(
              CATGPT_GATEWAY_TIMEOUT_MS / 1000
            )}s while waiting for ChatGPT response.`
          )
        : error;
    diagnostics.hasErrors = true;
    diagnostics.stages.push({
      stage,
      ok: false,
      model: CATGPT_GATEWAY_MODEL,
      route: "catgpt/chat_completions",
      attempts: [
        {
          route: "catgpt/chat_completions",
          model: CATGPT_GATEWAY_MODEL,
          error: normalizedError.message,
        },
      ],
      message:
        normalizedError === error
          ? "Không lấy được phản hồi từ CatGPT-Gateway."
          : "CatGPT-Gateway đang xử lý quá lâu, client đã dừng chờ để tránh treo preview.",
    });
    if (isCatgptGatewayNetworkError(normalizedError)) {
      await probeCatgptGatewayStatus(diagnostics, {
        stage: "gateway_status",
        timeoutMs: 5000,
      });
    }
    throw attachAiDiagnosticsToError(normalizedError, diagnostics);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCatgptModels(diagnostics) {
  try {
    const response = await fetch(`${CATGPT_GATEWAY_BASE_URL}/models`, {
      headers: buildCatgptGatewayHeaders("application/json"),
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${truncate(raw || response.statusText, 240)}`);
    }
    const payload = JSON.parse(raw);
    diagnostics.availableModels = (payload?.data || [])
      .map((item) => String(item?.id || "").trim())
      .filter(Boolean);
    diagnostics.stages.push({
      stage: "gateway_models",
      ok: true,
      model: CATGPT_GATEWAY_MODEL,
      route: "catgpt/models",
      attempts: [],
      message: diagnostics.availableModels.length
        ? `Gateway đang mở ${diagnostics.availableModels.join(", ")}.`
        : "Gateway trả về danh sách model rỗng.",
    });
  } catch (error) {
    diagnostics.hasWarnings = true;
    diagnostics.stages.push({
      stage: "gateway_models",
      ok: false,
      model: CATGPT_GATEWAY_MODEL,
      route: "catgpt/models",
      attempts: [
        {
          route: "catgpt/models",
          model: CATGPT_GATEWAY_MODEL,
          error: error.message,
        },
      ],
      message: "Không đọc được danh sách model từ CatGPT-Gateway.",
    });
  }
}

async function fetchCatgptArtifactBundle({ completionId, diagnostics }) {
  const normalizedCompletionId = String(completionId || "").trim();
  if (!normalizedCompletionId) return null;

  const rootUrl = getCatgptGatewayRootUrl();

  try {
    const manifestResponse = await fetch(
      `${rootUrl}/artifacts/completions/${encodeURIComponent(normalizedCompletionId)}`,
      {
        headers: {
          accept: "application/json",
          ...(CATGPT_GATEWAY_API_TOKEN
            ? { authorization: `Bearer ${CATGPT_GATEWAY_API_TOKEN}` }
            : {}),
        },
      }
    );
    const rawManifest = await manifestResponse.text();
    if (manifestResponse.status === 404) {
      diagnostics.hasWarnings = true;
      diagnostics.artifactManifestAvailable = false;
      diagnostics.stages.push({
        stage: "gateway_artifacts",
        ok: false,
        model: CATGPT_GATEWAY_MODEL,
        route: "catgpt/artifacts_manifest",
        attempts: [
          {
            route: "catgpt/artifacts_manifest",
            model: CATGPT_GATEWAY_MODEL,
            error: "artifact manifest not found",
          },
        ],
        message:
          "Gateway chưa có artifact manifest cho completion này, đang dùng fallback local.",
      });
      return null;
    }
    if (!manifestResponse.ok) {
      throw new Error(
        `HTTP ${manifestResponse.status}: ${truncate(
          rawManifest || manifestResponse.statusText,
          240
        )}`
      );
    }

    const manifest = JSON.parse(rawManifest);
    const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
    diagnostics.artifactManifestAvailable = true;
    diagnostics.artifactKeys = artifacts
      .map((artifact) => String(artifact?.key || "").trim())
      .filter(Boolean);

    const downloads = {};
    for (const artifact of artifacts) {
      const key = String(artifact?.key || "").trim();
      const downloadPath = String(artifact?.download_path || "").trim();
      if (!key || !downloadPath) continue;
      if (!["raw_text", "parsed_json", "parsed_csv"].includes(key)) continue;

      const artifactResponse = await fetch(`${rootUrl}${downloadPath}`, {
        headers: {
          accept: "text/plain, application/json, text/csv",
          ...(CATGPT_GATEWAY_API_TOKEN
            ? { authorization: `Bearer ${CATGPT_GATEWAY_API_TOKEN}` }
            : {}),
        },
      });
      const artifactText = await artifactResponse.text();
      if (!artifactResponse.ok) {
        throw new Error(
          `Artifact ${key} HTTP ${artifactResponse.status}: ${truncate(
            artifactText || artifactResponse.statusText,
            240
          )}`
        );
      }
      downloads[key] = {
        ...artifact,
        content: artifactText,
      };
    }

    diagnostics.stages.push({
      stage: "gateway_artifacts",
      ok: true,
      model: CATGPT_GATEWAY_MODEL,
      route: "catgpt/artifacts_manifest",
      attempts: [],
      message: diagnostics.artifactKeys.length
        ? `Đã lấy artifact: ${diagnostics.artifactKeys.join(", ")}.`
        : "Đã lấy manifest artifact, nhưng không có file text/csv/json phù hợp.",
    });

    return {
      manifest,
      rawText: downloads.raw_text || null,
      parsedJson: downloads.parsed_json || null,
      parsedCsv: downloads.parsed_csv || null,
    };
  } catch (error) {
    diagnostics.hasWarnings = true;
    diagnostics.artifactManifestAvailable = false;
    diagnostics.stages.push({
      stage: "gateway_artifacts",
      ok: false,
      model: CATGPT_GATEWAY_MODEL,
      route: "catgpt/artifacts_manifest",
      attempts: [
        {
          route: "catgpt/artifacts_manifest",
          model: CATGPT_GATEWAY_MODEL,
          error: error.message,
        },
      ],
      message: "Không lấy được artifact từ gateway, đang dùng local fallback.",
    });
    return null;
  }
}

function parseCatgptJsonPayload(text) {
  const parsed = parseJsonLoose(text);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("ChatGPT không trả về JSON object hợp lệ.");
  }

  return {
    documentAnalysis:
      parsed.documentAnalysis && typeof parsed.documentAnalysis === "object"
        ? parsed.documentAnalysis
        : {},
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    unparsedSections: Array.isArray(parsed.unparsedSections)
      ? parsed.unparsedSections
      : [],
    registrations: Array.isArray(parsed.registrations)
      ? parsed.registrations
      : [],
  };
}

function stripMarkdownWrapper(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:csv|text)?\s*([\s\S]*?)```/i);
  return fenced?.[1]?.trim() || raw;
}

function parseCatgptCsvPayload(text) {
  const raw = stripMarkdownWrapper(text);
  const delimiter = detectDelimiter(raw) || ",";
  const matrix = parseDelimited(raw, delimiter).filter((row) => !isBlankRow(row));
  if (matrix.length < 2) {
    throw new Error("CSV fallback không có đủ dòng dữ liệu.");
  }

  const headers = buildHeaders(matrix[0]);
  const rows = matrix.slice(1).map((cells) =>
    Object.fromEntries(
      headers.map((header, index) => [header, String(cells[index] || "").trim()])
    )
  );

  return rows.map((row) => ({
    sourceLabel: row.sourcelabel || row.source_label || "",
    confidence: safeNumber(row.confidence, 0),
    needsReview: coerceBoolean(row.needsreview || row.needs_review),
    paymentStatus: normalizeGatewayPaymentStatus(
      row.paymentstatus || row.payment_status
    ),
    eventGuess: row.eventguess || row.event_guess || "",
    notes: row.notes || "",
    reasons: compactList(
      String(row.reasons || "")
        .split(";")
        .map((item) => item.trim())
    ),
    players: [
      {
        slot: 1,
        fullName: row.primaryname || row.primary_name || "",
        phone: row.primaryphone || row.primary_phone || "",
        email: row.primaryemail || row.primary_email || "",
        rating: normalizeGatewayRating(
          row.primaryrating || row.primary_rating
        ),
      },
      {
        slot: 2,
        fullName: row.secondaryname || row.secondary_name || "",
        phone: row.secondaryphone || row.secondary_phone || "",
        email: row.secondaryemail || row.secondary_email || "",
        rating: normalizeGatewayRating(
          row.secondaryrating || row.secondary_rating
        ),
      },
    ],
  }));
}

function normalizeCatgptDocumentAnalysis(
  parsedHeaders,
  parsedRows,
  gatewayPayload,
  diagnostics
) {
  const fallback = buildFallbackDocumentAnalysis(parsedHeaders, parsedRows);
  const incoming =
    gatewayPayload?.documentAnalysis &&
    typeof gatewayPayload.documentAnalysis === "object"
      ? gatewayPayload.documentAnalysis
      : {};
  const notes = compactList(
    [
      incoming.summary,
      incoming.notes,
      diagnostics?.responseMode === "csv-fallback"
        ? "Đã dùng đường CSV dự phòng để đọc file này."
        : "",
      ...(gatewayPayload?.warnings || []),
    ].filter(Boolean)
  ).join(" ");

  return {
    ...fallback,
    layoutType: String(incoming.layoutType || fallback.layoutType),
    registrationStyle: String(
      incoming.registrationStyle || fallback.registrationStyle
    ),
    notes: notes || fallback.notes,
    confidence: safeNumber(incoming.confidence, fallback.confidence),
    registrationHints: compactList(gatewayPayload?.warnings || []).slice(0, 12),
  };
}

function buildCatgptSourceGroups(parsedRows, registrations) {
  const rowMap = new Map((parsedRows || []).map((row) => [row.rowNumber, row]));
  const limitedRegistrations = (registrations || []).slice(0, PREVIEW_MAX_ROWS);

  return limitedRegistrations.map((registration, index) => {
    const parsedRowNumbers = extractRowNumbersFromSourceLabel(
      registration?.sourceLabel
    );
    const matchedRows = parsedRowNumbers
      .map((rowNumber) => rowMap.get(rowNumber))
      .filter(Boolean);
    const rows =
      matchedRows.length > 0
        ? matchedRows
        : [
            {
              rowNumber: parsedRowNumbers[0] || index + 1,
              cells: [],
              object: null,
              sourcePreview: buildGatewaySourcePreview(registration),
            },
          ];
    const rowNumbers = compactList(rows.map((row) => row.rowNumber));
    const sourceLabel =
      String(registration?.sourceLabel || "").trim() ||
      (rowNumbers.length > 1
        ? `${rowNumbers[0]}-${rowNumbers[rowNumbers.length - 1]}`
        : String(rowNumbers[0] || index + 1));

    return {
      groupId: `gateway-${index + 1}-${slugify(sourceLabel, {
        lower: true,
        strict: true,
      })}`,
      rowNumber: rowNumbers[0] || index + 1,
      rowNumbers,
      rowLabel: sourceLabel,
      rows,
      sourcePreview:
        matchedRows.length > 0
          ? buildGroupedSourcePreview(rows, 320)
          : buildGatewaySourcePreview(registration),
      isRegistrationGroup: true,
      groupConfidence: safeNumber(registration?.confidence, 0.4),
      groupReasons: compactList(registration?.reasons || []),
    };
  });
}

function buildCatgptAiRows(registrations, sourceGroups) {
  return (sourceGroups || []).map((group, index) => {
    const registration = registrations[index] || {};
    const playerMap = new Map(
      (Array.isArray(registration?.players) ? registration.players : [])
        .filter(Boolean)
        .map((player, playerIndex) => [
          Number(player?.slot) || playerIndex + 1,
          player,
        ])
    );
    const primary = playerMap.get(1) || registration?.players?.[0] || {};
    const secondary = playerMap.get(2) || registration?.players?.[1] || {};
    const notes = compactList(
      [registration?.eventGuess ? `Noi dung doan: ${registration.eventGuess}` : "", registration?.notes]
        .filter(Boolean)
    ).join(" | ");
    const reasons = compactList([
      ...(registration?.reasons || []),
      registration?.needsReview ? "AI đánh dấu cần xem lại." : "",
      !registration?.sourceLabel ? "AI chưa chỉ rõ dòng gốc của hồ sơ này." : "",
    ]);

    return {
      rowIndex: index,
      isRegistrationRow: true,
      confidence: Math.min(
        1,
        Math.max(
          0,
          safeNumber(registration?.confidence, group?.groupConfidence || 0.35)
        )
      ),
      primaryName: normalizeName(primary?.fullName),
      primaryPhone: normalizePhone(primary?.phone),
      primaryEmail: normalizeEmail(primary?.email),
      primaryRating: normalizeGatewayRating(primary?.rating),
      secondaryName: normalizeName(secondary?.fullName),
      secondaryPhone: normalizePhone(secondary?.phone),
      secondaryEmail: normalizeEmail(secondary?.email),
      secondaryRating: normalizeGatewayRating(secondary?.rating),
      paidStatus: normalizeGatewayPaymentStatus(registration?.paymentStatus),
      notes,
      reasons,
    };
  });
}

function buildExportBaseName(tournament) {
  const slug =
    slugify(String(tournament?.name || "ai-import"), {
      lower: true,
      strict: true,
    }) || "ai-import";
  return `${slug}-preview`;
}

function buildCatgptExportCsv(registrations = []) {
  const rows = [
    [
      "sourceLabel",
      "confidence",
      "needsReview",
      "paymentStatus",
      "eventGuess",
      "notes",
      "reasons",
      "primaryName",
      "primaryPhone",
      "primaryEmail",
      "primaryRating",
      "secondaryName",
      "secondaryPhone",
      "secondaryEmail",
      "secondaryRating",
    ],
  ];

  (registrations || []).forEach((registration) => {
    const players = Array.isArray(registration?.players) ? registration.players : [];
    const bySlot = new Map(
      players.map((player, index) => [Number(player?.slot) || index + 1, player || {}])
    );
    const primary = bySlot.get(1) || players[0] || {};
    const secondary = bySlot.get(2) || players[1] || {};
    rows.push([
      String(registration?.sourceLabel || "").trim(),
      String(safeNumber(registration?.confidence, 0)),
      String(Boolean(registration?.needsReview)),
      normalizeGatewayPaymentStatus(registration?.paymentStatus),
      String(registration?.eventGuess || "").trim(),
      String(registration?.notes || "").trim(),
      compactList(registration?.reasons || []).join("; "),
      normalizeName(primary?.fullName),
      normalizePhone(primary?.phone),
      normalizeEmail(primary?.email),
      String(normalizeGatewayRating(primary?.rating)),
      normalizeName(secondary?.fullName),
      normalizePhone(secondary?.phone),
      normalizeEmail(secondary?.email),
      String(normalizeGatewayRating(secondary?.rating)),
    ]);
  });

  return serializeCsv(rows);
}

function buildCatgptExportText({
  tournament,
  source,
  materializedSource,
  diagnostics,
  payload,
  analysis,
  adminPrompt = "",
}) {
  const lines = [
    `Giải: ${tournament?.name || "-"}`,
    `Nội dung: ${tournament?.eventType === "single" ? "Đơn" : "Đôi"}`,
    `Địa điểm: ${tournament?.location || "-"}`,
    `Nguồn: ${source?.sourceLabel || source?.sourceType || "-"}`,
    `Provider: CatGPT-Gateway`,
    `Endpoint: ${diagnostics?.environment?.configuredBaseUrl || "-"}`,
    `Model: ${diagnostics?.environment?.configuredModel || "-"}`,
    `File gửi AI: ${materializedSource?.filename || "-"} (${materializedSource?.fileType || "-"})`,
    `Kiểu nguồn gửi AI: ${materializedSource?.sourceMode || "-"}`,
    `Kiểu kết quả: ${diagnostics?.responseMode || "json"}`,
    `Bố cục AI nhận ra: ${analysis?.layoutType || "unknown"}`,
    `Kiểu ghi đăng ký: ${analysis?.registrationStyle || "unknown"}`,
    `Độ tin cậy bố cục: ${safeNumber(analysis?.confidence, 0)}`,
    `Tóm tắt: ${analysis?.notes || payload?.documentAnalysis?.summary || "-"}`,
    `Tổng hồ sơ: ${(payload?.registrations || []).length}`,
    `Cảnh báo: ${compactList(payload?.warnings || []).join(" | ") || "-"}`,
  ];
  if (normalizeAdminPrompt(adminPrompt)) {
    lines.push(`Ghi chú admin: ${normalizeAdminPrompt(adminPrompt)}`);
  }

  const unparsedSections = Array.isArray(payload?.unparsedSections)
    ? payload.unparsedSections
    : [];
  if (unparsedSections.length) {
    lines.push("");
    lines.push("Mục chưa parse rõ:");
    unparsedSections.slice(0, 50).forEach((section) => {
      lines.push(
        `- ${String(section?.sourceLabel || "?").trim()}: ${String(
          section?.reason || "Không rõ"
        ).trim()}`
      );
    });
  }

  return lines.join("\n");
}

function buildCatgptPreviewExports({
  tournament,
  source,
  materializedSource,
  diagnostics,
  payload,
  analysis,
  adminPrompt = "",
  artifactBundle = null,
}) {
  const baseName = buildExportBaseName(tournament);
  const csvContent =
    String(artifactBundle?.parsedCsv?.content || "").trim() ||
    buildCatgptExportCsv(payload?.registrations || []);
  const txtContent = buildCatgptExportText({
    tournament,
    source,
    materializedSource,
    diagnostics,
    payload,
    analysis,
    adminPrompt,
  });
  const jsonContent =
    String(artifactBundle?.parsedJson?.content || "").trim() ||
    JSON.stringify(
      {
        tournament: {
          _id: String(tournament?._id || ""),
          name: tournament?.name || "",
          eventType: tournament?.eventType || "",
          location: tournament?.location || "",
        },
        source: {
          sourceType: source?.sourceType || "",
          sourceLabel: source?.sourceLabel || "",
          fileType: materializedSource?.fileType || "",
          filename: materializedSource?.filename || "",
        },
        adminInstructions: normalizeAdminPrompt(adminPrompt),
        diagnostics: {
          provider: diagnostics?.provider || "catgpt",
          responseMode: diagnostics?.responseMode || "json",
          configuredBaseUrl: diagnostics?.environment?.configuredBaseUrl || "",
          configuredModel: diagnostics?.environment?.configuredModel || "",
          completionId: diagnostics?.completionId || "",
          artifactSource: diagnostics?.artifactSource || "",
        },
        documentAnalysis: payload?.documentAnalysis || {},
        warnings: payload?.warnings || [],
        unparsedSections: payload?.unparsedSections || [],
        registrations: payload?.registrations || [],
      },
      null,
      2
    );

  return compactList([
    csvContent
      ? {
          key: "analysis_csv",
          label: "Tải CSV đã phân tích",
          filename: `${baseName}.csv`,
          mimeType: "text/csv;charset=utf-8",
          content: csvContent,
          source: artifactBundle?.parsedCsv?.content
            ? "gateway-artifact"
            : "local-fallback",
        }
      : null,
    txtContent
      ? {
          key: "analysis_txt",
          label: "Tải ghi chú phân tích",
          filename: `${baseName}.txt`,
          mimeType: "text/plain;charset=utf-8",
          content: txtContent,
          source: "local-fallback",
        }
      : null,
    jsonContent
      ? {
          key: "analysis_json",
          label: "Tải JSON AI",
          filename: `${baseName}.json`,
          mimeType: "application/json;charset=utf-8",
          content: jsonContent,
          source: artifactBundle?.parsedJson?.content
            ? "gateway-artifact"
            : "local-fallback",
        }
      : null,
    artifactBundle?.rawText?.content
      ? {
          key: "gateway_raw_text",
          label: "Tải phản hồi gốc của ChatGPT",
          filename: `${baseName}-raw.txt`,
          mimeType:
            artifactBundle.rawText.mime_type || "text/plain;charset=utf-8",
          content: artifactBundle.rawText.content,
          source: "gateway-artifact",
        }
      : null,
  ]);
}

async function analyzeWithCatgptGateway({
  tournament,
  source,
  parsed,
  diagnostics,
  onProgress,
  adminPrompt = "",
}) {
  const materializedSource = await materializeSourceFile({ source, parsed });
  diagnostics.fileType = materializedSource.fileType;
  reportPreviewProgress(onProgress, {
    step: "source_materialized",
    progress: 20,
    message: `Đã tạo file tạm ${materializedSource.filename} để gửi sang ChatGPT.`,
    fileType: materializedSource.fileType,
  });

  try {
    const gatewayStatus = await probeCatgptGatewayStatus(diagnostics, {
      stage: "gateway_status",
      timeoutMs: 5000,
    });
    if (gatewayStatus?.reachable === false || gatewayStatus?.loggedIn === false) {
      diagnostics.hasErrors = true;
      throw attachAiDiagnosticsToError(
        new Error("CatGPT-Gateway chưa sẵn sàng."),
        diagnostics
      );
    }

    await fetchCatgptModels(diagnostics);
    reportPreviewProgress(onProgress, {
      step: "gateway_uploading",
      progress: 28,
      message: `Đang gửi file ${materializedSource.fileType.toUpperCase()} lên CatGPT-Gateway.`,
    });
    reportPreviewProgress(onProgress, {
      step: "gateway_analyzing",
      progress: 42,
      message: "ChatGPT đang đọc và phân tích file đính kèm.",
    });

    const jsonResponse = await requestCatgptGateway({
      prompt: buildCatgptJsonPrompt(
        tournament,
        materializedSource,
        adminPrompt
      ),
      materializedSource,
      diagnostics,
      stage: "gateway_analyzing",
    });
    let artifactBundle = await fetchCatgptArtifactBundle({
      completionId: jsonResponse.completionId,
      diagnostics,
    });

    reportPreviewProgress(onProgress, {
      step: "gateway_parsing",
      progress: 62,
      message: "Đang đọc kết quả JSON trả về từ ChatGPT.",
      fileType: materializedSource.fileType,
    });

    let payload;
    try {
      payload = parseCatgptJsonPayload(
        artifactBundle?.parsedJson?.content || jsonResponse.text
      );
      diagnostics.responseMode = "json";
      diagnostics.artifactSource = artifactBundle?.parsedJson?.content
        ? "gateway-artifact"
        : "local-fallback";
      diagnostics.stages.push({
        stage: "gateway_parsing",
        ok: true,
        model: CATGPT_GATEWAY_MODEL,
        route: "catgpt/json",
        attempts: [],
        message: artifactBundle?.parsedJson?.content
          ? "Đã parse JSON artifact từ CatGPT-Gateway."
          : "Đã parse xong JSON từ CatGPT-Gateway.",
      });
    } catch (jsonError) {
      diagnostics.hasWarnings = true;
      diagnostics.stages.push({
        stage: "gateway_parsing",
        ok: false,
        model: CATGPT_GATEWAY_MODEL,
        route: "catgpt/json",
        attempts: [
          {
            route: "catgpt/json",
            model: CATGPT_GATEWAY_MODEL,
            error: jsonError.message,
          },
        ],
        message: "JSON không parse được, đang thử CSV fallback.",
      });

      const csvResponse = await requestCatgptGateway({
        prompt: buildCatgptCsvFallbackPrompt(
          tournament,
          materializedSource,
          adminPrompt
        ),
        materializedSource,
        diagnostics,
        stage: "gateway_analyzing",
      });
      artifactBundle = await fetchCatgptArtifactBundle({
        completionId: csvResponse.completionId,
        diagnostics,
      });

      let registrations;
      try {
        registrations = parseCatgptCsvPayload(
          artifactBundle?.parsedCsv?.content || csvResponse.text
        );
      } catch (csvError) {
        diagnostics.hasErrors = true;
        diagnostics.stages.push({
          stage: "gateway_parsing",
          ok: false,
          model: CATGPT_GATEWAY_MODEL,
          route: "catgpt/csv_fallback",
          attempts: [
            {
              route: "catgpt/json",
              model: CATGPT_GATEWAY_MODEL,
              error: jsonError.message,
            },
            {
              route: "catgpt/csv_fallback",
              model: CATGPT_GATEWAY_MODEL,
              error: csvError.message,
            },
          ],
          message: "CSV fallback cũng không parse được.",
        });
        throw csvError;
      }
      diagnostics.responseMode = "csv-fallback";
      diagnostics.artifactSource = artifactBundle?.parsedCsv?.content
        ? "gateway-artifact"
        : "local-fallback";
      diagnostics.stages.push({
        stage: "gateway_parsing",
        ok: true,
        model: CATGPT_GATEWAY_MODEL,
        route: "catgpt/csv_fallback",
        attempts: [
          {
            route: "catgpt/json",
            model: CATGPT_GATEWAY_MODEL,
            error: jsonError.message,
          },
        ],
        message: artifactBundle?.parsedCsv?.content
          ? "Đã fallback sang CSV artifact và parse thành công."
          : "Đã fallback sang CSV và parse thành công.",
      });
      payload = {
        documentAnalysis: {},
        warnings: ["Đã dùng CSV fallback do JSON trả về không parse được."],
        unparsedSections: [],
        registrations,
      };
    }

    const analysis = normalizeCatgptDocumentAnalysis(
      parsed.headers,
      parsed.rows,
      payload,
      diagnostics
    );
    const sourceGroups = buildCatgptSourceGroups(parsed.rows, payload.registrations);
    const aiRows = buildCatgptAiRows(payload.registrations, sourceGroups);
    const exports = buildCatgptPreviewExports({
      tournament,
      source,
      materializedSource,
      diagnostics,
      payload,
      analysis,
      adminPrompt,
      artifactBundle,
    });

    return {
      analysis,
      sourceGroups,
      aiRows,
      warnings: payload.warnings || [],
      totalRegistrations: (payload.registrations || []).length,
      totalUnparsedSections: (payload.unparsedSections || []).length,
      materializedSource,
      exports,
    };
  } finally {
    await cleanupMaterializedSource(materializedSource);
  }
}

async function findExistingUser({ phone, email }) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = normalizeEmail(email);

  if (normalizedPhone) {
    const user = await User.findOne({ phone: normalizedPhone })
      .select("_id name nickname phone email localRatings")
      .lean();
    if (user) return { user, matchedBy: "phone" };
  }

  if (normalizedEmail) {
    const user = await User.findOne({ email: normalizedEmail })
      .select("_id name nickname phone email localRatings")
      .lean();
    if (user) return { user, matchedBy: "email" };
  }

  return null;
}

async function buildTempDraft({
  name,
  rowNumber,
  slot,
  emailReserved,
  phoneReserved,
  nicknameReserved,
}) {
  const { emailBase, nicknameBase, phoneBase } = buildTempBase(
    name,
    rowNumber,
    slot
  );

  const email = await uniqueValue({
    model: User,
    field: "email",
    baseValue: emailBase,
    reservedSet: emailReserved,
    formatter: (base, attempt) =>
      attempt === 0
        ? `${base}@${TEMP_EMAIL_DOMAIN}`
        : `${base}.${attempt}@${TEMP_EMAIL_DOMAIN}`,
  });

  const nickname = await uniqueValue({
    model: User,
    field: "nickname",
    baseValue: nicknameBase,
    reservedSet: nicknameReserved,
    formatter: (base, attempt) => (attempt === 0 ? base : `${base}${attempt}`),
  });

  const phone = await uniqueValue({
    model: User,
    field: "phone",
    baseValue: phoneBase,
    reservedSet: phoneReserved,
    formatter: (base, attempt) => {
      const seed = Number(base.slice(-7)) || 0;
      const next = String((seed + attempt) % 10_000_000).padStart(7, "0");
      return `099${next}`;
    },
  });

  return { email, nickname, phone };
}

function getPlannedScore(player, tournament) {
  const ratingFromAi = safeNumber(player.rating, -1);
  if (player.matchedUser && tournament?.eventType === "single") {
    const score = safeNumber(player.matchedUser.localRatings?.singles, NaN);
    if (Number.isFinite(score)) return score;
  }
  if (player.matchedUser && tournament?.eventType !== "single") {
    const score = safeNumber(player.matchedUser.localRatings?.doubles, NaN);
    if (Number.isFinite(score)) return score;
  }
  if (ratingFromAi >= 0) return ratingFromAi;
  return 2.5;
}

function validateScoresForTournament(tournament, players) {
  const issues = [];
  const isSingles = String(tournament?.eventType || "double") === "single";
  const p1 = players[0]?.score ?? 0;
  const p2 = players[1]?.score ?? 0;

  if (
    !tournament?.allowExceedMaxRating &&
    safeNumber(tournament?.singleCap, 0) > 0
  ) {
    if (
      p1 > tournament.singleCap ||
      (!isSingles && p2 > tournament.singleCap)
    ) {
      issues.push(`Điểm từng VĐV vượt singleCap ${tournament.singleCap}`);
    }
  }

  if (
    !isSingles &&
    !tournament?.allowExceedMaxRating &&
    safeNumber(tournament?.scoreCap, 0) > 0
  ) {
    if (p1 + p2 > tournament.scoreCap) {
      issues.push(`Tổng điểm đôi vượt scoreCap ${tournament.scoreCap}`);
    }
  }

  if (!isSingles && safeNumber(tournament?.scoreGap, 0) > 0) {
    if (Math.abs(p1 - p2) > tournament.scoreGap) {
      issues.push(`Chênh lệch điểm đôi vượt scoreGap ${tournament.scoreGap}`);
    }
  }

  return issues;
}

function buildIdentityKey(player) {
  if (!player) return "";
  if (player.matchedUser?._id) return `user:${player.matchedUser._id}`;
  if (player.sourcePhone) return `phone:${player.sourcePhone}`;
  if (player.sourceEmail) return `email:${player.sourceEmail}`;
  if (player.fullName) {
    return `name:${slugify(player.fullName, { lower: true, strict: true })}`;
  }
  return "";
}

function mapPaymentStatusLabel(value) {
  if (value === "paid") return "Đã thanh toán";
  if (value === "unpaid") return "Chưa thanh toán";
  return "Chưa rõ";
}

async function resolvePreviewPlayer({
  slot,
  rowNumber,
  fullName,
  phone,
  email,
  rating,
  tournament,
  emailReserved,
  phoneReserved,
  nicknameReserved,
}) {
  const normalized = {
    fullName: normalizeName(fullName),
    sourcePhone: normalizePhone(phone),
    sourceEmail: normalizeEmail(email),
    rating: safeNumber(rating, -1),
  };

  const hasIdentity =
    Boolean(normalized.fullName) ||
    Boolean(normalized.sourcePhone) ||
    Boolean(normalized.sourceEmail);

  if (!hasIdentity) {
    return {
      ...normalized,
      action: "missing",
      matchedUser: null,
      matchedBy: "",
      tempDraft: null,
      score: 0,
    };
  }

  const match = await findExistingUser({
    phone: normalized.sourcePhone,
    email: normalized.sourceEmail,
  });

  if (match?.user) {
    const matchedUser = {
      _id: String(match.user._id),
      name: match.user.name || match.user.nickname || normalized.fullName,
      nickname: match.user.nickname || "",
      phone: match.user.phone || "",
      email: match.user.email || "",
      localRatings: match.user.localRatings || {},
    };
    return {
      ...normalized,
      fullName: normalized.fullName || matchedUser.name,
      action: "match_existing",
      matchedUser,
      matchedBy: match.matchedBy,
      tempDraft: null,
      score: getPlannedScore(
        { matchedUser, rating: normalized.rating },
        tournament
      ),
    };
  }

  if (!normalized.fullName) {
    return {
      ...normalized,
      action: "missing_name",
      matchedUser: null,
      matchedBy: "",
      tempDraft: null,
      score: 0,
    };
  }

  const tempDraft = await buildTempDraft({
    name: normalized.fullName,
    rowNumber,
    slot,
    emailReserved,
    phoneReserved,
    nicknameReserved,
  });

  return {
    ...normalized,
    action: "create_temp",
    matchedUser: null,
    matchedBy: "",
    tempDraft,
    score: getPlannedScore({ rating: normalized.rating }, tournament),
  };
}

async function buildPreviewRows(tournament, sourceRows, aiRows) {
  const isSingles = String(tournament?.eventType || "double") === "single";
  const existingRegs = await Registration.find({ tournament: tournament._id })
    .select("player1.user player2.user player1.phone player2.phone")
    .lean();

  const registeredUserIds = new Set();
  const registeredPhones = new Set();
  existingRegs.forEach((reg) => {
    if (reg?.player1?.user) registeredUserIds.add(String(reg.player1.user));
    if (reg?.player2?.user) registeredUserIds.add(String(reg.player2.user));
    if (reg?.player1?.phone)
      registeredPhones.add(normalizePhone(reg.player1.phone));
    if (reg?.player2?.phone)
      registeredPhones.add(normalizePhone(reg.player2.phone));
  });

  const plannedKeys = new Set();
  const emailReserved = new Set();
  const phoneReserved = new Set();
  const nicknameReserved = new Set();
  const previewRows = [];
  let acceptedCount = 0;

  for (let i = 0; i < sourceRows.length; i += 1) {
    const source = sourceRows[i];
    const ai = aiRows[i] || {};
    const sourceLabel = source.rowLabel || String(source.rowNumber);
    const sourceConfidence = safeNumber(source.groupConfidence, 1);
    const sourceReasons = compactList(source.groupReasons);
    const primary = await resolvePreviewPlayer({
      slot: 1,
      rowNumber: source.rowNumber,
      fullName: ai.primaryName,
      phone: ai.primaryPhone,
      email: ai.primaryEmail,
      rating: ai.primaryRating,
      tournament,
      emailReserved,
      phoneReserved,
      nicknameReserved,
    });
    const secondary = isSingles
      ? null
      : await resolvePreviewPlayer({
          slot: 2,
          rowNumber: source.rowNumber,
          fullName: ai.secondaryName,
          phone: ai.secondaryPhone,
          email: ai.secondaryEmail,
          rating: ai.secondaryRating,
          tournament,
          emailReserved,
          phoneReserved,
          nicknameReserved,
        });

    const issues = [];
    if (!source.isRegistrationGroup || !ai.isRegistrationRow) {
      previewRows.push({
        rowId: source.groupId || `row-${source.rowNumber}`,
        sourceRowNumber: sourceLabel,
        sourceRowNumbers: source.rowNumbers || [source.rowNumber],
        status: "skip",
        confidence: safeNumber(ai.confidence, 0),
        sourcePreview: source.sourcePreview,
        paymentStatus: mapPaymentStatusLabel(ai.paidStatus),
        paymentStatusKey: ai.paidStatus || "unknown",
        notes: ai.notes || "",
        reasons: compactList([...sourceReasons, ...(ai.reasons || [])]),
        actionSummary: "Bỏ qua",
        primary,
        secondary,
        issues: [],
      });
      continue;
    }

    if (primary.action === "missing" || primary.action === "missing_name") {
      issues.push("Thiếu dữ liệu VĐV 1");
    }
    if (
      !isSingles &&
      (secondary?.action === "missing" || secondary?.action === "missing_name")
    ) {
      issues.push("Thiếu dữ liệu VĐV 2");
    }

    if (
      !isSingles &&
      !secondary?.fullName &&
      !secondary?.sourcePhone &&
      !secondary?.sourceEmail
    ) {
      issues.push("Giải đôi cần đủ 2 VĐV");
    }

    if (safeNumber(ai.confidence, 0) < MIN_READY_CONFIDENCE) {
      issues.push("AI confidence thấp");
    }
    if (sourceConfidence < MIN_READY_CONFIDENCE) {
      issues.push("AI chưa chắc cách gộp các dòng của hồ sơ này");
    }

    const primaryKey = buildIdentityKey(primary);
    const secondaryKey = buildIdentityKey(secondary);

    if (
      primary?.matchedUser?._id &&
      registeredUserIds.has(primary.matchedUser._id)
    ) {
      issues.push("VĐV 1 đã đăng ký giải này");
    }
    if (
      !isSingles &&
      secondary?.matchedUser?._id &&
      registeredUserIds.has(secondary.matchedUser._id)
    ) {
      issues.push("VĐV 2 đã đăng ký giải này");
    }

    if (primary?.sourcePhone && registeredPhones.has(primary.sourcePhone)) {
      issues.push("SĐT VĐV 1 đã có trong danh sách đăng ký");
    }
    if (
      !isSingles &&
      secondary?.sourcePhone &&
      registeredPhones.has(secondary.sourcePhone)
    ) {
      issues.push("SĐT VĐV 2 đã có trong danh sách đăng ký");
    }

    if (primaryKey && plannedKeys.has(primaryKey)) {
      issues.push("VĐV 1 bị trùng trong chính file import");
    }
    if (!isSingles && secondaryKey && plannedKeys.has(secondaryKey)) {
      issues.push("VĐV 2 bị trùng trong chính file import");
    }

    if (
      !isSingles &&
      primaryKey &&
      secondaryKey &&
      primaryKey === secondaryKey
    ) {
      issues.push("Hai VĐV trong cùng một cặp đang trùng nhau");
    }

    issues.push(
      ...validateScoresForTournament(tournament, [
        { score: primary.score },
        { score: secondary?.score ?? 0 },
      ])
    );

    if (
      safeNumber(tournament?.maxPairs, 0) > 0 &&
      acceptedCount >= safeNumber(tournament.maxPairs, 0) - existingRegs.length
    ) {
      issues.push("Giải đã hết chỗ đăng ký");
    }

    const actionSummary = compactList(
      [
        source.rowNumbers?.length > 1
          ? `Gộp ${source.rowNumbers.length} dòng`
          : null,
        primary?.action === "match_existing" ? "Match VĐV 1" : null,
        primary?.action === "create_temp" ? "Tạo temp VĐV 1" : null,
        !isSingles && secondary?.action === "match_existing"
          ? "Match VĐV 2"
          : null,
        !isSingles && secondary?.action === "create_temp"
          ? "Tạo temp VĐV 2"
          : null,
      ].filter(Boolean)
    ).join(" + ");

    const status = issues.length ? "needs_review" : "ready";
    if (status === "ready") {
      if (primaryKey) plannedKeys.add(primaryKey);
      if (secondaryKey) plannedKeys.add(secondaryKey);
      acceptedCount += 1;
    }

    previewRows.push({
      rowId: source.groupId || `row-${source.rowNumber}`,
      sourceRowNumber: sourceLabel,
      sourceRowNumbers: source.rowNumbers || [source.rowNumber],
      status,
      confidence: Math.min(safeNumber(ai.confidence, 0), sourceConfidence || 1),
      sourcePreview: source.sourcePreview,
      paymentStatus: mapPaymentStatusLabel(ai.paidStatus),
      paymentStatusKey: ai.paidStatus || "unknown",
      notes: ai.notes || "",
      reasons: compactList([...sourceReasons, ...(ai.reasons || [])]),
      actionSummary,
      primary: {
        ...primary,
        maskedMatchedEmail: primary?.matchedUser?.email
          ? maskEmail(primary.matchedUser.email)
          : "",
      },
      secondary: secondary
        ? {
            ...secondary,
            maskedMatchedEmail: secondary?.matchedUser?.email
              ? maskEmail(secondary.matchedUser.email)
              : "",
          }
        : null,
      issues: compactList(issues),
    });
  }

  return previewRows;
}

function buildPreviewSummary(rows, sourceMeta) {
  const summary = {
    totalRows: rows.length,
    readyRows: rows.filter((row) => row.status === "ready").length,
    reviewRows: rows.filter((row) => row.status === "needs_review").length,
    skippedRows: rows.filter((row) => row.status === "skip").length,
    matchedPlayers: 0,
    tempPlayers: 0,
  };

  rows.forEach((row) => {
    [row.primary, row.secondary].filter(Boolean).forEach((player) => {
      if (player.action === "match_existing") summary.matchedPlayers += 1;
      if (player.action === "create_temp") summary.tempPlayers += 1;
    });
  });

  return {
    ...summary,
    sourceType: sourceMeta.sourceType,
    sourceLabel: sourceMeta.sourceLabel,
    sourceRows: sourceMeta.sourceRows,
    candidateGroups: sourceMeta.candidateGroups || rows.length,
    truncated: sourceMeta.truncated,
  };
}

export async function previewAiRegistrationImport({
  tournamentId,
  sheetUrl,
  rawText,
  adminPrompt = "",
  onProgress,
}) {
  const normalizedAdminPrompt = normalizeAdminPrompt(adminPrompt);
  reportPreviewProgress(onProgress, {
    step: "init",
    progress: 4,
    message: "Đang tải thông tin giải.",
  });

  const tournament = await Tournament.findById(tournamentId)
    .select(
      "_id name location eventType maxPairs singleCap scoreCap scoreGap allowExceedMaxRating"
    )
    .lean();

  if (!tournament) {
    throw new Error("Tournament không tồn tại");
  }

  reportPreviewProgress(onProgress, {
    step: "source_loading",
    progress: 10,
    message: "Đang lấy dữ liệu nguồn để đọc trước.",
  });

  const source = await resolveSourceText({ sheetUrl, rawText });
  const parsed = parseTextToRows(source.text);
  if (!parsed.rows.length) {
    throw new Error("Không đọc được dòng dữ liệu nào từ nguồn import");
  }

  const sourceRows = parsed.rows.slice(0, PREVIEW_MAX_ROWS);
  const truncated = parsed.rows.length > sourceRows.length;
  const aiDiagnostics = buildAiDiagnostics();
  reportPreviewProgress(onProgress, {
    step: "source_parsed",
    progress: 18,
    message: `Đã đọc ${parsed.rows.length} dòng từ nguồn import.`,
    sourceRows: parsed.rows.length,
    previewRows: sourceRows.length,
    truncated,
  });
  const useCatgptProvider =
    AI_IMPORT_PROVIDER === "catgpt" && Boolean(CATGPT_GATEWAY_BASE_URL);

  if (useCatgptProvider) {
    let catgptResult;
    try {
      catgptResult = await analyzeWithCatgptGateway({
        tournament,
        source,
        parsed,
        diagnostics: aiDiagnostics,
        onProgress,
        adminPrompt: normalizedAdminPrompt,
      });
    } catch (error) {
      aiDiagnostics.hasErrors = true;
      aiDiagnostics.summary = classifyImportDiagnosticSummary(aiDiagnostics);
      throw attachAiDiagnosticsToError(error, aiDiagnostics);
    }

    reportPreviewProgress(onProgress, {
      step: "preview_building",
      progress: 88,
      message: "Đang đối chiếu tài khoản và lập bảng xem trước.",
    });

    const previewRows = await buildPreviewRows(
      tournament,
      catgptResult.sourceGroups,
      catgptResult.aiRows
    );
    const previewTruncated =
      truncated ||
      safeNumber(catgptResult.totalRegistrations, 0) >
        catgptResult.sourceGroups.length;

    aiDiagnostics.summary = classifyImportDiagnosticSummary(aiDiagnostics);
    reportPreviewProgress(onProgress, {
      step: "preview_building",
      progress: 96,
      message: "Đã lập xong bảng xem trước, đang tổng hợp kết quả.",
      readyRows: previewRows.filter((row) => row.status === "ready").length,
      reviewRows: previewRows.filter((row) => row.status === "needs_review").length,
      responseMode: aiDiagnostics.responseMode || "json",
    });

    return {
      ok: true,
      tournament: {
        _id: String(tournament._id),
        name: tournament.name,
        eventType: tournament.eventType,
        location: tournament.location,
      },
      summary: buildPreviewSummary(previewRows, {
        sourceType: source.sourceType,
        sourceLabel: source.sourceLabel,
        sourceRows: parsed.rows.length,
        candidateGroups:
          safeNumber(catgptResult.totalRegistrations, 0) ||
          catgptResult.sourceGroups.length,
        truncated: previewTruncated,
      }),
      analysis: catgptResult.analysis,
      aiDiagnostics,
      exports: catgptResult.exports || [],
      rows: previewRows,
    };
  }

  const tableContext = buildTableContext(parsed.headers, sourceRows);
  reportPreviewProgress(onProgress, {
    step: "document_analysis",
    progress: 28,
    message: "AI đang phân tích bố cục tổng thể của file.",
  });
  const analysis = await analyzeDocumentLayoutWithAI(
    tournament,
    parsed.headers,
    sourceRows,
    aiDiagnostics,
    normalizedAdminPrompt
  );
  reportPreviewProgress(onProgress, {
    step: "document_analysis",
    progress: 40,
    message: "Đã xong bước hiểu bố cục file.",
    layoutType: analysis?.layoutType || "unknown",
    registrationStyle: analysis?.registrationStyle || "unknown",
  });
  reportPreviewProgress(onProgress, {
    step: "row_grouping",
    progress: 46,
    message: "AI đang xác định dòng nào là hồ sơ đăng ký.",
  });
  const groupingRows = await analyzeRowGroupingCompact(
    tournament,
    sourceRows,
    analysis,
    aiDiagnostics,
    normalizedAdminPrompt
  );
  const groupedRows = buildSourceGroups(sourceRows, groupingRows);
  reportPreviewProgress(onProgress, {
    step: "row_grouping",
    progress: 54,
    message: `Đã gom được ${groupedRows.length} cụm hồ sơ cần xử lý.`,
    candidateGroups: groupedRows.length,
  });
  const aiRows = await analyzeRows(
    tournament,
    groupedRows,
    tableContext,
    analysis,
    aiDiagnostics,
    onProgress,
    normalizedAdminPrompt
  );
  reportPreviewProgress(onProgress, {
    step: "preview_building",
    progress: 88,
    message: "Đang đối chiếu tài khoản và lập bảng xem trước.",
  });
  const previewRows = await buildPreviewRows(tournament, groupedRows, aiRows);
  aiDiagnostics.summary = classifyImportDiagnosticSummary(aiDiagnostics);
  reportPreviewProgress(onProgress, {
    step: "preview_building",
    progress: 96,
    message: "Đã lập xong bảng xem trước, đang tổng hợp kết quả.",
    readyRows: previewRows.filter((row) => row.status === "ready").length,
    reviewRows: previewRows.filter((row) => row.status === "needs_review").length,
  });

  return {
    ok: true,
    tournament: {
      _id: String(tournament._id),
      name: tournament.name,
      eventType: tournament.eventType,
      location: tournament.location,
    },
    summary: buildPreviewSummary(previewRows, {
      sourceType: source.sourceType,
      sourceLabel: source.sourceLabel,
      sourceRows: parsed.rows.length,
      candidateGroups: groupedRows.length,
      truncated,
    }),
    analysis,
    aiDiagnostics,
    exports: [],
    rows: previewRows,
  };
}

function generatePassword(length = 12) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function ensureUniqueTempIdentity(tempDraft, session) {
  const emailReserved = new Set();
  const phoneReserved = new Set();
  const nicknameReserved = new Set();

  const email = await uniqueValue({
    model: User,
    field: "email",
    baseValue: tempDraft?.email?.split("@")[0] || "temp-user",
    session,
    reservedSet: emailReserved,
    formatter: (base, attempt) =>
      attempt === 0
        ? `${base}@${TEMP_EMAIL_DOMAIN}`
        : `${base}.${attempt}@${TEMP_EMAIL_DOMAIN}`,
  });

  const nickname = await uniqueValue({
    model: User,
    field: "nickname",
    baseValue: tempDraft?.nickname || "temp-user",
    session,
    reservedSet: nicknameReserved,
    formatter: (base, attempt) => (attempt === 0 ? base : `${base}${attempt}`),
  });

  const phone = await uniqueValue({
    model: User,
    field: "phone",
    baseValue: tempDraft?.phone || "0990000000",
    session,
    reservedSet: phoneReserved,
    formatter: (base, attempt) => {
      const seed = Number(String(base || "").slice(-7)) || 0;
      const next = String((seed + attempt) % 10_000_000).padStart(7, "0");
      return `099${next}`;
    },
  });

  return { email, nickname, phone };
}

async function materializePlayer({
  player,
  tournament,
  session,
  sourceRowNumber,
}) {
  if (!player) return null;

  if (player?.matchedUser?._id) {
    const user = await User.findById(player.matchedUser._id)
      .session(session)
      .select("_id name nickname phone email avatar localRatings");
    if (!user) {
      throw new Error(
        `Không tìm thấy user match sẵn cho row ${sourceRowNumber}`
      );
    }
    return {
      user,
      created: false,
      password: null,
      score:
        String(tournament?.eventType || "double") === "single"
          ? safeNumber(user.localRatings?.singles, player.score || 2.5)
          : safeNumber(user.localRatings?.doubles, player.score || 2.5),
    };
  }

  if (player.action !== "create_temp" || !player.fullName) {
    throw new Error(`Row ${sourceRowNumber} thiếu dữ liệu để tạo temp user`);
  }

  const identity = await ensureUniqueTempIdentity(
    player.tempDraft || {},
    session
  );
  const password = generatePassword(12);
  const userDoc = new User({
    name: player.fullName,
    nickname: identity.nickname,
    phone: isLikelyPhone(player.sourcePhone)
      ? player.sourcePhone
      : identity.phone,
    email: identity.email,
    password,
    role: "user",
    verified: "pending",
    gender: "unspecified",
    isTempAccount: true,
    tempAccountMeta: {
      source: "ai_registration_import",
      createdForTournament: tournament?._id || null,
      originalPhone: player.sourcePhone || "",
      originalEmail: player.sourceEmail || "",
    },
    localRatings: {
      singles: safeNumber(player.score, 2.5),
      doubles: safeNumber(player.score, 2.5),
    },
  });

  const saved = await userDoc.save({ session });
  return {
    user: saved,
    created: true,
    password,
    score: safeNumber(player.score, 2.5),
  };
}

async function registrationConflictExists(
  tournamentId,
  playerAId,
  playerBId,
  session
) {
  const ids = [playerAId, playerBId].filter(Boolean).map((id) => String(id));
  let query = Registration.exists({
    tournament: tournamentId,
    $or: [{ "player1.user": { $in: ids } }, { "player2.user": { $in: ids } }],
  });
  if (session) query = query.session(session);
  const exists = await query;
  return !!exists;
}

function buildRegistrationPlayer(user, score) {
  return {
    user: user._id,
    phone: user.phone || "",
    fullName: user.name || user.nickname || user.email || "Temp User",
    nickName: user.nickname || "",
    avatar: user.avatar || "",
    score: safeNumber(score, 2.5),
  };
}

function validateCommitRow(
  tournament,
  primary,
  secondary,
  existingCount,
  readyIndex
) {
  const issues = [];
  const isSingles = String(tournament?.eventType || "double") === "single";

  if (!primary) issues.push("Thiếu VĐV 1");
  if (!isSingles && !secondary) issues.push("Thiếu VĐV 2");

  if (
    safeNumber(tournament?.maxPairs, 0) > 0 &&
    existingCount + readyIndex >= tournament.maxPairs
  ) {
    issues.push("Giải đã đầy");
  }

  issues.push(
    ...validateScoresForTournament(tournament, [
      { score: primary?.score ?? 0 },
      { score: secondary?.score ?? 0 },
    ])
  );

  if (
    !isSingles &&
    primary &&
    secondary &&
    String(primary.user._id) === String(secondary.user._id)
  ) {
    issues.push("Hai VĐV bị trùng nhau");
  }

  return compactList(issues);
}

export async function commitAiRegistrationImport({
  tournamentId,
  rows,
  actorId,
}) {
  const tournament = await Tournament.findById(tournamentId).select(
    "_id name eventType maxPairs singleCap scoreCap scoreGap allowExceedMaxRating"
  );
  if (!tournament) {
    throw new Error("Tournament không tồn tại");
  }

  const selectedRows = Array.isArray(rows) ? rows : [];
  if (!selectedRows.length) {
    throw new Error("Không có dòng nào được chọn để commit");
  }

  const existingCount = await Registration.countDocuments({
    tournament: tournament._id,
  });
  const results = [];
  const createdUsers = [];
  let createdRegistrations = 0;

  for (let index = 0; index < selectedRows.length; index += 1) {
    const row = selectedRows[index];
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const primary = await materializePlayer({
        player: row.primary,
        tournament,
        session,
        sourceRowNumber: row.sourceRowNumber,
      });
      const secondary =
        String(tournament.eventType || "double") === "single"
          ? null
          : await materializePlayer({
              player: row.secondary,
              tournament,
              session,
              sourceRowNumber: row.sourceRowNumber,
            });

      const rowIssues = validateCommitRow(
        tournament,
        primary,
        secondary,
        existingCount,
        createdRegistrations
      );
      if (rowIssues.length) {
        throw new Error(rowIssues.join("; "));
      }

      const conflict = await registrationConflictExists(
        tournament._id,
        primary?.user?._id,
        secondary?.user?._id,
        session
      );
      if (conflict) {
        throw new Error("Một trong các VĐV đã đăng ký giải này rồi");
      }

      const registration = await Registration.create(
        [
          {
            tournament: tournament._id,
            player1: buildRegistrationPlayer(primary.user, primary.score),
            player2:
              String(tournament.eventType || "double") === "single"
                ? null
                : buildRegistrationPlayer(secondary.user, secondary.score),
            payment: {
              status: row.paymentStatusKey === "paid" ? "Paid" : "Unpaid",
              paidAt: row.paymentStatusKey === "paid" ? new Date() : undefined,
            },
            createdBy: actorId || undefined,
          },
        ],
        { session }
      );

      await session.commitTransaction();

      createdRegistrations += 1;
      [primary, secondary]
        .filter((player) => player?.created)
        .forEach((player) => {
          createdUsers.push({
            rowId: row.rowId,
            rowNumber: row.sourceRowNumber,
            userId: String(player.user._id),
            name: player.user.name || "",
            nickname: player.user.nickname || "",
            phone: player.user.phone || "",
            email: player.user.email || "",
            password: player.password,
          });
        });

      results.push({
        rowId: row.rowId,
        rowNumber: row.sourceRowNumber,
        status: "created",
        registrationId: String(registration[0]._id),
      });
    } catch (error) {
      await session.abortTransaction();
      results.push({
        rowId: row.rowId,
        rowNumber: row.sourceRowNumber,
        status: "failed",
        error: error.message,
      });
    } finally {
      session.endSession();
    }
  }

  return {
    ok: true,
    createdRegistrations,
    createdUsers: createdUsers.length,
    credentials: createdUsers,
    results,
  };
}
