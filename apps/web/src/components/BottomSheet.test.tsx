// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BottomSheet } from './BottomSheet';

class FakeVV extends EventTarget {
  height = 800;
  offsetTop = 0;
}

function setup(vvHeight: number, innerHeight = 800) {
  const vv = new FakeVV();
  vv.height = vvHeight;
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true });
  return vv;
}

const wrapper = () => screen.getByTestId('sheet').parentElement as HTMLElement;

function open() {
  render(
    <BottomSheet labelledBy="t" header={<h2 id="t">Title</h2>} onClose={() => {}}>
      body
    </BottomSheet>,
  );
}

describe('BottomSheet viewport sizing', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, 'visualViewport');
  });

  it('ignores a stale short visualViewport reading when no keyboard is open', () => {
    // Slightly short reading (browser chrome), not a keyboard: must not clip the sheet.
    setup(790, 800);
    open();
    expect(wrapper().style.height).toBe('100dvh');
  });

  it('falls back to 100dvh without visualViewport', () => {
    open();
    expect(wrapper().style.height).toBe('100dvh');
  });

  it('shrinks to the visual viewport while the keyboard is open, then recovers', () => {
    const vv = setup(800, 800);
    open();
    expect(wrapper().style.height).toBe('100dvh');
    act(() => {
      vv.height = 400;
      vv.dispatchEvent(new Event('resize'));
    });
    expect(wrapper().style.height).toBe('400px');
    act(() => {
      vv.height = 800;
      vv.dispatchEvent(new Event('resize'));
    });
    expect(wrapper().style.height).toBe('100dvh');
  });
});
