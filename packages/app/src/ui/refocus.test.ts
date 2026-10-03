import { beforeEach, describe, expect, it } from 'vitest';
import { clearPressed, forgetPressable, notePressed, refocusLastPressed, registerPressable } from './refocus.js';

describe('fokus tilbage paa sidste tryk', () => {
  beforeEach(() => clearPressed());

  it('vaelger det seneste tryk der stadig findes', () => {
    const fired: string[] = [];
    const cell = registerPressable(() => fired.push('celle'));
    const sheetButton = registerPressable(() => fired.push('ark'));
    notePressed(cell);
    notePressed(sheetButton);
    forgetPressable(sheetButton);
    expect(refocusLastPressed()).toBe(true);
    expect(fired).toEqual(['celle']);
  });

  it('svarer falsk naar intet er trykket', () => {
    expect(refocusLastPressed()).toBe(false);
  });

  it('et nyt tryk paa et gammelt punkt goer det til det seneste', () => {
    const fired: string[] = [];
    const a = registerPressable(() => fired.push('a'));
    const b = registerPressable(() => fired.push('b'));
    notePressed(a);
    notePressed(b);
    notePressed(a);
    refocusLastPressed();
    expect(fired).toEqual(['a']);
  });
});
