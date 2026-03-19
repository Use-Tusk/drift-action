import * as core from '@actions/core'

import * as cache from '@actions/cache'
import * as exec from '@actions/exec'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_INSTALL_SCRIPT_URL = 'https://cli.usetusk.ai/install.sh'
const DEFAULT_RUN_COMMAND =
  'tusk run -c -p --ci --validate-suite-if-default-branch'
const DEFAULT_CACHE_PATH = '~/.cache/tusk'
const CLI_SOURCE_REPOSITORY = 'Use-Tusk/tusk-drift-cli'
const DEFAULT_CLI_SOURCE_REF = 'main'
const SUBID_BLOCK_SIZE = 65536
const SUBID_MIN_START = 100000
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'on'])
const FALSE_VALUES = new Set(['0', 'false', 'no', 'n', 'off'])

type CommandResult = {
  exitCode: number
  stdout: string
  stderr: string
}

function parseBooleanInput(name: string, defaultValue: boolean): boolean {
  const raw = core.getInput(name).trim()
  if (raw === '') {
    return defaultValue
  }

  const normalized = raw.toLowerCase()
  if (TRUE_VALUES.has(normalized)) {
    return true
  }
  if (FALSE_VALUES.has(normalized)) {
    return false
  }

  throw new Error(
    `Input "${name}" must be a boolean value (true/false), received "${raw}"`
  )
}

function getStringInput(name: string, defaultValue: string): string {
  const value = core.getInput(name).trim()
  return value === '' ? defaultValue : value
}

function parseMultilineInput(name: string): string[] {
  return core
    .getMultilineInput(name)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function expandHomeDir(pathValue: string): string {
  if (pathValue === '~') {
    return homedir()
  }
  if (pathValue.startsWith('~/')) {
    return join(homedir(), pathValue.slice(2))
  }
  return pathValue
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function getCliInstallMode(): 'release' | 'source' {
  const raw = getStringInput('cli-source', 'release').toLowerCase()
  if (raw === 'release' || raw === 'source') {
    return raw
  }

  throw new Error(
    `Input "cli-source" must be either "release" or "source", received "${raw}"`
  )
}

async function readTuskVersion(): Promise<string> {
  let output = ''
  await exec.exec('tusk', ['--version'], {
    silent: true,
    listeners: {
      stdout: (data) => {
        output += data.toString()
      }
    }
  })

  return output.trim()
}

function buildExecEnvironment(apiKey: string): { [key: string]: string } {
  const env: { [key: string]: string } = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value
    }
  }

  if (apiKey !== '') {
    env['TUSK_API_KEY'] = apiKey
  }

  return env
}

async function installFromReleaseScript(
  workingDirectory: string,
  installScriptUrl: string,
  cliVersion: string
): Promise<void> {
  core.startGroup('Install Tusk CLI (release)')
  try {
    const installCommand =
      cliVersion === ''
        ? `curl -fsSL ${shellQuote(installScriptUrl)} | sh`
        : `curl -fsSL ${shellQuote(installScriptUrl)} | sh -s -- ${shellQuote(cliVersion)}`

    await exec.exec('bash', ['-eo', 'pipefail', '-c', installCommand], {
      cwd: workingDirectory
    })
  } finally {
    core.endGroup()
  }
}

async function installFromSource(
  workingDirectory: string,
  ref: string
): Promise<void> {
  core.startGroup('Install Tusk CLI (source)')
  try {
    await exec.exec('go', ['version'], { cwd: workingDirectory })

    const repoUrl = `https://github.com/${CLI_SOURCE_REPOSITORY}.git`
    const installCommand =
      `tmp_dir="$(mktemp -d)" && ` +
      `trap 'rm -rf "$tmp_dir"' EXIT && ` +
      `git clone --depth 1 --branch ${shellQuote(ref)} ${shellQuote(repoUrl)} "$tmp_dir/repo" && ` +
      `cd "$tmp_dir/repo" && ` +
      `go build -o tusk . && ` +
      `install_dir="/usr/local/bin" && ` +
      `if [ ! -w "$install_dir" ]; then install_dir="$HOME/.local/bin"; mkdir -p "$install_dir"; fi && ` +
      `mv tusk "$install_dir/" && chmod +x "$install_dir/tusk"`

    await exec.exec('bash', ['-eo', 'pipefail', '-c', installCommand], {
      cwd: workingDirectory
    })
  } finally {
    core.endGroup()
  }
}

async function execCapture(
  command: string,
  args: string[]
): Promise<CommandResult> {
  let stdout = ''
  let stderr = ''
  const exitCode = await exec.exec(command, args, {
    silent: true,
    ignoreReturnCode: true,
    listeners: {
      stdout: (data: Buffer) => {
        stdout += data.toString()
      },
      stderr: (data: Buffer) => {
        stderr += data.toString()
      }
    }
  })

  return {
    exitCode,
    stdout: stdout.trim(),
    stderr: stderr.trim()
  }
}

async function resolveCommandPath(command: string): Promise<string | null> {
  const result = await execCapture('which', [command])
  if (result.exitCode !== 0 || result.stdout === '') {
    return null
  }

  return result.stdout.split(/\r?\n/, 1)[0] ?? null
}

function summarizeFailure(result: CommandResult): string {
  const detail = (result.stderr || result.stdout).replace(/\s+/g, ' ').trim()
  if (detail !== '') {
    return detail
  }

  return `exit code ${result.exitCode}`
}

function isHostedLinuxRunner(): boolean {
  if (process.platform !== 'linux') {
    return false
  }

  // GitHub-hosted Linux images expose ImageOS; prefer that signal to avoid
  // mutating arbitrary self-hosted runners when sandbox bootstrap fails.
  return (
    process.env['RUNNER_ENVIRONMENT'] === 'github-hosted' ||
    process.env['ImageOS'] !== undefined
  )
}

async function runLinuxSandboxPreflight(): Promise<CommandResult> {
  return execCapture('bwrap', [
    '--ro-bind',
    '/',
    '/',
    '--unshare-user',
    '--uid',
    '0',
    '--gid',
    '0',
    '--',
    '/bin/true'
  ])
}

async function ensureUidmapInstalled(): Promise<void> {
  const newuidmapPath = await resolveCommandPath('newuidmap')
  const newgidmapPath = await resolveCommandPath('newgidmap')
  if (newuidmapPath !== null && newgidmapPath !== null) {
    return
  }

  await exec.exec('sudo', ['apt-get', 'install', '-y', 'uidmap'])
}

async function ensureSubidEntry(filePath: string): Promise<void> {
  const script = `
set -euo pipefail
user_name="$(whoami)"
block_size=${SUBID_BLOCK_SIZE}
min_start=${SUBID_MIN_START}

sudo touch ${shellQuote(filePath)}
if sudo grep -q "^$user_name:" ${shellQuote(filePath)}; then
  exit 0
fi

start="$(
  sudo awk -F: -v block_size="$block_size" -v min_start="$min_start" '
    BEGIN { max = min_start - 1 }
    NF >= 3 {
      start = $2 + 0
      count = $3 + 0
      end = start + count - 1
      if (end > max) max = end
    }
    END {
      next = max + 1
      if (next < min_start) next = min_start
      rem = next % block_size
      if (rem != 0) next += block_size - rem
      print next
    }
  ' ${shellQuote(filePath)}
)"

printf '%s\\n' "$user_name:$start:$block_size" | sudo tee -a ${shellQuote(filePath)} >/dev/null
`.trim()

  await exec.exec('bash', ['-eo', 'pipefail', '-c', script])
}

async function ensureBwrapSetuid(bwrapPath: string): Promise<void> {
  const status = await execCapture('bash', [
    '-eo',
    'pipefail',
    '-c',
    `test -u ${shellQuote(bwrapPath)}`
  ])
  if (status.exitCode === 0) {
    return
  }

  await exec.exec('sudo', ['chmod', 'u+s', bwrapPath])
}

async function installSandboxDeps(): Promise<void> {
  if (process.platform !== 'linux') {
    return
  }

  const missing: string[] = []
  for (const bin of ['bwrap', 'socat']) {
    if ((await resolveCommandPath(bin)) === null) {
      missing.push(bin === 'bwrap' ? 'bubblewrap' : bin)
    }
  }

  if (missing.length > 0) {
    core.startGroup(`Installing sandbox dependencies: ${missing.join(', ')}`)
    try {
      await exec.exec('sudo', ['apt-get', 'install', '-y', ...missing])
    } catch (error) {
      if (error instanceof Error) {
        core.warning(
          `Failed to install sandbox dependencies: ${error.message}. Sandboxing may be unavailable.`
        )
      }
    } finally {
      core.endGroup()
    }
  }

  const bwrapPath = await resolveCommandPath('bwrap')
  if (bwrapPath === null) {
    return
  }

  const preflight = await runLinuxSandboxPreflight()
  if (preflight.exitCode === 0) {
    return
  }

  const preflightSummary = summarizeFailure(preflight)
  core.info(`Linux sandbox preflight failed: ${preflightSummary}`)

  if (!isHostedLinuxRunner()) {
    core.warning(
      `Linux sandbox preflight failed: ${preflightSummary}. This action will not modify this runner automatically. To enable strict replay sandboxing, install uidmap, configure /etc/subuid and /etc/subgid, and ensure bwrap is setuid.`
    )
    return
  }

  const sudoPath = await resolveCommandPath('sudo')
  if (sudoPath === null) {
    core.warning(
      `Linux sandbox preflight failed: ${preflightSummary}. sudo is unavailable, so the action cannot repair sandbox support automatically.`
    )
    return
  }

  core.startGroup('Repair Linux sandbox support')
  try {
    await ensureUidmapInstalled()
    await ensureSubidEntry('/etc/subuid')
    await ensureSubidEntry('/etc/subgid')
    await ensureBwrapSetuid(bwrapPath)
  } catch (error) {
    if (error instanceof Error) {
      core.warning(
        `Failed to repair Linux sandbox support: ${error.message}. Strict replay sandboxing may be unavailable.`
      )
    }
    return
  } finally {
    core.endGroup()
  }

  const repairedPreflight = await runLinuxSandboxPreflight()
  if (repairedPreflight.exitCode !== 0) {
    core.warning(
      `Linux sandbox preflight still failing after repair: ${summarizeFailure(repairedPreflight)}. Strict replay sandboxing may be unavailable.`
    )
    return
  }

  core.info('Linux sandbox preflight passed after repair')
}

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const workingDirectory = getStringInput('working-directory', '.')
    const cliSource = getCliInstallMode()
    const cacheEnabled = parseBooleanInput('cache', true)
    const installScriptUrl = getStringInput(
      'install-script-url',
      DEFAULT_INSTALL_SCRIPT_URL
    )
    const cliVersion = core.getInput('cli-version').trim()
    const cliSourceRef = getStringInput(
      'cli-source-ref',
      DEFAULT_CLI_SOURCE_REF
    )
    const runCommand = getStringInput('run-command', DEFAULT_RUN_COMMAND)
    const apiKey = core.getInput('api-key').trim()
    const cachePath = expandHomeDir(
      getStringInput('cache-path', DEFAULT_CACHE_PATH)
    )
    const cacheRestoreKeys = parseMultilineInput('cache-restore-keys')
    const cacheKeyInput = core.getInput('cache-key').trim()
    const defaultCacheKey = `${process.env['RUNNER_OS'] ?? process.platform}-tusk-drift`
    const cacheKey = cacheKeyInput === '' ? defaultCacheKey : cacheKeyInput

    let restoredCacheKey: string | undefined
    if (cacheEnabled) {
      try {
        restoredCacheKey = await cache.restoreCache(
          [cachePath],
          cacheKey,
          cacheRestoreKeys.length > 0 ? cacheRestoreKeys : undefined
        )
      } catch (error) {
        if (error instanceof Error) {
          core.warning(`Failed to restore cache: ${error.message}`)
        }
      }
    }

    core.setOutput(
      'cache-hit',
      restoredCacheKey === cacheKey ? 'true' : 'false'
    )

    core.addPath(join(homedir(), '.local', 'bin'))
    core.addPath('/usr/local/bin')

    if (cliSource === 'release') {
      await installFromReleaseScript(
        workingDirectory,
        installScriptUrl,
        cliVersion
      )
    } else {
      await installFromSource(workingDirectory, cliSourceRef)
    }

    await installSandboxDeps()

    try {
      const version = await readTuskVersion()
      if (version !== '') {
        core.info(`Using ${version}`)
        core.setOutput('tusk-version', version)
      }
    } catch (error) {
      if (error instanceof Error) {
        core.warning(`Unable to determine Tusk version: ${error.message}`)
      }
    }

    const env = buildExecEnvironment(apiKey)
    await exec.exec('bash', ['-eo', 'pipefail', '-c', runCommand], {
      cwd: workingDirectory,
      env
    })

    if (cacheEnabled && restoredCacheKey !== cacheKey) {
      try {
        await cache.saveCache([cachePath], cacheKey)
      } catch (error) {
        if (error instanceof Error) {
          core.warning(`Failed to save cache: ${error.message}`)
        }
      }
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
