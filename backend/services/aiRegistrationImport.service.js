import OpenAI from "openai";
import fetch from "node-fetch";
import mongoose from "mongoose";
import pLimit from "p-limit";
import slugify from "slugify";
import { openai, OPENAI_DEFAULT_MODEL } from "../lib/openaiClient.js";
import Registration from "../models/registrationModel.js";
import Tournament from "../models/tournamentModel.js";
import User from "../models/userModel.js";

// Model riêng cho AI Import Đăng Ký:
// dùng để phân tích bố cục file, gom dòng thành hồ sơ, và tách VĐV/cặp/đội.
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
  return {
    environment: {
      configuredBaseUrl: process.env.CLIPROXY_BASE_URL || "",
      configuredModel: IMPORT_MODEL,
      directFallbackEnabled: Boolean(directOpenAI),
      directFallbackModel: directOpenAI ? IMPORT_DIRECT_MODEL : "",
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
    ? "\n\nTra ve JSON hop le, khong them giai thich ngoai JSON."
    : "";

  if (shouldInlineChatInstructions(attempt)) {
    return [
      {
        role: "user",
        content: `${instructions}\n\nDu lieu dau vao:\n${userContent}${jsonTail}`,
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
                "Chat Completions json_schema tra ve du lieu khong parse duoc"
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
                "Chat Completions json_object tra ve du lieu khong parse duoc"
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
                "Responses API tra ve du lieu khong parse duoc"
              );
            }
          }

          stageDiagnostics.ok = true;
          stageDiagnostics.model = attempt.model;
          stageDiagnostics.route = `${attempt.label}/${route}`;
          stageDiagnostics.message =
            stageDiagnostics.attempts.length > 0
              ? "Da fallback thanh cong o route khac"
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

function resolveGoogleSheetCsvUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/\/export\?format=csv/i.test(value)) return value;

  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return value;

  const gidMatch = value.match(/[?&#]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : "0";
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
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
    sourceLabel: exportUrl,
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
  documentAnalysis
) {
  const isSingles = String(tournament?.eventType || "double") === "single";
  return JSON.stringify({
    tournament: {
      name: tournament?.name || "",
      eventType: isSingles ? "single" : "double",
      location: tournament?.location || "",
    },
    documentAnalysis,
    tableContext,
    instructions: {
      oneItemMeansOneCandidateRegistration: true,
      doNotInventData: true,
      leaveBlankIfMissing: true,
      ratingUnknownValue: -1,
      secondaryPlayerRequired: !isSingles,
      useTableContextToInferStructure: true,
      useAdjacentRowsOnlyForContext: true,
      rowMayContainTwoPlayersInOneCell: true,
      rowMayContainTeamOrCompanyNameSeparateFromPlayers: true,
      candidateItemMayContainMultipleSourceRows: true,
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

function buildDocumentAnalysisPrompt(tournament, headers, rows) {
  const isSingles = String(tournament?.eventType || "double") === "single";
  return JSON.stringify({
    tournament: {
      name: tournament?.name || "",
      eventType: isSingles ? "single" : "double",
      location: tournament?.location || "",
    },
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

function buildRowGroupingPrompt(tournament, rows, documentAnalysis) {
  const isSingles = String(tournament?.eventType || "double") === "single";
  return JSON.stringify({
    tournament: {
      name: tournament?.name || "",
      eventType: isSingles ? "single" : "double",
      location: tournament?.location || "",
    },
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
  diagnostics
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
      input: buildRowGroupingPrompt(tournament, rows, documentAnalysis),
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
  diagnostics
) {
  const instructions = `
Ban la bo phan nhom du lieu dang ky PickleTour.

Muc tieu:
- Quyet dinh dong nao thuc su la dong dang ky.
- Neu mot ho so dang ky trai tren nhieu dong lien tiep, hay danh dau mergeWithPrevious = true o cac dong tiep theo.
- Chi duoc gom cac dong lien ke nhau.
- Neu gap tieu de, dong ngan cach, ghi chu, ten doi, ten cong ty, so thu tu, tong ket thi dat isRegistrationRow = false.
- mergeWithPrevious chi true khi dong hien tai thuc su bo sung cho ho so cua dong ngay truoc do.
- Khong bia du lieu.
- Neu khong chac, ha confidence va ghi ro reasons.

Tra ve JSON dung schema, khong them giai thich.
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
        input: buildRowGroupingPrompt(tournament, chunkRows, documentAnalysis),
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
            reasons: ["AI chua phan nhom ro dong nay"],
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
          reasons: ["AI chua phan nhom ro dong nay"],
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
      reasons: ["AI chua phan nhom duoc cac dong trong file nay"],
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
  diagnostics
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
      input: buildDocumentAnalysisPrompt(tournament, headers, rows),
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
  diagnostics
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
      documentAnalysis
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
  onProgress
) {
  const chunks = [];
  for (let i = 0; i < sourceRows.length; i += AI_BATCH_SIZE) {
    chunks.push(sourceRows.slice(i, i + AI_BATCH_SIZE));
  }

  reportPreviewProgress(onProgress, {
    step: "row_extraction",
    progress: 58,
    message: `Dang tach ${sourceRows.length} cum ho so de xu ly.`,
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
            diagnostics
          );
          completedChunks += 1;
          reportPreviewProgress(onProgress, {
            step: "row_extraction",
            progress:
              58 + Math.round((completedChunks / Math.max(chunks.length, 1)) * 24),
            message: `Da tach xong ${completedChunks}/${chunks.length} dot du lieu.`,
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
            message: `Mot dot du lieu gap loi, dang tiep tuc ${completedChunks}/${chunks.length}.`,
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
  onProgress,
}) {
  reportPreviewProgress(onProgress, {
    step: "init",
    progress: 4,
    message: "Dang tai thong tin giai.",
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
    message: "Dang lay du lieu nguon de doc truoc.",
  });

  const source = await resolveSourceText({ sheetUrl, rawText });
  const parsed = parseTextToRows(source.text);
  if (!parsed.rows.length) {
    throw new Error("Không đọc được dòng dữ liệu nào từ nguồn import");
  }

  const sourceRows = parsed.rows.slice(0, PREVIEW_MAX_ROWS);
  const truncated = parsed.rows.length > sourceRows.length;
  const tableContext = buildTableContext(parsed.headers, sourceRows);
  const aiDiagnostics = buildAiDiagnostics();
  reportPreviewProgress(onProgress, {
    step: "source_parsed",
    progress: 18,
    message: `Da doc ${parsed.rows.length} dong tu nguon import.`,
    sourceRows: parsed.rows.length,
    previewRows: sourceRows.length,
    truncated,
  });
  reportPreviewProgress(onProgress, {
    step: "document_analysis",
    progress: 28,
    message: "AI dang phan tich bo cuc tong the cua file.",
  });
  const analysis = await analyzeDocumentLayoutWithAI(
    tournament,
    parsed.headers,
    sourceRows,
    aiDiagnostics
  );
  reportPreviewProgress(onProgress, {
    step: "document_analysis",
    progress: 40,
    message: "Da xong buoc hieu bo cuc file.",
    layoutType: analysis?.layoutType || "unknown",
    registrationStyle: analysis?.registrationStyle || "unknown",
  });
  reportPreviewProgress(onProgress, {
    step: "row_grouping",
    progress: 46,
    message: "AI dang xac dinh dong nao la ho so dang ky.",
  });
  const groupingRows = await analyzeRowGroupingCompact(
    tournament,
    sourceRows,
    analysis,
    aiDiagnostics
  );
  const groupedRows = buildSourceGroups(sourceRows, groupingRows);
  reportPreviewProgress(onProgress, {
    step: "row_grouping",
    progress: 54,
    message: `Da gom duoc ${groupedRows.length} cum ho so can xu ly.`,
    candidateGroups: groupedRows.length,
  });
  const aiRows = await analyzeRows(
    tournament,
    groupedRows,
    tableContext,
    analysis,
    aiDiagnostics,
    onProgress
  );
  reportPreviewProgress(onProgress, {
    step: "preview_building",
    progress: 88,
    message: "Dang doi chieu tai khoan va lap bang xem truoc.",
  });
  const previewRows = await buildPreviewRows(tournament, groupedRows, aiRows);
  aiDiagnostics.summary = classifyAiDiagnosticSummary(aiDiagnostics);
  reportPreviewProgress(onProgress, {
    step: "preview_building",
    progress: 96,
    message: "Da lap xong bang xem truoc, dang tong hop ket qua.",
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
