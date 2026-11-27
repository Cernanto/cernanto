# The Cernanto web UI

A console for the plane, served by the plane's own gateway: the agents
on the left as the people of a chat app, each agent's calls as a
conversation with the agents it talks to, a box that calls one of its
functions, its source, its code, its settings and its accounts beside
them.

It is a client of the gateway's OpenAPI document and nothing more, as
the cli is: what a screen shows is an answer of the gateway, and what it
does is an operation of the gateway. It holds no logic of the plane and
keeps no state but what a reader would lose nothing by losing: the look,
the clock, the favorites, and the drafts of sources not deployed yet,
all in the browser's own storage.

## How it is made

A static single-page app in React and TypeScript, built by Vite into
`dist/`: one document, its scripts under `js/` and its stylesheet under
`css/`, the font and the drawings carried inside them. Those are the
three kinds of file the gateway serves, at `/`, `/ui/js/` and
`/ui/css/`.

One more script rides with them, `js/third-party-notices.js`: the
notices of what the built files carry of other parties, every package
a script holds code of, the stylesheet's framework, the font and the
drawings, each with the license it came under. The build makes it, it
is one comment, and the document never loads it.

It ships as a platform agent, `cernanto/ui`: a module that carries the
same three kinds of file as its granted folder, `cernanto/ui/bundle/`,
and answers them to the gateway. So the UI reaches a plane as every
platform agent does, inside its package, and a plane serves the UI its
`cernanto/ui` package holds.

- `scripts/gateway-client.mjs` makes the gateway client under
  `src/gateway/` from `cernanto/gateway/openapi.yaml`, by the generator
  and the script the cli uses. It is made before every build, type-check
  and lint, and is never committed.
- `src/model/` reads what the plane answers: a call's records as a
  conversation, a contract as a form, a source as its labels.
- `src/api/` asks the gateway, and follows its three streams.
- `src/screens/` are the screens; `src/components/` what they share.
- `src/styles/tokens.css` holds the look: the site's tokens under the
  site's names, and the UI's own tones beside them.

## Working on it

```sh
pnpm install
pnpm --filter @cernanto/package-format run build
pnpm -C ui run dev         # Vite's own server on 5183, passing the API on to the dev plane
pnpm -C ui run build       # into ui/dist, to look at the bundle itself (vite preview)
pnpm -C ui run typecheck
pnpm -C ui run lint
```

With the dev plane up (`cernanto dev`), a screen is written and looked
at on the dev server, `http://127.0.0.1:5183/ui/`: an edit shows as the
file is saved, and every request goes on to the plane.

The plane's own address, `http://127.0.0.1:7434/`, shows the UI that
was landed last. A landing lays the bundle in the agent's folder and
deploys the agent, and the gateway restarts onto it:

```sh
pnpm -C ui run land                  # into cernanto/ui/bundle
cernanto deploy cernanto/ui
```

The bundle and the agent's package are committed with the change they
carry, so the UI is landed by the batch of work and not by the edit.
