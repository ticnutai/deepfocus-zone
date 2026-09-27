import { beforeEach, expect, it, vi } from 'vitest';
import { isCloudTemporarilyUnavailable, markCloudAvailable, markCloudTemporarilyUnavailable } from '@/lib/cloudAvailability';

beforeEach(() => {
  sessionStorage.clear();
  vi.useRealTimers();
});

it('shares one short cloud-failure circuit across startup services', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-27T10:00:00Z'));
  markCloudTemporarilyUnavailable(30_000);
  expect(isCloudTemporarilyUnavailable()).toBe(true);
  vi.advanceTimersByTime(30_001);
  expect(isCloudTemporarilyUnavailable()).toBe(false);
});

it('clears the circuit immediately after a successful cloud request', () => {
  markCloudTemporarilyUnavailable();
  markCloudAvailable();
  expect(isCloudTemporarilyUnavailable()).toBe(false);
});
