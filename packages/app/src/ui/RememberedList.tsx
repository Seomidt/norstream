import { useEffect, useRef } from 'react';
import { FlatList } from 'react-native';
import type { FlatListProps, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { isTV } from './tv.js';

/**
 * Hvor langt hver liste var rullet, paa tvaers af at listen tegnes forfra.
 *
 * Modulniveau med vilje: en liste kan blive afmonteret og monteret igen
 * (en anden skaerm ovenpaa, data der hentes igen), og saa er en ref i
 * komponenten vaek sammen med den. Noeglen siger hvilken liste: et lands
 * stationer, landelisten, en soegning.
 */
const offsets = new Map<string, number>();

/** Glem hvor en liste var; naar dens indhold er et andet nu. */
export function forgetScroll(memoryKey: string): void {
  offsets.delete(memoryKey);
}

interface Props<T> extends FlatListProps<T> {
  memoryKey: string;
  /** Taelles op af foraelderen naar listen skal tilbage til sin gemte plads, fx naar en skaerm ovenpaa lukker. */
  restoreSignal?: number;
  /**
   * Raekken der skal vaere i syne naar listen vender tilbage — den station man
   * kom fra (ogsaa efter at have skiftet station inde i afspilleren). Er den
   * ikke paa skaermen ved den gemte plads, rulles der hen til den. Kraever
   * getItemLayout; -1 eller udeladt = kun den gemte plads.
   */
  restoreIndex?: number;
  /**
   * Sand mens en anden skaerm ligger ovenpaa listen. Saa gemmes rulningen
   * ikke: Android kan saette listen til toppen imens, og den top maa ikke
   * blive til "den gemte plads" man vender tilbage til.
   */
  frozen?: boolean;
}

/**
 * En FlatList der lander hvor den var sidst.
 *
 * Tilbage fra en station skal ramme den station man kom fra, ikke toppen.
 * Rulningen gemmes loebende, og naar listen har indhold nok, rulles der
 * til den gemte plads uden animation. Uden getItemLayout vokser indholdet
 * efterhaanden som raekkerne tegnes, saa der ventes til det naar derned.
 */
export function RememberedList<T>({
  memoryKey,
  restoreSignal = 0,
  restoreIndex,
  frozen = false,
  onScroll,
  onScrollBeginDrag,
  onContentSizeChange,
  onLayout,
  ...rest
}: Props<T>) {
  const ref = useRef<FlatList<T>>(null);
  const restored = useRef(false);
  const height = useRef(0);
  const key = memoryKey;
  /** Pladsen da en skaerm lagde sig ovenpaa; den er sandheden, ikke det Android goer imens. */
  const anchor = useRef<number | null>(null);
  /** Har brugeren selv rullet siden tilbage? Saa roeres listen ikke igen. */
  const dragged = useRef(false);
  // Laeses naar signalet kommer, ikke som afhaengighed: raekken skal findes
  // i den liste der staar der i det oejeblik.
  const latest = useRef({ restoreIndex, data: rest.data, getItemLayout: rest.getItemLayout });
  latest.current = { restoreIndex, data: rest.data, getItemLayout: rest.getItemLayout };

  useEffect(() => {
    if (frozen) anchor.current = offsets.get(key) ?? 0;
  }, [frozen, key]);

  // Eksplicit tilbage til pladsen naar foraelderen beder om det. Uanset
  // hvad der satte listen til toppen imens, lander den her igen — og er den
  // station man kom fra ikke i syne dér, rulles der hen til den.
  useEffect(() => {
    if (restoreSignal === 0) return;
    dragged.current = false;
    const go = (): void => {
      const list = ref.current;
      if (list === null || dragged.current) return;
      const wanted = anchor.current ?? offsets.get(key) ?? 0;
      const { restoreIndex: index, data, getItemLayout } = latest.current;
      if (index !== undefined && index >= 0 && getItemLayout !== undefined && getItemLayout !== null) {
        const row = getItemLayout(data as ArrayLike<T>, index);
        const view = height.current;
        const visible = view > 0 && row.offset >= wanted && row.offset + row.length <= wanted + view;
        if (!visible) {
          // Stationen en tredjedel nede, saa man ogsaa ser dem omkring den.
          const target = Math.max(0, row.offset - view / 3);
          offsets.set(key, target);
          list.scrollToOffset({ offset: target, animated: false });
          return;
        }
      }
      if (wanted > 0) {
        offsets.set(key, wanted);
        list.scrollToOffset({ offset: wanted, animated: false });
      }
    };
    const frame = requestAnimationFrame(go);
    // Én gang til lidt efter: Android kan saette listen til toppen efter den
    // foerste tegning (hoejde og kanter der falder paa plads), og saa skal den
    // tilbage igen. Har brugeren rullet imens, lades listen vaere.
    const later = setTimeout(() => {
      go();
      anchor.current = null;
    }, 300);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(later);
    };
  }, [restoreSignal, key]);

  return (
    <FlatList
      ref={ref}
      // Faa skaermfulde ad gangen: standarden tegner 21, og paa tv gav 232
      // stationer med logoer et hak paa flere sekunder ved aabning.
      windowSize={5}
      initialNumToRender={12}
      maxToRenderPerBatch={8}
      // Paa tv aldrig afmontere en raekke fjernbetjeningen kan staa paa (ellers
      // ryger fokus ud i menuen). Paa telefon beholdes klipningen for fart.
      removeClippedSubviews={!isTV}
      {...rest}
      onLayout={(event) => {
        // Aendrer listen selv hoejde (en bjaelke, tastaturet, kanterne),
        // kan Android saette den til toppen. Saa tilbage til den gemte plads.
        const next = event.nativeEvent.layout.height;
        if (restored.current && height.current > 0 && next !== height.current) {
          const wanted = offsets.get(key) ?? 0;
          if (wanted > 0) requestAnimationFrame(() => ref.current?.scrollToOffset({ offset: wanted, animated: false }));
        }
        height.current = next;
        onLayout?.(event);
      }}
      scrollEventThrottle={rest.scrollEventThrottle ?? 64}
      onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
        // Gemmes altid — undtagen mens en skaerm ligger ovenpaa (se `frozen`).
        // Foer kun efter den foerste tegning, og kom den besked aldrig, blev
        // der aldrig gemt noget at vende tilbage til.
        if (!frozen) offsets.set(key, event.nativeEvent.contentOffset.y);
        onScroll?.(event);
      }}
      onScrollBeginDrag={(event) => {
        dragged.current = true;
        onScrollBeginDrag?.(event);
      }}
      onContentSizeChange={(width, height) => {
        if (!restored.current) {
          const wanted = offsets.get(key) ?? 0;
          if (wanted <= 0) {
            restored.current = true;
          } else if (height >= wanted) {
            restored.current = true;
            ref.current?.scrollToOffset({ offset: wanted, animated: false });
          }
        }
        onContentSizeChange?.(width, height);
      }}
    />
  );
}
