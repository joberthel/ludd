import { vi } from 'vitest'

export interface TestStdin {
  write: (data: string) => void
}

export async function pressKey(stdin: TestStdin, key: string): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 50))
  stdin.write(key)
}

export async function submitAndWait(
  stdin: TestStdin,
  key: string,
  assertFn: () => void | Promise<void>,
): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 50))
  await vi.waitFor(async () => {
    stdin.write(key)
    await assertFn()
  })
}
