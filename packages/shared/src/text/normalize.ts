/** Normalize PDF-extracted text for AI context and lexical search while preserving displayed raw text separately. */
export function normalizePdfText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/([\p{L}\p{N}])-\s*\r?\n\s*([\p{L}\p{N}])/gu, "$1$2")
    .replace(/\s+/gu, " ")
    .trim();
}
