# Connect Trolley to Claude or ChatGPT

Once connected, you can say things like "add tissues to my shopping list", "what's on my shopping list?" or "take the tissues off" and Trolley updates this week's list. Either of you can connect; connections are shared by the household and listed in Trolley under **Settings > Connected apps**.

The connector address is:

```
https://trolley.mcn.am/mcp
```

## Claude (claude.ai, desktop or mobile app)

1. On claude.ai or in the desktop app, open **Settings > Connectors** and choose **Add custom connector**. (On a Team or Enterprise plan an owner may need to add it under organisation settings first.)
2. Name it **Trolley**, paste the address above and choose **Add**. Leave any "OAuth client ID/secret" fields empty.
3. Choose **Connect**. A Trolley page opens: sign in if asked, check it says "Connect Claude", then choose **Allow**. You're sent back to Claude.
4. In a chat, make sure Trolley is switched on in the tools menu, then try "add tissues to my shopping list". The first time, Claude asks permission to use each Trolley tool; choose **Always allow** if you like.
5. The connector then also works in the Claude mobile app (it syncs from your account).

## ChatGPT

Custom connectors need a plan that allows them (for example Plus or Pro with developer mode, or a workspace where an admin allows custom connectors).

1. In ChatGPT on the web, open **Settings > Apps & Connectors** (called Connectors on some plans), turn on **Developer mode** under Advanced settings if it's offered, then choose **Create** (or **Add connector**).
2. Name it **Trolley**, paste the address above, set authentication to **OAuth**, tick that you trust this app, and choose **Create**.
3. A Trolley page opens: sign in if asked, check it says "Connect ChatGPT", then choose **Allow**.
4. In a new chat, add Trolley from the **+** (tools) menu, then try "what's on my shopping list?".

## Good to know

- Trolley adds your **usual** product (the one you've bought most). If it isn't sure (for example "chips" when you've never bought chips), the chatbot shows you a few options and adds nothing until you pick one.
- The chatbot can only see your lists, add or remove items on this week's list and search products. It can't tick items, change other lists or delete lists.
- To disconnect, go to **Settings > Connected apps** in Trolley and choose **Disconnect**; the chatbot will ask you to connect again next time. Removing the connector in Claude or ChatGPT doesn't remove it from Trolley, so disconnect there too.
- If connecting fails with "This connection link isn't valid", start again from Claude or ChatGPT (links last 10 minutes).

## Siri

Say "Hey Siri, Add to Trolley", answer "What should I add?" and it goes on this week's list, with no app open. It uses a personal key rather than a connector, and works on iPhone, iPad, Apple Watch and HomePod once the shortcut is built.

1. In Trolley, open **Settings > Siri & Shortcuts**, type a name (for example "Matt's iPhone") and choose **Create key**. Copy the key straight away: it is shown once. Each person can make their own; up to 5 per household.
2. In the **Shortcuts** app, tap **+** and name the shortcut **Add to Trolley** (that name is the Siri phrase).
3. Add **Ask for Text** with the prompt "What should I add?".
4. Add **Get Contents of URL**. URL: `https://trolley.mcn.am/api/quick/add` (Trolley shows your exact address with a Copy button). Tap **Show More**: Method **POST**, Headers: **Authorization** = `Bearer <your key>`, Request Body **JSON** with a Text field **text** set to **Provided Input**.
5. Add **Get Dictionary Value** for the key **spoken** from Contents of URL.
6. Add **Speak Text** (or **Show Result**) with the Dictionary Value.

Optional: a second shortcut called **What's on my Trolley list** with **Get Contents of URL** (`https://trolley.mcn.am/api/quick/list`, Method GET, same Authorization header), **Get Dictionary Value** `spoken`, then **Speak Text**.

Good to know:
- "milk and eggs" adds both. Trolley adds your usual product; if it isn't sure (say "tissues" and you've never bought any) it adds nothing and says a few options. Say the one you want.
- A key can only add to this week's list and read it. It can't tick, remove or see other lists.
- Lost a phone or shared a key by mistake? **Revoke** it in Settings > Siri & Shortcuts. The shortcut then says "That Trolley key isn't valid any more."
- Anyone with the key can add to your list, so keep it out of screenshots and chats.

