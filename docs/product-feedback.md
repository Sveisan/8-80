# Product feedback and manually approved improvements

The feedback button opens a small dialog on signup, weekly/account, Beliefs and
Unblock pages. One note is required. A screenshot is optional: the person chooses
an image, previews it and can remove it before sending. This is a web attachment
flow; the website does not observe iPhone system screenshots or capture the page.
There is no feedback network request or cookie until the dialog is opened.

## Data and tracking

Original reports are AES-256-GCM encrypted in `product_feedback` for 30 days.
Only a broad page category, viewport and the web process's Git SHA accompany the
note. URL credentials, arbitrary paths and page/form contents are excluded.
Images are resized and re-encoded by the browser before submission. The server
validates the supported format and limits the encoded image to 1 MB. This strips
image metadata in the normal browser flow; API validation alone is not a metadata
scrubber. People should inspect the preview and remove anything they do not want
to share.

A signed, HttpOnly browser capability and CSRF token protect submission, history,
deletion and outcome feedback. The daily rotating IP hash enforces ten reports per
day per bucket across browser resets. Exact retries reuse one record; conflicting
payloads with the same request ID are rejected. Browser-owned history is available
for 30 days. A verified weekly browser also links its reports to account export
and deletion; reports without that proof remain browser-owned.

The source repository is public. The issue outbox refuses a public tracker. Its
private GitHub issues contain fixed text and an opaque report reference, never
the original comment/image. Ambiguous issue writes are reconciled rather than
blindly retried. If the matching issue is older than the last 100 issues, inspect
and reconcile it manually; do not clear `issue_sending` merely to retry.

The worker fetches original reports through a separate bearer-protected endpoint.
Its token grants feedback access, not account, billing, calling or deployment
access. Deleted or expired reports return 410. Private processing copies may
survive deletion until the private run's one-day retention expires. OpenAI also
processes the report during preparation/review, under the configured API account's
data controls. Do not imply that deleting our row establishes provider erasure.

## Automated preparation

Install `.github/feedback/improve.yml` as `.github/workflows/improve.yml` in
`Sveisan/8-80-feedback`, the dedicated private tracker. Keep its contents limited
to operating instructions and this workflow. The source code is checked out from
the public repository at a pinned commit for each run.

The workflow validates the enrolled issue author and private repository, retrieves
the private report, and prepares at most five runs per UTC day. A separate Codex
run proposes a small UI patch and a synthetic regression test. Ambiguous requests
and protected changes require human input. A trusted scope/privacy check precedes
application validation. Candidate code runs in a disposable Docker container
without production or runner credentials or original customer files. Another
read-only Codex run reviews the patch against the report. A fresh trusted job may
then publish a generic public PR. No customer screenshot or report artifact is
published. Scope/privacy checks and AI review are safeguards, not a proof that
arbitrary generated code is correct or anonymous: inspect the diff before merge.

Allowed automatic preparation is deliberately limited to the files listed in
`scripts/feedback/contract.mjs` and a new focused regression test. Calls, prompts,
schedules, authentication, billing, data/schema changes, dependencies, workflows
and permissions need an engineer. The initial workflow never merges or deploys.

The coding/review jobs have no code-publishing or production tokens. Codex is the
last step in each job, with sandboxing and sudo removal. Publishing happens in a
fresh job. See the [Codex Action documentation](https://learn.chatgpt.com/docs/github-action.md).

## Initial activation

Keep both switches off until the implementation PR is reviewed and released.
No existing deployment, voice, billing or signup switch is changed by this setup.

1. Review and merge the implementation PR. Release it using the existing approved
   production process, including migration `0033_product_feedback`. Review the
   privacy wording and processor settings before enabling collection.
2. In the private tracker, set Actions artifact/log/run retention to **1 day**.
   Restrict access to people who should see private reports and processing logs.
   The upload action also requests one-day artifact retention. The repository's
   broader setting covers logs and run outputs as well.
3. Provision scoped credentials outside Git. On the application server set:
   `PRODUCT_FEEDBACK_GITHUB_REPOSITORY=Sveisan/8-80-feedback`,
   `PRODUCT_FEEDBACK_GITHUB_TOKEN` (fine-grained access to this private repository,
   Issues write and Metadata read), and `PRODUCT_FEEDBACK_WORKER_TOKEN` (a new
   random secret of at least 32 characters). Keep the existing encryption key.
   The issue token's GitHub account must match `FEEDBACK_REPORTER` below. A normal
   Actions `GITHUB_TOKEN` must not be used as the server issue token: its issue
   events do not start another Actions workflow.
4. In the private tracker set secrets `FEEDBACK_WORKER_TOKEN` (the same new
   value), `OPENAI_API_KEY` (a dedicated project with a monitored budget), and
   `FEEDBACK_CODE_TOKEN` (fine-grained access to `Sveisan/8-80`, Contents write,
   Pull requests write, Metadata read). A fine-grained write token can have more
   authority than the publisher uses; it is only exposed to the trusted publisher.
   Do not reuse a broad personal CLI login token. Set repository variables
   `FEEDBACK_REPORTER=Sveisan`, `FEEDBACK_SERVICE_URL=https://api.8and80.me` and
   `FEEDBACK_AUTOMATION_ENABLED=false`.
5. Run `npm run feedback -- doctor` on the server. Enable collection with
   `PRODUCT_FEEDBACK_ENABLED=1` and restart the web service through the normal
   release procedure. Submit one invented report and check its private issue.
6. Set `FEEDBACK_AUTOMATION_ENABLED=true`, then dispatch the workflow for that
   synthetic issue number. Inspect the private run, the public diff and ordinary
   PR CI. Establish an API spending limit/alert appropriate to a business with
   zero paying customers; five runs/day is an abuse brake, not a monetary cap.
   The owner should reduce or disable processing if it is not producing value.

GitHub settings: [private tracker variables](https://github.com/Sveisan/8-80-feedback/settings/variables/actions),
[private tracker secrets](https://github.com/Sveisan/8-80-feedback/settings/secrets/actions).
Credentials are never pasted into issue bodies, PRs, logs or this document.

## Manual approval and release

Review the proposed public PR and all required CI, including visual comparisons.
An automated review is not your approval. Merge only after accepting the change.
Deploy the approved commit through the existing production release process. This
feedback system has no SSH key, production deployment job or merge step.

After the web service is healthy, run on the production checkout:

```sh
npm run feedback -- reconcile-release
```

The command compares the live HTTPS health response's startup Git SHA with this
checkout and verifies that each associated merged PR is an ancestor. Only then
does it mark that report `released`, enabling “Did the change help?” in that
browser. A merge, successful build or worker message alone cannot do this.
Use the existing rollback process if needed; release reconciliation does not
attempt rollback and a positive outcome response does not establish retention.

## Operations and measurement

```sh
npm run feedback -- doctor       # Presence/flags only; never secret values
npm run feedback -- sync         # Reconcile outbox / create private tickets
npm run feedback -- metrics      # Counts and explicit helped/not-yet responses
```

The normal tick prunes expired reports and attempts issue delivery. Disabling
the worker variable stops new automatic preparations; disable the workflow or
cancel an in-flight run as well if one is already running. Turning off the server
feature hides the button and refuses the feedback API while retention cleanup
continues. Existing private tracking references may remain after report expiry.

Failed scope/tests/review route a report to `needs_input`; they never release it.
Before rerunning after a publication failure, inspect any existing branch/PR.
Publication reconciles an existing matching branch without resetting it. If a
run was interrupted while `reviewing`, use the scoped worker API to mark it
`needs_input` after checking that no publication is in progress, then dispatch
again. A deleted report cannot be recreated through that API.

Initially measure whether reports become reviewed changes, whether the reporter
says the change helped, and founder time/cost per useful fix. With zero paying
customers at $25/month, these are learning signals. Paid conversion, renewal and
repeated use must be measured separately; more generated fixes is not evidence
of a profitable or wanted product.
