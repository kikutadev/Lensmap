import { z } from "zod";

export const bookSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  fingerprint: z.string().min(1),
  fileName: z.string().min(1),
  pageCount: z.number().int().positive().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Book = z.infer<typeof bookSchema>;
