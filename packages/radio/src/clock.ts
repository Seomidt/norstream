/** "7.30", "07:30", "0730" → timer og minutter; null naar det ikke er et klokkeslaet. */
export function parseClock(text: string): { hour: number; minute: number } | null {
  const digits = text.replace(/[^0-9]/g, '');
  if (digits.length < 3 || digits.length > 4) return null;
  const hour = Number.parseInt(digits.slice(0, digits.length - 2), 10);
  const minute = Number.parseInt(digits.slice(-2), 10);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}
