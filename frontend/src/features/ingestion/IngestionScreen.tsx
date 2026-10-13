import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CameraCapture } from '../../components/CameraCapture';
import { ModelSetup } from '../../components/ModelSetup';
import { useModelStatuses } from '../../ml/modelStatus';
import { deviceModels, useExecutionPlan } from '../../ml/useExecutionPlan';
import { useServices } from '../../services/ServicesProvider';
import { ui } from '../../theme';
import { IngestionResult } from './components/IngestionResult';
import { screenStyles } from './components/screenStyles';
import { Centered, ErrorPanel, JunkWarning, StepProgress } from './components/StatusViews';
import { useIngestionMode, type ModeKey } from './modes';
import { useIngestion } from './useIngestion';

/** Container: wires a mode strategy and the pipeline to the state machine and picks a view. */
export function IngestionScreen({
  mode: modeKey,
  garmentId,
  underHeader = false,
}: {
  mode: ModeKey;
  garmentId?: string;
  /** The route shows a navigation header, which already clears the status bar. */
  underHeader?: boolean;
}) {
  const { pipeline, models, closet, sync } = useServices();
  const statuses = useModelStatuses(models.status);
  const plan = useExecutionPlan(models.router);
  const mode = useIngestionMode(modeKey, garmentId);
  const { state, capture, processAnyway, reset } = useIngestion(mode, pipeline);
  const insets = useSafeAreaInsets();

  const page = (children: ReactNode, scroll = false) => {
    const style = [screenStyles.padded, { paddingTop: (underHeader ? 0 : insets.top) + 16, paddingBottom: 32 }];
    return scroll ? (
      <ScrollView style={ui.screen} contentContainerStyle={style}>{children}</ScrollView>
    ) : (
      <View style={[ui.screen, ...style]}>{children}</View>
    );
  };

  // Models the plan sends to the cloud need no download on this phone.
  const needed = deviceModels(mode.requiredModels, plan);
  const modelsReady = needed.every((k) => statuses[k].state !== 'downloading' && models.files.isDownloaded(k));
  if (!modelsReady) return page(<ModelSetup required={needed} />);

  switch (state.kind) {
    case 'capture':
      return <CameraCapture onCapture={capture} hint={mode.copy.captureHint} />;
    case 'inspecting':
      return <Centered label="Checking photo quality…" />;
    case 'junk':
      return page(<JunkWarning quality={state.quality} onRetake={reset} onProceed={() => processAnyway(state.photo)} />, true);
    case 'processing':
      return page(<StepProgress steps={mode.steps} current={state.step} />);
    case 'error':
      return page(<ErrorPanel message={state.message} onRetry={reset} />);
    case 'done': {
      const { outcome } = state;
      const garment = outcome.garment;
      return page(
        <IngestionResult
          copy={mode.copy}
          result={state.result}
          outcome={outcome}
          onAgain={reset}
          onCategory={
            garment && mode.asksCategory
              ? (category) => {
                  closet
                    .update(garment.id, { category })
                    .then(() => sync.syncAll())
                    .catch(() => {});
                }
              : undefined
          }
          onAddPhotos={
            mode.addPhotos
              ? () => {
                  reset();
                  mode.addPhotos!(outcome);
                }
              : undefined
          }
          onExit={() => {
            reset();
            mode.exit(outcome);
          }}
        />,
        true,
      );
    }
  }
}
