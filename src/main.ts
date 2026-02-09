import * as core from '@actions/core'

import * as cache from '@actions/cache'
import * as exec from '@actions/exec'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_INSTALL_SCRIPT_URL = 'https://cli.usetusk.ai/install.sh'
const DEFAULT_RUN_COMMAND =
  'tusk run -c -p --ci --validate-suite-if-default-branch'
const DEFAULT_CACHE_PATH = '~/.cache/tusk'
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'on'])
const FALSE_VALUES = new Set(['0', 'false', 'no', 'n', 'off'])

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

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const workingDirectory = getStringInput('working-directory', '.')
    const cacheEnabled = parseBooleanInput('cache', true)
    const installScriptUrl = getStringInput(
      'install-script-url',
      DEFAULT_INSTALL_SCRIPT_URL
    )
    const cliVersion = core.getInput('cli-version').trim()
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

    const installCommand =
      cliVersion === ''
        ? `curl -fsSL ${shellQuote(installScriptUrl)} | sh`
        : `curl -fsSL ${shellQuote(installScriptUrl)} | sh -s -- ${shellQuote(cliVersion)}`

    await exec.exec('bash', ['-eo', 'pipefail', '-c', installCommand], {
      cwd: workingDirectory
    })

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
