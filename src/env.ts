import { z } from "zod";

/**
 * Server environment, validated once on first use (not at import time, so
 * `next build` and unit tests don't need a full .env).
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  EMAIL_FROM: z.string().default("Reservo <no-reply@reservo.local>"),
  STRIPE_SECRET_KEY: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  STRIPE_PRO_PRICE_ID: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  FAKE_PAYMENTS_WEBHOOK_SECRET: z.string().default("dev-fake-webhook-secret"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new Error(`Invalid environment variables:\n${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}
