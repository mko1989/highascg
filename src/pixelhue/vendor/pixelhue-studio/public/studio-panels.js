import { createDeviceUI } from './device-ui.js';
import { createOutputsUI } from './outputs-ui.js';
import { createScreensUI } from './screens-ui.js';
import { createProgrammingUI } from './programming-ui.js';
import { createAudioUI } from './audio-ui.js';

export function createStudioPanels(context) {
  const stale = new Set(['device', 'outputs', 'screens', 'programming', 'audio']);
  const invalidate = source => {
    for (const name of Object.keys(panels)) if (name !== source) stale.add(name);
    context.invalidate(source);
  };
  const options = { ...context, invalidate };
  const panels = { device: createDeviceUI(options), outputs: createOutputsUI(options), screens: createScreensUI(options), programming: createProgrammingUI(options), audio: createAudioUI(options) };
  return {
    async open(name) {
      const panel = panels[name]; if (!panel) return;
      if (stale.has(name) && !panel.hasChanges()) { stale.delete(name); return panel.refresh(); }
      return panel.open();
    },
    reset(session) { for (const [name, panel] of Object.entries(panels)) { panel.reset(session); stale.add(name); } },
    setBusy(busy) { for (const panel of Object.values(panels)) panel.setBusy(busy); },
    hasChanges: () => Object.values(panels).some(panel => panel.hasChanges()),
    invalidate,
  };
}
