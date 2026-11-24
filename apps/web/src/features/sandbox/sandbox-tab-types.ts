import type { SandboxRunSummary } from '@nexter/contracts';
import type { SandboxTab } from './sandbox-tabs';

/** Props shared by every tab that shows the selected run. */
export interface SandboxTabSharedProps {
  runs: readonly SandboxRunSummary[];
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
  onChangeTab?: (tab: SandboxTab) => void;
  /** True while the page is still resolving the default run. */
  selectionPending?: boolean;
}

export interface SandboxDashboardProps extends SandboxTabSharedProps {
  onChangeTab: (tab: SandboxTab) => void;
}
