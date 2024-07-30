import { config } from "dotenv";
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["test/**/*.spec.ts"],
        watch: false,
        // the two files invoke the app on the same port
        fileParallelism: false,
        env: config({ path: ".env.test" }).parsed,
    },
});
