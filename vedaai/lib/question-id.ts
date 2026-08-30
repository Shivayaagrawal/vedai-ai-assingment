function slugifyPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function questionIdFromParts(
  section: string | undefined,
  displayNumber: string,
  subPart: string | undefined,
): string {
  const slug = [section, displayNumber, subPart]
    .filter((part): part is string => Boolean(part && part.trim()))
    .map(slugifyPart)
    .filter(Boolean)
    .join("-");
  return slug || slugifyPart(displayNumber) || "question";
}
