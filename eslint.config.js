import convexPlugin from "@convex-dev/eslint-plugin";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
    // Global ignores - must be first
    {
        ignores: [
            "node_modules/**",
            "dist/**",
            "build/**",
            "convex/_generated/**",
            ".convex/**",
            "**/*.config.js",
            "**/*.config.ts",
        ],
    },
    // TypeScript configuration for all TypeScript files
    {
        files: ["**/*.ts", "**/*.tsx"],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 2022,
                sourceType: "module",
            },
        },
        plugins: {
            "@typescript-eslint": tseslint,
        },
        rules: {
            ...tseslint.configs.recommended.rules,
            // Allow unused vars that start with underscore
            "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
        },
    },
    // Apply Convex rules specifically to Convex functions
    {
        files: ["convex/**/*.ts", "convex/**/*.tsx"],
        ...convexPlugin.configs.recommended[0],
    },
]; 