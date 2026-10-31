import type {GpuKernelObservation} from './gpu-budget.mjs';
/** DATA only; never initializes a GPU or yields a lease. */
export function readLinuxAmdVramObservations():readonly Readonly<GpuKernelObservation>[];
