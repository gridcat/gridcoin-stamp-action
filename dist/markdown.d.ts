import { StampResult } from './types';
export declare function generateStampsMarkdown(stamps: StampResult[]): string;
export declare function updateReleaseBody(existingBody: string | null, stampsMarkdown: string): string;
