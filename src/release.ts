import * as github from '@actions/github';
import * as core from '@actions/core';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AssetInfo } from './types';

type Octokit = ReturnType<typeof github.getOctokit>;

export interface ReleaseInfo {
  id: number;
  tagName: string;
  body: string | null;
  zipballUrl: string | null;
  tarballUrl: string | null;
  assets: Array<{
    id: number;
    name: string;
    url: string;
  }>;
}

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
    zipballUrl: payload.release.zipball_url ?? null,
    tarballUrl: payload.release.tarball_url ?? null,
    assets: (payload.release.assets ?? []).map(
      (a: { id: number; name: string; url: string }) => ({
        id: a.id,
        name: a.name,
        url: a.url,
      }),
    ),
  };
}

export async function downloadAssets(
  octokit: Octokit,
  release: ReleaseInfo,
  includeSourceArchives: boolean,
): Promise<{ assets: AssetInfo[]; tempDir: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), 'grc-stamp-'));
  const assets: AssetInfo[] = [];

  const { owner, repo } = github.context.repo;

  if (includeSourceArchives) {
    if (release.zipballUrl) {
      const zipPath = join(tempDir, `${release.tagName}-source.zip`);
      core.info(`Downloading source archive: ${release.tagName}-source.zip`);
      const { data } = await octokit.rest.repos.downloadZipballArchive({
        owner,
        repo,
        ref: release.tagName,
      });
      await writeFile(zipPath, Buffer.from(data as ArrayBuffer));
      assets.push({ name: `${release.tagName}-source.zip`, localPath: zipPath });
    }

    if (release.tarballUrl) {
      const tarPath = join(tempDir, `${release.tagName}-source.tar.gz`);
      core.info(`Downloading source archive: ${release.tagName}-source.tar.gz`);
      const { data } = await octokit.rest.repos.downloadTarballArchive({
        owner,
        repo,
        ref: release.tagName,
      });
      await writeFile(tarPath, Buffer.from(data as ArrayBuffer));
      assets.push({ name: `${release.tagName}-source.tar.gz`, localPath: tarPath });
    }
  }

  for (const asset of release.assets) {
    const assetPath = join(tempDir, asset.name);
    core.info(`Downloading release asset: ${asset.name}`);
    const { data } = await octokit.rest.repos.getReleaseAsset({
      owner,
      repo,
      asset_id: asset.id,
      headers: { accept: 'application/octet-stream' },
    });
    await writeFile(assetPath, Buffer.from(data as unknown as ArrayBuffer));
    assets.push({ name: asset.name, localPath: assetPath });
  }

  return { assets, tempDir };
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

export async function cleanupTempDir(tempDir: string): Promise<void> {
  await rm(tempDir, { recursive: true, force: true });
}
