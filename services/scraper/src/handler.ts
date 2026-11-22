/**
 * Scraper Lambda: invoked monthly by EventBridge Scheduler, or on demand by the
 * "scrape-now" GitHub workflow. Throws (-> Lambda Errors metric -> alarm email) on any
 * failed or partial run.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { Context } from 'aws-lambda';
import { AldiClient } from './aldi-client';
import { loadConfig } from './config';
import { runScrape } from './run';
import { DynamoCatalogueStore } from './store';

/** Stop crawling with this much Lambda time left, so the writes and run record fit. */
const SAFETY_MARGIN_MS = 120_000;

const log = (event: Record<string, unknown>) => console.log(JSON.stringify(event));

let doc: DynamoDBDocumentClient | undefined;

export async function handler(event: unknown, context: Context) {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) throw new Error('TABLE_NAME is not set');
  const config = loadConfig();
  doc ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });

  const trigger =
    typeof event === 'object' &&
    event !== null &&
    typeof (event as { trigger?: unknown }).trigger === 'string'
      ? String((event as { trigger: string }).trigger).slice(0, 40)
      : 'schedule';

  const client = new AldiClient({
    servicePoint: config.servicePoint,
    minIntervalMs: config.minIntervalMs,
    maxRequests: config.maxRequests,
    log,
  });
  const { run } = await runScrape({
    client,
    servicePoint: config.servicePoint,
    store: new DynamoCatalogueStore(doc, { tableName }),
    trigger,
    crawl: {
      maxProducts: config.maxProducts,
      shouldStop: () => context.getRemainingTimeInMillis() < SAFETY_MARGIN_MS,
    },
    log,
  });
  log({ level: 'info', msg: 'scrape finished', ...run });
  return run;
}
