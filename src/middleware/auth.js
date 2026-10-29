const jwt = require("jsonwebtoken");
const { z } = require("zod");
const env = require("../config/env");
const prisma = require("../db/prisma");
const { ApiError, asyncHandler } = require("../lib/http");
const { SESSION_COOKIE_NAME } = require("../auth/session-cookie");

const tokenSchema = z.string().min(1);

const authenticate = asyncHandler(async (request, response, next) => {
  const credentials = (request.get("authorization") || "").trim().split(/\s+/);
  const [scheme, bearerToken] = credentials;
  const token = request.cookies?.[SESSION_COOKIE_NAME]
    || (credentials.length === 2 && scheme === "Bearer" ? bearerToken : null);
  if (!tokenSchema.safeParse(token).success) {
    throw new ApiError(401, "AUTHENTICATION_REQUIRED", "A valid session is required");
  }

  let claims;
  try {
    claims = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "e-commerce-backend",
      audience: "e-commerce-client"
    });
  } catch {
    throw new ApiError(401, "INVALID_TOKEN", "The access token is invalid or expired");
  }
  if (typeof claims !== "object" || typeof claims.sub !== "string") {
    throw new ApiError(401, "INVALID_TOKEN", "The access token is invalid");
  }

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { id: true, email: true, name: true, avatarUrl: true, role: true, emailVerified: true }
  });
  if (!user || !user.emailVerified) {
    throw new ApiError(401, "INVALID_ACCOUNT", "The account is unavailable or not verified");
  }

  request.user = user;
  next();
});

function allowRoles(...roles) {
  return function authorizeRole(request, response, next) {
    if (!request.user || !roles.includes(request.user.role)) {
      return next(new ApiError(403, "FORBIDDEN", "You do not have permission to access this resource"));
    }
    next();
  };
}

module.exports = { authenticate, allowRoles };
