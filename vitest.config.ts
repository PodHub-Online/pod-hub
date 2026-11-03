import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The schedule check runs on a UTC server and works on wall-clock times, so the tests do too
process.env.TZ = "UTC";

export default defineConfig({
  resolve: { alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"] },
});
