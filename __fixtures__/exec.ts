import { jest } from '@jest/globals'
import type * as actionsExec from '@actions/exec'

export const exec = jest.fn<typeof actionsExec.exec>(async () => 0)
