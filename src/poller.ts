import * as core from '@actions/core';
import { StampApiClient } from './stamp-api';
import { StampApiResponse } from './types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Blocks until a stamp transitions from "submitted" (in mempool) to
 * "confirmed" (mined into a block), or until `timeout` seconds elapse.
 *
 * A stamp is considered confirmed when both `block` and `time` are
 * populated on the API response — the stamp API leaves them null while the
 * transaction is still pending in the Gridcoin mempool and fills them in
 * once the Scraper observes the containing block. Typical confirmation
 * takes 2–5 minutes on mainnet, which is why the default timeout is 300s.
 */
export async function pollForConfirmation(
  client: StampApiClient,
  stampId: string,
  timeout: number,
  interval: number,
): Promise<StampApiResponse> {
  const deadline = Date.now() + timeout * 1000;

  while (Date.now() < deadline) {
    const response = await client.getStamp(stampId);
    const { block, time } = response.data.attributes;

    if (block !== null && time !== null) {
      core.info(`Stamp ${stampId} confirmed in block ${block}`);
      return response;
    }

    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    core.info(`Stamp ${stampId} not yet confirmed. ${remaining}s remaining...`);
    await sleep(interval * 1000);
  }

  throw new Error(`Timed out after ${timeout}s waiting for confirmation of stamp ${stampId}`);
}
