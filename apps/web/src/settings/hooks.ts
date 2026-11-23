import { useQuery } from '@tanstack/react-query';
import { getConnectedApps } from '../api';
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
