import { useEffect, useRef, useState } from 'react';
import type { StoredChannel } from '@norstream/app/src/storage/channels.js';
import { RadioView } from '@norstream/app/src/features/player/RadioView.js';
import type { RadioState } from '@norstream/app/src/features/player/RadioView.js';
import { useSaveSong } from '@norstream/app/src/features/radio/useSaveSong.js';
import type { SqlDatabase } from '@norstream/app/src/storage/types.js';
import { current, pause, play, resume, subscribe } from '../modules/radio-auto/index.js';
import type { AutoSnapshot, AutoStation } from '../modules/radio-auto/index.js';

interface Props {
  db: SqlDatabase;
  channel: StoredChannel;
  /** Listen stationen stod i, til forrige og naeste. */
  zap: StoredChannel[];
  onBack: () => void;
}

/** Kanalen som listen gav den, tilbage til det tjenesten skal bruge. */
export function toAutoStationFromChannel(channel: StoredChannel): AutoStation {
  return {
    id: channel.streamId,
    name: channel.name,
    url: channel.streamUrl ?? '',
    logoUrl: channel.logoUrls[0] ?? null,
    logoUrls: [...channel.logoUrls],
    country: '',
  };
}

function describe(snapshot: AutoSnapshot): { state: RadioState; text: string } {
  switch (snapshot.state) {
    case 'playing':
      return { state: 'playing', text: 'Spiller' };
    case 'paused':
      return { state: 'paused', text: 'Pause' };
    case 'error':
      return { state: 'error', text: snapshot.message ?? 'Streamen kunne ikke afspilles' };
    default:
      return { state: 'connecting', text: 'Forbinder …' };
  }
}

/**
 * Radio-afspilleren i NorRadio: samme skaerm som i NorStream, men lyden
 * kommer fra tjenesten bag Android Auto, saa telefon, notifikation, rat
 * og bil styrer den samme afspiller.
 */
export function RadioPlayerScreen({ db, channel: initial, zap, onBack }: Props) {
  const [channel, setChannel] = useState(initial);
  const [snapshot, setSnapshot] = useState<AutoSnapshot>(() => current());
  /**
   * Om tjenesten har bekraeftet den station skaermen bad om.
   *
   * Tjenestens tilstand halter efter et valg: aabnes skaermen paa en ny
   * station mens den gamle spiller, siger tilstanden stadig den gamle.
   * Uden det her tog skaermen det som at bilen havde skiftet, fulgte med
   * og bad om den gamle igen — og den nye station vandt aldrig.
   */
  const acknowledged = useRef(false);

  const choose = (next: StoredChannel): void => {
    acknowledged.current = false;
    setChannel(next);
  };

  useEffect(() => {
    acknowledged.current = false;
    void play(toAutoStationFromChannel(channel));
  }, [channel]);

  useEffect(() => subscribe(setSnapshot), []);

  // Skifter bilen station, foelger skaermen med — men foerst naar tjenesten
  // har naaet den station skaermen selv bad om.
  useEffect(() => {
    if (snapshot.stationId === null) return;
    if (snapshot.stationId === channel.streamId) {
      acknowledged.current = true;
      return;
    }
    if (!acknowledged.current) return;
    const picked = zap.find((entry) => entry.streamId === snapshot.stationId);
    if (picked !== undefined) setChannel(picked);
  }, [snapshot.stationId, channel.streamId, zap]);

  const index = zap.findIndex((entry) => entry.id === channel.id);
  const shown = describe(snapshot);
  // Sangen hoerer til den station der spiller; efter et skift er den gamle sang ikke den nyes.
  const nowPlaying =
    snapshot.stationId === channel.streamId && snapshot.track !== null
      ? { artist: snapshot.artist ?? '', track: snapshot.track, coverUrl: snapshot.coverUrl }
      : null;
  const saveSong = useSaveSong(db, nowPlaying, channel.name);

  return (
    <RadioView
      channel={channel}
      state={shown.state}
      stateText={shown.text}
      nowPlaying={nowPlaying}
      saveSong={saveSong}
      hiddenVideo={null}
      hasPrevious={zap.length > 1 && index !== -1}
      hasNext={zap.length > 1 && index !== -1}
      onBack={onBack}
      onPrevious={() => {
        const target = zap[(index - 1 + zap.length) % zap.length];
        if (target !== undefined) choose(target);
      }}
      onNext={() => {
        const target = zap[(index + 1) % zap.length];
        if (target !== undefined) choose(target);
      }}
      onToggle={() => {
        void (snapshot.state === 'playing' ? pause() : resume());
      }}
    />
  );
}
