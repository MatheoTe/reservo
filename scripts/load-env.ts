// Loads .env for CLI scripts (Next.js loads it for the app on its own).
import { config } from "dotenv";

config({ path: ".env", quiet: true });
