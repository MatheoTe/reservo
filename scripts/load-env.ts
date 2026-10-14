// Loads .env for CLI scripts (Next.js loads it for the app on its own).
import { config } from "dotenv";

import { applyManagedPostgresEnv } from "@/server/db/managed-env";

config({ path: ".env", quiet: true });
applyManagedPostgresEnv();
