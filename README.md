# Gridcoin Blockchain Timestamp Action

A GitHub Action that timestamps your release contents on the [Gridcoin](https://gridcoin.us/) blockchain via [stamp.gridcoin.club](https://stamp.gridcoin.club). When a release is published, this action uploads a set of immutable artifacts to the release, computes their SHA-256 hashes, submits them for blockchain timestamping, and appends verification links to the release notes.

## Why Gridcoin Stamp?

Most blockchain timestamping tools hash whatever bytes you hand them and miss the fact that those bytes cannot be reliably retrieved later. Gridcoin Stamp Action is purpose-built for the GitHub release lifecycle and solves three correctness problems other tools quietly ignore.

### The bytes you stamp stay the bytes people download

GitHub's "Source code" downloads are **not byte-stable** — they are regenerated on every request and can produce different hashes for the same commit when the underlying `git archive`/`gzip` behavior drifts. This is not theoretical: on 30 January 2023, a routine Git upgrade on GitHub's servers silently changed the compressed bytes of every source archive on the platform, breaking checksum-pinned builds across Homebrew, Bazel, Spack, Go modules and many other ecosystems. GitHub [acknowledged the problem publicly](https://github.blog/open-source/git/update-on-the-future-stability-of-source-code-archives-and-hashes/) and committed to one year of byte-stability — a commitment that expired in February 2024 and has not been reissued.

Gridcoin Stamp Action fetches each archive once, **re-uploads it as an immutable release asset** under a `-stamped` name, and stamps the uploaded copy. Uploaded assets are fixed CDN blobs whose bytes never change, so your proof stays verifiable years from now regardless of what happens to `git archive` upstream.

<sub>References: [GitHub Blog — Update on the future stability of source code archives and hashes](https://github.blog/open-source/git/update-on-the-future-stability-of-source-code-archives-and-hashes/) · [LWN — Git archive generation meets Hyrum's law](https://lwn.net/Articles/921787/) · [GitHub community discussion #46034 — Archive hash stability](https://github.com/orgs/community/discussions/46034) · [Bazel blog — GitHub Archive Checksum Outage](https://blog.bazel.build/2023/02/15/github-archive-checksum.html)</sub>

### Reproducible commit-level proof

Every release gets a `<tag>.stamp.txt` **proof manifest** — a four-line file with repository, tag, commit SHA, and tree SHA. Its contents are fully derivable from git state, so anyone with a clone can regenerate the file and recompute its hash with `sha256sum`. No archive download, no trusted third party.

### Refuses to silently attest to a mutated tag

Git tags can be force-pushed. Other timestamping workflows would silently re-stamp against the new tree on a rerun, leaving a release whose artifacts disagree about which commit they represent. Gridcoin Stamp Action **aborts on tag mutation**: it compares the existing manifest's commit against the tag's current commit and refuses to proceed on mismatch, with clear remediation steps.

### Drag-and-drop, privacy-first verification

Verification at [stamp.gridcoin.club](https://stamp.gridcoin.club) is one gesture. Drag the stamped file onto the page — the hash is computed **locally in your browser** and only the 64-character SHA-256 is checked against the blockchain. Your file never leaves your machine.

### Anchored on a blockchain that rewards real science

Every stamp lives on the [Gridcoin](https://gridcoin.us/) blockchain, whose reward mechanism is tied to volunteer scientific computing via [BOINC](https://boinc.berkeley.edu/) — protein folding, pulsar searches, climate modelling, cancer research. Your timestamp gets to live on a chain built by people who value science, not wasted hashes.

## How it works

When a release is published, the action uploads up to three kinds of artifacts directly to the release and stamps each of them:

1. **`<tag>.stamp.txt`** — a tiny proof manifest containing the repository, tag, commit SHA, and tree SHA. It is fully reproducible from git state, so anyone can regenerate it and verify the hash without downloading an archive. **Always generated** — the manifest is a hard invariant of the action because it is the commit anchor that the rerun safety checks rely on (see [Tag-mutation protection](#tag-mutation-protection)).
2. **`<repo>-<version>-stamped.zip`** and **`<repo>-<version>-stamped.tar.gz`** — source archives. GitHub's auto-generated "Source code" downloads are fetched once at action runtime, re-uploaded as standard release assets, and that uploaded copy is what gets hashed and stamped. Optional (see `include-source-archives`). (See [Why re-upload source archives?](#why-re-upload-source-archives) below.)
3. **Release assets uploaded by other tools** (e.g. semantic-release, goreleaser) — downloaded and stamped as-is; not re-uploaded. Optional (see `include-release-assets`).

For each artifact the action computes a local SHA-256, submits it to the [stamp.gridcoin.club](https://stamp.gridcoin.club) API, and appends a verification row to the release body.

Proof links in the release body will **not resolve immediately** — `stamp.gridcoin.club/proof/<hash>` returns a 404 until the blockchain confirms the transaction (typically 2–5 minutes). Once confirmed, the page displays the full cryptographic proof. If you need the links to be valid by the time the action finishes, set `wait-for-confirmation: true`.

### Why re-upload source archives?

GitHub's "Source code (zip)" and "Source code (tar.gz)" links on a release page are **not byte-stable**. They are generated on demand by `git archive` + `gzip` running on GitHub's servers, and the exact byte output depends on the git version, gzip implementation, and file ordering — all of which have changed in the past and can change again. Two downloads seconds apart can produce different SHA-256 hashes for the same commit. This means that stamping the auto-generated archive directly produces a hash that nobody — not even the repository owner — can reliably reproduce later, making the proof unverifiable in practice.

Uploaded release assets, on the other hand, are stored as immutable blobs on GitHub's CDN. By fetching the auto-archive once, uploading it back under a distinctive `-stamped` name, and stamping that uploaded copy, the action guarantees that the exact bytes you stamped are the exact bytes any future visitor will download when they click the asset.

The original "Source code" links remain on the release page and will still hash to unstable values — **always use the `-stamped` assets for verification**.

### Rerun behavior and idempotency

The action is safe to re-run on the same release. On a rerun:

- If a `-stamped` asset already exists on the release, its **existing bytes are reused** — the action does not re-download GitHub's auto-archive (which would likely produce different bytes — see above) and does not attempt to overwrite the asset. The existing hash is re-checked against the stamp API, and the release body is rewritten only if needed.
- If the proof manifest already exists, the action **verifies that the tag still points at the same commit the manifest pinned**. If the tag has been force-pushed to a different commit since the previous run, the action aborts with a clear error rather than silently re-stamping against a different tree. See [Tag-mutation protection](#tag-mutation-protection) for details and recovery steps.
- Partial failures from a previous run (e.g. zip uploaded but tar.gz missing) are picked up and completed on the rerun without disturbing what was already stamped.

### Tag-mutation protection

Git tags can be force-pushed, which means a tag that was pointing at commit `A` when stamped can later be made to point at a completely different commit `B`. If the action naively re-stamped on top of such a mutation, the release could end up with stamped artifacts that disagree about which commit they represent — a silently broken proof.

To prevent that, every run performs a **preflight check**. Because the proof manifest is always generated (it's a hard invariant, not an input), any rerun is guaranteed to have a manifest from the previous run to compare against — there is no "manifest-less rerun" loophole.

1. If a `<tag>.stamp.txt` manifest from a previous run is present on the release, the action downloads it and parses out the `commit:` line.
2. It fetches the commit SHA the tag currently resolves to via the GitHub API.
3. If the two disagree, the run **aborts** with an error like:

   > Tag mutation detected: `v1.0.1` now resolves to commit `b2b2…`, but the existing proof manifest `v1.0.1.stamp.txt` pins commit `a1a1…`. This release is in an inconsistent state and the action refuses to attest to it.

If you see this error, you have two options:

- **Reset the tag** back to the commit the manifest pins (`git tag -f v1.0.1 a1a1…` + `git push --force origin v1.0.1`), if the force-push was a mistake.
- **Delete the previously stamped assets** (`<repo>-<version>-stamped.zip`, `<repo>-<version>-stamped.tar.gz`, `<tag>.stamp.txt`) from the release UI. The next run will then stamp a fresh, consistent set against the current commit.

The previously-stamped on-chain records remain valid for whichever bytes they originally attested to — the action simply refuses to mix them with contradictory new attestations.

### Required permissions

Because the action uploads assets to the release and edits the release body, the workflow needs `contents: write` on the `GITHUB_TOKEN`:

```yaml
permissions:
  contents: write
```

Without this, uploads fail with a clear 403 error telling you exactly what to add.

## Usage

```yaml
name: Stamp Release
on:
  release:
    types: [published]

jobs:
  stamp:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: gridcat/gridcoin-stamp-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `github-token` | GitHub token for downloading assets and updating the release body | `${{ github.token }}` |
| `api-url` | Stamp API base URL | `https://stamp.gridcoin.club/api` |
| `include-source-archives` | Re-upload the auto-generated source archives as immutable `<repo>-<version>-stamped.zip/.tar.gz` assets and stamp them | `true` |
| `include-release-assets` | Also stamp files that other tooling (semantic-release, goreleaser, …) already uploaded to the release | `true` |
| `wait-for-confirmation` | Poll until the blockchain confirms the stamps before finishing | `false` |
| `poll-timeout` | Max seconds to wait for blockchain confirmation | `300` |
| `poll-interval` | Seconds between confirmation polls | `30` |

> **Self-hosting note.** `api-url` exists so you can point the action at a private or self-hosted stamp service. Only the 64-character SHA-256 hash is ever sent to that URL — never the file contents, never the source, never any secret. Those hashes are about to be published on a public blockchain anyway, so there is no confidentiality risk in directing them at a different endpoint; the only thing you trust the endpoint with is whether it will actually submit them.

## Outputs

| Output | Description |
|--------|-------------|
| `stamps` | JSON array of stamp results |

Each entry in the `stamps` array has the following shape:

```json
{
  "filename": "gridcoin-stamp-action-1.0.0-stamped.zip",
  "hash": "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
  "proofUrl": "https://stamp.gridcoin.club/proof/b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
  "status": "submitted"
}
```

Status is one of: `submitted` (hash sent to API), `pending` (polling timed out), or `confirmed` (blockchain confirmed).

## Examples

### Basic — stamp source archives only

```yaml
- uses: gridcat/gridcoin-stamp-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Wait for blockchain confirmation

```yaml
- uses: gridcat/gridcoin-stamp-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    wait-for-confirmation: true
    poll-timeout: 600
```

### Stamp only files uploaded by other tooling

Skip the re-uploaded source archives and only stamp assets that other tools (semantic-release, goreleaser, …) already uploaded. The proof manifest is still generated — it is a hard invariant of the action and cannot be disabled.

```yaml
- uses: gridcat/gridcoin-stamp-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    include-source-archives: false
```

### Commit-level proof only

If you don't care about byte-for-byte archive verification and only want a cheap commit-level proof, disable both the source archives and the pre-existing asset stamping — you'll get just the proof manifest:

```yaml
- uses: gridcat/gridcoin-stamp-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    include-source-archives: false
    include-release-assets: false
```

### Use stamp output in subsequent steps

```yaml
- uses: gridcat/gridcoin-stamp-action@v1
  id: stamp
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}

- run: echo '${{ steps.stamp.outputs.stamps }}' | jq .
```

### Using with CircleCI and semantic-release

If you use [CircleCI](https://circleci.com/) with [semantic-release](https://github.com/semantic-release/semantic-release) to publish releases, you can still use this action. semantic-release creates a GitHub Release via the `@semantic-release/github` plugin, which triggers the `release: published` event. A separate GitHub Actions workflow then picks up that event and stamps the assets.

**CircleCI** handles your build, test, and release pipeline as usual:

```yaml
# .circleci/config.yml (simplified)
jobs:
  release:
    docker:
      - image: cimg/node:22.0
    steps:
      - checkout
      - run: npm ci
      - run: npx semantic-release
```

Make sure your semantic-release config includes the `@semantic-release/github` plugin (it's included by default) so that a GitHub Release is created with assets.

**GitHub Actions** runs the stamping workflow, triggered automatically when the release appears:

```yaml
# .github/workflows/stamp.yml
name: Stamp Release
on:
  release:
    types: [published]

jobs:
  stamp:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: gridcat/gridcoin-stamp-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

This works because the action only reacts to the GitHub Release event — it doesn't matter whether the release was created by semantic-release on CircleCI, manually, or by any other tool.

> [!IMPORTANT]
> **If your release is created by a GitHub Actions workflow** (e.g. semantic-release running inside GitHub Actions rather than CircleCI), you **must** use a Personal Access Token (PAT) or GitHub App token instead of `GITHUB_TOKEN` for the step that creates the release. Events generated by `GITHUB_TOKEN` [do not trigger other workflows](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication#using-the-github_token-in-a-workflow) — this is a GitHub limitation to prevent recursive workflow runs. If your release workflow uses `GITHUB_TOKEN`, the `release: published` event will fire but GitHub will silently suppress it, and the Stamp Release workflow will never run.
>
> This does **not** apply when the release is created from an external CI system (CircleCI, Jenkins, etc.) using a PAT — those events trigger workflows normally.
>
> **Fix:** Create a [fine-grained PAT](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token) with the permissions that semantic-release requires (`contents: write`, `issues: write`, and `pull_requests: write`), store it as a repository secret (e.g. `PAT_TOKEN`), and use it in your release step:
>
> ```yaml
> # .github/workflows/release.yml
> - name: Release
>   run: npx semantic-release
>   env:
>     GITHUB_TOKEN: ${{ secrets.PAT_TOKEN }}
> ```

## Release body output

The action appends a section like this to your release notes:

---

### Blockchain Timestamps (Gridcoin)
| File | SHA-256 | Proof | Status |
|------|---------|-------|--------|
| gridcoin-stamp-action-1.1.0-stamped.zip | `d1f18678e819a8cadafef2301d7711e39569c0c1d10c0fca1e0c4d62c410b6d6` | [Verify](https://stamp.gridcoin.club/proof/d1f18678e819a8cadafef2301d7711e39569c0c1d10c0fca1e0c4d62c410b6d6) | submitted |
| gridcoin-stamp-action-1.1.0-stamped.tar.gz | `00fd6ca8f2d279972205571ce66f92c500bf2bcf4bbbeb1dcb35c3b5b324a851` | [Verify](https://stamp.gridcoin.club/proof/00fd6ca8f2d279972205571ce66f92c500bf2bcf4bbbeb1dcb35c3b5b324a851) | submitted |
| v1.1.0.stamp.txt | `fb55c015ee5efa8073dfa7cb1ec5ad71d7507c6b73265c9f35d39e1cb17db502` | [Verify](https://stamp.gridcoin.club/proof/fb55c015ee5efa8073dfa7cb1ec5ad71d7507c6b73265c9f35d39e1cb17db502) | submitted |

---

Re-running the action on the same release replaces the section rather than duplicating it. The action is idempotent: if the `-stamped` assets already exist on the release, they will not be re-uploaded, and their existing hashes will be re-checked against the stamp API.

## Verifying a stamp

### Stamped source archive

The easiest way:

1. Download the `…-stamped.zip` (or `.tar.gz`) asset from the release page — **not** the "Source code" auto-archive.
2. Drag and drop it onto [stamp.gridcoin.club](https://stamp.gridcoin.club). The page hashes the file locally in your browser (the file never leaves your machine) and looks it up against the blockchain. If the file was stamped, you'll see the proof directly.

Or, from a terminal:

1. Download the `…-stamped.zip` (or `.tar.gz`) asset from the release page.
2. Compute its SHA-256: `sha256sum <file>`.
3. Open the Verify link next to the same filename in the release body and confirm it matches.

### Proof manifest

The manifest is a four-line text file derived purely from git state, so anyone with a clone of the repository can regenerate it and confirm its hash:

```bash
OWNER=gridcat
REPO=gridcoin-stamp-action
TAG=v1.0.0

git clone https://github.com/$OWNER/$REPO && cd $REPO
git fetch --tags
printf 'repository: %s/%s\ntag: %s\ncommit: %s\ntree: %s\n' \
  "$OWNER" "$REPO" "$TAG" \
  "$(git rev-list -n 1 $TAG)" \
  "$(git rev-parse $TAG^{tree})" \
  | sha256sum
```

The output must match the hash shown in the row for `$TAG.stamp.txt` on the release page. Any mismatch means the tag points to a different commit than it did at stamping time.

> **Note:** the "Source code (zip)" and "Source code (tar.gz)" links that GitHub shows by default are **not byte-stable** and their hashes should not be compared against any stamp. Always use the `-stamped` assets or the proof manifest for verification. See [Why re-upload source archives?](#why-re-upload-source-archives) for the rationale.

## Development

```bash
# Install dependencies
npm install

# Type check
npm run typecheck

# Run tests
npm test

# Build the dist bundle
npm run build

# All of the above
npm run all
```

The `dist/` directory must be committed — GitHub Actions runs the compiled bundle directly.

## License

MIT

---

<p align="center">Made with ❤️ by @gridcat</p>
