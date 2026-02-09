# Tusk Drift GitHub Action

<p align="center">
  <a href="https://usetusk.ai">
    <img src="./assets/tusk.png" width="200" title="Tusk" alt="Tusk">
  </a>
</p>

<div align="center">

[![Tusk Drift Docs](https://img.shields.io/badge/Tusk%20Drift-Docs-6C63FF?style=flat&logo=readthedocs&logoColor=white)](https://docs.usetusk.ai/api-tests/overview)
[![GitHub Tag](https://img.shields.io/github/v/tag/Use-Tusk/drift-action?sort=semver&label=latest+version)](https://github.com/Use-Tusk/drift-action/tags)
[![CI](https://github.com/Use-Tusk/drift-action/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Use-Tusk/drift-action/actions/workflows/ci.yml?query=branch%3Amain)
[![CodeQL](https://github.com/Use-Tusk/drift-action/actions/workflows/codeql-analysis.yml/badge.svg?branch=main)](https://github.com/Use-Tusk/drift-action/actions/workflows/codeql-analysis.yml?query=branch%3Amain)
[![X URL](https://img.shields.io/twitter/url?url=https%3A%2F%2Fx.com%2Fusetusk&style=flat&logo=x&label=Tusk&color=BF40BF)](https://x.com/usetusk)
[![Slack URL](https://img.shields.io/badge/slack-badge?style=flat&logo=slack&label=Tusk&color=BF40BF)](https://join.slack.com/t/tusk-community/shared_invite/zt-3fve1s7ie-NAAUn~UpHsf1m_2tdoGjsQ)

</div>

Run Tusk Drift trace tests in GitHub Actions.

New to Tusk Drift? Check out our [main page](https://www.usetusk.ai/tusk-drift)
or [docs](https://docs.usetusk.ai/api-tests/overview).

## What this action does

- Installs the [Tusk CLI](https://github.com/Use-Tusk/tusk-drift-cli) (`tusk`)
  with `https://cli.usetusk.ai/install.sh`.
- Can optionally build the CLI from a GitHub repo/ref (for unreleased
  dogfooding).
- Restores and saves Tusk cache data (optional).
- Runs a configurable Tusk command (defaults to CI cloud validation mode).
- Optionally injects `TUSK_API_KEY` from an input.

## Quick usage

```yaml
name: Tusk Drift

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  tusk-drift:
    runs-on: ubuntu-latest
    if: github.event_name == 'push' || github.event.pull_request.draft == false

    steps:
      - uses: actions/checkout@v4

      # Any project-specific setup steps go here, for example:
      # - build Docker image
      # - install dependencies
      # - copy env files

      - name: Run Tusk Drift
        uses: Use-Tusk/drift-action@v1
        with:
          working-directory: .
          cache-key:
            ${{ runner.os }}-tusk-drift-${{ hashFiles('.tusk/config.yaml') }}
          api-key: ${{ secrets.TUSK_API_KEY }}
```

## Inputs

<table>
  <thead>
    <tr>
      <th>Input</th>
      <th>Required</th>
      <th>Default</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>working-directory</code></td>
      <td>No</td>
      <td><code>.</code></td>
      <td>Directory where install and run commands execute.</td>
    </tr>
    <tr>
      <td><code>cli-source</code></td>
      <td>No</td>
      <td><code>release</code></td>
      <td>Install source mode: <code>release</code> or <code>source</code>.</td>
    </tr>
    <tr>
      <td><code>install-script-url</code></td>
      <td>No</td>
      <td><code>https://cli.usetusk.ai/install.sh</code></td>
      <td>Install script URL for Tusk CLI. Only used if <code>cli-source</code> is <code>release</code>.</td>
    </tr>
    <tr>
      <td><code>cli-version</code></td>
      <td>No</td>
      <td>Latest available CLI version</td>
      <td>Specific CLI version to install (for example <code>v1.2.3</code>). Only used if <code>cli-source</code> is <code>release</code>.</td>
    </tr>
    <tr>
      <td><code>cli-source-ref</code></td>
      <td>No</td>
      <td><code>main</code></td>
      <td>Git ref to build from when <code>cli-source</code> is <code>source</code>.</td>
    </tr>
    <tr>
      <td><code>cache</code></td>
      <td>No</td>
      <td><code>true</code></td>
      <td>Restore and save cache for Tusk data.</td>
    </tr>
    <tr>
      <td><code>cache-path</code></td>
      <td>No</td>
      <td><code>~/.cache/tusk</code></td>
      <td>Cache directory path.</td>
    </tr>
    <tr>
      <td><code>cache-key</code></td>
      <td>No</td>
      <td><code>${RUNNER_OS}-tusk-drift</code></td>
      <td>Cache key for restore/save.</td>
    </tr>
    <tr>
      <td><code>cache-restore-keys</code></td>
      <td>No</td>
      <td><code></code></td>
      <td>Newline-delimited fallback cache keys.</td>
    </tr>
    <tr>
      <td><code>run-command</code></td>
      <td>No</td>
      <td><code>tusk run -c -p --ci --validate-suite-if-default-branch</code></td>
      <td>Command to execute Tusk Drift tests.</td>
    </tr>
    <tr>
      <td><code>api-key</code></td>
      <td>No</td>
      <td><code></code></td>
      <td>Passed as <code>TUSK_API_KEY</code> for the run command.</td>
    </tr>
  </tbody>
</table>

## Outputs

<table>
  <thead>
    <tr>
      <th>Output</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>tusk-version</code></td>
      <td>Version returned by <code>tusk --version</code>.</td>
    </tr>
    <tr>
      <td><code>cache-hit</code></td>
      <td><code>true</code> when cache restored with an exact key match; otherwise <code>false</code>.</td>
    </tr>
  </tbody>
</table>

## Notes

- The action adds `~/.local/bin` and `/usr/local/bin` to `PATH`.
- If your job should skip cache handling, set `cache: false`.

## Contact

Need help? Raise an issue for drop us an email at <support@usetusk.ai>.
