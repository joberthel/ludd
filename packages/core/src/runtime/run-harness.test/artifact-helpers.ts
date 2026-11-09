import { expect } from 'vitest'

export async function putMcpArtifact(
  url: string,
  token: string,
  key: string,
  content: string,
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'put',
      method: 'tools/call',
      params: {
        name: 'put_artifact',
        arguments: { key, content },
      },
    }),
  })
  const json = (await res.json()) as { result?: { isError?: boolean } }
  expect(json.result?.isError).toBeUndefined()
}
