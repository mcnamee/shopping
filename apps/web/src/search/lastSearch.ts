/**
 * Remembers the Search tab's URL query (?q=milk&cat=dairy-eggs) for this page session so
 * the bottom-nav Search link returns to it (docs/ux/search.md section 1, URL state).
 */
let last = '';

export const getLastSearch = (): string => last;

export const setLastSearch = (search: string): void => {
  last = search;
};
