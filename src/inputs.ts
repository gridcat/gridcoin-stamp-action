import * as core from '@actions/core';
import { ActionInputs } from './types';

export function getInputs(): ActionInputs {
  const pollTimeout = parseInt(core.getInput('poll-timeout'), 10);
  const pollInterval = parseInt(core.getInput('poll-interval'), 10);

  if (isNaN(pollTimeout) || pollTimeout <= 0) {
    throw new Error('poll-timeout must be a positive number');
  }
  if (isNaN(pollInterval) || pollInterval <= 0) {
    throw new Error('poll-interval must be a positive number');
  }

  return {
    apiUrl: core.getInput('api-url'),
    waitForConfirmation: core.getBooleanInput('wait-for-confirmation'),
    pollTimeout,
    pollInterval,
    includeSourceArchives: core.getBooleanInput('include-source-archives'),
    includeReleaseAssets: core.getBooleanInput('include-release-assets'),
    githubToken: core.getInput('github-token', { required: true }),
  };
}
