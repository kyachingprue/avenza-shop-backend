const env = require("../config/env");

const SESSION_COOKIE_NAME = "avenza_session";
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: env.NODE_ENV === "production" ? "none" : "lax",
  path: "/",
  maxAge: 60 * 60 * 1000
};

function setSessionCookie(response, token) {
  response.cookie(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
}

function clearSessionCookie(response) {
  const { maxAge, ...options } = SESSION_COOKIE_OPTIONS;
  response.clearCookie(SESSION_COOKIE_NAME, options);
}

module.exports = {
  SESSION_COOKIE_NAME,
  setSessionCookie,
  clearSessionCookie
};
