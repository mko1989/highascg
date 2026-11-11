import { sourceSignal, matchesRatio } from '../public/mvr-geometry.js';
import { umdHeight } from './mvr-umd.js';

// Raw interface.state uses LinkStateE, before PixelFlow's UI status conversion.
export function inputSignals(interfaces) {
  return interfaces.filter((input) => input.auxiliaryInfo?.connectorInfo?.interfaceType === 2).map((input) => {
    const width = input.actualTiming?.horizontal?.addTime;
    const height = input.actualTiming?.vertical?.addTime;
    const connected = [1, 2, 3, 4].includes(input.state) && input.auxiliaryInfo?.online !== 0 &&
      input.auxiliaryInfo?.connectorInfo?.workMode !== 2 && Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0;
    return { id: input.interfaceId, connected, width: connected ? width : null, height: connected ? height : null };
  });
}

export function screenSignals(screens) {
  return screens.filter((screen) => screen.screenIdObj?.type !== 8).flatMap((screen) => {
    const width = screen.mosaic?.window?.width ?? screen.timing?.horizontal?.addTime;
    const height = screen.mosaic?.window?.height ?? screen.timing?.vertical?.addTime;
    const valid = [width, height].every((n) => Number.isSafeInteger(n) && n > 0);
    // PGM/PVW share a screen's dimensions, even when its physical output is disabled.
    return [3, 4].map((sourceType) => ({ id: screen.screenId, sourceType, connected: valid,
      width: valid ? width : null, height: valid ? height : null }));
  });
}

export function layerAspect(layer, signals, config) {
  const source = layer.source?.general || {};
  const mode = layer.aspectRatio?.aspectRatio === 8 ? 8 : 5;
  const signal = sourceSignal({ sourceType: source.sourceType, sourceId: source.sourceId }, signals);
  const offset = umdHeight(layer, config);
  const sourceRatio = signal?.connected ? signal.width / signal.height : null;
  const ratio = sourceRatio && (mode === 8 || (offset > 0 && matchesRatio(layer.window, sourceRatio, offset))) ?
    sourceRatio : layer.window.width / Math.max(1, layer.window.height - (offset ?? 0));
  return { sourceId: source.sourceId ?? null, sourceType: source.sourceType ?? null,
    umdHeight: offset,
    aspectMode: mode, aspectLock: layer.aspectRatio?.locked === 1 || layer.aspectRatio?.locked === true ? ratio : null };
}
