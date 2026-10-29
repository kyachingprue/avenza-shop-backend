const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = "unit-test-secret-that-is-long-enough-to-pass-validation";
process.env.CORS_ORIGINS = "http://localhost:5173";
process.env.STRIPE_SECRET_KEY = "";
process.env.FIREBASE_PROJECT_ID = "test-firebase-project";

const { app } = require("../src/app");
const { getApps } = require("firebase-admin/app");
const { getFirebaseAuth } = require("../src/services/firebase");

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test("health endpoint reports readiness without exposing configuration", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("Firebase auth initializes using the configured project ID", () => {
  getFirebaseAuth();
  const firebaseApp = getApps().find((candidate) => candidate.name === "[DEFAULT]");
  assert.equal(firebaseApp.options.projectId, "test-firebase-project");
});

test("checkout rejects invalid quantities before contacting Stripe", async () => {
  const response = await fetch(`${baseUrl}/api/checkout/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items: [{ productId: 1, quantity: 0 }] })
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
});

test("checkout rejects client-supplied prices", async () => {
  const response = await fetch(`${baseUrl}/api/checkout/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items: [{ productId: 1, quantity: 1, price: 1 }] })
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
});

test("checkout requires an authenticated session", async () => {
  const response = await fetch(`${baseUrl}/api/checkout/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items: [{ productId: 1, quantity: 1 }] })
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "AUTHENTICATION_REQUIRED");
});

test("signup rejects caller-supplied elevated roles", async () => {
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "seller@example.com",
      name: "Seller",
      password: "a-valid-long-password",
      role: "ADMIN"
    })
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
});

test("protected profile requires a bearer token", async () => {
  const response = await fetch(`${baseUrl}/api/users/me`);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "AUTHENTICATION_REQUIRED");
});

test("profile image updates require an authenticated session", async () => {
  const response = await fetch(`${baseUrl}/api/users/me`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ photoURL: "https://i.ibb.co/example/avatar.png" })
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "AUTHENTICATION_REQUIRED");
});

test("logout clears the HttpOnly session cookie", async () => {
  const response = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { message: "Signed out successfully." });
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /^avenza_session=;/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Expires=Thu, 01 Jan 1970/i);
});

test("CORS rejects origins outside the configured allowlist", async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { origin: "https://not-allowed.example" }
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "CORS_ORIGIN_DENIED");
});
