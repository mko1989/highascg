import { applyOutputCapacity } from './output-capacity.js';
import { readProgramSources } from './program-sources.js';
import { readDevice, applyDevice } from './studio-device.js';
import { runDeviceAction } from './studio-maintenance.js';
import { readOutputs, applyOutputs } from './studio-outputs.js';
import { readScreens, applyScreens } from './studio-screens.js';
import { readProgramming, applyProgramming } from './studio-programming.js';
import { readProgramGeometry, applyProgramGeometry } from './program-geometry.js';
import { readInputAdvanced, applyInputAdvanced } from './input-advanced.js';
import { applyInputTiming } from './input-edid.js';
import { readAudio, applyAudio } from './studio-audio.js';
import { readOutputAdvanced, applyOutputAdvanced } from './output-advanced.js';
import { readMvrTemplates, applyMvrTemplate } from './mvr-templates.js';
import { readSelfTest, runSelfTest } from './self-test.js';
import { readSourceBackup, applySourceBackup } from './source-backup.js';

export const studioRoutes = {
  '/api/device': { read: readDevice, write: (client, body) => applyDevice(client, body.changes) },
  '/api/device-action': { read: readDevice, write: (client, body) => runDeviceAction(client, body, readDevice) },
  '/api/output-capacity': { read: readOutputs, write: applyOutputCapacity },
  '/api/outputs': { read: readOutputs, write: (client, body) => applyOutputs(client, body.changes) },
  '/api/screens': { read: readScreens, write: applyScreens },
  '/api/programming': { read: readProgramming, write: applyProgramming },
  '/api/programming/sources': { read: readProgramSources },
  '/api/programming/geometry': { read: readProgramGeometry, write: applyProgramGeometry },
  '/api/output-advanced': { read: client => readOutputAdvanced(client), write: applyOutputAdvanced },
  '/api/mvr-templates': { read: readMvrTemplates, write: applyMvrTemplate },
  '/api/self-test': { read: client => readSelfTest(client), write: runSelfTest },
  '/api/source-backup': { read: readSourceBackup, write: applySourceBackup },
  '/api/audio': { read: readAudio, write: applyAudio },
  '/api/input-timing': { read: client => readInputAdvanced(client), write: (client, body) => applyInputTiming(client, body, readInputAdvanced) },
  '/api/input-advanced': { read: client => readInputAdvanced(client), write: applyInputAdvanced },
};
