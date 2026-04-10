import { createHash } from 'node:crypto';

export function sha256Buffer(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
