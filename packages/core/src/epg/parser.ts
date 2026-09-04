import type { Programme } from '../models.js';
import { decodeXmlEntities } from './entities.js';
import { parseXmltvTimestamp } from './timestamp.js';

const MAX_BUFFER = 1_048_576;
const OPEN_TAG = '<programme';
const CLOSE_TAG = '</programme>';

export interface XmltvParser {
  write(chunk: string): void;
  end(): void;
  /** Eksponeret så tests kan bekræfte at hukommelsen er afgrænset. */
  bufferLength(): number;
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return match?.[1] ?? null;
}

function childText(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(block);
  if (match?.[1] === undefined) return null;
  const text = decodeXmlEntities(match[1]).trim();
  return text.length > 0 ? text : null;
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
): XmltvParser {
  let buffer = '';

  function drain(): void {
    for (;;) {
      const start = buffer.indexOf(OPEN_TAG);
      if (start === -1) {
        // Behold en hale, så et '<programme' delt over to bidder ikke tabes.
        buffer = buffer.slice(Math.max(0, buffer.length - OPEN_TAG.length));
        return;
      }

      const end = buffer.indexOf(CLOSE_TAG, start);
      if (end === -1) {
        buffer = buffer.slice(start);
        if (buffer.length > MAX_BUFFER) {
          // Malformet input uden lukketag: kassér alt på nær det sidste
          // mulige elementstart, så hukommelsen forbliver afgrænset.
          const lastStart = buffer.lastIndexOf(OPEN_TAG);
          buffer = lastStart > 0 ? buffer.slice(lastStart) : '';
        }
        return;
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
