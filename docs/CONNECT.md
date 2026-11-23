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
