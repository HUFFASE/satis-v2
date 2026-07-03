import { z } from "zod";

export const periodQuerySchema = z.object({
  fiscalYear: z.coerce.number().int().min(2000).max(2100),
  quarter: z.coerce.number().int().min(1).max(4),
});

export const optionalYearQuartersQuerySchema = z.object({
  fiscalYear: z.coerce.number().int().min(2000).max(2100).optional(),
  quarters: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((part) => Number(part.trim()))
            .filter((quarter) => Number.isInteger(quarter))
        : undefined
    ),
});

export function getQueryObject(request: Request) {
  const url = new URL(request.url);
  return Object.fromEntries(url.searchParams.entries());
}
