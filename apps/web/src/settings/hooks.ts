import { useQuery } from '@tanstack/react-query';
import { getConnectedApps, getShortcutKeys } from '../api';
import { retryOnce } from '../lists/data';

export const connectedAppsKey = ['connected-apps'] as const;

export function useConnectedAppsQuery() {
  return useQuery({
    queryKey: connectedAppsKey,
    queryFn: getConnectedApps,
    retry: retryOnce,
    staleTime: 0,
  });
}

export const shortcutKeysKey = ['shortcut-keys'] as const;

export function useShortcutKeysQuery() {
  return useQuery({
    queryKey: shortcutKeysKey,
    queryFn: getShortcutKeys,
    retry: retryOnce,
    staleTime: 0,
  });
}
