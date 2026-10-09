/**
 * Hvem vi siger vi er, over for de aabne tjenester.
 *
 * Wikimedia (Wikidata, Commons) afviser anonyme og generiske klienter med
 * 403 og beder om en beskrivende User-Agent med en adresse man kan skrive
 * til. Androids indbyggede "okhttp/4.x" er netop saadan en generisk en.
 * Panelet faar ikke denne: dets egen indpakning bestemmer selv.
 */
export const APP_USER_AGENT = 'NorStream/1.0 (Android; +https://github.com/Seomidt/norstream)';
