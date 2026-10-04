# dsh-activity-bar

A DeepSeek Harness Web GUI plugin that adds a **VS Code-style activity bar** — an independent
narrow icon strip at the window's far left, with the sidebar drawer to its right. The workspace,
device, plugin and task-board entries move from full-width sidebar rows into that strip, and other
plugins can register their own icons and left-side views through `ctx.activityBar`.

## What it does

- **An icon strip, an independent container**: a 44px column of icons sits at the window's far
  left, and the sidebar drawer starts to its right (the width is themeable through
  `--dsh-activity-bar-width`). Order: `Workspace`, then the entry rows already present in the
  sidebar (in their own top-to-bottom order), then items registered by other plugins. Collapsing
  the drawer slides the drawer away and leaves the strip in place, so the strip is never inside
  the drawer's box — a skin that draws a frame around the sidebar column does not take the strip
  into it either.
- **Mirroring, not rewriting**: official `sidebar.panellist` rows (Plugins, Task board, …) and
  plugin-injected entry rows (`data-dsh-part="sidebar-entry"`, e.g. dsh-interconnect's Devices or
  dsh-task-board's Task board) are *mirrored* into icons — the glyph is a clone of the row's own
  glyph, a click is a click on that row, and the selected state is read from it. Any current or
  future entry row therefore shows up in the activity bar with no per-plugin work.
- **Wide drawer only for the rows**: an entry row is mirrored while the sidebar shows its wide
  content, and the row itself gives way to the icon. In browser layouts, where a collapsed sidebar
  keeps the shell's own 56px rail, the strip stands down instead so the two icon columns never sit
  side by side; in the desktop layouts (macOS, Windows title bar) the collapsed drawer is
  zero-width, so the strip stays and remains the only navigation.
- **Views**: `Workspace` is the built-in view (the shell's own workspace/session browser). Other
  views are supplied by registered items; while one is active the official browser is hidden and
  the registrant's content renders in the same region.
- **Hybrid click semantics**: the `Workspace` icon toggles the left browser (clicking it while
  active collapses the sidebar, as VS Code does); icons such as `Plugins` / `Task board` /
  `Devices` open their **centre-column panel** — those pages are unchanged, only their entry
  moved.

## Install

```sh
# 1) add it to the web profile (a local checkout installs as link:)
dsh plugin --profile web add link:/path/to/dsh-activity-bar

# 2) restart dsh web — a bundle-row change needs a restart
```

Or edit the profile directly: add `@linxin666/dsh-activity-bar` to `dsh.profile.bundles` in
`~/.dsh/profiles/web/package.json`, with
`"@linxin666/dsh-activity-bar": "link:/path/to/dsh-activity-bar"` in its dependencies.

## For plugin authors: registering an item

```ts
// in your plugin's apply — the activity bar is an optional dependency, so wait for its service
ctx.inject(['activityBar'], (scoped) => {
  const bar = scoped.get('activityBar')
  if (bar === undefined) return
  scoped.effect(() => bar.register({
    id: 'my-plugin:view',
    label: () => 'My view',
    icon: '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3">…</svg>',
    kind: 'view',
    view: 'my-plugin:main',
    mountView: (container) => {
      container.append(myNode())
      return () => { /* cleanup */ }
    },
  }), 'my-plugin: activity bar entry')
})
```

- `kind: 'view'` switches the left view (`mountView` draws into the given container and returns a
  disposer). `kind: 'action'` just runs `activate()` — for example to open your own centre panel.
- `active` may supply `{ subscribe, isActive }` so the icon follows your own selected state; a view
  item without it is active exactly while its view is the current one.
- `order` only orders registered items against each other (default 1000); mirrored rows always come
  first.

**Never assume the activity bar is installed.** Without it `ctx.activityBar` does not exist, so
treat `ctx.inject(['activityBar'], …)` as an optional enhancement rather than adding it to your
plugin's own `inject`.

## Implementation notes (maintainers)

- The official sidebar exposes no slot an external plugin can register into (`sidebar` is a single
  slot owned by ui-sidebar), so the strip is **injected** as a child of AppFrame, the grid container
  the three columns share: it only inserts its own nodes, never moves or wraps React-owned ones, and
  self-heals through a MutationObserver (re-inserted in the same frame when a React re-render
  displaces it).
- The mount point is AppFrame rather than the sidebar root because the sidebar column is what skins
  decorate (`[class*='sidebarCol']` frames the whole column): a strip inside the root would be
  counted into that frame, would slide away with the drawer, and would be clipped by the column's
  `overflow: hidden`. On the grid container the strip reserves its band through the host's
  `padding-left`, which shifts the sidebar, centre and right tracks together without touching the
  shell's own grid solve.
- Shell state is published on AppFrame as attributes — `data-dsh-activity-bar-host` (the strip lives
  here), `-wide` (the sidebar shows its wide content), `-view` (a custom view is active) and `-rail`
  (the shell's own rail takes over, so the strip stands down). Hiding the official rows, reserving
  the band and hiding the built-in browser are pure CSS
  (`src/client/activity-bar.module.css`).
- The strip follows the colour the sidebar column actually paints (read from its computed
  background), so a skin that floods the column with its own fill does not leave a foreign band next
  to it; a gradient or transparent column falls back to the CSS token.
- Applied icons are remembered in a `WeakMap` keyed by the markup written, rather than compared
  through `innerHTML`: re-reading `innerHTML` re-serializes it, so comparing it would rewrite the DOM
  on every render, retrigger the observer, and spin the microtask queue.
- `shared/tsdown.client.ts` and `shared/web-platform.ts` are taken verbatim from dsh-web-ui's
  `shared/` (the same copies dsh-interconnect uses), so the browser bundle and platform module table
  match the rest of the family.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build      # tsc emits lib/types, tsdown emits lib/index.js and lib/client.js
```

## Known limitations

- In a browser layout, collapsing the sidebar hands navigation back to the shell's own 56px rail and
  the strip stands down; the desktop layouts keep the strip (their collapsed drawer is zero-width).
- The strip consumes 44px of window width (the shell's grid solve still prices the full frame, so the
  centre column loses those pixels); narrow the strip through the theme variable when the centring
  matters.
- Official rows are hidden by CSS in the wide state (not unmounted), so their behaviour, selected
  state and accessibility semantics keep exactly one source of truth: the row itself.
- The strip's own bottom is the frame's bottom: a footer control that a future shell version pins to
  the frame's left edge below the strip would overlap it.
