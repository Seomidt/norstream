import type { Programme } from '../models.js';
import { decodeXmlEntities } from './entities.js';
import { parseXmltvTimestamp } from './timestamp.js';

const MAX_BUFFER = 4_194_304;
const OPEN_TAG = '<programme';
const CLOSE_TAG = '</programme>';
const CHANNEL_OPEN = '<channel';
const CHANNEL_CLOSE = '</channel>';

/**
 * En kanal som XMLTV-filen beskriver den, foer programmerne.
 *
 * Det er her logoet staar i standarden: `<channel id="DR1.dk"><icon
 * src="…"/><display-name>DR1</display-name></channel>`. En udbyder der
 * leverer en XMLTV-fil, leverer altsaa tit ogsaa logoerne — og de har
 * ingen anden vej ind i appen end den her.
 */
export interface XmltvChannel {
  id: string;
  iconUrl: string | null;
  displayNames: string[];
}

export interface XmltvParser {
  write(chunk: string): void;
  end(): void;
  /** Eksponeret så tests kan bekræfte at hukommelsen er afgrænset. */
  bufferLength(): number;
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  if (match?.[1] === undefined) return null;
  return decodeXmlEntities(match[1]);
}

function childText(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(block);
  if (match?.[1] === undefined) return null;
  const text = decodeXmlEntities(match[1]).trim();
  return text.length > 0 ? text : null;
}

function toChannel(block: string): XmltvChannel | null {
  const openTag = /<channel[^>]*>/.exec(block)?.[0];
  if (!openTag) return null;
  const id = attribute(openTag, 'id');
  if (!id) return null;

  const icon = /<icon[^>]*>/.exec(block)?.[0] ?? null;
  const displayNames: string[] = [];
  const namePattern = /<display-name[^>]*>([\s\S]*?)<\/display-name>/g;
  for (;;) {
    const match = namePattern.exec(block);
    if (match === null) break;
    const name = decodeXmlEntities(match[1] ?? '').trim();
    if (name.length > 0) displayNames.push(name);
  }
  return { id, iconUrl: icon === null ? null : attribute(icon, 'src'), displayNames };
}

function toProgramme(block: string): Programme | null {
  const openTag = /<programme[^>]*>/.exec(block)?.[0];
  if (!openTag) return null;

  const channelId = attribute(openTag, 'channel');
  const startRaw = attribute(openTag, 'start');
  const stopRaw = attribute(openTag, 'stop');
  if (!channelId || !startRaw || !stopRaw) return null;

  const start = parseXmltvTimestamp(startRaw);
  const stop = parseXmltvTimestamp(stopRaw);
  if (!start || !stop) return null;

  const title = childText(block, 'title');
  if (!title) return null;

  return {
    channelId,
    title,
    description: childText(block, 'desc'),
    start,
    stop,
  };
}

/**
 * Streamet XMLTV-parser. Fodres med tekstbidder i vilkårlig størrelse og
 * kalder `onProgramme` for hvert komplet, gyldigt <programme>-element.
 * Ugyldige elementer springes over uden at kaste.
 */
export function createXmltvParser(
  onProgramme: (programme: Programme) => void,
  /** Valgfri: kaldes for hvert `<channel>`-element. Kanalerne staar foerst i filen. */
  onChannel?: (channel: XmltvChannel) => void,
): XmltvParser {
  let buffer = '';

  /**
   * Naeste element af den ene eller anden slags, det der kommer foerst.
   *
   * `<channel` som **element**, ikke som attribut: `<programme channel="…">`
   * indeholder `channel=` men aldrig `<channel` efterfulgt af mellemrum eller
   * `>`. Og et programme-element indeholder aldrig `</channel>`.
   */
  function nextChannelStart(): number {
    if (onChannel === undefined) return -1;
    let from = 0;
    for (;;) {
      const index = buffer.indexOf(CHANNEL_OPEN, from);
      if (index === -1) return -1;
      const after = buffer.charAt(index + CHANNEL_OPEN.length);
      if (after === ' ' || after === '>' || after === '\t' || after === '\n') return index;
      from = index + CHANNEL_OPEN.length;
    }
  }

  function drain(): void {
    for (;;) {
      const channelStart = nextChannelStart();
      const programmeStart = buffer.indexOf(OPEN_TAG);

      if (channelStart !== -1 && (programmeStart === -1 || channelStart < programmeStart)) {
        const channelEnd = buffer.indexOf(CHANNEL_CLOSE, channelStart);
        if (channelEnd === -1) {
          // Ufuldstaendigt endnu — men er der et programme laengere fremme,
          // er kanalen malformet og skal ikke holde alt andet tilbage.
          if (programmeStart === -1) {
            buffer = buffer.slice(channelStart);
            if (buffer.length > MAX_BUFFER) buffer = '';
            return;
          }
          buffer = buffer.slice(programmeStart);
          continue;
        }
        const block = buffer.slice(channelStart, channelEnd + CHANNEL_CLOSE.length);
        buffer = buffer.slice(channelEnd + CHANNEL_CLOSE.length);
        const channel = toChannel(block);
        if (channel && onChannel) onChannel(channel);
        continue;
      }

      const start = programmeStart;
      if (start === -1) {
        // Behold en hale, så et '<programme' delt over to bidder ikke tabes.
        buffer = buffer.slice(Math.max(0, buffer.length - OPEN_TAG.length));
        return;
      }

      const end = buffer.indexOf(CLOSE_TAG, start);
      if (end === -1) {
        buffer = buffer.slice(start);
        if (buffer.length <= MAX_BUFFER) {
          return;
        }
        // Malformet input uden lukketag: kassér alt på nær det sidste
        // mulige elementstart, så hukommelsen forbliver afgrænset. Det
        // sidste elementstart kan selv ligge langt fra bufferens slutning
        // (fx et enkelt kæmpestort tekstbidde), så trimningen kan stadig
        // efterlade bufferen over grænsen — løkken går derfor rundt igen
        // og genanvender grænsen på den trimmede buffer i stedet for at
        // returnere med det samme.
        const lastStart = buffer.lastIndexOf(OPEN_TAG);
        buffer = lastStart > 0 ? buffer.slice(lastStart) : '';
        continue;
      }

      const block = buffer.slice(start, end + CLOSE_TAG.length);
      buffer = buffer.slice(end + CLOSE_TAG.length);

      const programme = toProgramme(block);
      if (programme) onProgramme(programme);
    }
  }

  return {
    write(chunk: string): void {
      buffer += chunk;
      drain();
    },
    end(): void {
      drain();
      buffer = '';
    },
    bufferLength(): number {
      return buffer.length;
    },
  };
}
