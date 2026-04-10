/**
 * Thin entry point for the GitHub Action. All orchestration lives in
 * `./flow` so that its helpers can be imported and unit-tested without
 * triggering a full action run as a side effect of the import.
 */
import { run } from './flow';

run();
