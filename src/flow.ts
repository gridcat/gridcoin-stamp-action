/**
 * Orchestration layer for the action. Lives in its own module (rather than
 * alongside `run()` in index.ts) so these helpers can be unit-tested in
 * isolation — `index.ts` is the entry point that calls `run()` at import
 * time, which would otherwise fire during test imports.
 *
 * The full release-event flow:
 *
 *   1. Read the release that triggered the workflow.
 *   2. Snapshot the release's current assets (used for idempotency).
 *   3. Preflight tag-mutation check: if a prior run already uploaded the
 *      proof manifest, verify the tag still resolves to the same commit
 *      the manifest pinned. Abort loudly on mismatch — a force-pushed tag
 *      must not silently re-stamp against a different tree.
 *   4. Build a list of managed artifacts: re-uploaded source zip/tar
 *      (gated by `include-source-archives`) and the proof manifest
 *      (mandatory — see `buildArtifacts`).
 *   5. For each managed artifact: if it already exists on the release
 *      (a rerun), reuse those bytes; otherwise produce and upload. Hash
 *      the bytes, submit the hash to stamp.gridcoin.club.
 *   6. Optionally also stamp any OTHER assets the release already carries
 *      (e.g. binaries uploaded by semantic-release), skipping our own
 *      managed names to avoid double-counting.
 *   7. Replace or append the "Blockchain Timestamps" section in the
 *      release body with a table of results.
 *
 * Individual artifact failures are caught and surfaced as warnings rather
 * than fatal errors — one broken asset shouldn't block the rest of the
 * release from getting stamped. The job only hard-fails on setup errors
 * (bad inputs, missing event payload, tag mutation).
 */
import * as core from '@actions/core';
import * as github from '@actions/github';
import { getInputs } from './inputs';
import { sha256Buffer } from './hasher';
import { StampApiClient } from './stamp-api';
import { pollForConfirmation } from './poller';
import { generateStampsMarkdown, updateReleaseBody } from './markdown';
import {
  getReleaseFromContext,
  listReleaseAssets,
  getCommitInfo,
  buildProofManifest,
  parseProofManifestCommit,
  downloadZipball,
  downloadTarball,
  downloadAssetBytes,
  uploadReleaseAsset,
  updateRelease,
  stampedAssetNames,
  ReleaseAssetRef,
} from './release';
import { ActionInputs, StampResult } from './types';

type Octokit = ReturnType<typeof github.getOctokit>;

/**
 * A unit of work that results in one stamped asset. `produce` is lazy on
 * purpose: when an artifact already exists on the release from a prior
 * run, we skip the download/generation step entirely and reuse the bytes
 * already on GitHub's CDN.
 */
export interface Artifact {
  name: string;
  contentType: string;
  produce: () => Promise<Buffer>;
}

/** Render an unknown caught value as a short log-friendly string. */
function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function buildArtifacts(
  inputs: ActionInputs,
  octokit: Octokit,
  owner: string,
  repo: string,
  tag: string,
): Artifact[] {
  const names = stampedAssetNames(repo, tag);
  const artifacts: Artifact[] = [];

  if (inputs.includeSourceArchives) {
    artifacts.push({
      name: names.zip,
      contentType: 'application/zip',
      produce: () => downloadZipball(octokit, tag),
    });
    artifacts.push({
      name: names.tar,
      contentType: 'application/gzip',
      produce: () => downloadTarball(octokit, tag),
    });
  }

  // The proof manifest is not gated by an input: if it were optional, a
  // run originally stamped without one could later be re-run with one,
  // producing a manifest pinning commit B alongside source archives from
  // commit A — silent inconsistency. Always generating it (~200 bytes)
  // closes that hole and keeps the preflight tag-mutation check honest.
  artifacts.push({
    name: names.manifest,
    contentType: 'text/plain; charset=utf-8',
    produce: async () => {
      const { commit, tree } = await getCommitInfo(octokit, tag);
      const body = buildProofManifest(owner, repo, tag, commit, tree);
      core.info(`Proof manifest: commit=${commit} tree=${tree}`);
      return Buffer.from(body, 'utf-8');
    },
  });

  return artifacts;
}

/**
 * Returns the bytes to hash for an artifact, handling the rerun path.
 *
 * On a rerun we reuse the bytes already uploaded to the release rather
 * than regenerating them locally — GitHub auto-archives are not
 * byte-stable, so a fresh download would produce a different hash than
 * the one previously stamped. The uploaded copy is the canonical bytes.
 *
 * The `bytesCache` parameter lets the caller pre-seed already-fetched
 * payloads (e.g. the manifest downloaded during the tag-mutation
 * preflight) so they don't get re-downloaded on the reuse path.
 */
export async function resolveArtifactBytes(
  octokit: Octokit,
  releaseId: number,
  artifact: Artifact,
  existingByName: Map<string, ReleaseAssetRef>,
  bytesCache: Map<string, Buffer>,
): Promise<Buffer> {
  const cached = bytesCache.get(artifact.name);
  if (cached) {
    core.info(`Asset '${artifact.name}': using bytes cached from preflight`);
    return cached;
  }

  const existing = existingByName.get(artifact.name);
  if (existing) {
    core.info(`Asset '${artifact.name}' already present; reusing uploaded bytes`);
    return downloadAssetBytes(octokit, existing.id);
  }

  core.info(`Producing '${artifact.name}'...`);
  const bytes = await artifact.produce();
  await uploadReleaseAsset(octokit, releaseId, artifact.name, artifact.contentType, bytes);
  return bytes;
}

/**
 * Submits a hash to the stamp API and returns a `StampResult` row.
 *
 * Before submitting, we ask the API whether this hash has been stamped
 * before (`getByHash`). This isn't just an optimization — every
 * submission burns a small amount of GRC on the blockchain, so stamping
 * the same hash twice would waste wallet funds and clutter the chain
 * with duplicates. Also makes retried workflows safe.
 *
 * When `wait-for-confirmation` is enabled we poll until the stamp
 * actually lands on-chain; a polling timeout is downgraded to a warning
 * ("pending") rather than an error because the stamp was still submitted
 * successfully — confirmation hasn't happened *yet* but can be observed
 * later via the proof URL.
 */
export async function stampHash(
  client: StampApiClient,
  inputs: ActionInputs,
  filename: string,
  hash: string,
  proofBaseUrl: string,
): Promise<StampResult | null> {
  try {
    const existing = await client.getByHash(hash);

    if (existing) {
      const { block, time } = existing.data.attributes;
      const status: StampResult['status'] =
        block !== null && time !== null ? 'confirmed' : 'pending';
      core.info(`${filename} already stamped (status: ${status})`);
      return { filename, hash, proofUrl: `${proofBaseUrl}/${hash}`, status };
    }

    core.info(`Submitting hash for ${filename}...`);
    const stampResponse = await client.submitHash(hash);
    const stampId = stampResponse.data.id;

    let status: StampResult['status'] = 'submitted';

    if (inputs.waitForConfirmation) {
      try {
        core.info(`Waiting for blockchain confirmation of stamp ${stampId}...`);
        await pollForConfirmation(client, stampId, inputs.pollTimeout, inputs.pollInterval);
        status = 'confirmed';
      } catch (pollError) {
        core.warning(`Confirmation polling timed out for ${filename}: ${formatError(pollError)}`);
        status = 'pending';
      }
    }

    core.info(`Stamped ${filename} (status: ${status})`);
    return { filename, hash, proofUrl: `${proofBaseUrl}/${hash}`, status };
  } catch (error) {
    core.warning(`Failed to stamp ${filename}: ${formatError(error)}`);
    return null;
  }
}

/**
 * Preflight safeguard against tag mutation between runs.
 *
 * If a prior run uploaded the proof manifest pinning commit A and the
 * tag has since been force-pushed to commit B, a rerun would mix
 * commit-A archives with a commit-B manifest. This function aborts
 * loudly on that mismatch before any stamping happens, with remediation
 * steps telling the user to reset the tag or delete the stale assets.
 *
 * Returns the manifest bytes when a previous manifest is found, so the
 * caller can reuse them via the bytes cache and skip the re-download on
 * the artifact-loop reuse path. Returns `null` when there is no prior
 * manifest to check against (the preflight is a no-op in that case).
 */
export async function assertTagNotMutated(
  octokit: Octokit,
  tag: string,
  existingManifest: ReleaseAssetRef | undefined,
): Promise<Buffer | null> {
  if (!existingManifest) return null;

  core.info(`Existing proof manifest '${existingManifest.name}' found; verifying tag consistency`);

  const manifestBytes = await downloadAssetBytes(octokit, existingManifest.id);
  const pinnedCommit = parseProofManifestCommit(manifestBytes.toString('utf-8'));

  if (!pinnedCommit) {
    throw new Error(
      `Existing proof manifest '${existingManifest.name}' is malformed or uses an unknown format — ` +
        `cannot verify tag consistency. Delete the asset from the release to force a fresh stamp.`,
    );
  }

  const currentCommit = (await getCommitInfo(octokit, tag)).commit;

  if (pinnedCommit !== currentCommit) {
    throw new Error(
      `Tag mutation detected: '${tag}' now resolves to commit ${currentCommit}, ` +
        `but the existing proof manifest '${existingManifest.name}' pins commit ${pinnedCommit}. ` +
        `This release is in an inconsistent state and the action refuses to attest to it. ` +
        `Either reset '${tag}' back to ${pinnedCommit}, or delete the previously stamped ` +
        `assets from the release to force a clean re-stamp against the current commit.`,
    );
  }

  core.info(`Tag '${tag}' still pinned to ${currentCommit}; preflight OK`);
  return manifestBytes;
}

export async function run(): Promise<void> {
  try {
    const inputs = getInputs();
    const octokit = github.getOctokit(inputs.githubToken);
    const client = new StampApiClient(inputs.apiUrl);
    const { owner, repo } = github.context.repo;

    const release = getReleaseFromContext();
    core.info(`Processing release: ${release.tagName}`);

    // Live asset snapshot — the release payload from the event is stale
    // as soon as a previous run uploads anything. Everything downstream
    // (idempotency, tag-mutation preflight, skip-our-own-uploads filter)
    // uses THIS snapshot as the source of truth.
    const currentAssets = await listReleaseAssets(octokit, release.id);
    const existingByName = new Map(currentAssets.map((a) => [a.name, a] as const));
    const names = stampedAssetNames(repo, release.tagName);
    const managedNames = new Set(Object.values(names));

    const preflightManifestBytes = await assertTagNotMutated(
      octokit,
      release.tagName,
      existingByName.get(names.manifest),
    );

    // Seed the bytes cache with anything we already hold in memory, so
    // `resolveArtifactBytes` doesn't re-download the manifest it just
    // fetched during the preflight.
    const bytesCache = new Map<string, Buffer>();
    if (preflightManifestBytes) {
      bytesCache.set(names.manifest, preflightManifestBytes);
    }

    const artifacts = buildArtifacts(inputs, octokit, owner, repo, release.tagName);
    const stamps: StampResult[] = [];
    // The public proof URL lives at the site root (not under /api), e.g.
    // https://stamp.gridcoin.club/proof/<hash>. Derived from the API base
    // URL so self-hosted deployments that override `api-url` Just Work.
    const proofBaseUrl = inputs.apiUrl.replace(/\/api\/?$/, '/proof');

    for (const artifact of artifacts) {
      try {
        const bytes = await resolveArtifactBytes(
          octokit,
          release.id,
          artifact,
          existingByName,
          bytesCache,
        );
        const hash = sha256Buffer(bytes);
        core.info(`${artifact.name}: ${hash}`);
        const result = await stampHash(client, inputs, artifact.name, hash, proofBaseUrl);
        if (result) stamps.push(result);
      } catch (error) {
        // Per-artifact isolation: a single failure should not block the
        // rest of the release from getting stamped.
        core.warning(`Failed to prepare ${artifact.name}: ${formatError(error)}`);
      }
    }

    if (inputs.includeReleaseAssets) {
      for (const asset of currentAssets) {
        // Skip artifacts we manage ourselves: they were stamped in the
        // loop above, and re-stamping them here would duplicate the row.
        if (managedNames.has(asset.name)) continue;
        try {
          core.info(`Downloading pre-existing asset: ${asset.name}`);
          const bytes = await downloadAssetBytes(octokit, asset.id);
          const hash = sha256Buffer(bytes);
          core.info(`${asset.name}: ${hash}`);
          const result = await stampHash(client, inputs, asset.name, hash, proofBaseUrl);
          if (result) stamps.push(result);
        } catch (error) {
          core.warning(`Failed to stamp ${asset.name}: ${formatError(error)}`);
        }
      }
    }

    if (stamps.length === 0) {
      core.warning('Nothing was stamped. Release body not updated.');
      return;
    }

    const stampsMarkdown = generateStampsMarkdown(stamps);
    const newBody = updateReleaseBody(release.body, stampsMarkdown);
    await updateRelease(octokit, release.id, newBody);
    core.info('Release body updated with stamp proof links');

    core.setOutput('stamps', JSON.stringify(stamps));
  } catch (error) {
    core.setFailed(formatError(error));
  }
}
