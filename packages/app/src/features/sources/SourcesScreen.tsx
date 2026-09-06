import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { XtreamAuthError, XtreamClient, detectTimeshiftDialect } from '@norstream/core';
import type { Source, SourceKind, XtreamCredentials } from '@norstream/core';
import type { AppSession } from '../../session.js';
import {
  clearSourceCredentials,
  loadSourceCredentials,
  saveSourceCredentials,
} from '../../storage/credentials.js';
import {
  getTimeshiftDialect,
  setPanelOffsetMinutes,
  setTimeshiftDialect,
} from '../../storage/settings.js';
import {
  addSource,
  deleteSource,
  listSources,
  setSourceEnabled,
} from '../../storage/sources.js';
import { syncChannels } from '../../sync/syncChannels.js';
import { syncM3u } from '../../sync/syncM3u.js';
import { Notice } from '../../ui/Notice.js';
import type { NoticeState } from '../../ui/Notice.js';
import { theme } from '../../ui/theme.js';

interface Props {
  session: AppSession;
  /** Kaldes naar listen af kilder har aendret sig, saa sessionen kan laeses om. */
  onSourcesChanged: () => void;
}

/**
 * Kilderne: paneler og M3U-lister.
 *
 * Alt kommer i **én** liste ude i appen — kanaler fra flere udbydere ligger
 * side om side under land og kategori, og favoritter kan blandes paa tvaers.
 * Her er det eneste sted man ser hvor de kommer fra, og det eneste sted man
 * kan slaa en fra uden at miste det man har bygget op omkring den.
 */
export function SourcesScreen({ session, onSourcesChanged }: Props) {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<SourceKind | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  /** Har kilden fundet vejen til udbyderens arkiv? Slaaet op paa kilde-id. */
  const [archive, setArchive] = useState<Record<string, boolean>>({});
  const [probing, setProbing] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    const rows = await listSources(session.db);
    setSources(rows);
    // Arkivets tilstand per kilde. Uden den kan man ikke se hvorfor
    // start-forfra ikke virker paa netop den ene udbyder.
    const status: Record<string, boolean> = {};
    for (const row of rows) {
      status[row.id] = (await getTimeshiftDialect(session.db, row.id)) !== null;
    }
    setArchive(status);
  }, [session.db]);

  useEffect(() => {
    void (async () => {
      try {
        await reload();
      } finally {
        setLoading(false);
      }
    })();
  }, [reload]);

  async function toggle(source: Source, enabled: boolean): Promise<void> {
    await setSourceEnabled(session.db, source.id, enabled);
    await reload();
    onSourcesChanged();
  }

  /**
   * Leder efter udbyderens arkiv igen.
   *
   * Probingen koerte kun da kilden blev tilfoejet. Svarede panelet ikke den
   * dag, var start-forfra vaek for altid — og der var ingen knap der kunne
   * aendre det uden at fjerne kilden og laegge den ind igen.
   */
  async function reprobe(source: Source): Promise<void> {
    setProbing(source.id);
    try {
      const creds = await loadSourceCredentials(source.id);
      if (creds === null) {
        setNotice({ text: 'Adgangsoplysningerne til denne kilde mangler på enheden.' });
        return;
      }
      await probeArchive(session, source.id, creds);
      await reload();
      const found = (await getTimeshiftDialect(session.db, source.id)) !== null;
      setNotice({
        text: found
          ? `Arkivet blev fundet for “${source.name}”. Start forfra virker nu.`
          : `“${source.name}” svarede ikke på arkiv-testen. Udbyderen har måske ikke arkiv.`,
      });
    } finally {
      setProbing(null);
    }
  }

  async function remove(source: Source): Promise<void> {
    await clearSourceCredentials(source.id);
    await deleteSource(session.db, source.id);
    setConfirmDelete(null);
    await reload();
    onSourcesChanged();
    setNotice({ text: `“${source.name}” er fjernet med alt hvad den havde.` });
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  if (adding !== null) {
    return (
      <AddSource
        kind={adding}
        session={session}
        onCancel={() => setAdding(null)}
        onAdded={(name) => {
          setAdding(null);
          void reload();
          onSourcesChanged();
          setNotice({ text: `“${name}” er tilføjet. Kanalerne hentes nu.` });
        }}
      />
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      <Text style={styles.hint}>
        Kanaler fra alle kilder står side om side under land og kategori.
        Favoritter kan blandes på tværs.
      </Text>

      {sources.length === 0 && (
        <Text style={styles.empty}>Ingen kilder endnu.</Text>
      )}

      {sources.map((source) => (
        <View key={source.id} style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {source.name}
            </Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {source.kind === 'xtream' ? 'Panel' : 'M3U-liste'} · {hostOf(source.url)}
            </Text>
            {source.kind === 'xtream' && (
              <View style={styles.archiveLine}>
                <Text style={archive[source.id] === true ? styles.rowOk : styles.rowWarn}>
                  {archive[source.id] === true
                    ? 'Arkiv fundet — start forfra og optagelse virker'
                    : 'Arkiv ikke fundet — start forfra og optagelse er slået fra'}
                </Text>
                {archive[source.id] !== true && (
                  <Pressable
                    hitSlop={8}
                    disabled={probing === source.id}
                    onPress={() => {
                      void reprobe(source);
                    }}
                  >
                    {probing === source.id ? (
                      <ActivityIndicator color={theme.colors.accent} />
                    ) : (
                      <Text style={styles.action}>Prøv igen</Text>
                    )}
                  </Pressable>
                )}
              </View>
            )}
            {source.kind === 'm3u' && source.xmltvUrl === null && (
              <Text style={styles.rowWarn}>
                Uden en XMLTV-adresse har listen ingen programoversigt.
              </Text>
            )}
            {confirmDelete === source.id ? (
              <View style={styles.confirm}>
                <Text style={styles.rowWarn}>
                  Fjerner også favoritter og optagelser fra denne kilde.
                </Text>
                <View style={styles.confirmRow}>
                  <Pressable hitSlop={8} onPress={() => setConfirmDelete(null)}>
                    <Text style={styles.action}>Annullér</Text>
                  </Pressable>
                  <Pressable
                    hitSlop={8}
                    onPress={() => {
                      void remove(source);
                    }}
                  >
                    <Text style={styles.danger}>Fjern alligevel</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable hitSlop={8} onPress={() => setConfirmDelete(source.id)}>
                <Text style={styles.danger}>Fjern</Text>
              </Pressable>
            )}
          </View>
          <Switch
            value={source.enabled}
            onValueChange={(value) => {
              void toggle(source, value);
            }}
            trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
          />
        </View>
      ))}

      <Pressable style={styles.button} onPress={() => setAdding('xtream')}>
        <Text style={styles.buttonText}>Tilføj panel</Text>
      </Pressable>
      <Pressable style={styles.button} onPress={() => setAdding('m3u')}>
        <Text style={styles.buttonText}>Tilføj M3U-liste</Text>
      </Pressable>
    </ScrollView>
  );
}

/** Formularen til én ny kilde. */
function AddSource({
  kind,
  session,
  onCancel,
  onAdded,
}: {
  kind: SourceKind;
  session: AppSession;
  onCancel: () => void;
  onAdded: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [xmltvUrl, setXmltvUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isXtream = kind === 'xtream';
  const canSubmit =
    url.trim().length > 0 &&
    (!isXtream || (username.trim().length > 0 && password.length > 0));

  /**
   * Kilden proeves foer den gemmes.
   *
   * En kilde der ikke svarer, ser i listen ud som en kilde uden kanaler, og
   * den forskel er ikke til at se fra den anden side af en telefon. Bedre at
   * sige det her, hvor adressen stadig staar i feltet og kan rettes.
   */
  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const trimmedUrl = url.trim();
      const label = name.trim().length > 0 ? name.trim() : hostOf(trimmedUrl);

      if (isXtream) {
        const creds: XtreamCredentials = {
          baseUrl: trimmedUrl,
          username: username.trim(),
          password,
        };
        try {
          await new XtreamClient(creds, session.fetchImpl).authenticate();
        } catch (cause) {
          setError(
            cause instanceof XtreamAuthError
              ? 'Brugernavn eller adgangskode blev afvist af panelet.'
              : 'Kunne ikke nå panelet. Tjek adressen og din forbindelse.',
          );
          return;
        }

        const source = await addSource(session.db, {
          kind: 'xtream',
          name: label,
          url: trimmedUrl,
          username: creds.username,
        });
        await saveSourceCredentials(source.id, creds);

        // Kanalerne hentes her, ikke af skaermen bagefter: sessionen kender
        // endnu ikke den nye kilde, saa en synkronisering udefra ville springe
        // netop den over — og kilden ville staa tom til naeste opstart.
        try {
          await syncChannels(session.db, source.id, creds, session.fetchImpl);
        } catch {
          // Panelet svarede paa login og ikke paa kanallisten. Kilden bliver
          // staaende; naeste opdatering forsoeger igen.
        }
        await probeArchive(session, source.id, creds);
        onAdded(label);
        return;
      }

      // M3U: listen hentes med det samme, saa en forkert adresse opdages nu.
      const source = await addSource(session.db, {
        kind: 'm3u',
        name: label,
        url: trimmedUrl,
        xmltvUrl: xmltvUrl.trim().length > 0 ? xmltvUrl.trim() : null,
      });
      try {
        const result = await syncM3u(session.db, source, session.fetchImpl);
        if (result.channels === 0) {
          await deleteSource(session.db, source.id);
          setError('Listen kunne hentes, men indeholdt ingen kanaler.');
          return;
        }
      } catch {
        await deleteSource(session.db, source.id);
        setError('Kunne ikke hente listen. Tjek adressen og din forbindelse.');
        return;
      }
      onAdded(label);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>
        {isXtream ? 'Tilføj panel' : 'Tilføj M3U-liste'}
      </Text>

      <Field label="Navn (valgfrit)" value={name} onChange={setName} placeholder="Hovedpanel" />
      <Field
        label={isXtream ? 'Panelets adresse' : 'Adressen på listen'}
        value={url}
        onChange={setUrl}
        placeholder={isXtream ? 'http://panel.example:8080' : 'http://.../liste.m3u'}
        keyboardType="url"
      />

      {isXtream ? (
        <>
          <Field label="Brugernavn" value={username} onChange={setUsername} />
          <Field label="Adgangskode" value={password} onChange={setPassword} secure />
        </>
      ) : (
        <>
          <Field
            label="XMLTV-adresse (valgfrit)"
            value={xmltvUrl}
            onChange={setXmltvUrl}
            placeholder="http://.../epg.xml"
            keyboardType="url"
          />
          <Text style={styles.hint}>
            En M3U-liste rummer ingen programoversigt. Uden en XMLTV-adresse
            står guiden tom for kanalerne herfra.
          </Text>
        </>
      )}

      {error !== null && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actions}>
        <Pressable style={styles.buttonQuiet} onPress={onCancel} disabled={busy}>
          <Text style={styles.buttonText}>Annullér</Text>
        </Pressable>
        <Pressable
          style={[styles.button, (!canSubmit || busy) && styles.buttonDisabled]}
          disabled={!canSubmit || busy}
          onPress={() => {
            void submit();
          }}
        >
          {busy ? (
            <ActivityIndicator color={theme.colors.text} />
          ) : (
            <Text style={styles.buttonText}>Tilføj</Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

/**
 * Finder panelets tidszone og timeshift-dialekt for den nye kilde.
 *
 * Maa ikke kunne blokere tilfoejelsen: uden arkiv virker alt andet stadig, og
 * kun start-forfra er utilgaengeligt. Afspilleren kan probe igen bagefter.
 */
async function probeArchive(
  session: AppSession,
  sourceId: string,
  creds: XtreamCredentials,
): Promise<void> {
  try {
    const client = new XtreamClient(creds, session.fetchImpl);
    const offset = await client.getPanelOffsetMinutes();
    if (offset !== null) await setPanelOffsetMinutes(session.db, offset, sourceId);

    const streams = await client.getLiveStreams();
    const withArchive = streams.find((stream) => stream.hasArchive);
    if (withArchive === undefined) return;

    const dialect = await detectTimeshiftDialect(
      creds,
      withArchive.id,
      session.fetchImpl,
      new Date(),
      offset ?? 0,
    );
    await setTimeshiftDialect(session.db, dialect, sourceId);
  } catch {
    // Med vilje: se kommentaren ovenfor.
  }
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  secure,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  secure?: boolean;
  keyboardType?: 'url';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secure === true}
        keyboardType={keyboardType === 'url' ? 'url' : 'default'}
      />
    </View>
  );
}

function hostOf(url: string): string {
  const match = /^[a-z]+:\/\/([^/:]+)/i.exec(url.trim());
  return match?.[1] ?? url.trim();
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.md, paddingBottom: theme.spacing.xl },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: theme.spacing.md,
  },
  hint: {
    color: theme.colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: theme.spacing.md,
  },
  empty: { color: theme.colors.textMuted, fontSize: 14, marginBottom: theme.spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: theme.spacing.sm,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, paddingRight: theme.spacing.sm },
  rowTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  rowMeta: { color: theme.colors.textMuted, fontSize: 13, marginTop: 2 },
  rowWarn: { color: theme.colors.danger, fontSize: 12, marginTop: 4, lineHeight: 16 },
  rowOk: { color: theme.colors.textMuted, fontSize: 12, marginTop: 4, lineHeight: 16 },
  archiveLine: { marginTop: 2 },
  confirm: { marginTop: theme.spacing.xs },
  confirmRow: { flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.xs },
  action: { color: theme.colors.accent, fontSize: 14, fontWeight: '600' },
  danger: { color: theme.colors.danger, fontSize: 14, fontWeight: '600', marginTop: 4 },
  field: { marginBottom: theme.spacing.md },
  fieldLabel: { color: theme.colors.textMuted, fontSize: 13, marginBottom: theme.spacing.xs },
  input: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    color: theme.colors.text,
    fontSize: 15,
  },
  error: { color: theme.colors.danger, fontSize: 14, marginBottom: theme.spacing.md },
  actions: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  button: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    alignItems: 'center',
    marginTop: theme.spacing.md,
    minWidth: 120,
  },
  buttonQuiet: {
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    alignItems: 'center',
    marginTop: theme.spacing.md,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
});
