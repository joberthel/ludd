import type { LedgerEvent } from '../types/ledger.js'
import fs from 'node:fs'
import path from 'node:path'

export function appendLedgerEvent(runDir: string, event: LedgerEvent): void {
  fs.mkdirSync(runDir, { recursive: true })
  const ledgerPath = path.join(runDir, 'ledger.jsonl')
  fs.appendFileSync(ledgerPath, `${JSON.stringify(event)}\n`, 'utf8')
}
