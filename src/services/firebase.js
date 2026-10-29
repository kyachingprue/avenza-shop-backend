const { getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const env = require("../config/env");
const { ApiError } = require("../lib/http");

function getFirebaseAuth() {
  if (!env.FIREBASE_PROJECT_ID) {
    throw new ApiError(503, "GOOGLE_AUTH_UNAVAILABLE", "Google sign-in is not configured on this server");
  }

  let firebaseApp = getApps().find((app) => app.name === "[DEFAULT]");
  if (!firebaseApp) {
    firebaseApp = initializeApp({ projectId: env.FIREBASE_PROJECT_ID });
  }
  return getAuth(firebaseApp);
}

module.exports = { getFirebaseAuth };
