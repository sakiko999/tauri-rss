/**
 * Shared error types for the data layer.
 */

/** Raised when a capability isn't wired yet (Phase 1: all fetching paths). */
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NotImplementedError"
  }
}

/** Raised when a subscription's sourceId has no registered source adapter. */
export class NoAdapterError extends Error {
  constructor(sourceId: string) {
    super(`No source adapter registered for subscription source: ${sourceId}`)
    this.name = "NoAdapterError"
  }
}
