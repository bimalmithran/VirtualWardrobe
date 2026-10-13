import { Emitter } from '../lib/observable';
import { planExecution, type Capabilities, type ExecutionPlan, type PlanInputs } from './capabilities';

/**
 * Holds the device's capabilities (probed once at launch) and recomputes the execution plan
 * when its inputs change, e.g. the user grants cloud-processing consent or toggles the NPU.
 */
export class ExecutionRouter {
  private changes = new Emitter<ExecutionPlan>();
  private cached: ExecutionPlan | null = null;

  constructor(
    private capabilities: Capabilities,
    private readonly inputs: () => PlanInputs,
  ) {}

  subscribe = (listener: (plan: ExecutionPlan) => void) => this.changes.subscribe(listener);

  get caps() {
    return this.capabilities;
  }

  plan(): ExecutionPlan {
    const next = planExecution(this.capabilities, this.inputs());
    if (!this.cached || JSON.stringify(this.cached) !== JSON.stringify(next)) {
      this.cached = next;
      this.changes.emit(next);
    }
    return next;
  }

  /** Replaces the capabilities after an async probe (web adapters) finishes. */
  update(capabilities: Capabilities) {
    this.capabilities = capabilities;
    this.plan();
  }
}
