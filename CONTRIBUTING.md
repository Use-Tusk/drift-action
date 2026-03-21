# Contributing

## Prerequisites

- Node.js 24+ (see `.node-version`)
- npm
- Git

## Local development

1. Install dependencies:

   ```bash
   npm ci
   ```

2. Run all checks (format, lint, tests, coverage, bundle):

   ```bash
   npm run all
   ```

3. For faster iteration:

   ```bash
   npm run test
   npm run lint
   npm run package
   ```

## Project layout

- `src/main.ts`: action logic
- `src/index.ts`: runtime entrypoint
- `__tests__/`: unit tests
- `action.yml`: action metadata (inputs/outputs)
- `dist/`: bundled runtime used by GitHub Actions

## Important: keep `dist/` updated

This action is distributed as committed JavaScript in `dist/`. If you change
code in `src/` or dependencies, regenerate bundle artifacts before opening a PR:

```bash
npm run package
```

Then include updated `dist/index.js` and `dist/index.js.map` in your commit.

## Testing changes

- Update or add tests in `__tests__/` for behavior changes.
- Validate metadata changes in `action.yml` match runtime behavior in
  `src/main.ts`.
- If inputs/outputs change, update `README.md` examples and reference tables.

## Using the action locally

You can smoke test with:

```bash
npm run local-action
```

Use `.env` for local-action input/environment values.

## CLI coupling

This action is intentionally coupled to `Use-Tusk/tusk-cli`. When the CLI
changes, verify these contracts still hold:

- Release installer contract: `install.sh` still supports both `curl ... | sh`
  and `curl ... | sh -s -- <version>`.
- Source build contract: `cli-source: source` can still clone
  `Use-Tusk/tusk-cli` and build from repo root with `go build -o tusk .`.
- Binary contract: resulting binary name remains `tusk` and `tusk --version`
  still works.
- Run command contract: default command in this action remains valid with
  current CLI flags (`tusk run -c -p --ci --validate-suite-if-default-branch`).
- Auth/cache contract: CLI still reads `TUSK_API_KEY` and default cache data
  remains under `~/.cache/tusk`.

If any of these contracts change in the CLI, update `src/main.ts`, `action.yml`,
`README.md`, and tests together in the same PR.

## Release flow

This repo includes a helper at `scripts/release.sh` for creating and pushing
action release tags.

### Before releasing

1. Ensure `main` is up to date and clean.
2. Make sure action artifacts are current:

   ```bash
   npm ci
   npm run all
   ```

### Create and push a release tag

Run:

```bash
sh scripts/release.sh
```

You can optionally pass a bump type:

```bash
sh scripts/release.sh patch
sh scripts/release.sh minor
sh scripts/release.sh major
```

The script will:

- suggest an auto-incremented `vX.X.X` tag and let you confirm with `Y`
- create the exact tag (for example `v1.2.0`)
- create or sync the major tag (`v1`)
- push tags to `origin`
- create/push `releases/v#` on a new major release

### Notes

- For non-major releases, the script force-updates the major tag (`v1`, `v2`,
  etc.) to the new latest minor/patch release.
- After tagging, publish a GitHub Release for the new exact tag so users can
  discover release notes and changes.
