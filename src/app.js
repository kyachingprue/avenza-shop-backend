const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const env = require("./config/env");
const { ApiError } = require("./lib/http");
const { SESSION_COOKIE_NAME } = require("./auth/session-cookie");
const { notFound, errorHandler } = require("./middleware/error-handler");
const checkoutRoutes = require("./routes/checkout.routes");
const adminRoutes = require("./routes/admin.routes");
const authRoutes = require("./routes/auth.routes");
const catalogRoutes = require("./routes/catalog.routes");
const productRoutes = require("./routes/product.routes");
const paymentRoutes = require("./routes/payment.routes");
const orderRoutes = require("./routes/order.routes");
const sellerRoutes = require("./routes/seller.routes");
const userRoutes = require("./routes/user.routes");

const app = express();
const corsOptions = {
  origin(origin, callback) {
    if (!origin || env.CORS_ORIGIN_LIST.includes(origin)) return callback(null, true);
    callback(new ApiError(403, "CORS_ORIGIN_DENIED", "Origin is not allowed by this API"));
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
};

app.disable("x-powered-by");
app.use(helmet());
app.use(cors(corsOptions));
app.use(cookieParser());
app.use((request, response, next) => {
  const isUnsafeMethod = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  const hasSessionCookie = Boolean(request.cookies?.[SESSION_COOKIE_NAME]);
  const origin = request.get("origin");
  if (isUnsafeMethod && hasSessionCookie && (!origin || !env.CORS_ORIGIN_LIST.includes(origin))) {
    return next(new ApiError(403, "CSRF_ORIGIN_DENIED", "The request origin is not allowed"));
  }
  next();
});
app.use(express.json({ limit: "16kb" }));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: { code: "AUTH_RATE_LIMITED", message: "Too many authentication attempts; try again later" }
  }
});

app.get("/api/health", (request, response) => {
  response.json({ status: "ok" });
});
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/checkout", checkoutRoutes);
app.use("/api/catalog", catalogRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/users", userRoutes);
app.use("/api/products", productRoutes);
app.use("/api/seller", sellerRoutes);
app.use("/api/admin", adminRoutes);
app.use(notFound);
app.use(errorHandler);

module.exports = { app, corsOptions };
