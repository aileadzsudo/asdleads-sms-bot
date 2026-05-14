# Repo Update Strategy

This explains how another operator can receive future updates while protecting production.

## Option 1: Same Private Repo, Separate Environment

How it works:

- Add recipient/dev as GitHub collaborator.
- They deploy the same repo to their own Render service.
- Their environment variables point to their own GHL, Slack, OpenAI, and database.
- Auto-deploy from `main` can update them automatically.

Pros:

- Easiest to keep updated.
- One source of truth.
- Every push can deploy everywhere if configured.

Cons:

- They see the full repo history.
- A bad push could affect all connected auto-deploy environments.
- Harder to customize per recipient.

Use this only with trusted collaborators and good test discipline.

## Option 2: Private Fork With Upstream

How it works:

- Recipient forks the repo privately.
- Their deployment points to their fork.
- Original repo is added as `upstream`.
- They pull updates when ready.

Commands:

```bash
git remote add upstream <original-repo-url>
git fetch upstream
git merge upstream/main
npm test
npm run build
git push origin main
```

Pros:

- Safer for production.
- Recipient controls when updates deploy.
- Recipient can customize without changing your production.

Cons:

- Someone must pull/merge updates.
- Merge conflicts are possible.

Recommended for most outside operators.

## Option 3: Release Tags

How it works:

- You create stable release tags:

```bash
git tag handoff-2026-05-14
git push origin handoff-2026-05-14
```

- Recipient deploys a specific tag or branch.

Pros:

- Stable.
- Easy rollback.
- Good for multiple clients/operators.

Cons:

- Requires release discipline.

Recommended if this becomes a repeatable product.

## Option 4: Template Repo

How it works:

- Create a clean template repo without client-specific docs/history.
- New operators create a repo from the template.

Pros:

- Cleanest handoff.
- No accidental client-specific files.

Cons:

- More work to maintain.
- Updates need a release/merge strategy.

## Strong Recommendation

For one trusted operator:

- Use a private fork.
- Keep your repo as upstream.
- Pull updates manually after tests pass.

For many operators:

- Create a clean product/template repo.
- Use release tags.
- Keep each operator on their own database and env vars.

## Auto-Deploy Warning

Auto-deploy is powerful but risky.

If a recipient points Render directly to `main`, every push to `main` can deploy to their production.

Safer:

- Deploy from a `production` branch.
- Merge into `production` only after tests.
- Keep `main` as active development.

Example:

```bash
git checkout -b production
git push origin production
```

Then set Render branch to `production`.

## Rollback

If a deploy breaks:

1. Go to Render deploy history.
2. Roll back to previous deploy.
3. Or revert the Git commit:

```bash
git revert <bad-commit-sha>
git push
```

4. Verify `/health`, `/dashboard`, and a test webhook.

