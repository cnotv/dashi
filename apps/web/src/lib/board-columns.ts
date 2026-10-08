import { issueStatusLabels } from './presentation'
import type { BoardColumnStatus } from './types'

// The columns most boards fill with work nobody is on yet, or work already done, start folded.
export const defaultCollapsedStatuses: BoardColumnStatus[] = ['no-pull-request', 'closed']

const isBoardColumnStatus = (value: unknown): value is BoardColumnStatus => typeof value === 'string' && Object.hasOwn(issueStatusLabels, value)

/**
 * Reads the folded columns this browser remembers, falling back to the defaults when nothing
 * readable is stored.
 * @param storedValue What browser storage holds, or null.
 * @returns The statuses of the folded columns.
 */
export const parseCollapsedStatuses = (storedValue: string | null): BoardColumnStatus[] => {
  if (storedValue === null) return defaultCollapsedStatuses
  try {
    const parsedValue: unknown = JSON.parse(storedValue)
    return Array.isArray(parsedValue) ? parsedValue.filter(isBoardColumnStatus) : defaultCollapsedStatuses
  } catch {
    return defaultCollapsedStatuses
  }
}

/**
 * Folds an unfolded column, or unfolds a folded one.
 * @param collapsedStatuses The folded columns.
 * @param status The column to toggle.
 * @returns The folded columns after the toggle.
 */
export const toggleCollapsedStatus = (collapsedStatuses: BoardColumnStatus[], status: BoardColumnStatus): BoardColumnStatus[] =>
  collapsedStatuses.includes(status)
    ? collapsedStatuses.filter((collapsedStatus) => collapsedStatus !== status)
    : [...collapsedStatuses, status]
