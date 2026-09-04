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
 * Afkoder et numerisk kodepunkt sikkert og lader teksten stå urørt, hvis
 * værdien ligger uden for det gyldige Unicode-område eller ikke er endelig.
 */
function safeCodePointDecode(codePoint: number, originalText: string): string {
  // Tjek at kodepunktet ligger i det gyldige Unicode-område.
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return originalText;
  }
  return String.fromCodePoint(codePoint);
}
