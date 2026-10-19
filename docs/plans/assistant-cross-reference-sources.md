# Assistant: result lists for the cross-reference tools

## Goal
The core tools `get_related`, `find_person`, `get_graph` and `list_known_people` show
result rows in the chat like the domain tools do, instead of a plain line.

## Known
- `DomainTool.sources?(output): ToolSource[]` exists in `layers/core/shared/types/tools.ts`;
  mail, documents, calendar, contacts and drive implement it. `toAiSdkTools`
  (`layers/mail-ai/server/mail-ai/tools.ts`) attaches up to 20 sources to the UI output
  and keeps them off the model payload (`toModelOutput`).
- The core tools were left out because core files were off-limits at the time.

## Steps
1. Implement `sources` for the four core tools (where they are registered in
   `layers/core/server`): related items → one row per item with its domain as `kind`;
   person → the person plus their linked items; graph → the nodes (cap 20);
   known people → name + address. Links: the entity's in-app link if one exists.
2. Pure mapping functions with tests per tool.
3. Map the new kinds to icons in the assistant's kind→icon map.

## Verify
lint, typecheck, test; ask the assistant "Who is <known address>?" with Cross references
enabled → result rows with links.
