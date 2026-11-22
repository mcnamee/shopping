// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './Toast';

function Demo({ onAction }: { onAction: () => void }) {
  const toast = useToast();
  return (
    <>
      <button
        onClick={() =>
          toast.show('Removed Milk', { durationMs: 5000, action: { label: 'Undo', onAction } })
        }
      >
        remove
      </button>
      <button onClick={() => toast.show('Plain', 1000)}>plain</button>
    </>
  );
}

afterEach(() => vi.useRealTimers());

describe('Toast with an action', () => {
  it('shows an Undo button that runs the action and closes the toast', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Demo onAction={onAction} />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'remove' }));
    expect(screen.getByTestId('toast')).toHaveTextContent('Removed Milk');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('lasts for the requested duration and a plain number still works', () => {
    vi.useFakeTimers();
    const onAction = vi.fn();
    render(
      <ToastProvider>
        <Demo onAction={onAction} />
      </ToastProvider>,
    );
    act(() => screen.getByRole('button', { name: 'remove' }).click());
    act(() => void vi.advanceTimersByTime(4900));
    expect(screen.getByTestId('toast')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.queryByTestId('toast')).toBeNull();
    act(() => screen.getByRole('button', { name: 'plain' }).click());
    act(() => void vi.advanceTimersByTime(1100));
    expect(screen.queryByTestId('toast')).toBeNull();
  });
});
