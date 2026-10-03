import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { VideoPlayer } from 'expo-video';
import { isTV } from '../../ui/tv.js';
import { cueAt } from './openSubtitles.js';
import type { Cue } from './openSubtitles.js';

/**
 * Undertekster hentet udefra (OpenSubtitles, v338), tegnet af appen selv
 * oven paa videoen: afspilleren kan ikke tage en undertekstfil udefra.
 *
 * Afspilleren melder tiden hvert kvarte sekund mens underteksterne vises
 * (ellers hvert sekund), og teksten skiftes kun naar replikken skifter.
 * Hvid tekst paa en halvgennemsigtig sort bjaelke — laesbar paa lyse og
 * moerke billeder; stoerre paa tv.
 */
export function SubtitleOverlay({ player, cues, bottom }: { player: VideoPlayer; cues: readonly Cue[]; bottom?: number }) {
  const [text, setText] = useState<string | null>(null);
  const last = useRef<string | null>(null);

  useEffect(() => {
    let previous = 1;
    try {
      previous = player.timeUpdateEventInterval;
      player.timeUpdateEventInterval = 0.25;
    } catch {
      // Afspilleren er vaek.
    }
    const show = (t: number): void => {
      const next = cueAt(cues, t);
      if (next !== last.current) {
        last.current = next;
        setText(next);
      }
    };
    try {
      show(player.currentTime);
    } catch {
      // Endnu ikke klar.
    }
    const subscription = player.addListener('timeUpdate', ({ currentTime }: { currentTime: number }) => {
      if (Number.isFinite(currentTime)) show(currentTime);
    });
    return () => {
      subscription.remove();
      try {
        player.timeUpdateEventInterval = previous;
      } catch {
        // Afspilleren er allerede frigivet.
      }
    };
  }, [player, cues]);

  if (text === null) return null;
  return (
    <View style={[styles.host, bottom !== undefined && { bottom }]} pointerEvents="none">
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: '8%',
    right: '8%',
    bottom: isTV ? 48 : 24,
    alignItems: 'center',
  },
  text: {
    color: '#FFFFFF',
    fontSize: isTV ? 30 : 17,
    lineHeight: isTV ? 40 : 23,
    fontWeight: '600',
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
});
