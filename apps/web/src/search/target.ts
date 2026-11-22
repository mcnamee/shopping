import {
  defaultListName,
  type ListSummary,
  type TemplateSummary,
  type TemplateType,
} from '@trolley/core';

/**
 * Where the quantity modal adds to (docs/ux/quantity-modal.md 10). `thisWeek` means "this
 * week's list, created and flagged if there is none" (C1, C2).
 */
export type AddTarget =
  | { kind: 'thisWeek' }
  | { kind: 'list'; id: string; name: string }
  | { kind: 'template'; id: string; name: string; type?: TemplateType };

/** Last target confirmed in this session (10.1 rules 2 and 3). Not persisted. */
const session: { last: AddTarget | null; lastTemplate: AddTarget | null } = {
  last: null,
  lastTemplate: null,
};

export const sessionTargets = {
  get last() {
    return session.last;
  },
  get lastTemplate() {
    return session.lastTemplate;
  },
  remember(target: AddTarget) {
    session.last = target;
    if (target.kind === 'template') session.lastTemplate = target;
  },
  reset() {
    session.last = null;
    session.lastTemplate = null;
  },
};

export interface TargetView {
  /** Name shown in the row and on the button. */
  name: string;
  kind: 'list' | 'template';
  thisWeek: boolean;
  /** `thisWeek` target with no flagged list: a new one is created on confirm. */
  isNew: boolean;
  type?: TemplateType | undefined;
}

/** Resolve a target against the loaded lists and templates. */
export function describeTarget(
  target: AddTarget,
  lists: readonly ListSummary[] | undefined,
  templates: readonly TemplateSummary[] | undefined,
  now = new Date(),
): TargetView {
  if (target.kind === 'template') {
    const t = templates?.find((x) => x.id === target.id);
    return {
      name: t?.name ?? target.name,
      kind: 'template',
      thisWeek: false,
      isNew: false,
      type: t?.type ?? target.type,
    };
  }
  if (target.kind === 'list') {
    const l = lists?.find((x) => x.id === target.id);
    return { name: l?.name ?? target.name, kind: 'list', thisWeek: !!l?.thisWeek, isNew: false };
  }
  const week = lists?.find((l) => l.thisWeek);
  if (week) return { name: week.name, kind: 'list', thisWeek: true, isNew: false };
  return {
    name: lists ? defaultListName(now) : "this week's list",
    kind: 'list',
    thisWeek: true,
    isNew: lists !== undefined,
  };
}
