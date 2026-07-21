import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildJobListViewModels,
  isMissingCpJobsRelation,
  jobUiStatusLabel,
  resolveJobUiStatus,
} from './job-attempt-display.js';

describe('cp-runtime job-attempt-display (B1.8)', () => {
  it('maps UI labels for queued/running/failed/retry', () => {
    assert.equal(jobUiStatusLabel('queued'), 'Đang chờ');
    assert.equal(jobUiStatusLabel('running'), 'Đang chạy');
    assert.equal(jobUiStatusLabel('failed'), 'Thất bại');
    assert.equal(jobUiStatusLabel('retry'), 'Đang chạy lại');
  });

  it('resolveJobUiStatus: retry when attempt_number > 1 is active', () => {
    assert.equal(
      resolveJobUiStatus(
        { status: 'running' },
        [
          { attempt_number: 1, status: 'failed' },
          { attempt_number: 2, status: 'running' },
        ],
      ),
      'retry',
    );
    assert.equal(
      resolveJobUiStatus({ status: 'queued' }, []),
      'queued',
    );
    assert.equal(
      resolveJobUiStatus(
        { status: 'failed' },
        [{ attempt_number: 1, status: 'failed' }],
      ),
      'failed',
    );
    assert.equal(
      resolveJobUiStatus(
        { status: 'succeeded' },
        [{ attempt_number: 2, status: 'succeeded' }],
      ),
      'succeeded',
    );
  });

  it('buildJobListViewModels joins attempts per job', () => {
    const items = buildJobListViewModels(
      [
        {
          id: 'j1',
          status: 'running',
          created_at: '2026-07-21T00:00:00Z',
          required_image_spec_ref: 'gpuvietnam.comfy.v3@1.0',
        },
      ],
      [
        { job_id: 'j1', attempt_number: 1, status: 'failed', error_message: 'lost' },
        { job_id: 'j1', attempt_number: 2, status: 'provisioning' },
      ],
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].uiStatus, 'retry');
    assert.equal(items[0].uiLabel, 'Đang chạy lại');
    assert.equal(items[0].attemptNumber, 2);
    assert.equal(items[0].attemptCount, 2);
  });

  it('detects missing relation errors', () => {
    assert.equal(isMissingCpJobsRelation({ code: '42P01', message: 'x' }), true);
    assert.equal(isMissingCpJobsRelation({ message: 'Could not find the table' }), true);
    assert.equal(isMissingCpJobsRelation({ message: 'permission denied' }), false);
  });
});
