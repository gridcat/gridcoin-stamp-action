import * as github from '@actions/github';
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
export declare function getReleaseFromContext(): ReleaseInfo;
export declare function downloadAssets(octokit: Octokit, release: ReleaseInfo, includeSourceArchives: boolean): Promise<{
    assets: AssetInfo[];
    tempDir: string;
}>;
export declare function updateRelease(octokit: Octokit, releaseId: number, body: string): Promise<void>;
export declare function cleanupTempDir(tempDir: string): Promise<void>;
export {};
