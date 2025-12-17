// services/tingtingZns.service.js
import axios from "axios";

const BASE_URL = "https://v1.tingting.im/api/zns";

function normalizeTo84(phone = "") {
  let s = String(phone).trim();

  // remove spaces, non-digits except leading '+'
  s = s.replace(/\s+/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/[^\d]/g, "");

  // 0xxxxxxxxx -> 84xxxxxxxxx
  if (s.startsWith("0")) return "84" + s.slice(1);
  // 84xxxxxxxxx already ok
  if (s.startsWith("84")) return s;

  // fallback: return as-is
  return s;
}

export async function sendTingTingOtp({ phone, otp }) {
    const apikey = process.env.TINGTING_APIKEY;
  const sender = process.env.TINGTING_SENDER;
  const tempid = process.env.TINGTING_TEMPID;
  const session = process.env.TINGTING_SESSION; // optional
  const content = process.env.TINGTING_CONTENT || "PickleTour";

  if (!apikey || !sender || !tempid) {
    throw new Error("Missing TingTing config (TINGTING_APIKEY/SENDER/TEMPID).");
  }

  const to = normalizeTo84(phone);
  if (!to || to.length < 10) throw new Error("Invalid phone format.");

  const url = `${BASE_URL}?apikey=${encodeURIComponent(apikey)}`;

  const payload = {
    to,
    content,
    sender,
    tempid,
    temp_data: { otp: String(otp) },
  };

  const headers = { "Content-Type": "application/json" };
  if (session) headers["Cookie"] = `tingting_session=${session}`;

  const resp = await axios.request({
    url,
    method: "GET", // 👈 đúng như curl bạn đưa
    data: payload, // 👈 JSON body
    headers,
    timeout: 15000,
    validateStatus: () => true,
  });

  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`TingTing HTTP ${resp.status}`);
  }

  const body = resp.data;
  if (!body || body.status !== "success") {
    throw new Error(`TingTing failed: ${JSON.stringify(body)}`);
  }
  if (Array.isArray(body.invalid_phones) && body.invalid_phones.length > 0) {
    throw new Error(`Invalid phones: ${body.invalid_phones.join(", ")}`);
  }

  // body: { status:"success", sms, cost, tranId, ...}
  return body;
}
