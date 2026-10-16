import babelParser from "@babel/eslint-parser";
import stylistic from "@stylistic/eslint-plugin";

const controlFlow = ["if", "switch", "for", "while", "do", "try"];

export default [
  {
    ignores: [
      "node_modules/**",
      "web-dist/**",
      "dist/**",
      ".scratch/**",
      "src-tauri/**",
      "scripts/verify-*.mjs",
    ],
  },
  {
    files: ["src/**/*.ts", "scripts/**/*.mjs", "tests/**/*.mjs", "eslint.config.mjs"],
    plugins: { "@stylistic": stylistic },
    rules: {
      curly: ["error", "all"],
      "no-nested-ternary": "error",
      "@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: false }],
      "@stylistic/max-len": ["error", { code: 100, tabWidth: 2 }],
      "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "*", next: controlFlow },
        { blankLine: "always", prev: controlFlow, next: "*" },
        { blankLine: "always", prev: ["case", "default"], next: "*" },
        {
          blankLine: "any",
          prev: { selector: "SwitchCase[consequent.length=0]" },
          next: "*",
        },
      ],
      "@stylistic/padded-blocks": ["error", "never"],
      "@stylistic/function-call-argument-newline": ["error", "consistent"],
      "@stylistic/function-paren-newline": ["error", "multiline-arguments"],
      "@stylistic/newline-per-chained-call": ["error", { ignoreChainWithDepth: 1 }],
      "@stylistic/keyword-spacing": "error",
      "@stylistic/space-before-blocks": "error",
      "@stylistic/space-infix-ops": "error",
      "@stylistic/comma-spacing": "error",
      "@stylistic/indent": ["error", 2, { SwitchCase: 1 }],
      "@stylistic/no-multiple-empty-lines": ["error", { max: 1, maxBOF: 0, maxEOF: 0 }],
      "@stylistic/no-trailing-spaces": "error",
      "@stylistic/eol-last": ["error", "always"],
    },
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      // Syntax-only parsing avoids coupling style checks to the TypeScript compiler version.
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          babelrc: false,
          configFile: false,
          parserOpts: { plugins: ["typescript"] },
        },
      },
    },
  },
];
