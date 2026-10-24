import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ Platform: { isTV: true }, View: 'View', Pressable: 'Pressable', StyleSheet: { create: (styles: unknown) => styles } }));
import { TvPressable } from './TvPressable.js';
let tree: ReactTestRenderer | null = null;
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); tree = null; vi.unstubAllGlobals(); });
it('giver visuel respons ved tryk ned uden at udfoere handlingen foer slip', async () => {
  const press = vi.fn(); const hold = vi.fn();
  await act(async () => { tree = create(createElement(TvPressable, { onPress: press, onLongPress: hold })); });
  const native = tree!.root.findByType('Pressable' as any);
  expect(native.props.style({ pressed: true })).toContainEqual({ opacity: 0.72 });
  expect(native.props.style({ pressed: false })).not.toContainEqual({ opacity: 0.72 });
  expect(press).not.toHaveBeenCalled();
  await act(async () => native.props.onLongPress({})); expect(hold).toHaveBeenCalledTimes(1);
  expect(press).not.toHaveBeenCalled();
  await act(async () => native.props.onPress({})); expect(press).toHaveBeenCalledTimes(1);
});
it('en spaerret TV-knap er fortsat fokuserbar men udfoerer intet', async () => {
  const press = vi.fn();
  await act(async () => { tree = create(createElement(TvPressable, { disabled: true, onPress: press })); });
  const native = tree!.root.findByType('Pressable' as any);
  expect(native.props.disabled).toBeUndefined();
  expect(native.props.style({ pressed: true })).not.toContainEqual({ opacity: 0.72 });
  await act(async () => native.props.onPress({})); expect(press).not.toHaveBeenCalled();
});
