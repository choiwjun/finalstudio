import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ADMIN_COOKIE,
  clearSessionCookie,
  createSessionToken,
  isAuthenticated,
  sameOrigin,
  sessionCookie,
  verifySessionToken,
} from "./admin-auth.mjs";

const secret = "test-admin-password-123456";

test("creates and verifies an expiring signed admin session", async () => {
  const token = await createSessionToken(secret, 1_000);

  assert.equal(await verifySessionToken(token, secret, 1_100), true);
  assert.equal(await verifySessionToken(token, "wrong-password-123456", 1_100), false);
  assert.equal(await verifySessionToken(token, secret, 1_000 + 8 * 60 * 60), false);
  assert.match(sessionCookie(token), new RegExp(`^${ADMIN_COOKIE}=`));
  assert.match(clearSessionCookie(), /Max-Age=0/);
});

test("rejects malformed or tampered sessions", async () => {
  assert.equal(await verifySessionToken("not-a-token", secret), false);
  const token = await createSessionToken(secret, 1_000);
  const tampered = `${token.slice(0, -1)}x`;
  assert.equal(await verifySessionToken(tampered, secret, 1_100), false);
});

test("requires a same-origin request for browser writes", () => {
  assert.equal(sameOrigin(new Request("https://wjblog.example/api/admin/posts", { headers: { Origin: "https://wjblog.example" } })), true);
  assert.equal(sameOrigin(new Request("https://wjblog.example/api/admin/posts", { headers: { Origin: "https://evil.example" } })), false);
});

test("authenticates a request carrying the signed cookie", async () => {
  const token = await createSessionToken(secret);
  const request = new Request("https://wjblog.example/api/admin/session", {
    headers: { Cookie: `${ADMIN_COOKIE}=${token}` },
  });

  assert.equal(await isAuthenticated(request, { ADMIN_PASSWORD: secret }), true);
});
