/**
 * Fjerner brugernavn og adgangskode af en adresse foer den vises.
 *
 * Logo-adresser peger normalt paa et billede uden legitimation i sig, men
 * nogle paneler serverer dem fra den samme sti som streams. En diagnostik der
 * kan komme til at staa paa et skaermbillede maa ikke vaere det sted panelets
 * adgangskode slipper ud.
 *
 * Eget modul frem for en hjaelper i skaermen, saa den kan testes: alt der
 * importerer react-native kan ikke koeres af testene her.
 */
export function redactCredentials(url: string): string {
  return url
    .replace(/(\/\/)[^/@]+@/, '$1***@')
    .replace(/([?&](?:username|password|user|pass)=)[^&]*/gi, '$1***');
}
