const env = require("../config/env");
const { ApiError } = require("../lib/http");

function notFound(request, response, next) {
  next(new ApiError(404, "NOT_FOUND", `No route found for ${request.method} ${request.path}`));
}

function errorHandler(error, request, response, next) {
  if (response.headersSent) return next(error);

  const knownPrismaConflict = error.code === "P2002";
  const missingRecord = error.code === "P2025";
  const status = error instanceof ApiError
    ? error.status
    : knownPrismaConflict
      ? 409
      : missingRecord
        ? 404
        : Number.isInteger(error.status) && error.status >= 400 && error.status < 500
          ? error.status
          : 500;
  const code = error instanceof ApiError
    ? error.code
    : knownPrismaConflict
      ? "CONFLICT"
      : missingRecord
        ? "NOT_FOUND"
        : status === 413
          ? "PAYLOAD_TOO_LARGE"
          : status === 400
            ? "BAD_REQUEST"
            : "INTERNAL_SERVER_ERROR";
  if (status >= 500) {
    console.error("Request failed", {
      method: request.method,
      path: request.path,
      error: error.message
    });
  }

  response.status(status).json({
    error: {
      code,
      message: error instanceof ApiError
        ? error.message
        : knownPrismaConflict
          ? "A record with that unique value already exists"
          : missingRecord
            ? "The requested record was not found"
            : status < 500
              ? "The request could not be processed"
              : env.NODE_ENV === "production"
                ? "An unexpected error occurred"
                : error.message || "An unexpected error occurred"
    }
  });
}

module.exports = { notFound, errorHandler };
