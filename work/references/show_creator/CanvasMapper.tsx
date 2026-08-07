import React, { useState, useMemo } from 'react';
import { useProjectStore } from '../../../store';
import { X, Move, Maximize2 } from 'lucide-react';

interface CanvasMapperProps {
  onClose: () => void;
}

// Color palette for screens
const SCREEN_COLORS = [
  { bg: 'rgba(59, 130, 246, 0.4)', border: '#3b82f6', text: '#93c5fd' },  // blue
  { bg: 'rgba(34, 197, 94, 0.4)', border: '#22c55e', text: '#86efac' },   // green
  { bg: 'rgba(249, 115, 22, 0.4)', border: '#f97316', text: '#fdba74' },  // orange
  { bg: 'rgba(168, 85, 247, 0.4)', border: '#a855f7', text: '#d8b4fe' },  // purple
  { bg: 'rgba(236, 72, 153, 0.4)', border: '#ec4899', text: '#f9a8d4' },  // pink
  { bg: 'rgba(20, 184, 166, 0.4)', border: '#14b8a6', text: '#5eead4' },  // teal
];

export const CanvasMapper: React.FC<CanvasMapperProps> = ({ onClose }) => {
  const { screens, virtualCanvas, updateScreen, updateVirtualCanvas, saveProject } = useProjectStore();
  
  // Local state for canvas size
  const [canvasWidth, setCanvasWidth] = useState(virtualCanvas.width);
  const [canvasHeight, setCanvasHeight] = useState(virtualCanvas.height);
  
  // Local state for each screen's mapping
  const [screenMappings, setScreenMappings] = useState<Record<string, {
    canvasX: number;
    canvasY: number;
    canvasWidth: number;
    canvasHeight: number;
  }>>(
    Object.fromEntries(screens.map(s => [s.id, {
      canvasX: s.canvasX,
      canvasY: s.canvasY,
      canvasWidth: s.canvasWidth,
      canvasHeight: s.canvasHeight
    }]))
  );

  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(
    screens.length > 0 ? screens[0].id : null
  );

  // Calculate preview scale to fit in viewport
  const previewScale = useMemo(() => {
    const maxWidth = 600;
    const maxHeight = 300;
    return Math.min(maxWidth / canvasWidth, maxHeight / canvasHeight, 1);
  }, [canvasWidth, canvasHeight]);

  const updateMapping = (screenId: string, updates: Partial<typeof screenMappings[string]>) => {
    setScreenMappings(prev => ({
      ...prev,
      [screenId]: { ...prev[screenId], ...updates }
    }));
  };

  const handleSaveAll = () => {
    // Update virtual canvas
    updateVirtualCanvas({ width: canvasWidth, height: canvasHeight });
    
    // Update each screen's mapping
    Object.entries(screenMappings).forEach(([id, mapping]) => {
      updateScreen(id, mapping);
    });
    
    // Auto-save to backend so Show Runner gets the latest data
    // Small delay to ensure state updates are processed
    setTimeout(() => {
      saveProject(false); // Show save notification
    }, 100);
    
    onClose();
  };

  // Auto-fit: Calculate mapping based on screen physical sizes
  const handleAutoFit = () => {
    if (screens.length === 0) return;
    
    // Sort screens by X position (left to right)
    const sortedScreens = [...screens].sort((a, b) => a.position[0] - b.position[0]);
    
    // Calculate total width needed based on screen resolutions
    let totalWidth = 0;
    const mappings: Record<string, typeof screenMappings[string]> = {};
    
    sortedScreens.forEach(screen => {
      mappings[screen.id] = {
        canvasX: totalWidth,
        canvasY: 0,
        canvasWidth: screen.resolutionWidth,
        canvasHeight: screen.resolutionHeight
      };
      totalWidth += screen.resolutionWidth;
    });
    
    // Find max height
    const maxHeight = Math.max(...sortedScreens.map(s => s.resolutionHeight));
    
    setCanvasWidth(totalWidth);
    setCanvasHeight(maxHeight);
    setScreenMappings(mappings);
  };

  const selectedScreen = screens.find(s => s.id === selectedScreenId);
  const selectedMapping = selectedScreenId ? screenMappings[selectedScreenId] : null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.9)' }}>
      <div className="bg-zinc-800 rounded-xl w-[900px] max-h-[90vh] overflow-hidden flex flex-col" style={{ border: '1px solid #3f3f46' }}>
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-zinc-700 bg-zinc-900">
          <div>
            <h3 className="text-lg font-semibold text-white">Canvas Mapping</h3>
            <p className="text-xs text-zinc-400 mt-0.5">Configure how screens map to the virtual canvas</p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white p-1 hover:bg-zinc-700 rounded">
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left Panel - Screen List */}
          <div className="w-56 border-r border-zinc-700 flex flex-col bg-zinc-850">
            <div className="p-3 border-b border-zinc-700">
              <div className="text-xs font-semibold text-zinc-400 uppercase mb-2">Screens ({screens.length})</div>
              <button 
                onClick={handleAutoFit}
                className="w-full text-xs bg-blue-600 hover:bg-blue-700 text-white py-1.5 rounded flex items-center justify-center gap-1"
              >
                <Maximize2 size={12} /> Auto-Fit All
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {screens.map((screen, idx) => {
                const color = SCREEN_COLORS[idx % SCREEN_COLORS.length];
                const mapping = screenMappings[screen.id];
                return (
                  <div
                    key={screen.id}
                    onClick={() => setSelectedScreenId(screen.id)}
                    className={`p-2 rounded cursor-pointer transition-colors ${
                      selectedScreenId === screen.id 
                        ? 'ring-2 ring-white' 
                        : 'hover:bg-zinc-700'
                    }`}
                    style={{ backgroundColor: color.bg, borderLeft: `3px solid ${color.border}` }}
                  >
                    <div className="text-xs font-medium text-white truncate">{screen.name}</div>
                    <div className="text-[10px] text-zinc-300 mt-0.5">
                      {screen.resolutionWidth}×{screen.resolutionHeight}px
                    </div>
                    <div className="text-[10px] text-zinc-400">
                      @ ({mapping?.canvasX || 0}, {mapping?.canvasY || 0})
                    </div>
                  </div>
                );
              })}
              {screens.length === 0 && (
                <div className="text-xs text-zinc-500 italic p-2">No screens in scene</div>
              )}
            </div>
          </div>

          {/* Main Panel - Canvas Preview & Editor */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Canvas Size Controls */}
            <div className="p-3 border-b border-zinc-700 bg-zinc-850">
              <div className="flex items-center gap-4">
                <div className="text-xs font-semibold text-zinc-400 uppercase">Virtual Canvas</div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={canvasWidth}
                    onChange={e => setCanvasWidth(Number(e.target.value))}
                    className="w-20 bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-white text-xs"
                  />
                  <span className="text-zinc-500">×</span>
                  <input
                    type="number"
                    value={canvasHeight}
                    onChange={e => setCanvasHeight(Number(e.target.value))}
                    className="w-20 bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-white text-xs"
                  />
                  <span className="text-xs text-zinc-500">px</span>
                </div>
              </div>
            </div>

            {/* Canvas Preview */}
            <div className="flex-1 p-4 overflow-auto bg-zinc-900 flex items-center justify-center">
              <div 
                className="relative border-2 border-zinc-600 bg-zinc-950"
                style={{ 
                  width: canvasWidth * previewScale,
                  height: canvasHeight * previewScale,
                  backgroundImage: 'linear-gradient(45deg, #333 25%, transparent 25%), linear-gradient(-45deg, #333 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #333 75%), linear-gradient(-45deg, transparent 75%, #333 75%)',
                  backgroundSize: '20px 20px',
                  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
                }}
              >
                {/* Render all screen regions */}
                {screens.map((screen, idx) => {
                  const mapping = screenMappings[screen.id];
                  if (!mapping) return null;
                  const color = SCREEN_COLORS[idx % SCREEN_COLORS.length];
                  const isSelected = selectedScreenId === screen.id;
                  
                  return (
                    <div
                      key={screen.id}
                      onClick={() => setSelectedScreenId(screen.id)}
                      className={`absolute cursor-pointer transition-all ${isSelected ? 'ring-2 ring-white z-10' : ''}`}
                      style={{
                        left: mapping.canvasX * previewScale,
                        top: mapping.canvasY * previewScale,
                        width: mapping.canvasWidth * previewScale,
                        height: mapping.canvasHeight * previewScale,
                        backgroundColor: color.bg,
                        border: `2px solid ${color.border}`,
                      }}
                    >
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-1">
                        <div className="text-[10px] font-bold truncate w-full" style={{ color: color.text }}>
                          {screen.name}
                        </div>
                        <div className="text-[9px] text-zinc-400">
                          {mapping.canvasWidth}×{mapping.canvasHeight}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Canvas dimensions label */}
                <div className="absolute -bottom-6 left-0 right-0 text-center text-[10px] text-zinc-500">
                  {canvasWidth} × {canvasHeight} px
                </div>
              </div>
            </div>

            {/* Selected Screen Editor */}
            {selectedScreen && selectedMapping && (
              <div className="p-4 border-t border-zinc-700 bg-zinc-800">
                <div className="flex items-center gap-2 mb-3">
                  <Move size={14} className="text-zinc-400" />
                  <span className="text-sm font-medium text-white">{selectedScreen.name}</span>
                  <span className="text-xs text-zinc-500">
                    (Physical: {selectedScreen.worldWidth.toFixed(2)}m × {selectedScreen.worldHeight.toFixed(2)}m, 
                    Resolution: {selectedScreen.resolutionWidth}×{selectedScreen.resolutionHeight})
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[10px] text-zinc-500 mb-1">X Offset (px)</label>
                    <input
                      type="number"
                      value={selectedMapping.canvasX}
                      onChange={e => updateMapping(selectedScreen.id, { canvasX: Number(e.target.value) })}
                      className="w-full bg-zinc-900 border border-zinc-600 rounded px-2 py-1.5 text-white text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-500 mb-1">Y Offset (px)</label>
                    <input
                      type="number"
                      value={selectedMapping.canvasY}
                      onChange={e => updateMapping(selectedScreen.id, { canvasY: Number(e.target.value) })}
                      className="w-full bg-zinc-900 border border-zinc-600 rounded px-2 py-1.5 text-white text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-500 mb-1">Width (px)</label>
                    <input
                      type="number"
                      value={selectedMapping.canvasWidth}
                      onChange={e => updateMapping(selectedScreen.id, { canvasWidth: Number(e.target.value) })}
                      className="w-full bg-zinc-900 border border-zinc-600 rounded px-2 py-1.5 text-white text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-500 mb-1">Height (px)</label>
                    <input
                      type="number"
                      value={selectedMapping.canvasHeight}
                      onChange={e => updateMapping(selectedScreen.id, { canvasHeight: Number(e.target.value) })}
                      className="w-full bg-zinc-900 border border-zinc-600 rounded px-2 py-1.5 text-white text-xs"
                    />
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-zinc-500">
                  This screen displays canvas region ({selectedMapping.canvasX}, {selectedMapping.canvasY}) to ({selectedMapping.canvasX + selectedMapping.canvasWidth}, {selectedMapping.canvasY + selectedMapping.canvasHeight})
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-700 flex justify-end gap-3 bg-zinc-900">
          <button onClick={onClose} className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded font-medium text-sm">
            Cancel
          </button>
          <button onClick={handleSaveAll} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium text-sm">
            Save Mapping
          </button>
        </div>
      </div>
    </div>
  );
};

