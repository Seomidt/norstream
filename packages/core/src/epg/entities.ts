/**
 * Afkoder XML-entiteter i tekstindhold.
 * `&amp;` afkodes til sidst, så `&amp;lt;` korrekt bliver til `&lt;` og ikke til `<`.
 */
export function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (match: string, hex: string) =>
      safeCodePointDecode(Number.parseInt(hex, 16), match),
    )
    .replace(/&#(\d+);/g, (match: string, dec: string) =>
      safeCodePointDecode(Number.parseInt(dec, 10), match),
    )
    .replace(/&amp;/g, '&');
}

/**
 * Safely decode a numeric code point, leaving the original text untouched if
 * the value is out of range or not finite.
 */
function safeCodePointDecode(codePoint: number, originalText: string): string {
  // Check if the code point is in the valid Unicode range
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return originalText;
  }
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    // If fromCodePoint still throws (should not happen with our guard), return original
    return originalText;
  }
}
