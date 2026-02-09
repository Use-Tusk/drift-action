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
      'cli-version': '',
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
})
