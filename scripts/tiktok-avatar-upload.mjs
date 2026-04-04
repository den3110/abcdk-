import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";

const DEFAULT_DEBUG_PORT = Number(process.env.TIKTOK_CAPTURE_DEBUG_PORT || 9229);
const DEFAULT_TIMEOUT_MS = Number(process.env.TIKTOK_AVATAR_TIMEOUT_MS || 120000);
const DEFAULT_PROFILE_URL = process.env.TIKTOK_AVATAR_PROFILE_URL || "";
const EDIT_PROFILE_BUTTON_SELECTOR = 'button[data-e2e="edit-profile-entrance"]';
const EDIT_PROFILE_POPUP_SELECTOR = '[data-e2e="edit-profile-popup"]';
const EDIT_PROFILE_FILE_INPUT_SELECTOR =
  `${EDIT_PROFILE_POPUP_SELECTOR} input[type="file"]`;
const EDIT_PROFILE_SAVE_SELECTOR = 'button[data-e2e="edit-profile-save"]';

function printUsage() {
  console.log(`
Sử dụng:
  node scripts/tiktok-avatar-upload.mjs <đường-dẫn-ảnh> [--profile-url=https://www.tiktok.com/@username] [--debug-port=9229]
  npm run tiktok:avatar:upload -- <đường-dẫn-ảnh> [--profile-url=https://www.tiktok.com/@username]

Tùy chọn:
  --dry-run            Chỉ mở popup "Sửa hồ sơ" và kiểm tra selector, không tải ảnh.
  --timeout-ms=120000  Thời gian chờ tối đa cho từng bước.
  --debug-port=9229    Cổng Chrome remote debugging.
  --profile-url=...    URL hồ sơ TikTok cần thao tác.
  --help               In hướng dẫn này.

Biến môi trường:
  TIKTOK_CAPTURE_DEBUG_PORT
  TIKTOK_AVATAR_TIMEOUT_MS
  TIKTOK_AVATAR_PROFILE_URL
  TIKTOK_AVATAR_IMAGE
`);
}

function clipText(value, limit = 240) {
  if (!value) {
    return "";
  }

  const compact = String(value).replace(/\s+/g, " ").trim();
  if (!compact) {
    return "";
  }

  return compact.length > limit
    ? `${compact.slice(0, limit)}...<cắt bớt>`
    : compact;
}

function normalizeUrl(url) {
  return String(url || "").replace(/\/+$/, "");
}

function parseNumberOption(value, name) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new Error(`Giá trị ${name} không hợp lệ: ${value}`);
  }

  return numberValue;
}

function parseArgs(argv) {
  const options = {
    debugPort: DEFAULT_DEBUG_PORT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    profileUrl: DEFAULT_PROFILE_URL,
    imagePath: process.env.TIKTOK_AVATAR_IMAGE || "",
    dryRun: process.env.TIKTOK_AVATAR_DRY_RUN === "1",
  };
  const positional = [];

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg.startsWith("--debug-port=")) {
      options.debugPort = parseNumberOption(
        arg.slice("--debug-port=".length),
        "--debug-port"
      );
      continue;
    }

    if (arg.startsWith("--timeout-ms=")) {
      options.timeoutMs = parseNumberOption(
        arg.slice("--timeout-ms=".length),
        "--timeout-ms"
      );
      continue;
    }

    if (arg.startsWith("--profile-url=")) {
      options.profileUrl = arg.slice("--profile-url=".length).trim();
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Tùy chọn không được hỗ trợ: ${arg}`);
    }

    positional.push(arg);
  }

  if (positional[0]) {
    options.imagePath = positional[0];
  }

  if (!options.help && !options.dryRun && !options.imagePath) {
    throw new Error("Thiếu đường dẫn ảnh. Dùng --help để xem cách chạy.");
  }

  if (options.imagePath) {
    options.imagePath = path.resolve(process.cwd(), options.imagePath);
  }

  if (options.profileUrl) {
    options.profileUrl = normalizeUrl(options.profileUrl);
  }

  return options;
}

async function connectToBrowser(debugPort) {
  try {
    return await puppeteer.connect({
      browserURL: `http://127.0.0.1:${debugPort}`,
      defaultViewport: null,
    });
  } catch (error) {
    throw new Error(
      `Không kết nối được Chrome ở cổng ${debugPort}. Hãy mở Chrome remote debugging trước, hoặc chạy script capture đã dùng lúc nãy.\nChi tiết: ${error.message}`
    );
  }
}

async function resolveTikTokPage(browser, { profileUrl, timeoutMs }) {
  const pages = await browser.pages();
  let page =
    (profileUrl &&
      pages.find((currentPage) => normalizeUrl(currentPage.url()) === profileUrl)) ||
    pages.find((currentPage) => currentPage.url().includes("tiktok.com/@")) ||
    pages.find((currentPage) => currentPage.url().includes("tiktok.com")) ||
    null;

  if (!page) {
    page = await browser.newPage();
  }

  await page.bringToFront().catch(() => {});

  if (profileUrl && normalizeUrl(page.url()) !== profileUrl) {
    await page.goto(profileUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
  }

  return page;
}

async function ensureEditProfilePopup(page, timeoutMs) {
  const popup = await page.$(EDIT_PROFILE_POPUP_SELECTOR);
  if (popup) {
    return;
  }

  await page.waitForFunction(
    ({ buttonSelector, popupSelector }) =>
      Boolean(
        document.querySelector(buttonSelector) || document.querySelector(popupSelector)
      ),
    {
      timeout: timeoutMs,
    },
    {
      buttonSelector: EDIT_PROFILE_BUTTON_SELECTOR,
      popupSelector: EDIT_PROFILE_POPUP_SELECTOR,
    }
  );

  const alreadyOpen = await page.$(EDIT_PROFILE_POPUP_SELECTOR);
  if (!alreadyOpen) {
    await page.$eval(EDIT_PROFILE_BUTTON_SELECTOR, (button) => {
      button.scrollIntoView({ block: "center", inline: "center" });
      button.click();
    });
  }

  await page.waitForSelector(EDIT_PROFILE_POPUP_SELECTOR, {
    visible: true,
    timeout: timeoutMs,
  });
  await page.waitForSelector(EDIT_PROFILE_FILE_INPUT_SELECTOR, {
    visible: true,
    timeout: timeoutMs,
  });
}

async function waitForSuccessResponse(page, urlPart, timeoutMs) {
  const response = await page.waitForResponse(
    (currentResponse) =>
      currentResponse.request().method() === "POST" &&
      currentResponse.url().includes(urlPart),
    {
      timeout: timeoutMs,
    }
  );
  const body = await response.text().catch(() => "");
  let payload = body;

  if (body) {
    try {
      payload = JSON.parse(body);
    } catch {
      payload = clipText(body, 500);
    }
  }

  const apiSuccess =
    !payload ||
    typeof payload !== "object" ||
    payload === null ||
    !("status_code" in payload) ||
    Number(payload.status_code) === 0;

  if (!response.ok() || !apiSuccess) {
    const payloadText =
      typeof payload === "string" ? payload : clipText(JSON.stringify(payload), 500);
    throw new Error(
      `Request ${urlPart} thất bại: HTTP ${response.status()} ${payloadText}`
    );
  }

  return {
    response,
    payload,
  };
}

async function waitForSaveEnabled(page, timeoutMs) {
  await page.waitForFunction(
    (saveSelector) => {
      const button = document.querySelector(saveSelector);
      return Boolean(button && !button.disabled);
    },
    {
      timeout: timeoutMs,
    },
    EDIT_PROFILE_SAVE_SELECTOR
  );
}

async function uploadAvatar(page, imagePath, timeoutMs) {
  const uploadPromise = waitForSuccessResponse(page, "/api/upload/image/", timeoutMs);
  const inputHandle = await page.waitForSelector(EDIT_PROFILE_FILE_INPUT_SELECTOR, {
    visible: true,
    timeout: timeoutMs,
  });

  await inputHandle.uploadFile(imagePath);
  const { response: uploadResponse, payload: uploadPayload } = await uploadPromise;

  console.log(
    `Upload ảnh: HTTP ${uploadResponse.status()} ${clipText(
      uploadResponse.url(),
      140
    )}`
  );

  if (uploadPayload && typeof uploadPayload === "object") {
    console.log(`Phản hồi upload: ${clipText(JSON.stringify(uploadPayload), 240)}`);
  }

  await waitForSaveEnabled(page, timeoutMs);

  const updatePromise = waitForSuccessResponse(
    page,
    "/api/update/profile/",
    timeoutMs
  );

  await page.$eval(EDIT_PROFILE_SAVE_SELECTOR, (button) => {
    button.scrollIntoView({ block: "center", inline: "center" });
    button.click();
  });

  const { response: updateResponse, payload: updatePayload } = await updatePromise;

  console.log(
    `Cập nhật hồ sơ: HTTP ${updateResponse.status()} ${clipText(
      updateResponse.url(),
      140
    )}`
  );

  if (updatePayload && typeof updatePayload === "object") {
    console.log(
      `Phản hồi cập nhật: ${clipText(JSON.stringify(updatePayload), 240)}`
    );
  }

  await page
    .waitForFunction(
      (popupSelector) => !document.querySelector(popupSelector),
      {
        timeout: 15000,
      },
      EDIT_PROFILE_POPUP_SELECTOR
    )
    .catch(() => {});
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printUsage();
    return;
  }

  if (options.imagePath && !fs.existsSync(options.imagePath)) {
    throw new Error(`Không tìm thấy file ảnh: ${options.imagePath}`);
  }

  if (options.imagePath) {
    const stats = fs.statSync(options.imagePath);
    if (!stats.isFile()) {
      throw new Error(`Đường dẫn không phải file ảnh: ${options.imagePath}`);
    }
  }

  const browser = await connectToBrowser(options.debugPort);

  try {
    const page = await resolveTikTokPage(browser, options);
    console.log(`Đang thao tác trên tab: ${page.url() || "<tab mới>"}`);

    await ensureEditProfilePopup(page, options.timeoutMs);
    console.log("Đã mở popup Sửa hồ sơ.");

    if (options.dryRun) {
      console.log("Dry run hoàn tất, chưa tải ảnh.");
      return;
    }

    console.log(`Đang tải ảnh từ: ${options.imagePath}`);
    await uploadAvatar(page, options.imagePath, options.timeoutMs);
    console.log("Đổi avatar xong.");
  } finally {
    await browser.disconnect();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
