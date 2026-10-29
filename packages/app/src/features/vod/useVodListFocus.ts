import { useCallback, useRef } from 'react';
import type { FlatList } from 'react-native';
import { isTV } from '../../ui/tv.js';
import { useTvListTail } from '../../ui/tvScroll.js';

/** Hold sidste raekke synlig uden at aendre den fungerende listegeometri. */
export function useVodListFocus<T>() {
  const list = useRef<FlatList<T>>(null);
  const previous = useRef(-1);
  const tail = useTvListTail();
  const focus = useCallback((index: number) => {
    if (!isTV || previous.current === index) return;
    previous.current = index;
    list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
  }, []);
  const failed = useCallback(({ index, averageItemLength }: { index: number; averageItemLength: number }) => {
    list.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
  }, []);
  return { list, tail, focus, failed };
}
