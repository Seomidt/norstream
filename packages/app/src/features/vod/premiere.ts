const MONTHS = ['jan.', 'feb.', 'mar.', 'apr.', 'maj', 'juni', 'juli', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.'];

/** "12. sep." af ÅÅÅÅ-MM-DD; tom naar datoen mangler. */
export function premiereLabel(releaseDate: string | null | undefined): string {
  if (releaseDate === null || releaseDate === undefined) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(releaseDate);
  if (match === null) return '';
  const month = MONTHS[Number(match[2]) - 1];
  return month === undefined ? '' : `${Number(match[3])}. ${month}`;
}
