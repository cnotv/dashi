import type { Board, BoardCard, IssueStatus, RepositoryReference, SessionStart } from '@dashi/contracts'
import { repositoryKey } from './presentation'
import type { RepositoryBoardCard, RepositoryBoardColumn } from './types'

const lastUpdateOf = (card: BoardCard): string =>
  [card.pullRequest?.updatedAt, ...card.issues.map((issue) => issue.updatedAt)]
    .filter((updatedAt) => updatedAt !== undefined)
    .reduce((latest, updatedAt) => (updatedAt > latest ? updatedAt : latest), '')

const isSameRepository = (first: RepositoryReference, second: RepositoryReference): boolean =>
  repositoryKey(first).toLowerCase() === repositoryKey(second).toLowerCase()

/**
 * Finds the newest start Dashi has for an issue card that has no pull request yet.
 * @param starts The starts from the board.
 * @param repository The card's repository.
 * @param card The card.
 * @returns The newest start on one of the card's issues, or null when there is none.
 */
export const latestStartForCard = (starts: SessionStart[], repository: RepositoryReference, card: BoardCard): SessionStart | null =>
  starts
    .filter(
      (start) =>
        start.pullRequestNumber === null &&
        isSameRepository(start.repository, repository) &&
        card.issues.some((issue) => issue.number === start.issueNumber),
    )
    .reduce<SessionStart | null>((latest, start) => (latest === null || start.createdAt > latest.createdAt ? start : latest), null)

const cardsInStatus = (boards: Board[], status: IssueStatus, starts: SessionStart[]): RepositoryBoardCard[] =>
  boards
    .flatMap((board) =>
      (board.columns.find((column) => column.status === status)?.cards ?? []).map((card) => ({
        card,
        repository: board.repository,
        sessionStart: status === 'no-pull-request' ? latestStartForCard(starts, board.repository, card) : null,
      })),
    )
    .sort((first, second) => lastUpdateOf(second.card).localeCompare(lastUpdateOf(first.card)))

/**
 * Lays several repositories' boards out as one: the same columns, each holding every
 * repository's cards for that status, most recently updated first. An issue without a pull request
 * that Dashi started a session on moves to the Started from Dashi column right after No pull
 * request, newest start first, so a start that never ran is not lost among untouched issues.
 * @param boards The boards, one per repository, each with every column in the board's order.
 * @param starts The starts from the board.
 * @returns The columns, each card paired with its repository and, in Started from Dashi, its start.
 */
export const mergeBoards = (boards: Board[], starts: SessionStart[]): RepositoryBoardColumn[] =>
  (boards[0]?.columns ?? []).flatMap(({ status }): RepositoryBoardColumn[] => {
    const cards = cardsInStatus(boards, status, starts)
    if (status !== 'no-pull-request') return [{ status, cards }]
    return [
      { status, cards: cards.filter((repositoryCard) => repositoryCard.sessionStart === null) },
      {
        status: 'started-from-dashi',
        cards: cards
          .filter((repositoryCard) => repositoryCard.sessionStart !== null)
          .sort((first, second) => (second.sessionStart?.createdAt ?? '').localeCompare(first.sessionStart?.createdAt ?? '')),
      },
    ]
  })
