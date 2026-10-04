/** Why a request wrote the cache where it should have read it. */
export type MissCause = 'model' | 'idle' | 'prefix'

export type Miss = {
  cause: MissCause
  /**
   * An estimate of the tokens written again: what the previous request left
   * cached and this one did not read, capped at what this one wrote. The API
   * reports counts, not which tokens, so new content can hide inside it.
   */
  wasted: number
  /** ms between the end of the previous request and the start of this one */
  gapMs: number
  /** the previous request's model, when the cause is a model change */
  from?: string
}

/** One main-loop request, as the API reported it. */
export type Sample = {
  /** the request's number in the session, from 1 */
  n: number
  turnId: string
  index: number
  model: string
  /** `$.clock.now()` when the request started */
  startedAt: number
  /** `$.clock.now()` when its response was whole */
  endedAt: number
  /** served by the cache */
  read: number
  /** written to the cache */
  write: number
  /** sent uncached */
  fresh: number
  output: number
  miss?: Miss
}

/** Sums over every request since the session began or was cleared. */
export type Totals = {
  requests: number
  read: number
  write: number
  fresh: number
  output: number
  misses: number
  wasted: number
}

export type Meter = {
  /** the most recent requests, oldest first */
  samples: Sample[]
  totals: Totals
}

/** A rate-limit window of the account: `five_hour`, `seven_day`, a gateway's `spend_limit`. */
export type PlanWindow = {
  kind: string
  percentUsed: number
  resetsAt?: string
}

declare module 'claude-code' {
  interface PluginState {
    burnrate: { meter: Meter; windows: PlanWindow[] }
  }
}
