/**
 * En minimal CSV-laeser til de aabne registre.
 *
 * Findes fordi felterne **er** citerede og indeholder kommaer: en kanals
 * `alt_names` er fx `"DR1, DR Et"`. En split paa komma ville rive den raekke
 * midt over og forskyde hver eneste kolonne efter den — stille, og paa en
 * maade der ligner data der bare er lidt underlige.
 *
 * Ingen afhaengighed for det: filerne er velformede, og en laeser der klarer
 * citater, dobbelte citater og linjeskift inde i felter er tredive linjer.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let started = false;

  const endField = (): void => {
    row.push(field);
    field = '';
    started = true;
  };
  const endRow = (): void => {
    endField();
    // Tomme linjer — og den sidste linjes afsluttende linjeskift — maa ikke
    // blive til raekker med ét tomt felt.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') quoted = true;
    else if (char === ',') endField();
    else if (char === '\n') endRow();
    else if (char !== '\r') field += char;
  }

  if (field !== '' || started || row.length > 0) endRow();
  return rows;
}

/**
 * Raekkerne som opslag paa kolonnenavn, med foerste linje som overskrift.
 * Raekker med et andet antal felter end overskriften springes over: de kan
 * kun komme af beskadigede data, og en forskudt raekke er vaerre end ingen.
 */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  const header = rows[0];
  if (header === undefined) return [];

  const records: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row === undefined || row.length !== header.length) continue;
    const record: Record<string, string> = {};
    for (let c = 0; c < header.length; c += 1) {
      const key = header[c];
      if (key !== undefined) record[key] = row[c] ?? '';
    }
    records.push(record);
  }
  return records;
}
