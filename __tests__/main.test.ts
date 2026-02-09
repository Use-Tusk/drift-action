import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import * as cache from '../__fixtures__/cache.js'
import * as exec from '../__fixtures__/exec.js'

// Mocks should be declared before the module being tested is imported.
jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/cache', () => cache)
jest.unstable_mockModule('@actions/exec', () => exec)
const { run } = await import('../src/main.js')

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
    exec.exec.mockResolvedValue(0)
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('restores cache and runs the configured command', async () => {
    await run()

    expect(cache.restoreCache).toHaveBeenCalledWith(
      [expect.stringMatching(/\.cache\/tusk$/)],
      'linux-tusk-drift-config-hash',
      ['linux-tusk-drift-']
    )
    expect(exec.exec).toHaveBeenNthCalledWith(
      1,
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
    expect(exec.exec).toHaveBeenNthCalledWith(
      2,
      'tusk',
      ['--version'],
      expect.objectContaining({ silent: true })
    )
    expect(exec.exec).toHaveBeenNthCalledWith(
      3,
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

    expect(exec.exec).toHaveBeenNthCalledWith(
      1,
      'go',
      ['version'],
      expect.objectContaining({ cwd: '.' })
    )
    expect(exec.exec).toHaveBeenNthCalledWith(
      2,
      'bash',
      [
        '-eo',
        'pipefail',
        '-c',
        `tmp_dir="$(mktemp -d)" && trap 'rm -rf "$tmp_dir"' EXIT && git clone --depth 1 --branch 'main' 'https://github.com/Use-Tusk/tusk-drift-cli.git' "$tmp_dir/repo" && cd "$tmp_dir/repo" && go build -o tusk . && install_dir="/usr/local/bin" && if [ ! -w "$install_dir" ]; then install_dir="$HOME/.local/bin"; mkdir -p "$install_dir"; fi && mv tusk "$install_dir/" && chmod +x "$install_dir/tusk"`
      ],
      expect.objectContaining({ cwd: '.' })
    )
  })
})
