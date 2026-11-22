import type { HealthResponse, MeResponse } from '@trolley/core';
import { json } from './http';
import type { RouteTable } from './router';

export const routes: RouteTable = {
  'GET /api/health': {
    auth: false,
    handler: () => json(200, { status: 'ok' } satisfies HealthResponse),
  },
  'GET /api/me': {
    auth: true,
    handler: ({ household }) =>
      json(200, {
        userId: household.userId,
        email: household.email,
        householdId: household.householdId,
      } satisfies MeResponse),
  },
};
