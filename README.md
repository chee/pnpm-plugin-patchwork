# pnpm-plugin-patchwork

> **Warning**: chee has not read line 1 of this codebase. It was entirely written by the computer.

A pnpm custom resolver and fetcher for installing packages from a [patchwork](https://github.com/inkandswitch/pushwork) filesystem (automerge-repo).

Specify dependencies as `automerge:<documentId>` in your `package.json` and pnpm will resolve and fetch them from the automerge sync server.

## Requirements

- pnpm v11 (beta.2+) — uses the top-level `resolvers`/`fetchers` plugin API

## Setup

1. Add `pnpm-plugin-patchwork` as a config dependency in your `pnpm-workspace.yaml`:

```yaml
configDependencies:
  pnpm-plugin-patchwork: "0.1.0"
```

2. Add automerge dependencies to your `package.json`:

```json
{
  "dependencies": {
    "@patchwork/chat": "automerge:6iXwddwF9cwrjmM5yqp2xUENxUY"
  }
}
```

3. Run `pnpm install`.

## How it works

- **Resolver**: Detects `automerge:` specifiers, connects to the automerge sync server, reads the folder document's `package.json` to get the package manifest, and returns a `custom:automerge` resolution.

- **Fetcher**: Connects to the sync server, recursively walks the automerge folder document tree to collect all files, packs them into a tarball, and delegates to pnpm's built-in `localTarball` fetcher.

- **Caching**: The document ID + heads hash is used as the resolution ID in the lockfile, so installs are cached until the document changes.

## Subpath resolution

You can resolve a subfolder of a folder document as the package root:

```json
{
  "dependencies": {
    "my-pkg": "automerge:6iXwddwF9cwrjmM5yqp2xUENxUY/dist"
  }
}
```

## Configuration

The sync server defaults to `wss://sync3.automerge.org`. To use a different server, add a `pushwork.server` field to your `package.json`:

```json
{
  "pushwork": {
    "server": "wss://my-sync-server.example.com"
  }
}
```

Or set the `PATCHWORK_SYNC_SERVER` environment variable (takes precedence):

```sh
PATCHWORK_SYNC_SERVER=wss://my-sync-server.example.com pnpm install
```

## Tests

```sh
pnpm test
```

Unit tests use a mocked automerge repo. The e2e test runs `pnpm install` in `test/fixture/` against the real sync server.
