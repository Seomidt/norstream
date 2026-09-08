import type { SqlDatabase } from './types.js';

/**
 * Koerer `work` inde i een SQLite-transaktion.
 *
 * Uden det er hver eneste `runAsync` sin egen transaktion, og SQLite
 * synkroniserer til disken efter hver af dem. Panelet her har 22.142 kanaler,
 * saa en synkronisering blev til 22.142 diskskrivninger. Maalt paa en fil-
 * database: 26.184 ms uden, 63 ms med (se rettelsens beskrivelse).
 *
 * Transaktionen giver ogsaa atomaritet: bliver appen dræbt midt i en
 * kanalsynkronisering, ruller SQLite tilbage i stedet for at efterlade en
 * halv kanalliste hvor alt stadig er markeret `is_stale = 1`.
 *
 * **Maa ikke nestes.** SQLite afviser `BEGIN` inde i en transaktion med
 * "cannot start a transaction within a transaction". Kald den derfor kun fra
 * de yderste skrivefunktioner i storage-laget, aldrig fra sync-laget ovenpaa.
 *
 * Bemaerk at transaktionen ikke er eksklusiv — praecis som expo-sqlites egen
 * `withTransactionAsync`, der er implementeret paa noejagtig samme maade.
 * En samtidig skrivning fra UI'et (f.eks. en favorit der slaas til) kan naa at
 * lande inde i transaktionen og ville i saa fald blive rullet tilbage sammen
 * med den. I praksis er begge appens skrivninger korte og brugerudloeste;
 * skulle det blive et problem, er svaret expo-sqlites
 * `withExclusiveTransactionAsync` paa en separat forbindelse.
 */
export async function withTransaction(
  db: SqlDatabase,
  work: () => Promise<void>,
): Promise<void> {
  await db.execAsync('BEGIN');
  try {
    await work();
    // COMMIT skal ligge inde i try'en: fejler den, er transaktionen stadig
    // aaben, og saa skal den rulles tilbage som enhver anden fejl.
    await db.execAsync('COMMIT');
  } catch (cause) {
    // ROLLBACK kaster selv med "cannot rollback - no transaction is active",
    // hvis transaktionen allerede er faldet fra hinanden. Den fejl maa ikke
    // erstatte den rigtige aarsag — saa ville et opslag i loggen pege paa
    // rollbacken i stedet for paa den kanal der faktisk fejlede.
    try {
      await db.execAsync('ROLLBACK');
    } catch {
      // Med vilje tavs: `cause` nedenfor er den fejl der betyder noget.
    }
    throw cause;
  }
}
