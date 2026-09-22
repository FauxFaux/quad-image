import { defineConfig } from "cypress";

export default defineConfig({
  component: {
    defaultBrowser: "chrome",
    devServer: {
      framework: "react",
      bundler: "vite",
    },
  },
});
