import * as core from '@actions/core';
import { StampApiClient } from './stamp-api';
import { StampApiResponse } from './types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
