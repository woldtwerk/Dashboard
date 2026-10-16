Always run these command in the container via ddev:
- pnpm
- node
- php
- composer
- mysql
- drush
- any binary installed by pnpm or composer (e.g. eslint, drush, etc.)

e.g. `ddev exec pnpm run lint` or `ddev drush cr`.

## pnpm scripts, not binaries

Never run the underlying tools directly (`pnpm exec eslint`, `pnpm exec nuxt
typecheck`, `pnpm exec vue-tsc`). The TypeScript wrapper scripts only take
effect through the npm scripts: the `lint` and `typecheck` scripts preload
`nuxt/scripts/use-ts6.cjs`, which resolves `typescript` to the TS 6 alias —
the environment otherwise has TS 7, which vue-tsc and typescript-eslint reject.
Always run `ddev exec pnpm run lint` and `ddev exec pnpm run typecheck`.

## UI Templates

When working with nuxt ui use the following templates as reference:
- https://github.com/nuxt-ui-templates/calendar
- https://github.com/nuxt-ui-templates/chat
- https://github.com/nuxt-ui-templates/docs
- https://github.com/nuxt-ui-templates/portfolio
- https://github.com/nuxt-ui-templates/editor
- https://github.com/nuxt-ui-templates/saas
- https://github.com/nuxt-ui-templates/dashboard
- https://github.com/nuxt-ui-templates/changelog
- https://github.com/nuxt-ui-templates/landing

## Domain Driven Development

Make use of [nuxt layers](https://nuxt.com/docs/4.x/getting-started/layers) to separate your application into different layers. This allows you to have a clear separation of concerns and makes it easier to manage your codebase.

### After editing a layer, touch `nuxt.config.ts`

The dev server does not reliably pick up work done inside `layers/`. Finish
every change under `nuxt/layers/` with:

```
touch nuxt/nuxt.config.ts
```

Nuxt watches the config and rebuilds itself on a change — verified:
`.nuxt/dev/index.mjs` is rewritten a second after the touch. Do it as the last
step, before reporting the change as ready. Never restart or kill the dev
server process instead: it runs in the user's own terminal, and the touch
achieves the rebuild without taking it away from them.

## Split UI and business logic

Always keep the two apart. Business logic — the rules of a domain, how values
are derived, converted, validated, grouped or compared — lives in plain
TypeScript under `utils/` (or a composable when it needs reactivity), with no
Vue component in reach, and has a vitest file in `tests/`. A component only
wires that logic to the controls and renders it: props in, events out, no rule
of its own.

- A component that holds a domain rule inline cannot be tested without
  mounting it, and cannot be reused on another page without copying the rule.
- A generic component knows no domain. When a domain needs something extra
  from it, the domain registers it — a slot, a hook prop, or a component
  provided with `provide`/`inject` — rather than the generic component growing
  a branch for it. The Drupal form renderer (`DrupalFormField`) is the example:
  it renders every widget Drupal describes, and the listing form provides its
  media and season widgets.
- Name generic components after what they render, not after the first page
  that used them.


## Local data

Never delete, move, truncate or overwrite `.data/` or anything in it (e.g. the SQLite database). It holds the user's configured services and credentials, which cannot be recovered. This also applies to test cleanup: tests and experiments use their own location, e.g. `NUXT_DATABASE_PATH` pointing to a temp directory, and only clean up that location.

## State

When handling state always prefer using the url. E.g. pagination, filters, sorting, etc. should be handled via the url and not via a state management library like pinia. This allows for better user experience and makes it easier to share links with others.

## Data fetching and updates

When fetching data structure the code in a way that allows for easy prefetching. E.g. when hovering a button.

When updating data prefer using optimistic updates. This means that you update the UI immediately and then send the request to the server. If the request fails, you can revert the UI back to its previous state.

## Responsive images

Never hardcode breakpoint pixels into a `sizes` attribute (or any other media query written in script). Build them from `breakpointsTailwind` in `@vueuse/core` — the same source the `sm:`/`md:`/`lg:` classes come from — so an image's chosen candidate and the layout it sits in cannot drift apart:

```ts
import { breakpointsTailwind } from '@vueuse/core'

const { sm, md, lg } = breakpointsTailwind
const leadSizes = `(min-width: ${md}px) 50vw, 100vw`
```

For a reactive boolean, use the `useTailwindBreakpoints()` composable instead.

## Tooling

Always run tooling through the `package.json` scripts (`pnpm lint`, `pnpm typecheck`, …). Never call the binary directly (`pnpm exec eslint`, `npx tsc`).

The scripts carry a wrapper the bare binary cannot know about: `lint` and `typecheck` preload `scripts/use-ts6.cjs` via `NODE_OPTIONS=--require`, which patches `Module._resolveFilename` so `typescript` resolves to the `typescript-6` alias. typescript-eslint and vue-tsc do not support the TS 7 API the editor and the Vite build run on. Calling `eslint` directly skips the shim and fails with `typescript-eslint does not support TS 7.0` — that looks like broken tooling, but it is not.

`NODE_OPTIONS=--require` is silently ignored by bun, so a bun runtime needs `bun --preload ./scripts/use-ts6.cjs` (or a `bunfig.toml` `preload`) instead. `bun run lint` still works, because the `eslint` bin's shebang hands it to node.


## Node Cluster Compatibility

All server-side code must work when Nitro runs in `node_cluster` mode (multiple worker processes). Never assume a single process:

- No in-process state as source of truth. Module-scope variables, `Map`/`Set` caches, counters, rate-limit buckets and session stores are per-worker and diverge between requests. Use the Nitro storage layer, Redis or the database instead.
- No in-process pub/sub. `EventEmitter`, `hookable` events and WebSocket peer lists only reach the current worker. Use a shared broker (Redis pub/sub) for cross-worker messaging.
- No worker-local scheduling. `setInterval`/`setTimeout` cron-style jobs run once per worker. Guard them with a distributed lock or move them to an external scheduler.
- No exclusive resources. Don't bind extra ports, write to fixed temp file paths, or hold single-writer file handles — every worker executes the same code.
- Locks and idempotency belong in the database. Use transactions, `SELECT ... FOR UPDATE` or unique constraints instead of in-memory mutexes.
- Keep connection pools small. Pool size is multiplied by the worker count.
- Any request must be servable by any worker — no sticky-session assumptions.

## Performance

### Route params that only switch a view remount the page

`NuxtPage` keys the page component with `route.meta.key`, falling back to the route path with its params filled in (`nuxt/dist/pages/runtime/utils.js`, `generateRouteKey`). So on a route like `pages/things/[id]/[[tab]].vue`, every tab is a different key, and Vue destroys and rebuilds the whole page subtree — navbar, aside, every form control — on a switch that changes nothing but which section is shown. The same key drives `isChangingPage`, so the loading indicator fires too, and each Reka/Nuxt UI component that teleports (tooltips, popovers, selects) churns its anchor in `<body>` on the way out and back in.

Key the page by what actually changes the data:

```js
definePageMeta({
  key: route => `/dashboard/listings/${route.params.id}`
})
```

Navigating to another listing still remounts, which is what you want. Switching sections now only re-renders below the shared chrome. Measured on the listing form: 343 ms → ~120 ms for a 16-field section, and two long tasks per switch collapsed into one.

Reach for this whenever a route param selects a view rather than a resource — tabs, steps in a wizard, filter modes.

### Keep computed dependencies as narrow as the work is expensive

A computed re-runs when anything it touched changes. When one feeds an `items` prop, a single cheap-looking dependency drags the expensive part along with it:

```js
// Recomputes on every section switch, because `active` reads the current
// section — and walks every section's whole field tree while it is there.
const links = computed(() => sections.value.map(s => ({
  label: s.label,
  active: s.slug === section.value?.slug,
  status: hasMissingFields(collectFormFields(s.children)) ? … : …
})))
```
