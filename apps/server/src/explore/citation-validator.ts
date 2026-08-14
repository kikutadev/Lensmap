const SOURCE_REFERENCE = /\[(S\d+)\]/g;

/** Return citation labels that appear in an answer but were not attached to that message. */
export function findInvalidCitationLabels(content: string, validLabels: Iterable<string>): string[] {
  const allowed = new Set(validLabels);
  const found = Array.from(content.matchAll(SOURCE_REFERENCE))
    .flatMap((match) => match[1] ? [match[1]] : []);
  return [...new Set(found.filter((label) => !allowed.has(label)))];
}
