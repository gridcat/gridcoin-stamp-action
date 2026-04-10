/**
 * GitHub Releases integration layer.
 *
 * We never stamp GitHub's auto-generated source archives directly: their
 * bytes are not stable across git/gzip versions (see README "Why re-upload
 * source archives?"), so any hash computed from them is unverifiable after
 * the fact. Instead, this module provides the primitives to download those
 * archives once, re-upload them as immutable release assets under a
 * `-stamped` name, generate a reproducible proof manifest, and read the
 * release's live state for idempotent reruns.
 */
import * as github from '@actions/github';
import * as core from '@actions/core';

type Octokit = ReturnType<typeof github.getOctokit>;

export interface ReleaseInfo {
  id: number;
  tagName: string;
  body: string | null;
}

export interface ReleaseAssetRef {
  id: number;
  name: string;
}

export interface CommitInfo {
  commit: string;
  tree: string;
}

/**
 * Reads the release the workflow was triggered by. Only `id`, `tagName`, and
 * `body` are surfaced: the event payload's asset list is a point-in-time
 * snapshot that goes stale the moment we start uploading, so idempotency
 * checks go through the live `listReleaseAssets` call below instead.
 */
export function getReleaseFromContext(): ReleaseInfo {
  const payload = github.context.payload;

  if (!payload.release) {
    throw new Error(
      'No release found in event payload. This action must be triggered by a release event.',
    );
  }

  return {
    id: payload.release.id,
    tagName: payload.release.tag_name,
    body: payload.release.body ?? null,
  };
}

/**
 * Fresh fetch of the release's assets straight from the API.
 *
 * Re-fetching (rather than reusing `ReleaseInfo.assets`) is what makes the
 * action idempotent on reruns: if a previous run already uploaded the
 * `-stamped` archives or the proof manifest, we want to see them here so we
 * can reuse their bytes instead of trying to upload a duplicate (which
 * GitHub would reject with 422).
 */
export async function listReleaseAssets(
  octokit: Octokit,
  releaseId: number,
): Promise<ReleaseAssetRef[]> {
  const { owner, repo } = github.context.repo;
  // Explicit element type: `octokit.paginate`'s inference broke in the
  // @octokit/core v5→v7 transition and ncc's internal compile defaults the
  // element to `any` (tsc is fine). Annotating sidesteps both.
  const assets = await octokit.paginate(octokit.rest.repos.listReleaseAssets, {
    owner,
    repo,
    release_id: releaseId,
    per_page: 100,
  });
  return assets.map((a: ReleaseAssetRef) => ({ id: a.id, name: a.name }));
}

/**
 * Resolves a ref (typically the release tag) to its commit SHA and tree SHA.
 * Both are needed for the proof manifest — the commit SHA identifies the
 * exact commit, and the tree SHA is a merkle root over the file contents,
 * giving a second independent handle that a verifier can derive from a clone.
 */
export async function getCommitInfo(octokit: Octokit, ref: string): Promise<CommitInfo> {
  const { owner, repo } = github.context.repo;
  const { data } = await octokit.rest.repos.getCommit({ owner, repo, ref });
  return {
    commit: data.sha,
    tree: data.commit.tree.sha,
  };
}

/**
 * GitHub's native auto-archives are named `<repo>-<version>.zip` with the
 * leading `v` stripped from the tag. We mirror that convention so the
 * stamped assets sit visually next to them on the release page, with an
 * explicit `-stamped` suffix to make it obvious which one a verifier should
 * download.
 */
export function stripLeadingV(tag: string): string {
  return tag.startsWith('v') ? tag.slice(1) : tag;
}

/**
 * The canonical names for the three artifacts this action manages.
 * Keep these stable: the release body, idempotency checks, and the README
 * verification recipe all assume these exact filenames. The manifest keeps
 * the leading `v` on purpose — it's keyed by git tag, not semver version.
 */
export function stampedAssetNames(
  repoName: string,
  tag: string,
): { zip: string; tar: string; manifest: string } {
  const version = stripLeadingV(tag);
  return {
    zip: `${repoName}-${version}-stamped.zip`,
    tar: `${repoName}-${version}-stamped.tar.gz`,
    manifest: `${tag}.stamp.txt`,
  };
}

/**
 * Builds the proof manifest body.
 *
 * **This format is a public interface**: anyone with a clone of the
 * repository must be able to regenerate these exact bytes from git state
 * alone and confirm the stamped hash. That means:
 *   - Four fields, in this order, one per line, `key: value` with a single
 *     space after the colon.
 *   - Trailing newline after the last line (POSIX convention; `printf` in
 *     the README recipe emits the same).
 *   - No timestamps, run IDs, or other non-git-derivable data — those would
 *     break reproducibility.
 * Changing this format is a breaking change for anyone who stamped an older
 * manifest; add a new format, don't mutate this one.
 */
export function buildProofManifest(
  owner: string,
  repo: string,
  tag: string,
  commit: string,
  tree: string,
): string {
  return (
    `repository: ${owner}/${repo}\n` +
    `tag: ${tag}\n` +
    `commit: ${commit}\n` +
    `tree: ${tree}\n`
  );
}

/**
 * Extracts the `commit:` line from a previously generated proof manifest.
 * The inverse of `buildProofManifest`; returns `null` on unknown format.
 *
 * The regex is lenient about line endings (CRLF-normalized manifests
 * still parse) but strict about the SHA format — exactly 40 lowercase
 * hex characters, rejecting abbreviated or uppercased values.
 */
export function parseProofManifestCommit(body: string): string | null {
  const match = body.match(/^commit: ([0-9a-f]{40})\s*$/m);
  return match ? match[1] : null;
}

/**
 * Fetches GitHub's auto-generated zipball for a ref.
 *
 * The `Buffer.from(data as ArrayBuffer)` cast works around an Octokit type
 * mismatch: the endpoint returns a 302 that Octokit follows transparently
 * to a binary body, but the generated types still declare `data: string`
 * (inherited from the redirect-body shape). At runtime `data` is an
 * ArrayBuffer — we assert that here so the Buffer conversion type-checks.
 */
export async function downloadZipball(octokit: Octokit, ref: string): Promise<Buffer> {
  const { owner, repo } = github.context.repo;
  const { data } = await octokit.rest.repos.downloadZipballArchive({ owner, repo, ref });
  return Buffer.from(data as ArrayBuffer);
}

/** Same Octokit type/runtime-mismatch caveat as `downloadZipball`. */
export async function downloadTarball(octokit: Octokit, ref: string): Promise<Buffer> {
  const { owner, repo } = github.context.repo;
  const { data } = await octokit.rest.repos.downloadTarballArchive({ owner, repo, ref });
  return Buffer.from(data as ArrayBuffer);
}

/**
 * Downloads the raw bytes of a release asset by ID.
 *
 * The `accept: application/octet-stream` header is what tells the GitHub API
 * to return the binary blob rather than a JSON metadata envelope. Without
 * it, `data` would be a JSON object describing the asset, not its contents.
 */
export async function downloadAssetBytes(octokit: Octokit, assetId: number): Promise<Buffer> {
  const { owner, repo } = github.context.repo;
  const { data } = await octokit.rest.repos.getReleaseAsset({
    owner,
    repo,
    asset_id: assetId,
    headers: { accept: 'application/octet-stream' },
  });
  return Buffer.from(data as unknown as ArrayBuffer);
}

/**
 * Uploads a Buffer as a release asset under a given name.
 *
 * `data as unknown as string` works around another Octokit type gap:
 * `uploadReleaseAsset`'s `data` parameter is typed as string but the
 * underlying plumbing accepts (and expects) a Buffer for binary uploads.
 *
 * On 403, the default `GITHUB_TOKEN` in many workflows is read-only and
 * Uploads fail with an opaque "Resource not accessible by integration".
 * We rewrap it with an actionable message pointing at `contents: write`.
 */
export async function uploadReleaseAsset(
  octokit: Octokit,
  releaseId: number,
  name: string,
  contentType: string,
  data: Buffer,
): Promise<void> {
  const { owner, repo } = github.context.repo;
  try {
    await octokit.rest.repos.uploadReleaseAsset({
      owner,
      repo,
      release_id: releaseId,
      name,
      data: data as unknown as string,
      headers: {
        'content-type': contentType,
        'content-length': data.length,
      },
    });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 403) {
      throw new Error(
        `Upload of '${name}' failed with 403 Forbidden. The workflow's GITHUB_TOKEN needs 'contents: write' permission. Add 'permissions: { contents: write }' to your workflow or job.`,
      );
    }
    throw error;
  }
  core.info(`Uploaded release asset: ${name}`);
}

export async function updateRelease(
  octokit: Octokit,
  releaseId: number,
  body: string,
): Promise<void> {
  const { owner, repo } = github.context.repo;

  await octokit.rest.repos.updateRelease({
    owner,
    repo,
    release_id: releaseId,
    body,
  });
}
