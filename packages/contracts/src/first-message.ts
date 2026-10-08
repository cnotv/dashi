import type { SessionStart, StartAttachment, StartWorkflow } from './types.ts'

type StartSubject = Pick<SessionStart, 'repository' | 'issueNumber' | 'pullRequestNumber'>

type PromptStart = StartSubject & Pick<SessionStart, 'workflow' | 'note'>

// The branch types AGENTS.md allows. A conflicts start always works on its pull request's
// branch, so its entry is only reached by a start the dialog never makes.
const branchTypeByWorkflow: Record<Exclude<StartWorkflow, 'research'>, string> = {
  feature: 'feat',
  fix: 'fix',
  refactor: 'refactor',
  docs: 'docs',
  design: 'feat',
  '3d': 'feat',
  security: 'fix',
  tests: 'test',
  chore: 'chore',
  conflicts: 'fix',
}

/**
 * Finds the address a start is about: its pull request when it has one, such as a conflicts
 * start, otherwise its issue.
 * @param start The start's repository, issue and pull request.
 * @returns The GitHub URL, or null for a start on neither.
 */
export const subjectUrlOf = ({ repository, issueNumber, pullRequestNumber }: StartSubject): string | null => {
  const repositoryUrl = `https://github.com/${repository.owner}/${repository.name}`
  if (pullRequestNumber !== null) return `${repositoryUrl}/pull/${pullRequestNumber}`
  return issueNumber === null ? null : `${repositoryUrl}/issues/${issueNumber}`
}

const inlineAttachmentBlockOf = (attachment: StartAttachment): string =>
  `${attachment.name} (${attachment.mediaType}):\n\`\`\`base64\n${attachment.base64}\n\`\`\``

const inlineAttachmentsSectionOf = (attachments: StartAttachment[]): string | null =>
  attachments.length === 0
    ? null
    : [
        'Attachments, as base64. Decode each into a file outside the repository with `base64 -d` and read it:',
        ...attachments.map(inlineAttachmentBlockOf),
      ].join('\n\n')

const subjectNameOf = (start: StartSubject): string => {
  if (start.pullRequestNumber !== null) return 'the pull request'
  return start.issueNumber === null ? 'the request' : 'the issue'
}

const readingStepsFor = (start: StartSubject): string[] => {
  const reading =
    start.pullRequestNumber !== null
      ? 'Read the pull request, the issue it closes, and every comment and review on both.'
      : start.issueNumber !== null
        ? 'Read the issue with all its comments.'
        : 'Read the request in the note above.'
  const askWhere = start.pullRequestNumber === null && start.issueNumber === null ? 'in the session' : `in the session and as a comment on ${subjectNameOf(start)}`
  return [
    "Read the repository's AGENTS.md, or CLAUDE.md, before anything else. Where it says more than this message, it wins.",
    reading,
    `If intent, scope or expected behaviour is unclear, ask one focused question covering everything missing, ${askWhere}, and wait for the answer.`,
  ]
}

const researchStepsFor = (start: StartSubject): string[] => [
  'Answer from the code, the issue and the documentation. Change nothing: no branch, commit or pull request.',
  ...(start.issueNumber === null ? [] : ['Post the answer as a comment on the issue as well, so it can be read from the board.']),
  'End with the answer, and the link to the comment if you posted one.',
]

const gitStep =
  'Git: rebase onto the default branch, never merge it in and never `git pull`. Push with `git push -u origin <branch>`, adding `--force-with-lease` after a rebase; never `--force`, never `--no-verify`. If a push or fetch fails on the network, retry up to four times, waiting 2, 4, 8 and 16 seconds.'

const checksStep = "Before every push, run the repository's checks (Project facts in AGENTS.md) and see them pass."

const followUpSteps = [
  'Stay with the pull request until it is green and mergeable. Subscribe to its activity if the environment offers that; otherwise watch its checks. Fix each failing check at its cause, never by skipping or disabling a test, and re-run a job at most once, only to confirm a flake. Apply or answer every review comment.',
  'Once the change is validated and every check is green, mark the pull request ready.',
  'End with a short report: what changed, which checks you saw pass, what is left, and the link to the pull request.',
]

const pullRequestStepsFor = (start: PromptStart): string[] => [
  "Work on the pull request's own branch: no new issue, branch or pull request. Dashi turned it back to draft for this session.",
  start.workflow === 'conflicts'
    ? "Bring in the default branch the way the repository's rules say, and resolve each conflict keeping what both sides meant. Where both sides changed the same logic and keeping either loses behaviour, stop and ask which wins."
    : 'Tests first, then the change.',
  checksStep,
  'Update the pull request body wherever the change alters what it describes.',
  gitStep,
  ...followUpSteps,
]

const changeStepsFor = (start: PromptStart & { workflow: Exclude<StartWorkflow, 'research'> }): string[] => {
  const issueReference = start.issueNumber === null ? '<issue-number>' : String(start.issueNumber)
  return [
    ...(start.issueNumber === null ? ['Write the issue from the note first: what should be true once this lands, and why.'] : []),
    `Branch: a fresh \`${branchTypeByWorkflow[start.workflow]}/${issueReference}-<two or three word slug of the issue title>\` off an up-to-date default branch. Dashi links the session, the issue and the pull request through this name, so use it even if the environment assigned you another branch: this message is the owner's permission to create and push it. Only if pushing it is refused, keep the assigned branch and say so in the pull request.`,
    'Tests first, then the change.',
    checksStep,
    `At the first commit, open a draft pull request against the default branch, titled \`<type>: <summary> (#${issueReference})\`, its body starting with \`Closes #${issueReference}\` and following the repository's pull request template. Keep its body and the issue current as the work moves.`,
    gitStep,
    ...followUpSteps,
  ]
}

const workflowStepsFor = (start: PromptStart): string[] => {
  if (start.workflow === 'research') return researchStepsFor(start)
  if (start.pullRequestNumber !== null) return pullRequestStepsFor(start)
  return changeStepsFor({ ...start, workflow: start.workflow })
}

const briefFor = (start: PromptStart, commandArguments: string): string => {
  const subjectUrl = subjectUrlOf(start)
  const steps = [...readingStepsFor(start), ...workflowStepsFor(start)]
  return [
    `You were started from Dashi, the agent dashboard, with the \`${start.workflow}\` workflow${subjectUrl === null ? '' : ` on ${subjectUrl}`}. Work it through on your own and report at the end; the owner reviews the result.`,
    `If the line above did not run as a command, run the \`workflow:start\` skill yourself with \`${commandArguments}\`. These steps hold either way, and are the whole workflow where that skill is missing:`,
    steps.map((step, stepIndex) => `${stepIndex + 1}. ${step}`).join('\n'),
  ].join('\n\n')
}

/**
 * Writes the first message of a started session: the agent-base router with the workflow
 * already named, the note from the Start dialog, the workflow spelled out for a session where
 * that router line arrives as plain text, and the attachments of a session that only takes text.
 * @param start The start, as the dashboard stored it.
 * @param inlineAttachments Attachments to carry inside the prompt; a laptop session gets its own as files instead.
 * @returns The prompt.
 */
export const sessionPromptFor = (start: PromptStart, inlineAttachments: StartAttachment[]): string => {
  const commandArguments = [start.workflow, subjectUrlOf(start)].filter((part) => part !== null).join(' ')
  return [
    `/workflow:start ${commandArguments}`,
    start.note.length === 0 ? null : start.note,
    briefFor(start, commandArguments),
    inlineAttachmentsSectionOf(inlineAttachments),
  ]
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
