/**
 * The error the model routes answer with (/api/intent, /api/addressee): a code and a message the
 * client may show. Round 12 removed /api/interpret, the old editing route this file was named for.
 */
export type InterpretErrorCode = 'bad_request' | 'upstream_unavailable' | 'upstream_rejected' | 'timeout'

export class InterpretError extends Error {
  readonly code: InterpretErrorCode

  constructor(code: InterpretErrorCode, message: string) {
    super(message)
    this.name = 'InterpretError'
    this.code = code
  }
}
