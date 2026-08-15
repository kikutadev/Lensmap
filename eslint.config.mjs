import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**", "**/drizzle/**", "**/.wxt/**", "**/.output/**", "**/.astro/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["e2e/**/*.mjs", "scripts/**/*.mjs"],
    rules: {
      "no-undef": "off",
    },
  },
);
