import { jest } from '@jest/globals'

export const restoreCache = jest.fn(async () => undefined as string | undefined)
export const saveCache = jest.fn(async () => 1)
