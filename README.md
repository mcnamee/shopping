<p align="center">
  <img src="apps/web/public/icons/icon-512.png" alt="Trolley logo" width="120" height="120" />
</p>

<h1 align="center">Trolley</h1>

<p align="center"><b>The household shopping list that writes itself - built for shopping at ALDI.</b></p>

<p align="center">
  Mobile first &middot; Shared between two phones &middot; AI suggestions &middot; Works with Claude, ChatGPT and Siri
</p>

---

## Why Trolley?

Writing the weekly shopping list is a small job that never ends. You check the fridge, try to remember whether you're out of butter, scroll back through old lists, then still forget the bin bags.

Trolley does the remembering for you. It knows what you buy, how much and how often, and it builds most of this week's list before you've opened the fridge. In the store, the list is sorted by aisle so you can shop top to bottom without doubling back, and both of you can tick things off from your own phones at the same time.

## Features

**Plan in under two minutes**
- **Suggest items** - learns from your past shops and adds what's due: milk every week, butter once a month. You review everything before it's added.
- **Templates** - a *Weekly* list, a *Meal* list for each dinner you cook often, and *Regulars* for the things you buy now and then and want to check each shop.
- **Real ALDI products** - search the live ALDI Australia range for your store, with photos, prices and pack sizes. Products your store doesn't stock are hidden.
- **Sensible quantities** - kilograms for bananas, litres for milk, packs for everything else, with quick presets.

**Shop faster in the store**
- **Sorted by aisle** - items are grouped by section and ordered to match your store's layout, which you can rearrange in Settings.
- **One tap to tick** - big, one-handed tap targets; ticked items sink to the bottom.
- **Shop together** - two phones, one list, kept in sync.
- **Notes for the shopper** - "get white if red is out of stock".
- **Done means done** - the list archives itself when everything's ticked, and becomes history for next week's suggestions.

**Add things from anywhere**
- **Claude and ChatGPT** - "add tissues to my shopping list" adds the tissues you actually buy, using your templates and history.
- **Siri** - "Hey Siri, Add to Trolley... milk and eggs".

**Made for your phone**
- Installs to your home screen like an app, with light and dark mode and adjustable text size.

## Benefits

- **Less mental load** - stop trying to remember what's running low.
- **Fewer forgotten items** - periodic buys like bin bags and dishwasher tablets come up when they're due.
- **Quicker shops** - aisle order means no backtracking.
- **Private** - runs in your own AWS account; your lists and history are yours alone.
- **Practically free to run** - serverless on AWS for roughly $0-1 a month.

## How it works

| Part | Built with |
|---|---|
| App | React PWA served from Amazon S3 and CloudFront |
| Sign-in | Amazon Cognito (invite only) |
| Backend | API Gateway + AWS Lambda, DynamoDB |
| Suggestions | Your purchase history plus Amazon Bedrock (Nova Micro) |
| Product catalogue | Monthly scrape of ALDI Australia via GitHub Actions |
| Chatbots | Remote MCP server with OAuth 2.1 |
| Deployment | GitHub Actions only - no servers to patch |

## Installation

Trolley is designed to be self-hosted in your own AWS account. You'll need an AWS account, a GitHub account and (optionally) a domain name. Setup takes about 30 minutes, mostly in the AWS console.

1. **Fork or clone** this repository.
2. **Prepare AWS** - bootstrap CDK and create the GitHub deploy role from AWS CloudShell.
3. **Connect GitHub** - add the repository variables (account, deploy role, alert email, optional certificate).
4. **Deploy** - push to `main`; GitHub Actions builds, tests and deploys everything.
5. **Fill the catalogue** - run the scrape workflow once.
6. **Invite your household** - create the two user accounts with `scripts/create-user.sh`.
7. **Add to your home screen** - open the app on each phone and choose *Add to Home Screen*.

Step-by-step instructions: **[docs/SETUP.md](docs/SETUP.md)**. To connect Claude, ChatGPT or Siri: **[docs/CONNECT.md](docs/CONNECT.md)**.

## Documentation

| Doc | What's in it |
|---|---|
| [Setup](docs/SETUP.md) | One-off AWS and GitHub setup, custom domain, users |
| [Connect assistants](docs/CONNECT.md) | Claude, ChatGPT and Siri |
| [Recipes](docs/RECIPES.md) | Import from Mela, cooking view |
| [Development](docs/DEVELOPMENT.md) | Repo layout, local dev, tests, the ALDI scraper |
| [API reference](docs/api.md) | Every endpoint, including OAuth and MCP |
| [Product spec](docs/PRODUCT_SPEC.md) | Goals, requirements and release stages |
| [Decisions](docs/DECISIONS.md) | Why things are the way they are |
| [Status](docs/STATUS.md) and [Backlog](docs/BACKLOG.md) | Where things are up to and what's next |
