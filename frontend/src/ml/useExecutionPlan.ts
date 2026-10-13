import { useEffect, useState } from 'react';

import type { ModelKey } from '../config/models';
import type { ExecutionPlan } from './capabilities';
import type { ExecutionRouter } from './executionRouter';

export function useExecutionPlan(router: ExecutionRouter): ExecutionPlan {
  const [plan, setPlan] = useState(() => router.plan());
  useEffect(() => router.subscribe(setPlan), [router]);
  return plan;
}

/**
 * The models a flow needs on the phone under this plan; cloud-routed ones need no download.
 * Pose only ever runs on photos of the user, which never leave the phone.
 */
export function deviceModels(required: ModelKey[], plan: ExecutionPlan): ModelKey[] {
  return required.filter((k) => k === 'pose' || plan[k] === 'device');
}
