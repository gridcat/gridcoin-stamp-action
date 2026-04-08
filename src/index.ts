import * as core from '@actions/core';
import * as github from '@actions/github';
import { getInputs } from './inputs';
import { computeSha256 } from './hasher';
import { StampApiClient } from './stamp-api';
import { pollForConfirmation } from './poller';
import { generateStampsMarkdown, updateReleaseBody } from './markdown';
import {
  getReleaseFromContext,
  downloadAssets,
  updateRelease,
  cleanupTempDir,
} from './release';
import { StampResult } from './types';

async function run(): Promise<void> {
  let tempDir: string | undefined;

  try {
    const inputs = getInputs();
    const octokit = github.getOctokit(inputs.githubToken);
    const client = new StampApiClient(inputs.apiUrl);

    // 1. Get release info
    const release = getReleaseFromContext();
    core.info(`Processing release: ${release.tagName}`);

    // 2. Download assets
    const result = await downloadAssets(octokit, release, inputs.includeSourceArchives);
    tempDir = result.tempDir;

    if (result.assets.length === 0) {
      core.warning('No assets to stamp. Skipping.');
      return;
    }

    core.info(`Found ${result.assets.length} asset(s) to stamp`);

    // 3. Hash and submit each asset
    const stamps: StampResult[] = [];
    const proofBaseUrl = inputs.apiUrl.replace(/\/api\/?$/, '/proof');

    for (const asset of result.assets) {
      core.info(`Hashing ${asset.name}...`);
      const hash = await computeSha256(asset.localPath);
      core.info(`${asset.name}: ${hash}`);

      try {
        // Check if this hash is already stamped
        const existing = await client.getByHash(hash);

        if (existing) {
          const { block, time } = existing.data.attributes;
          const status: StampResult['status'] =
            block !== null && time !== null ? 'confirmed' : 'pending';
          core.info(`${asset.name} already stamped (status: ${status}), skipping submission`);

          stamps.push({
            filename: asset.name,
            hash,
            proofUrl: `${proofBaseUrl}/${hash}`,
            status,
          });
          continue;
        }

        core.info(`Submitting hash to stamp API...`);
        const stampResponse = await client.submitHash(hash);
        const stampId = stampResponse.data.id;

        let status: StampResult['status'] = 'submitted';

        if (inputs.waitForConfirmation) {
          try {
            core.info(`Waiting for blockchain confirmation of stamp ${stampId}...`);
            await pollForConfirmation(client, stampId, inputs.pollTimeout, inputs.pollInterval);
            status = 'confirmed';
          } catch (pollError) {
            core.warning(
              `Confirmation polling timed out for ${asset.name}: ${pollError instanceof Error ? pollError.message : pollError}`,
            );
            status = 'pending';
          }
        }

        stamps.push({
          filename: asset.name,
          hash,
          proofUrl: `${proofBaseUrl}/${hash}`,
          status,
        });

        core.info(`Stamped ${asset.name} (status: ${status})`);
      } catch (error) {
        core.warning(
          `Failed to stamp ${asset.name}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    if (stamps.length === 0) {
      core.warning('All stamp submissions failed. Release body not updated.');
      return;
    }

    // 4. Update release body
    const stampsMarkdown = generateStampsMarkdown(stamps);
    const newBody = updateReleaseBody(release.body, stampsMarkdown);
    await updateRelease(octokit, release.id, newBody);
    core.info('Release body updated with stamp proof links');

    // 5. Set output
    core.setOutput('stamps', JSON.stringify(stamps));
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  } finally {
    if (tempDir) {
      await cleanupTempDir(tempDir);
    }
  }
}

run();
