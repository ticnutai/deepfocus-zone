/**
 * navBenchSignal — zero-dependency module-level bridge
 *
 * CategoryExplorerView registers itself (via `register`) when mounted.
 * NavFlowBench calls `trigger` to start a real benchmark run inside the
 * actual CategoryExplorerView component.  This ensures we measure real
 * DnD-wrapped folder tile rendering, not a toy simulator.
 */

export type BenchStepResult = { label: string; times: number[] };
export type BenchCompleteFn = (steps: BenchStepResult[]) => void;
export type BenchProgressFn = (run: number, step: number) => void;

export type BenchTriggerFn = (
  path: Array<string | null>,
  numRuns: number,
  stepLabels: string[],
  onComplete: BenchCompleteFn,
  onProgress: BenchProgressFn,
) => void;

let _fn: BenchTriggerFn | null = null;

export const navBenchSignal = {
  isAvailable(): boolean {
    return _fn !== null;
  },

  register(fn: BenchTriggerFn): void {
    _fn = fn;
  },

  unregister(): void {
    _fn = null;
  },

  /**
   * Trigger a bench run.
   * @returns true if CategoryExplorerView is mounted and run was started; false otherwise.
   */
  trigger(
    path: Array<string | null>,
    numRuns: number,
    stepLabels: string[],
    onComplete: BenchCompleteFn,
    onProgress: BenchProgressFn,
  ): boolean {
    if (!_fn) return false;
    _fn(path, numRuns, stepLabels, onComplete, onProgress);
    return true;
  },
};
