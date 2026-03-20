import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import * as cache from '../__fixtures__/cache.js'
import * as exec from '../__fixtures__/exec.js'

// Mocks should be declared before the module being tested is imported.
jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/cache', () => cache)
jest.unstable_mockModule('@actions/exec', () => exec)
const { run } = await import('../src/main.js')

const originalPlatform = process.platform
const originalImageOS = process.env['ImageOS']
const originalRunnerEnvironment = process.env['RUNNER_ENVIRONMENT']

function emitStdout(options: unknown, value: string): void {
  const stdout = (
    options as { listeners?: { stdout?: (data: Buffer) => void } } | undefined
  )?.listeners?.stdout
  stdout?.(Buffer.from(value))
}

function emitStderr(options: unknown, value: string): void {
  const stderr = (
    options as { listeners?: { stderr?: (data: Buffer) => void } } | undefined
  )?.listeners?.stderr
  stderr?.(Buffer.from(value))
}

function getBashScripts(): string[] {
  return exec.exec.mock.calls.flatMap(([command, args]) => {
    if (command !== 'bash' || !Array.isArray(args)) {
      return []
    }

    const script = args[3]
    return typeof script === 'string' ? [script] : []
  })
}

describe('main.ts', () => {
  beforeEach(() => {
    const inputs: Record<string, string> = {
      'working-directory': './backend',
      'install-script-url': 'https://cli.usetusk.ai/install.sh',
      'cli-source': 'release',
      'cli-version': '',
      'cli-source-ref': 'main',
      cache: 'true',
      'cache-path': '~/.cache/tusk',
      'cache-key': 'linux-tusk-drift-config-hash',
      'run-command': 'tusk run -c -p --ci --validate-suite-if-default-branch',
      'api-key': 'test-api-key'
    }

    core.getInput.mockImplementation((name: string) => inputs[name] ?? '')
    core.getMultilineInput.mockImplementation((name: string) => {
      if (name === 'cache-restore-keys') {
        return ['linux-tusk-drift-']
      }
      return []
    })

    cache.restoreCache.mockResolvedValue(undefined)
    cache.saveCache.mockResolvedValue(1)
    delete process.env['ImageOS']
    delete process.env['RUNNER_ENVIRONMENT']

    exec.exec.mockImplementation(
      async (cmd: string, args?: string[], options?: unknown) => {
        if (cmd === 'which') {
          const target = args?.[0]
          const paths: Record<string, string> = {
            bwrap: '/usr/bin/bwrap\n',
            socat: '/usr/bin/socat\n',
            sudo: '/usr/bin/sudo\n',
            newuidmap: '/usr/bin/newuidmap\n',
            newgidmap: '/usr/bin/newgidmap\n'
          }
          const path = target !== undefined ? paths[target] : undefined
          if (path === undefined) {
            return 1
          }
          emitStdout(options, path)
          return 0
        }

        if (cmd === 'tusk' && args?.[0] === '--version') {
          emitStdout(options, 'tusk version dev\n')
          return 0
        }

        return 0
      }
    )
  })

  afterEach(() => {
    jest.resetAllMocks()
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    if (originalImageOS === undefined) {
      delete process.env['ImageOS']
    } else {
      process.env['ImageOS'] = originalImageOS
    }
    if (originalRunnerEnvironment === undefined) {
      delete process.env['RUNNER_ENVIRONMENT']
    } else {
      process.env['RUNNER_ENVIRONMENT'] = originalRunnerEnvironment
    }
  })

  it('restores cache and runs the configured command', async () => {
    await run()

    expect(cache.restoreCache).toHaveBeenCalledWith(
      [expect.stringMatching(/\.cache\/tusk$/)],
      'linux-tusk-drift-config-hash',
      ['linux-tusk-drift-']
    )
    expect(exec.exec).toHaveBeenCalledWith(
      'bash',
      [
        '-eo',
        'pipefail',
        '-c',
        "curl -fsSL 'https://cli.usetusk.ai/install.sh' | sh"
      ],
      expect.objectContaining({
        cwd: './backend'
      })
    )
    expect(exec.exec).toHaveBeenCalledWith(
      'tusk',
      ['--version'],
      expect.objectContaining({ silent: true })
    )
    expect(exec.exec).toHaveBeenCalledWith(
      'bash',
      [
        '-eo',
        'pipefail',
        '-c',
        'tusk run -c -p --ci --validate-suite-if-default-branch'
      ],
      expect.objectContaining({
        cwd: './backend',
        env: expect.objectContaining({ TUSK_API_KEY: 'test-api-key' })
      })
    )
    expect(core.setOutput).toHaveBeenCalledWith('cache-hit', 'false')
  })

  it('marks action as failed for invalid cache input', async () => {
    core.getInput.mockImplementation((name: string) =>
      name === 'cache' ? 'maybe' : ''
    )

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      'Input "cache" must be a boolean value (true/false), received "maybe"'
    )
  })

  it('builds CLI from source when requested', async () => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'cli-source') {
        return 'source'
      }
      if (name === 'cache') {
        return 'false'
      }
      return ''
    })

    await run()

    expect(exec.exec).toHaveBeenCalledWith(
      'go',
      ['version'],
      expect.objectContaining({ cwd: '.' })
    )
    expect(exec.exec).toHaveBeenCalledWith(
      'bash',
      [
        '-eo',
        'pipefail',
        '-c',
        `tmp_dir="$(mktemp -d)" && trap 'rm -rf "$tmp_dir"' EXIT && git clone --depth 1 --branch 'main' 'https://github.com/Use-Tusk/tusk-cli.git' "$tmp_dir/repo" && cd "$tmp_dir/repo" && go build -o tusk . && install_dir="/usr/local/bin" && if [ ! -w "$install_dir" ]; then install_dir="$HOME/.local/bin"; mkdir -p "$install_dir"; fi && mv tusk "$install_dir/" && chmod +x "$install_dir/tusk"`
      ],
      expect.objectContaining({ cwd: '.' })
    )
  })

  it('installs sandbox deps on linux when missing', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    const whichCalls = new Map<string, number>()
    exec.exec.mockImplementation(
      async (cmd: string, args?: string[], options?: unknown) => {
        if (cmd === 'which') {
          const target = args?.[0] ?? ''
          const count = whichCalls.get(target) ?? 0
          whichCalls.set(target, count + 1)

          if ((target === 'bwrap' || target === 'socat') && count === 0) {
            return 1
          }

          const paths: Record<string, string> = {
            bwrap: '/usr/bin/bwrap\n',
            socat: '/usr/bin/socat\n',
            sudo: '/usr/bin/sudo\n',
            newuidmap: '/usr/bin/newuidmap\n',
            newgidmap: '/usr/bin/newgidmap\n'
          }
          const path = paths[target]
          if (path === undefined) {
            return 1
          }
          emitStdout(options, path)
          return 0
        }
        return 0
      }
    )

    await run()

    expect(exec.exec).toHaveBeenCalledWith(
      'which',
      ['bwrap'],
      expect.objectContaining({ silent: true, ignoreReturnCode: true })
    )
    expect(exec.exec).toHaveBeenCalledWith(
      'which',
      ['socat'],
      expect.objectContaining({ silent: true, ignoreReturnCode: true })
    )
    expect(exec.exec).toHaveBeenCalledWith('sudo', [
      'apt-get',
      'install',
      '-y',
      'bubblewrap',
      'socat'
    ])
    expect(core.startGroup).toHaveBeenCalledWith(
      'Installing sandbox dependencies: bubblewrap, socat'
    )
    expect(exec.exec).toHaveBeenCalledWith(
      'bwrap',
      [
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
      ],
      expect.objectContaining({ silent: true, ignoreReturnCode: true })
    )
  })

  it('skips sandbox repair on linux when preflight passes', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })

    await run()

    expect(exec.exec).toHaveBeenCalledWith(
      'bwrap',
      [
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
      ],
      expect.objectContaining({ silent: true, ignoreReturnCode: true })
    )
    expect(exec.exec).not.toHaveBeenCalledWith('sudo', expect.anything())
    expect(getBashScripts()).not.toContainEqual(
      expect.stringContaining('/etc/subuid')
    )
  })

  it('skips sandbox deps on non-linux', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })

    await run()

    expect(exec.exec).not.toHaveBeenCalledWith(
      'which',
      expect.anything(),
      expect.anything()
    )
  })

  it('warns but continues when sandbox dep install fails', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    exec.exec.mockImplementation(async (cmd: string) => {
      if (cmd === 'which') {
        return 1
      }
      if (cmd === 'sudo') {
        throw new Error('apt-get failed')
      }
      return 0
    })

    await run()

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Failed to install sandbox dependencies')
    )
    // Action should still run tusk
    expect(exec.exec).toHaveBeenCalledWith(
      'bash',
      expect.arrayContaining(['-eo', 'pipefail', '-c']),
      expect.objectContaining({ cwd: './backend' })
    )
  })

  it('repairs hosted linux runners when bwrap user namespaces fail', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    process.env['ImageOS'] = 'ubuntu24'

    exec.exec.mockImplementation(
      async (cmd: string, args?: string[], options?: unknown) => {
        if (cmd === 'which') {
          const target = args?.[0]
          const paths: Record<string, string> = {
            bwrap: '/usr/bin/bwrap\n',
            socat: '/usr/bin/socat\n',
            sudo: '/usr/bin/sudo\n'
          }
          const path = target !== undefined ? paths[target] : undefined
          if (path === undefined) {
            return 1
          }
          emitStdout(options, path)
          return 0
        }

        if (cmd === 'bwrap') {
          const isUserNamespacePreflight =
            args?.includes('--unshare-user') && args?.includes('/bin/true')
          if (isUserNamespacePreflight) {
            emitStderr(
              options,
              'bwrap: setting up uid map: Permission denied\n'
            )
            if (
              exec.exec.mock.calls.some(
                (call) =>
                  call[0] === 'sudo' &&
                  Array.isArray(call[1]) &&
                  call[1][0] === 'chmod'
              )
            ) {
              return 0
            }

            return 1
          }

          return 0
        }

        if (
          cmd === 'bash' &&
          Array.isArray(args) &&
          typeof args[3] === 'string' &&
          args[3].includes('test -u')
        ) {
          return 1
        }

        if (cmd === 'tusk' && args?.[0] === '--version') {
          emitStdout(options, 'tusk version dev\n')
          return 0
        }

        return 0
      }
    )

    await run()

    expect(core.startGroup).toHaveBeenCalledWith('Repair Linux sandbox support')
    expect(exec.exec).toHaveBeenCalledWith('sudo', [
      'apt-get',
      'install',
      '-y',
      'uidmap'
    ])
  })

  it('warns instead of mutating self-hosted runners when preflight fails', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    exec.exec.mockImplementation(
      async (cmd: string, args?: string[], options?: unknown) => {
        if (cmd === 'which') {
          const target = args?.[0]
          const paths: Record<string, string> = {
            bwrap: '/usr/bin/bwrap\n',
            socat: '/usr/bin/socat\n',
            sudo: '/usr/bin/sudo\n'
          }
          const path = target !== undefined ? paths[target] : undefined
          if (path === undefined) {
            return 1
          }
          emitStdout(options, path)
          return 0
        }

        if (cmd === 'bwrap') {
          emitStderr(options, 'bwrap: setting up uid map: Permission denied\n')
          return 1
        }

        if (cmd === 'tusk' && args?.[0] === '--version') {
          emitStdout(options, 'tusk version dev\n')
          return 0
        }

        return 0
      }
    )

    await run()

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('will not modify this runner automatically')
    )
    expect(getBashScripts()).not.toContainEqual(
      expect.stringContaining('/etc/subuid')
    )
    expect(exec.exec).not.toHaveBeenCalledWith('sudo', [
      'chmod',
      'u+s',
      '/usr/bin/bwrap'
    ])
  })
})
