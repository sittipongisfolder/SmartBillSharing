import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // ✅ อย่า lint rule นี้กับไฟล์ next-env.d.ts (Next สร้างมาให้เอง)
  {
    files: ["next-env.d.ts"],
    rules: {
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },

  // (ถ้าในอนาคตโดนพวก .next/types ด้วย) เปิดอันนี้ได้
  // {
  //   files: [".next/types/**/*.d.ts"],
  //   rules: {
  //     "@typescript-eslint/triple-slash-reference": "off",
  //   },
  // },
];

export default eslintConfig;