import type { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

/** The one DocumentClient method we use (tests pass a plain fake). */
export interface DocSender {
  send(
    command: QueryCommand | GetCommand | PutCommand | DeleteCommand,
  ): Promise<Record<string, unknown>>;
}
