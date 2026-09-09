import { useEffect, useRef } from 'react';
import { FlatList } from 'react-native';
import type { FlatListProps, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

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
}

/**
 * En FlatList der lander hvor den var sidst.
 *
 * Tilbage fra en station skal ramme den station man kom fra, ikke toppen.
 * Rulningen gemmes loebende, og naar listen har indhold nok, rulles der
 * til den gemte plads uden animation. Uden getItemLayout vokser indholdet
 * efterhaanden som raekkerne tegnes, saa der ventes til det naar derned.
 */
export function RememberedList<T>({ memoryKey, restoreSignal = 0, onScroll, onContentSizeChange, onLayout, ...rest }: Props<T>) {
  const ref = useRef<FlatList<T>>(null);
  const restored = useRef(false);
  const height = useRef(0);
  const key = memoryKey;

  // Eksplicit tilbage til pladsen naar foraelderen beder om det. Uanset
  // hvad der satte listen til toppen imens, lander den her igen.
  useEffect(() => {
    if (restoreSignal === 0) return;
    const wanted = offsets.get(key) ?? 0;
    if (wanted <= 0) return;
    const frame = requestAnimationFrame(() => ref.current?.scrollToOffset({ offset: wanted, animated: false }));
    return () => cancelAnimationFrame(frame);
  }, [restoreSignal, key]);

  return (
    <FlatList
      ref={ref}
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
        // Gemmes altid. Foer kun efter den foerste tegning, og kom den
        // besked aldrig, blev der aldrig gemt noget at vende tilbage til.
        offsets.set(key, event.nativeEvent.contentOffset.y);
        onScroll?.(event);
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
