import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** The element in the shell app bar where a tab can put its action (e.g. the (+) button). */
export const AppBarSlotContext = createContext<HTMLElement | null>(null);

/** Renders `children` in the app bar's trailing slot (docs/ux/lists.md 1: (+) New list). */
export function AppBarAction({ children }: { children: ReactNode }) {
  const slot = useContext(AppBarSlotContext);
  return slot ? createPortal(children, slot) : null;
}
