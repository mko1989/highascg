import { create } from 'zustand';
import { API_BASE_URL } from './config/api';

export interface Cue {
  id: string;
  startTime: string;
  endTime: string;
  duration: string;
  description: string;
  assetUrl: string;
  assetName?: string;  // Original filename for display
  [key: string]: any;  // Allow custom columns
}

export interface CustomColumn {
  id: string;
  name: string;
  width?: number;
}

// Helper: Parse time string (HH:MM:SS) to seconds
export function parseTimeToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

// Helper: Format seconds to HH:MM:SS
export function formatSecondsToTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// Helper: Calculate end time from start + duration
export function calculateEndTime(startTime: string, duration: string): string {
  const startSec = parseTimeToSeconds(startTime);
  const durationSec = parseTimeToSeconds(duration);
  return formatSecondsToTime(startSec + durationSec);
}

// LED Wall specific configuration
export interface LEDWallConfig {
  pixelPitch: number;        // mm (e.g., 2.6, 3.91, 4.81)
  panelWidth: number;        // pixels per panel (e.g., 128)
  panelHeight: number;       // pixels per panel (e.g., 128)
  panelsWide: number;        // number of panels horizontally
  panelsHigh: number;        // number of panels vertically
}

export type ScreenType = 'generic' | 'led_wall' | 'irregular';

// Individual LED panel in an irregular configuration
export interface LEDPanel {
  id: string;
  // Position relative to the screen's origin (bottom-left of bounding box)
  localX: number;      // meters from left edge
  localY: number;      // meters from bottom edge
  width: number;       // panel width in meters
  height: number;      // panel height in meters
  // Pixel resolution
  pixelWidth: number;
  pixelHeight: number;
  // UV mapping coordinates (0-1 range, where this panel maps on the content)
  uvMinX: number;
  uvMinY: number;
  uvMaxX: number;
  uvMaxY: number;
  // Original mesh info (for reference)
  meshUuid?: string;
  meshName?: string;
}

// Content mapping strategy for irregular screens
export type ContentMappingStrategy = 
  | 'stretch'      // Stretch content to fill bounding box, show only where panels exist
  | 'fit'          // Fit content maintaining aspect ratio, letterbox if needed
  | 'fill'         // Fill and crop to cover all panels
  | 'tile'         // Tile content across panels
  | 'per-panel';   // Each panel shows full content (useful for sync displays)

// Irregular screen configuration
export interface IrregularScreenConfig {
  panels: LEDPanel[];
  pixelPitch: number;           // mm - common pixel pitch for all panels
  mappingStrategy: ContentMappingStrategy;
  // Bounding box in local coordinates (calculated from panels)
  boundingWidth: number;        // total width in meters
  boundingHeight: number;       // total height in meters
  // Total pixel resolution (calculated from panels)
  totalPixelWidth: number;
  totalPixelHeight: number;
}

export interface ScreenRegion {
  id: string;
  name: string;
  screenType: ScreenType;
  
  // Canvas mapping (where on the virtual canvas this screen pulls from)
  canvasX: number;
  canvasY: number;
  canvasWidth: number;
  canvasHeight: number;
  
  // Physical dimensions (meters) - for irregular screens, this is the bounding box
  worldWidth: number;
  worldHeight: number;
  
  // 3D position/rotation
  position: [number, number, number];
  rotation: [number, number, number];
  
  // LED wall specific (only used if screenType === 'led_wall')
  ledConfig?: LEDWallConfig;
  
  // Irregular screen specific (only used if screenType === 'irregular')
  irregularConfig?: IrregularScreenConfig;
  
  // Calculated resolution (for LED walls, derived from config)
  resolutionWidth: number;
  resolutionHeight: number;
}

export interface StageBlock {
  id: string;
  name: string;
  width: number;
  height: number;
  depth: number;
  position: [number, number, number];
  rotation: [number, number, number];
  color: string;
}

// Info about a selected mesh from an imported model
export interface ModelMeshInfo {
  name: string;
  uuid: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
  };
  worldWidth: number;
  worldHeight: number;
  worldDepth: number;
}

// Virtual canvas that all screens map to
export interface VirtualCanvas {
  width: number;   // total width in arbitrary units (could be pixels or meters)
  height: number;
}

export interface ProjectData {
  cues: Cue[];
  screens: ScreenRegion[];
  stageBlocks: StageBlock[];
  virtualCanvas: VirtualCanvas;
  importedModelUrl?: string | null;
  customColumns?: CustomColumn[];
  notes?: string;
  additionalFiles?: Array<{ id: string; name: string; url: string; size?: number }>;
}

interface ProjectState {
  // Metadata
  projectId: string | null;
  projectName: string;
  
  // Data
  cues: Cue[];
  screens: ScreenRegion[];
  stageBlocks: StageBlock[];
  virtualCanvas: VirtualCanvas;
  importedModelUrl: string | null;
  customColumns: CustomColumn[];
  notes: string;
  additionalFiles: Array<{ id: string; name: string; url: string; size?: number }>;
  
  // Selection
  selectedId: string | null;
  selectedType: 'screen' | 'stage' | 'model_mesh' | null;
  
  // Model mesh selection info (for imported models) - supports multi-selection
  selectedModelMeshes: ModelMeshInfo[];
  
  // Mapping mode
  mappingScreenId: string | null;
  
  // Actions
  loadProject: (id: string, name: string, data: any) => void;
  setCues: (cues: Cue[]) => void;
  updateCue: (id: string, updates: Partial<Cue>) => void;
  deleteCue: (id: string) => void;
  
  // Screen actions
  addScreen: (screen: ScreenRegion) => void;
  updateScreen: (id: string, updates: Partial<ScreenRegion>) => void;
  deleteScreen: (id: string) => void;
  
  // Stage actions
  addStageBlock: (block: StageBlock) => void;
  updateStageBlock: (id: string, updates: Partial<StageBlock>) => void;
  deleteStageBlock: (id: string) => void;
  
  // Selection
  setSelected: (id: string | null, type: 'screen' | 'stage' | 'model_mesh' | null) => void;
  setSelectedModelMeshes: (meshes: ModelMeshInfo[]) => void;
  addSelectedModelMesh: (mesh: ModelMeshInfo) => void;
  removeSelectedModelMesh: (uuid: string) => void;
  clearSelectedModelMeshes: () => void;
  
  // Mapping
  setMappingScreen: (id: string | null) => void;
  updateVirtualCanvas: (canvas: Partial<VirtualCanvas>) => void;
  
  // Imported model
  setImportedModelUrl: (url: string | null) => void;
  
  // Notes and additional files
  setNotes: (notes: string) => void;
  addAdditionalFile: (file: { id: string; name: string; url: string; size?: number }) => void;
  removeAdditionalFile: (id: string) => void;
  
  saveProject: (silent?: boolean) => Promise<void>;
}

// Helper: Round to avoid floating point noise (e.g., 3.50003 -> 3.5)
export function roundDimension(value: number, decimals: number = 4): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// Helper: Calculate LED wall dimensions from config
export function calculateLEDWallDimensions(config: LEDWallConfig) {
  const totalPixelsW = config.panelWidth * config.panelsWide;
  const totalPixelsH = config.panelHeight * config.panelsHigh;
  const worldWidth = roundDimension((totalPixelsW * config.pixelPitch) / 1000); // convert mm to meters
  const worldHeight = roundDimension((totalPixelsH * config.pixelPitch) / 1000);
  return { 
    resolutionWidth: totalPixelsW, 
    resolutionHeight: totalPixelsH, 
