import fetch from "node-fetch";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

const isTruthy = (value) =>
  TRUE_VALUES.has(String(value || "").trim().toLowerCase());

const normalizeBaseUrl = (value) => String(value || "").trim().replace(/\/+$/, "");

export const extractCapToken = (body = {}) => {
  if (!body || typeof body !== "object") return "";

  return String(body.capToken || body["cap-token"] || body.cap_token || "").trim();
};

export const isCapVerificationEnabled = () => {
  const explicitFlag = String(process.env.CAP_ENABLED || "").trim();
  if (explicitFlag) return isTruthy(explicitFlag);

  return Boolean(
    normalizeBaseUrl(process.env.CAP_BASE_URL) &&
      String(process.env.CAP_SITE_KEY || "").trim() &&
      String(process.env.CAP_SECRET_KEY || "").trim(),
  );
};

export async function verifyCapToken(capToken) {
  if (!isCapVerificationEnabled()) {
    return { enabled: false, success: true };
  }

  const baseUrl = normalizeBaseUrl(process.env.CAP_BASE_URL);
  const siteKey = String(process.env.CAP_SITE_KEY || "").trim();
  const secretKey = String(process.env.CAP_SECRET_KEY || "").trim();

  if (!baseUrl || !siteKey || !secretKey) {
    return {
      enabled: true,
      success: false,
      status: 503,
      message: "Dịch vụ CAPTCHA chưa được cấu hình đầy đủ.",
    };
  }

  if (!capToken) {
    return {
      enabled: true,
      success: false,
      status: 400,
      message: "Vui lòng hoàn thành CAPTCHA.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${baseUrl}/${siteKey}/siteverify`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        secret: secretKey,
        response: capToken,
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);

    if (response.ok && payload?.success === true) {
      return { enabled: true, success: true };
    }

    return {
      enabled: true,
      success: false,
      status: response.status >= 500 ? 502 : 400,
      message: "Xác minh CAPTCHA không thành công. Vui lòng thử lại.",
    };
  } catch (error) {
    return {
      enabled: true,
      success: false,
      status: 503,
      message:
        error?.name === "AbortError"
          ? "Hết thời gian xác minh CAPTCHA. Vui lòng thử lại."
          : "Dịch vụ CAPTCHA tạm thời không khả dụng. Vui lòng thử lại sau.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function assertCapTokenOrThrow(req, res) {
  const result = await verifyCapToken(extractCapToken(req?.body));

  if (!result.success) {
    res.status(result.status || 400);
    throw new Error(result.message);
  }

  return result;
}
