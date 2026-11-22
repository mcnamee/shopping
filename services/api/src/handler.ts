import type { Context } from 'aws-lambda';
import { errors, type HttpResult } from './http';
import { createRouter, type ApiEvent } from './router';
import { routes } from './routes';

export function createHandler(route: (event: ApiEvent) => Promise<HttpResult>) {
  return async function handler(event: ApiEvent, context: Context): Promise<HttpResult> {
    try {
      return await route(event);
    } catch (err) {
      // Never echo internal errors to the client. Never log tokens or request bodies.
      console.error(
        JSON.stringify({
          level: 'error',
          requestId: context.awsRequestId,
          routeKey: event.routeKey,
          error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
        }),
      );
      return errors.internal();
    }
  };
}

export const handler = createHandler(createRouter(routes));
