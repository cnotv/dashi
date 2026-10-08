import type { SessionStart, StartAttachment } from '@dashi/contracts'

type StartSubject = Pick<SessionStart, 'repository' | 'issueNumber' | 'pullRequestNumber'>

// A start about a pull request, such as fixing its conflicts, points at the pull request; any
// other start points at its issue.
const subjectUrlOf = ({ repository, issueNumber, pullRequestNumber }: StartSubject): string | null => {
  const repositoryUrl = `https://github.com/${repository.owner}/${repository.name}`
  if (pullRequestNumber !== null) return `${repositoryUrl}/pull/${pullRequestNumber}`
  return issueNumber === null ? null : `${repositoryUrl}/issues/${issueNumber}`
}

/**
 * Tells the agent how to report its state to Dashi and what each state means, so the board can show
 * it. The start id is written into the message because a cloud routine's environment is the same for
 * every run and cannot carry it; the token is not, the session already holds DASHI_URL and DASHI_TOKEN.
 * @param startId The start the agent reports on.
 * @returns The section of the first message.
 */
export const statusReportingSectionFor = (startId: string): string =>
  [
    'Report your state to Dashi so the dashboard shows it. Only when DASHI_URL and DASHI_TOKEN are both set in the environment, run:',
    `\`curl -fsS -X POST "$DASHI_URL/api/session-starts/${startId}/status" -H "authorization: Bearer $DASHI_TOKEN" -H "content-type: application/json" -d '{"status":"working","note":"one short line"}'\``,
    'Report when you begin, and again each time the state changes, always before you stop to wait. A failed report never stops the work. The states:',
    '- working: you are doing the task.',
    '- waiting: you need an answer or a decision from the person before you can go on. Put the question in the note.',
    '- blocked: you cannot go on without outside help, such as a failing check you cannot fix or access you lack. Put the reason in the note.',
    '- done: the work is finished and nothing is left for you to do.',
  ].join('\n')

const inlineAttachmentBlockOf = (attachment: StartAttachment): string =>
  `${attachment.name} (${attachment.mediaType}):\n\`\`\`base64\n${attachment.base64}\n\`\`\``

const inlineAttachmentsSectionOf = (attachments: StartAttachment[]): string | null =>
  attachments.length === 0
    ? null
    : [
        'Attachments, as base64. Decode each into a file outside the repository with `base64 -d` and read it:',
        ...attachments.map(inlineAttachmentBlockOf),
      ].join('\n\n')

/**
 * Writes the first message of a started session: the agent-base router with the workflow
 * already named, the address of its pull request or issue, the note from the Start dialog, how to
 * report its state, and the attachments of a session that only takes text.
 * @param start The start, as the dashboard stored it.
 * @param inlineAttachments Attachments to carry inside the prompt; a laptop session gets its own as files instead.
 * @returns The prompt.
 */
export const sessionPromptFor = (start: StartSubject & Pick<SessionStart, 'startId' | 'workflow' | 'note'>, inlineAttachments: StartAttachment[]): string => {
  const firstLine = [`/workflow:start ${start.workflow}`, subjectUrlOf(start)].filter((part) => part !== null).join(' ')
  return [firstLine, start.note.length === 0 ? null : start.note, statusReportingSectionFor(start.startId), inlineAttachmentsSectionOf(inlineAttachments)]
    .filter((part) => part !== null)
    .join('\n\n')
}

/**
 * Names a started session after its repository, pull request or issue, and workflow, as it shows in the Claude app.
 * @param start The start.
 * @returns The session name, such as generative-art #42 fix.
 */
export const sessionNameFor = (start: StartSubject & Pick<SessionStart, 'workflow'>): string => {
  const subjectNumber = start.pullRequestNumber ?? start.issueNumber
  return [start.repository.name, subjectNumber === null ? null : `#${subjectNumber}`, start.workflow]
    .filter((part) => part !== null)
    .join(' ')
}
