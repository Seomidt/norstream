import { useEffect, useState } from 'react';
import type { StoredChannel } from '@norstream/app/src/storage/channels.js';
import { RadioView } from '@norstream/app/src/features/player/RadioView.js';
import type { RadioState } from '@norstream/app/src/features/player/RadioView.js';
import { current, pause, play, resume, subscribe } from '../modules/radio-auto/index.js';
import type { AutoSnapshot, AutoStation } from '../modules/radio-auto/index.js';

interface Props {
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
export function RadioPlayerScreen({ channel: initial, zap, onBack }: Props) {
  const [channel, setChannel] = useState(initial);
  const [snapshot, setSnapshot] = useState<AutoSnapshot>(() => current());

  useEffect(() => {
    void play(toAutoStationFromChannel(channel));
  }, [channel]);

  useEffect(() => subscribe(setSnapshot), []);

  // Skifter bilen station, foelger skaermen med.
  useEffect(() => {
    if (snapshot.stationId === null || snapshot.stationId === channel.streamId) return;
    const picked = zap.find((entry) => entry.streamId === snapshot.stationId);
    if (picked !== undefined) setChannel(picked);
  }, [snapshot.stationId, channel.streamId, zap]);

  const index = zap.findIndex((entry) => entry.id === channel.id);
  const shown = describe(snapshot);

  return (
    <RadioView
      channel={channel}
      state={shown.state}
      stateText={shown.text}
      hiddenVideo={null}
      hasPrevious={zap.length > 1 && index !== -1}
      hasNext={zap.length > 1 && index !== -1}
      onBack={onBack}
      onPrevious={() => {
        const target = zap[(index - 1 + zap.length) % zap.length];
        if (target !== undefined) setChannel(target);
      }}
      onNext={() => {
        const target = zap[(index + 1) % zap.length];
        if (target !== undefined) setChannel(target);
      }}
      onToggle={() => {
        void (snapshot.state === 'playing' ? pause() : resume());
      }}
    />
  );
}
