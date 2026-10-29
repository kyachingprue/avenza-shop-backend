class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function asyncHandler(handler) {
  return function wrappedHandler(request, response, next) {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function validate(schema, source = "body") {
  return function validateRequest(request, response, next) {
    const result = schema.safeParse(request[source]);
    if (!result.success) {
      return next(
        new ApiError(
          400,
          "VALIDATION_ERROR",
          result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        )
      );
    }
    request[source] = result.data;
    next();
  };
}

module.exports = { ApiError, asyncHandler, validate };
