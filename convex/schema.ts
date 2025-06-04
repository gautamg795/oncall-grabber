import { defineSchema } from "convex/server";

// No persistent data needed - all configuration via environment variables
// and override data is stored in Rootly, not in Convex
export default defineSchema({}); 