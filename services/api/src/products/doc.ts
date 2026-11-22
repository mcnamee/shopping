import type {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

export type DocCommand =
  | QueryCommand
  | GetCommand
  | PutCommand
  | DeleteCommand
  | UpdateCommand
  | BatchWriteCommand
  | TransactWriteCommand;

/** The one DocumentClient method we use (tests pass a plain fake). */
export interface DocSender {
  send(command: DocCommand): Promise<Record<string, unknown>>;
}
