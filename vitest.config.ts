import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [ "test/**/*" ],
    watch: false,
    // the test files invoke the app on the same port
    fileParallelism: false,
  },

});
