import type { CreatedPairing, PairingDescription, PairingPoll, PairingRequest } from '@dashi/contracts'
import type { MachineTokenStore } from '../machine-tokens/types.ts'

export interface PairingTokens {
  label: string
  ingestToken: string
  runnerToken: string | null
}

export type PairingPollResult = { outcome: 'unknown' } | { outcome: 'refused' } | { outcome: 'expired' } | { outcome: 'answered'; poll: PairingPoll }

export interface PairingRelay {
  create: (request: PairingRequest) => CreatedPairing | null
  describe: (userCode: string) => PairingDescription | null
  approve: (userCode: string, tokens: PairingTokens) => boolean
  poll: (pairingId: string, pollSecret: string) => PairingPollResult
}

export interface MachineRouteDependencies {
  pairingRelay: PairingRelay
  ingestTokens: MachineTokenStore
  runnerTokens: MachineTokenStore
  cliScriptPath: string
  openCodeReporterPath: string
}
