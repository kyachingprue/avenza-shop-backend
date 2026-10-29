const dotenv = require("dotenv");
const path = require("node:path");
const { z } = require("zod");

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const optionalNonEmpty = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional()
);
const optionalPort = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.coerce.number().int().min(1).max(65535).optional()
);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.string()
      .url("DATABASE_URL must be a PostgreSQL connection URL")
      .refine(
        (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
        "DATABASE_URL must use the postgresql:// or postgres:// protocol"
      ),
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
    CORS_ORIGINS: z.string().default("http://localhost:5173"),
    FRONTEND_URL: optionalNonEmpty,
    STRIPE_SECRET_KEY: optionalNonEmpty,
    SMTP_HOST: optionalNonEmpty,
    SMTP_PORT: optionalPort,
    SMTP_USER: optionalNonEmpty,
    SMTP_PASS: optionalNonEmpty,
    SMTP_FROM: optionalNonEmpty,
    FIREBASE_PROJECT_ID: optionalNonEmpty
  })
  .superRefine((values, context) => {
    if (values.FRONTEND_URL && !z.string().url()
      .refine((value) => value.startsWith("http://") || value.startsWith("https://"))
      .safeParse(values.FRONTEND_URL).success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["FRONTEND_URL"],
        message: "FRONTEND_URL must be a valid URL"
      });
    }

    const smtpValues = [
      values.SMTP_HOST,
      values.SMTP_PORT,
      values.SMTP_USER,
      values.SMTP_PASS,
      values.SMTP_FROM
    ];
    if (smtpValues.some(Boolean) && smtpValues.some((value) => !value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM must be configured together"
      });
    }
  });

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new Error(
    `Invalid backend environment:\n- ${details.join("\n- ")}\n\nCreate backend/.env from backend/.env.example and set the required values before starting the server.`
  );
}

const corsOriginList = parsed.data.CORS_ORIGINS.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
if (parsed.data.NODE_ENV !== "production") {
  for (const origin of [...corsOriginList]) {
    if (origin === "http://localhost" || origin.startsWith("http://localhost:")) {
      corsOriginList.push(origin.replace("http://localhost", "http://127.0.0.1"));
    } else if (origin === "http://127.0.0.1" || origin.startsWith("http://127.0.0.1:")) {
      corsOriginList.push(origin.replace("http://127.0.0.1", "http://localhost"));
    }
  }
}

module.exports = {
  ...parsed.data,
  CORS_ORIGIN_LIST: [...new Set(corsOriginList)],
  FRONTEND_URL: parsed.data.FRONTEND_URL || parsed.data.CORS_ORIGINS.split(",")[0].trim(),
  STRIPE_CONFIGURED: Boolean(parsed.data.STRIPE_SECRET_KEY),
  SMTP_CONFIGURED: Boolean(parsed.data.SMTP_HOST)
};
