import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { CameraCapture } from '../../components/CameraCapture';
import { ModelSetup } from '../../components/ModelSetup';
import { useModelStatuses } from '../../ml/modelStatus';
import { useServices } from '../../services/ServicesProvider';
import { ui } from '../../theme';
import { IngestionResult } from './components/IngestionResult';
import { screenStyles } from './components/screenStyles';
import { Centered, ErrorPanel, JunkWarning, StepProgress } from './components/StatusViews';
import { useIngestionMode, type ModeKey } from './modes';
import { useIngestion } from './useIngestion';

/** Container: wires a mode strategy and the pipeline to the state machine and picks a view. */
export function IngestionScreen({ mode: modeKey }: { mode: ModeKey }) {
  const { pipeline, models, closet, sync } = useServices();
  const statuses = useModelStatuses(models.status);
  const mode = useIngestionMode(modeKey);
  const { state, capture, processAnyway, reset } = useIngestion(mode, pipeline);
  const insets = useSafeAreaInsets();

  const page = (children: ReactNode, scroll = false) => {
    const style = [screenStyles.padded, { paddingTop: insets.top + 16, paddingBottom: 32 }];
    return scroll ? (
      <ScrollView style={ui.screen} contentContainerStyle={style}>{children}</ScrollView>
    ) : (
      <View style={[ui.screen, ...style]}>{children}</View>
    );
  };

  const modelsReady = mode.requiredModels.every((k) => statuses[k].state !== 'downloading' && models.files.isDownloaded(k));
  if (!modelsReady) return page(<ModelSetup required={mode.requiredModels} />);

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
    case 'done':
      return page(
        <IngestionResult
          copy={mode.copy}
          result={state.result}
          outcome={state.outcome}
          onAgain={reset}
          onCategory={
            state.outcome.garmentId
              ? (category) => {
                  const id = state.outcome.garmentId!;
                  closet
                    .update(id, { category })
                    .then(() => sync.syncAll())
                    .catch(() => {});
                }
              : undefined
          }
          onViewCloset={() => {
            reset();
            router.navigate('/');
          }}
        />,
        true,
      );
  }
}
