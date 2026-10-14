import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  // `server-only` throws outside the react-server condition; tests run in plain Node.
  "server-only": fileURLToPath(new URL("./tests/stubs/empty.ts", import.meta.url)),
};

// Integration tests run against a dedicated database (created if missing).
export const TEST_ADMIN_URL = "postgres://postgres:postgres@localhost:5433/reservo_test";
export const TEST_APP_URL = "postgres://reservo_app:reservo_app_dev_password@localhost:5433/reservo_test";

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          env: {
            NODE_ENV: "test",
            DATABASE_URL: process.env.TEST_DATABASE_URL ?? TEST_APP_URL,
            TEST_DATABASE_ADMIN_URL: process.env.TEST_DATABASE_ADMIN_URL ?? TEST_ADMIN_URL,
            MAIL_TRANSPORT: "memory",
            FAKE_PAYMENTS_WEBHOOK_SECRET: "test-fake-secret",
            NEXT_PUBLIC_APP_URL: "http://localhost:3000",
            STRIPE_SECRET_KEY: "",
          },
          // Tests share one database; files run sequentially, tests inside a
          // file may still fire concurrent queries on purpose.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
