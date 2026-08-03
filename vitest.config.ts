import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Testler uygulama kodunu `@/` alias'ıyla import edebilsin diye.
 * Not: testler DATABASE_URL olmadan çalışır — bu yüzden test edilen modüller
 * prisma'yı import ETMEMELİ. Saf mantık ayrı dosyalarda tutulur
 * (ör. crm/crosscheck-core.ts ↔ crm/weekly-crosscheck.ts).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
