import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { isTV } from '../../ui/tv.js';
import { VideoView, useVideoPlayer } from 'expo-video';
import { buildLiveUrl } from '@norstream/core';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';
import { theme } from '../../ui/theme.js';
import { useStyles } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { liveUrlFor } from '../../sources/access.js';
import { streamSource } from '../../net/doh.js';
import { formatForPlatform } from '../player/format.js';
import { TvPressable } from '../../ui/TvPressable.js';

/**
 * Giver forælderen mulighed for at frigive streamen og vente paa det.
 *
 * Panelet tillader **én** samtidig forbindelse. Aabnes den rigtige afspiller
 * mens previewet stadig holder sin, afviser panelet den stream brugeren
 * faktisk bad om — og en fungerende afspilning bliver til en fejl, forvoldt af
 * en bekvemmelighedsfunktion. Derfor frigives previewet foer navigation, og
 * kalderen venter paa at det er sket.
 */
export interface PreviewHandle {
  release: () => Promise<void>;
}

interface Props {
  session: AppSession;
  /** Kanalen brugeren staar paa lige nu, eller null for ingen. */
  channel: StoredChannel | null;
  enabled: boolean;
  onOpen: (channel: StoredChannel) => void;
  /** Udfyldes med previewets frigivelsesfunktion. */
  handle: { current: PreviewHandle | null };
}

/**
 * Hvor laenge listen skal staa stille foer previewet skifter kanal. Uden
 * forsinkelsen ville en hurtig scroll aabne snesevis af streams paa et panel
 * der kun tillader én.
 */
const IDLE_MS = 800;

/** Ét genforsoeg, kort efter. Er panelet stadig optaget, giver vi op og siger det. */
const RETRY_MS = 1200;

/**
 * Frigivelse maa aldrig kaste videre.
 *
 * `replaceAsync` afviser hvis afspilleren allerede er frigivet — hvilket sker
 * praecis naar komponenten afmonteres, altsaa hver gang brugeren forlader
 * skaermen. En uhaandteret rejection derfra ville vaere en redbox i udvikling
 * og et stille tab af det tryk brugeren lige lavede i produktion.
 */
function releaseQuietly(release: () => Promise<void>): Promise<void> {
  return release().catch(() => undefined);
}

const BUSY_MESSAGE =
  'Panelet har kun én forbindelse ad gangen, og den er optaget. ' +
  'Tryk på kanalen for at se den, eller slå forhåndsvisning fra i indstillinger.';

export function MiniPreview({ session, channel, enabled, onOpen, handle }: Props) {
  const styles = useStyles(makeStyles);
  // Kanalen previewet faktisk viser. Foelger `channel` efter IDLE_MS.
  const [target, setTarget] = useState<StoredChannel | null>(null);
  // Lyd fra som standard paa telefonen (spec sec. 7), til paa tv: der er
  // previewet det man sidder og kigger paa, og lydknappen er svaer at naa.
  const [muted, setMuted] = useState(!isTV);
  const [error, setError] = useState<string | null>(null);

  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
    // Spec sec.7: lyd fra som standard. Et preview der buldrer los mens man
    // ruller gennem 22.142 kanaler er ikke en funktion.
    p.muted = !isTV;
  });

  // Skifter previewet foerst naar listen har staaet stille. Slaas det fra,
  // slippes maalet med det samme frem for efter 800 ms.
  useEffect(() => {
    if (!enabled) {
      setTarget(null);
      return;
    }
    const timer = setTimeout(() => setTarget(channel), IDLE_MS);
    return () => clearTimeout(timer);
  }, [channel, enabled]);

  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);

  // Frigivelsen deles med foraelderen, saa navigation til afspilleren kan
  // vente paa at forbindelsen er lukket ned.
  useEffect(() => {
    handle.current = {
      release: async () => {
        setTarget(null);
        await releaseQuietly(() => player.replaceAsync(null));
      },
    };
    return () => {
      handle.current = null;
    };
  }, [handle, player]);

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    async function open(): Promise<void> {
      // Sekventiel nedlukning: den forrige stream lukkes helt, og vi venter
      // paa det, foer den naeste aabnes. Aldrig to i luften.
      await player.replaceAsync(null);
      if (cancelled || target === null) return;

      const url = liveUrlFor(session.access(target.sourceId), target, formatForPlatform());
      // Uden adresse er der intet at vise. Et forsoeg paa at aabne null ville
      // efterlade et sort felt der ligner en stream der ikke ville starte.
      if (url === null) return;
      await player.replaceAsync(streamSource(url));
      if (cancelled) return;
      player.muted = muted;
      player.play();
    }

    /**
     * Faelles vej for begge maader en afvist forbindelse kan naa os paa.
     *
     * `replaceAsync` afviser ikke altid — paa en stream panelet naegter,
     * kommer beskeden typisk som en `error`-status et oejeblik senere.
     * Fanges kun det foerste, fejler previewet **stille**, og spec sec.7's
     * krav om en forstaaelig besked er ikke opfyldt.
     */
    function handleFailure(): void {
      if (cancelled) return;
      attempt += 1;
      if (attempt === 1) {
        if (retryTimer !== null) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          if (cancelled) return;
          void open().catch(handleFailure);
        }, RETRY_MS);
        return;
      }
      // Aldrig den raa fejl: stream-URLen har panelets adgangskode som et
      // sti-segment, og ExoPlayer skriver rutinemaessigt URIen ind i teksten.
      setError(BUSY_MESSAGE);
    }

    const subscription = player.addListener(
      'statusChange',
      ({ status }: { status: string }) => {
        if (cancelled) return;
        if (status === 'error') handleFailure();
        if (status === 'readyToPlay') {
          attempt = 0;
          setError(null);
        }
      },
    );

    setError(null);
    void open().catch(handleFailure);

    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      subscription.remove();
      void releaseQuietly(() => player.replaceAsync(null));
    };
    // `muted` staar med vilje ikke i afhaengighederne: den saettes af sin egen
    // effekt ovenfor, og et tryk paa lydknappen maa ikke starte streamen
    // forfra — det ville koste en nedlukning og en genaabning paa et panel
    // der kun har én forbindelse.
  }, [player, target, session]);

  if (!enabled) return null;

  return (
    <View style={styles.container}>
      {/* Paa tv kan previewet ikke faa fokus: det foelger den raekke man
          staar paa, og fjernbetjeningen skal blive i listen. */}
      <TvPressable
        style={styles.frame}
        focusable={!isTV}
        onPress={() => {
          if (target !== null) onOpen(target);
        }}
      >
        {/* TextureView, ikke SurfaceView: en SurfaceView er sin egen
            hardwareflade og kan lægge sig oven på afspillerens, også naar
            den ligger under i traeet. Stoppet og uden billede er den groen:
            "groen skaerm med lyd" naar en udsendelse blev startet forfra
            fra guiden paa tv. */}
        <VideoView style={styles.video} player={player} nativeControls={false} surfaceType="textureView" />
        {error !== null && (
          <View style={styles.overlay}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
        {error === null && target === null && (
          <View style={styles.overlay}>
            <Text style={styles.placeholder}>Forhåndsvisning</Text>
          </View>
        )}
      </TvPressable>

      <View style={styles.bar}>
        <Text style={styles.title} numberOfLines={1}>
          {target?.name ?? ''}
        </Text>
        <TvPressable hitSlop={12} focusable={!isTV} onPress={() => setMuted((value) => !value)}>
          <Text style={styles.sound}>{muted ? '🔇' : '🔊'}</Text>
        </TvPressable>
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { backgroundColor: '#000000' },
  frame: { width: '100%', aspectRatio: 16 / 9 },
  video: { width: '100%', height: '100%', backgroundColor: '#000000' },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.md,
  },
  errorText: { color: colors.text, fontSize: 13, textAlign: 'center' },
  placeholder: { color: colors.textMuted, fontSize: 13 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    backgroundColor: colors.surface,
  },
  title: { flex: 1, color: colors.text, fontSize: 13 },
  sound: { fontSize: 18 },
});
