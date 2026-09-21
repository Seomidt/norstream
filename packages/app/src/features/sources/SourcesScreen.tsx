import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Source, SourceKind } from '@norstream/core';
import type { AppSession } from '../../session.js';
import {
  clearSourceCredentials,
  loadSourceCredentials,
} from '../../storage/credentials.js';
import { getTimeshiftDialect } from '../../storage/settings.js';
import { deleteSource, listSources, setSourceEnabled } from '../../storage/sources.js';
// Tilfoejelsen ligger i `sources/connect` og ikke her, saa den her skaerm og
// foerste-start-skaermen ikke kan komme til at goere det forskelligt. Foer laa
// den to steder, og kun det ene sted hentede kanalerne med det samme.
import { connectM3u, connectXtream, editM3u, editXtream, hostOf, probeArchive } from '../../sources/connect.js';
import { Notice } from '../../ui/Notice.js';
import type { NoticeState } from '../../ui/Notice.js';
import { theme } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { TvPressable } from '../../ui/TvPressable.js';

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
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<SourceKind | null>(null);
  /** Panelet der redigeres, med dets nuvaerende kodeord forudfyldt. */
  const [editing, setEditing] = useState<{ source: Source; password: string } | null>(null);
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
      await probeArchive(session.db, session.fetchImpl, source.id, creds);
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

  /** Aabner redigeringsformularen med kildens nuvaerende kodeord hentet frem. */
  async function startEdit(source: Source): Promise<void> {
    const creds = await loadSourceCredentials(source.id);
    setEditing({ source, password: creds?.password ?? '' });
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
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (adding !== null) {
    return (
      <SourceForm
        kind={adding}
        session={session}
        onCancel={() => setAdding(null)}
        onSaved={(name) => {
          setAdding(null);
          void reload();
          onSourcesChanged();
          setNotice({ text: `“${name}” er tilføjet. Kanalerne hentes nu.` });
        }}
      />
    );
  }

  if (editing !== null) {
    return (
      <SourceForm
        kind={editing.source.kind}
        session={session}
        source={editing.source}
        initialPassword={editing.password}
        onCancel={() => setEditing(null)}
        onSaved={(name) => {
          setEditing(null);
          void reload();
          onSourcesChanged();
          setNotice({ text: `“${name}” er gemt. Kanalerne hentes forfra fra den nye server.` });
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
                  <TvPressable
                    hitSlop={8}
                    disabled={probing === source.id}
                    onPress={() => {
                      void reprobe(source);
                    }}
                  >
                    {probing === source.id ? (
                      <ActivityIndicator color={colors.accent} />
                    ) : (
                      <Text style={styles.action}>Prøv igen</Text>
                    )}
                  </TvPressable>
                )}
              </View>
            )}
            {confirmDelete === source.id ? (
              <View style={styles.confirm}>
                <Text style={styles.rowWarn}>
                  Fjerner også favoritter og optagelser fra denne kilde.
                </Text>
                <View style={styles.confirmRow}>
                  <TvPressable hitSlop={8} onPress={() => setConfirmDelete(null)}>
                    <Text style={styles.action}>Annullér</Text>
                  </TvPressable>
                  <TvPressable
                    hitSlop={8}
                    onPress={() => {
                      void remove(source);
                    }}
                  >
                    <Text style={styles.danger}>Fjern alligevel</Text>
                  </TvPressable>
                </View>
              </View>
            ) : (
              <View style={styles.rowActions}>
                <TvPressable hitSlop={8} onPress={() => void startEdit(source)}>
                  <Text style={styles.action}>Redigér</Text>
                </TvPressable>
                <TvPressable hitSlop={8} onPress={() => setConfirmDelete(source.id)}>
                  <Text style={styles.danger}>Fjern</Text>
                </TvPressable>
              </View>
            )}
          </View>
          <Switch
            value={source.enabled}
            onValueChange={(value) => {
              void toggle(source, value);
            }}
            trackColor={{ true: colors.accent, false: colors.border }}
          />
        </View>
      ))}

      <TvPressable style={styles.button} onPress={() => setAdding('xtream')}>
        <Text style={styles.buttonText}>Tilføj panel</Text>
      </TvPressable>
      <TvPressable style={styles.button} onPress={() => setAdding('m3u')}>
        <Text style={styles.buttonText}>Tilføj M3U-liste</Text>
      </TvPressable>
    </ScrollView>
  );
}

/** Formularen til én kilde — ny (tilfoej) eller eksisterende (redigér). */
function SourceForm({
  kind,
  session,
  source,
  initialPassword,
  onCancel,
  onSaved,
}: {
  kind: SourceKind;
  session: AppSession;
  /** Sat naar en eksisterende kilde redigeres; ellers tilfoejes en ny. */
  source?: Source;
  /** Kildens nuvaerende kodeord, forudfyldt ved redigering. */
  initialPassword?: string;
  onCancel: () => void;
  onSaved: (name: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const editing = source !== undefined;
  const [name, setName] = useState(source?.name ?? '');
  const [url, setUrl] = useState(source?.url ?? '');
  const [username, setUsername] = useState(source?.username ?? '');
  const [password, setPassword] = useState(initialPassword ?? '');
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

      const result =
        editing && source !== undefined
          ? isXtream
            ? await editXtream(session.db, session.fetchImpl, source.id, {
                url: trimmedUrl,
                username,
                password,
                name: label,
              })
            : await editM3u(session.db, session.fetchImpl, source.id, {
                url: trimmedUrl,
                name: label,
              })
          : isXtream
            ? await connectXtream(session.db, session.fetchImpl, {
                url: trimmedUrl,
                username,
                password,
                name: label,
              })
            : await connectM3u(session.db, session.fetchImpl, {
                url: trimmedUrl,
                name: label,
              });

      if (!result.ok) {
        setError(result.message);
        return;
      }
      onSaved(label);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>
        {editing
          ? isXtream
            ? 'Redigér panel'
            : 'Redigér M3U-liste'
          : isXtream
            ? 'Tilføj panel'
            : 'Tilføj M3U-liste'}
      </Text>
      {editing && isXtream && (
        <Text style={styles.hint}>
          Har du fået en anden server? Ret adressen (og evt. brugernavn/kodeord) og gem.
          Panelet beholder dine favoritter, grupper og logoer; kanalerne hentes forfra fra
          den nye server. Går login ikke igennem, ændres intet.
        </Text>
      )}

      <Field label="Navn (valgfrit)" value={name} onChange={setName} placeholder="Hovedpanel" />
      <Field
        label={isXtream ? 'Panelets adresse' : 'Adressen på listen'}
        value={url}
        onChange={setUrl}
        placeholder={isXtream ? 'http://panel.example:8080' : 'http://.../liste.m3u'}
        keyboardType="url"
      />

      {isXtream && (
        <>
          <Field label="Brugernavn" value={username} onChange={setUsername} />
          <Field label="Adgangskode" value={password} onChange={setPassword} secure />
        </>
      )}

      {error !== null && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actions}>
        <TvPressable style={styles.buttonQuiet} onPress={onCancel} disabled={busy}>
          <Text style={styles.buttonText}>Annullér</Text>
        </TvPressable>
        <TvPressable
          style={[styles.button, (!canSubmit || busy) && styles.buttonDisabled]}
          disabled={!canSubmit || busy}
          onPress={() => {
            void submit();
          }}
        >
          {busy ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <Text style={styles.buttonText}>{editing ? 'Gem' : 'Tilføj'}</Text>
          )}
        </TvPressable>
      </View>
    </ScrollView>
  );
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
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secure === true}
        keyboardType={keyboardType === 'url' ? 'url' : 'default'}
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: theme.spacing.md, paddingBottom: theme.spacing.xl },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: theme.spacing.md,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: theme.spacing.md,
  },
  empty: { color: colors.textMuted, fontSize: 14, marginBottom: theme.spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: theme.spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, paddingRight: theme.spacing.sm },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowMeta: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  rowWarn: { color: colors.danger, fontSize: 12, marginTop: 4, lineHeight: 16 },
  rowOk: { color: colors.textMuted, fontSize: 12, marginTop: 4, lineHeight: 16 },
  archiveLine: { marginTop: 2 },
  confirm: { marginTop: theme.spacing.xs },
  confirmRow: { flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.xs },
  action: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg, marginTop: 4 },
  danger: { color: colors.danger, fontSize: 14, fontWeight: '600', marginTop: 4 },
  field: { marginBottom: theme.spacing.md },
  fieldLabel: { color: colors.textMuted, fontSize: 13, marginBottom: theme.spacing.xs },
  input: {
    backgroundColor: colors.surface,
    borderRadius: theme.radius,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    color: colors.text,
    fontSize: 15,
  },
  error: { color: colors.danger, fontSize: 14, marginBottom: theme.spacing.md },
  actions: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  button: {
    backgroundColor: colors.accent,
    borderRadius: theme.radius,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    alignItems: 'center',
    marginTop: theme.spacing.md,
    minWidth: 120,
  },
  buttonQuiet: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: theme.radius,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    alignItems: 'center',
    marginTop: theme.spacing.md,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.text, fontSize: 15, fontWeight: '600' },
});
