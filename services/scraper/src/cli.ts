/**
 * Local / GitHub-runner CLI.
 *
 *   npm run scrape -w @trolley/scraper -- --dry-run --out products.json
 *   npm run scrape -w @trolley/scraper -- --dry-run --max-per-category 12 --out sample.json
 *   TABLE_NAME=... npm run scrape -w @trolley/scraper -- --trigger github-fallback
 *
 * Without --dry-run it writes to DynamoDB (TABLE_NAME + ambient AWS credentials) with
 * exactly the same safety rules as the Lambda.
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { AldiClient, pageSizeFor } from './aldi-client';
import { loadConfig, servicePointFrom } from './config';
import { runScrape, ScrapeFailedError } from './run';
import { DynamoCatalogueStore } from './store';

const HELP = `Usage: scrape [--dry-run] [--out file.json] [--service-point G526|none]
              [--categories key,key] [--max-per-category N] [--max-products N]
              [--interval-ms N] [--trigger name]`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      out: { type: 'string' },
      'service-point': { type: 'string' },
      categories: { type: 'string' },
      'max-per-category': { type: 'string' },
      'max-products': { type: 'string' },
      'interval-ms': { type: 'string' },
      trigger: { type: 'string', default: 'cli' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const config = loadConfig({
    ...process.env,
    ...(values['interval-ms'] ? { SCRAPE_MIN_INTERVAL_MS: values['interval-ms'] } : {}),
    ...(values['max-products'] ? { SCRAPE_MAX_PRODUCTS: values['max-products'] } : {}),
  });
  const servicePoint =
    values['service-point'] !== undefined
      ? servicePointFrom(values['service-point'])
      : config.servicePoint;
  const maxPerCategory = values['max-per-category']
    ? Number(values['max-per-category'])
    : undefined;
  if (maxPerCategory !== undefined && !(Number.isInteger(maxPerCategory) && maxPerCategory > 0)) {
    throw new Error('--max-per-category must be a positive integer');
  }

  const dryRun = values['dry-run'];
  const tableName = process.env.TABLE_NAME;
  if (!dryRun && !tableName) throw new Error('TABLE_NAME is required unless --dry-run is given');

  const log = (e: Record<string, unknown>) => console.error(JSON.stringify(e));
  const client = new AldiClient({
    servicePoint,
    minIntervalMs: config.minIntervalMs,
    maxRequests: config.maxRequests,
    log,
  });
  const store =
    !dryRun && tableName
      ? new DynamoCatalogueStore(
          DynamoDBDocumentClient.from(new DynamoDBClient({}), {
            marshallOptions: { removeUndefinedValues: true },
          }),
          { tableName },
        )
      : undefined;

  try {
    const result = await runScrape({
      client,
      servicePoint,
      ...(store ? { store } : {}),
      trigger: values.trigger,
      crawl: {
        maxProducts: config.maxProducts,
        pageSize: pageSizeFor(maxPerCategory),
        ...(maxPerCategory ? { maxPerCategory } : {}),
        ...(values.categories
          ? { categoryKeys: values.categories.split(',').map((s) => s.trim()) }
          : {}),
      },
      log,
    });
    if (values.out) {
      writeFileSync(
        values.out,
        `${JSON.stringify({ run: result.run, crawl: result.crawl, products: result.products }, null, 2)}\n`,
      );
    }
    console.log(JSON.stringify(result.run, null, 2));
    return 0;
  } catch (err) {
    if (err instanceof ScrapeFailedError) {
      console.error(JSON.stringify(err.run, null, 2));
    }
    console.error(String(err));
    return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(String(err));
    process.exit(1);
  },
);
