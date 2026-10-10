# AI agents and LLM features

Anything a model reads can be an instruction to it. Treat model input from outside as
untrusted and model output as untrusted data.

## Untrusted text reaching a model with tools

- **Prompt injection sources**: issue and pull request text, comments, web pages, file
  contents, commit messages, tool results. Where such text reaches an agent that can run
  commands, push, spend money or read secrets, the tools it may use are the smallest set the
  task needs, and destructive or outward-facing actions need a human's approval.
- **Instructions and data are kept apart**: untrusted text is quoted or fenced as data in the
  prompt, never concatenated into the system prompt.
- **Scope of credentials**: the token an agent holds can do only what the task needs (read
  one repository, not write every one), and expires.

## Model output

- **Never executed as-is**: output is not passed to a shell, `eval`, SQL or a file path
  without the same validation as any other input.
- **Never rendered as HTML** without sanitising; markdown from a model goes through the same
  renderer settings as user markdown.
- **Structured output** is parsed with a schema; a malformed reply fails closed.

## Secrets around agents

- **Agents do not read secret files**: `.env`, key stores and credential directories are
  outside what the agent's tools may open, or denied by its permission settings.
- **Terminal and transcript logs** that are stored or shown elsewhere are scrubbed of known
  secret values.
- **API keys** reach a model client through the environment of that process only.

## Cost and abuse

- Requests that trigger model calls are authenticated and rate limited; a loop that calls a
  model has a step and spend limit.
