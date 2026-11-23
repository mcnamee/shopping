import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { householdContextFromClaims, type HouseholdContext, type JwtClaims } from '@trolley/core';
import { errors, HttpFailure, type HttpResult } from './http';

/**
 * HTTP API payload v2 event. `authorizer.jwt.claims` is only present on routes that
 * have the JWT authoriser attached; API Gateway has already verified the token.
 */
export type ApiEvent = APIGatewayProxyEventV2 & {
  requestContext: APIGatewayProxyEventV2['requestContext'] & {
    authorizer?: { jwt?: { claims?: JwtClaims; scopes?: string[] | null } };
  };
};

export interface PublicRequest {
  event: ApiEvent;
}

export interface AuthedRequest extends PublicRequest {
  household: HouseholdContext;
}

type PublicHandler = (req: PublicRequest) => Promise<HttpResult> | HttpResult;
type AuthedHandler = (req: AuthedRequest) => Promise<HttpResult> | HttpResult;

export type Route =
  { auth: false; handler: PublicHandler } | { auth: true; handler: AuthedHandler };

/** Keyed by HTTP API route key, e.g. "GET /api/me". Must match the routes in infra. */
export type RouteTable = Readonly<Record<string, Route>>;

export function createRouter(routes: RouteTable) {
  return async function route(event: ApiEvent): Promise<HttpResult> {
    const route = routes[event.routeKey];
    if (!route) return errors.notFound();

    if (!route.auth) {
      try {
        return await route.handler({ event });
      } catch (err) {
        if (err instanceof HttpFailure) return err.result;
        throw err;
      }
    }

    const claims = event.requestContext.authorizer?.jwt?.claims;
    if (!claims) return errors.unauthorised();

    const result = householdContextFromClaims(claims);
    if (!result.ok) {
      switch (result.reason) {
        case 'missing_user':
          return errors.unauthorised();
        case 'missing_household':
        case 'invalid_household':
          return errors.noHousehold();
        default:
          return errors.forbidden();
      }
    }
    try {
      return await route.handler({ event, household: result.context });
    } catch (err) {
      if (err instanceof HttpFailure) return err.result;
      throw err;
    }
  };
}
