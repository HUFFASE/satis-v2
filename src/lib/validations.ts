import { z } from "zod";

/**
 * Standard corporate password validation policy schema.
 * Rules:
 * - Minimum 8 characters
 * - At least one lowercase character (a-z)
 * - At least one uppercase character (A-Z)
 * - At least one numerical digit (0-9)
 */
export const passwordSchema = z
  .string()
  .min(8, "Şifre en az 8 karakter uzunluğunda olmalıdır.")
  .regex(/[a-z]/, "Şifre en az bir küçük harf (a-z) içermelidir.")
  .regex(/[A-Z]/, "Şifre en az bir büyük harf (A-Z) içermelidir.")
  .regex(/\d/, "Şifre en az bir rakam (0-9) içermelidir.");
