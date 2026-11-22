import { LayoutTemplate, ListChecks, type LucideIcon } from 'lucide-react';

const PAGES = {
  lists: {
    Icon: ListChecks,
    heading: 'Lists are coming soon',
    body: "Soon you'll build your weekly shop here and tick items off as you go.",
  },
  templates: {
    Icon: LayoutTemplate,
    heading: 'Templates are coming soon',
    body: 'Save your regular shops, like the weekly basics, and reuse them in one tap.',
  },
} satisfies Record<string, { Icon: LucideIcon; heading: string; body: string }>;

export type PlaceholderKind = keyof typeof PAGES;

/** Shared empty state for tabs that are built in later stages (docs/ux/app-shell.md section 2). */
export function PlaceholderPage({ kind }: { kind: PlaceholderKind }) {
  const { Icon, heading, body } = PAGES[kind];
  return (
    <div className="flex min-h-[calc(100dvh-var(--safe-top)-56px-var(--nav-height)-48px)] flex-col items-center justify-center text-center">
      <div className="flex h-24 w-24 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Icon aria-hidden size={48} />
      </div>
      <h2 className="mt-5 text-xl">{heading}</h2>
      <p className="mt-2 max-w-[280px] text-base text-muted">{body}</p>
    </div>
  );
}
