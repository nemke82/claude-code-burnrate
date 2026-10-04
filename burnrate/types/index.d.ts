/** Why a request wrote the cache where it should have read it. */
export type MissCause = 'model' | 'idle' | 'prefix'

export type Miss = {
  cause: MissCause
  /** tokens the previous request had cached that this one wrote again */
  wasted: number
  /** ms between the start of the previous request and this one */
  gapMs: number
}

/** One main-loop request, as the API reported it. */
export type Sample = {
  turnId: string
  index: number
  model: string
  /** `$.clock.now()` when the request started */
  startedAt: number
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
    burnrate: { meter: Meter; windows: PlanWindow[]; costUsd: number | null }
  }
}
