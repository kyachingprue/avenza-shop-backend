const crypto = require("node:crypto");
const { Router } = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const env = require("../config/env");
const prisma = require("../db/prisma");
const { ApiError, asyncHandler, validate } = require("../lib/http");
const { getFirebaseAuth } = require("../services/firebase");
const { sendVerificationCode } = require("../services/email");
const { setSessionCookie, clearSessionCookie } = require("../auth/session-cookie");

const router = Router();
const emailSchema = z.string().email().max(254).transform((email) => email.toLowerCase());
const signupSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1).max(100),
  password: z.string().min(12).max(72).refine(
    (password) => Buffer.byteLength(password, "utf8") <= 72,
    "Password must be at most 72 bytes"
  )
}).strict();
const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(72).refine(
    (password) => Buffer.byteLength(password, "utf8") <= 72,
    "Password must be at most 72 bytes"
  )
}).strict();
const verifySchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/, "Code must contain six digits")
}).strict();
const resendSchema = z.object({ email: emailSchema }).strict();
const googleSchema = z.object({ idToken: z.string().min(1).max(8192) }).strict();

function hashVerificationCode(code) {
  return crypto.createHmac("sha256", env.JWT_SECRET).update(code).digest("hex");
}

function issueToken(user) {
  return jwt.sign({}, env.JWT_SECRET, {
    algorithm: "HS256",
    subject: user.id,
    expiresIn: "1h",
    issuer: "e-commerce-backend",
    audience: "e-commerce-client"
  });
}

function userResponse(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    photoURL: user.avatarUrl || null,
    role: user.role
  };
}

function sendSession(response, user) {
  setSessionCookie(response, issueToken(user));
  response.json({ user: userResponse(user) });
}

router.post(
  "/signup",
  validate(signupSchema),
  asyncHandler(async (request, response) => {
    if (!env.SMTP_CONFIGURED) {
      throw new ApiError(503, "EMAIL_UNAVAILABLE", "Email verification is not configured on this server");
    }

    const { email, name, password } = request.body;
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new ApiError(409, "EMAIL_IN_USE", "An account with this email already exists");
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        verificationCodeHash: hashVerificationCode(code),
        verificationExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        verificationAttempts: 0
      },
      select: { id: true }
    });

    try {
      await sendVerificationCode(email, name, code);
    } catch (error) {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
      throw error;
    }

    response.status(201).json({
      message: "Account created. Check your email for a verification code."
    });
  })
);

router.post(
  "/verify-email",
  validate(verifySchema),
  asyncHandler(async (request, response) => {
    const { email, code } = request.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerified || !user.verificationCodeHash || !user.verificationExpiresAt) {
      throw new ApiError(400, "INVALID_VERIFICATION", "The verification code is invalid or expired");
    }
    if (user.verificationExpiresAt <= new Date() || user.verificationAttempts >= 5) {
      throw new ApiError(400, "INVALID_VERIFICATION", "The verification code is invalid or expired");
    }

    const expected = Buffer.from(user.verificationCodeHash, "hex");
    const provided = Buffer.from(hashVerificationCode(code), "hex");
    if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
      const attempts = user.verificationAttempts + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          verificationAttempts: attempts,
          ...(attempts >= 5 ? { verificationCodeHash: null, verificationExpiresAt: null } : {})
        }
      });
      throw new ApiError(400, "INVALID_VERIFICATION", "The verification code is invalid or expired");
    }

    const verifiedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        verificationCodeHash: null,
        verificationExpiresAt: null,
        verificationAttempts: 0
      },
      select: { id: true, email: true, name: true, avatarUrl: true, role: true }
    });
    sendSession(response, verifiedUser);
  })
);

router.post("/logout", (request, response) => {
  clearSessionCookie(response);
  response.json({ message: "Signed out successfully." });
});

router.post(
  "/resend-verification",
  validate(resendSchema),
  asyncHandler(async (request, response) => {
    const user = await prisma.user.findUnique({ where: { email: request.body.email } });
    if (user && !user.emailVerified && env.SMTP_CONFIGURED) {
      const code = String(crypto.randomInt(100000, 1000000));
      await prisma.user.update({
        where: { id: user.id },
        data: {
          verificationCodeHash: hashVerificationCode(code),
          verificationExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
          verificationAttempts: 0
        }
      });
      await sendVerificationCode(user.email, user.name, code);
    }
    response.json({ message: "If verification is available for that account, an email has been sent." });
  })
);

router.post(
  "/login",
  validate(loginSchema),
  asyncHandler(async (request, response) => {
    const user = await prisma.user.findUnique({ where: { email: request.body.email } });
    const passwordMatches = user && user.passwordHash
      ? await bcrypt.compare(request.body.password, user.passwordHash)
      : false;
    if (!passwordMatches) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
    }
    if (!user.emailVerified) {
      throw new ApiError(403, "EMAIL_NOT_VERIFIED", "Verify your email before signing in");
    }
    sendSession(response, user);
  })
);

router.post(
  "/google",
  validate(googleSchema),
  asyncHandler(async (request, response) => {
    let firebaseAuth;
    try {
      firebaseAuth = getFirebaseAuth();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, "GOOGLE_AUTH_UNAVAILABLE", "Google sign-in is not available on this server");
    }

    let decoded;
    try {
      decoded = await firebaseAuth.verifyIdToken(request.body.idToken);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(401, "INVALID_GOOGLE_TOKEN", "Google sign-in token is invalid or expired");
    }

    const email = typeof decoded.email === "string" ? decoded.email.toLowerCase() : "";
    if (!email || decoded.email_verified !== true || typeof decoded.uid !== "string") {
      throw new ApiError(401, "UNVERIFIED_GOOGLE_ACCOUNT", "A verified Google email is required");
    }

    let user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } });
    if (!user) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing && existing.firebaseUid && existing.firebaseUid !== decoded.uid) {
        throw new ApiError(409, "GOOGLE_ACCOUNT_CONFLICT", "This email is linked to a different Google account");
      }
      user = existing
        ? await prisma.user.update({
            where: { id: existing.id },
            data: {
              firebaseUid: decoded.uid,
              emailVerified: true,
              avatarUrl: existing.avatarUrl || (typeof decoded.picture === "string" ? decoded.picture : null)
            }
          })
        : await prisma.user.create({
            data: {
              email,
              name: typeof decoded.name === "string" && decoded.name.trim()
                ? decoded.name.trim().slice(0, 100)
                : email.split("@")[0].slice(0, 100),
              firebaseUid: decoded.uid,
              emailVerified: true,
              avatarUrl: typeof decoded.picture === "string" ? decoded.picture : null
            }
          });
    }
    if (!user.avatarUrl && typeof decoded.picture === "string") {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { avatarUrl: decoded.picture }
      });
    }

    sendSession(response, user);
  })
);

module.exports = router;
