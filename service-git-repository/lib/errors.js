// Typed failures for gitRepository callers. Messages are Chinese for tool/command surfaces.

export class GitRepositoryError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'GitRepositoryError'
    this.code = code
  }
}

export function fail(code, message) {
  throw new GitRepositoryError(code, message)
}
