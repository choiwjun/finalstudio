const encoder = new TextEncoder();
const SESSION_TTL_SECONDS = 8 * 60 * 60;
export const ADMIN_COOKIE = "__Host-wjblog_admin";

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSessionToken(secret, now = Math.floor(Date.now() / 1000)) {
  if (typeof secret !== "string" || secret.length < 16) throw new Error("ADMIN_PASSWORD must be configured");
  const payload = encodeBase64Url(encoder.encode(JSON.stringify({ iat: now, exp: now + SESSION_TTL_SECONDS })));
  const signature = await crypto.subtle.sign("HMAC", await importKey(secret), encoder.encode(payload));
  return `${payload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token, secret, now = Math.floor(Date.now() / 1000)) {
  if (typeof token !== "string" || typeof secret !== "string") return false;
  const [payload, encodedSignature] = token.split(".");
  if (!payload || !encodedSignature) return false;
  try {
    const data = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
    if (!Number.isInteger(data.iat) || !Number.isInteger(data.exp) || data.iat > now + 60 || data.exp <= now || data.exp - data.iat !== SESSION_TTL_SECONDS) return false;
    return crypto.subtle.verify("HMAC", await importKey(secret), decodeBase64Url(encodedSignature), encoder.encode(payload));
  } catch {
    return false;
  }
}

export function getCookie(request, name) {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

export function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function isAuthenticated(request, env) {
  return verifySessionToken(getCookie(request, ADMIN_COOKIE), env?.ADMIN_PASSWORD, Math.floor(Date.now() / 1000));
}

export function sessionCookie(token) {
  return `${ADMIN_COOKIE}=${token}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${ADMIN_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export { SESSION_TTL_SECONDS };
