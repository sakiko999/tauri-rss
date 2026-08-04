/**
 * Shared error types for the producer layer.
 *
 * Producer-owned copies (same shape as core's) so this package never imports
 * core. The maintainer (`createDataLayer`) re-exports these where consumers
 * need them.
 */

/** Raised when a capability isn't wired yet. */
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NotImplementedError"
  }
}

/** Raised when a subscription kind has no registered source adapter. */
export class NoAdapterError extends Error {
  constructor(kind: string) {
    super(`No source adapter registered for subscription kind: ${kind}`)
    this.name = "NoAdapterError"
  }
}
