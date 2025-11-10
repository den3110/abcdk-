// src/utils/rankingSec.js
import sha256 from "crypto-js/sha256";
import encHex from "crypto-js/enc-hex";

const T1 = import.meta.env.VITE_APP_METRIC_A || "";
const T2 = import.meta.env.VITE_APP_METRIC_B || "";
const T3 = import.meta.env.VITE_APP_WIDGET_VER || "";
const T4 = "pt"; 
const T5 = "rk"; 

const CLIENT_KEY_FE = [
  T4,
  T2 ? T2.slice(1, 4) : "q1",
  T5,
  T1 ? T1.slice(2, 6) : "z9",
  T3 ? T3.slice(-3) : "x0",
].join("");

const normalizePath = (url) => {
  if (!url) return "/";
  const noQuery = url.split("?")[0] || "/";
  const cleaned = noQuery.replace(/\/+$/, "");
  return cleaned === "" ? "/" : cleaned;
};

export function buildRankingToken(url = "/api/rankings", method = "GET") {
  const path = normalizePath(url); 
  const ts = Math.floor(Date.now() / 1000);
  const nonce = Math.random().toString(36).slice(2, 10);

  const raw = `${method.toUpperCase()}|${path}|${ts}|${nonce}|${CLIENT_KEY_FE}`;
  const sign = sha256(raw).toString(encHex);

  const payload =
    typeof btoa === "function"
      ? btoa(`${ts}:${nonce}:${sign}`)
      : Buffer.from(`${ts}:${nonce}:${sign}`).toString("base64");

  return payload;
}
