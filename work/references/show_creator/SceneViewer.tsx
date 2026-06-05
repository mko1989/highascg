import React, { Suspense, useRef, useMemo, useState, useEffect, Component, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, Grid, TransformControls, Text, Line, useGLTF } from '@react-three/drei';
import { ScreenSystem } from './ScreenSystem';
import { useProjectStore } from '../../../store';
import type { ScreenRegion, StageBlock, ModelMeshInfo, LEDPanel } from '../../../store';
import * as THREE from 'three';

interface SceneViewerProps {
  videoUrl?: string;
  isBuilder?: boolean;
  muted?: boolean;
  modelUrl?: string;
  videoSeekTime?: number;
  isVideoPlaying?: boolean;
}

// Error boundary for 3D model loading
class ModelErrorBoundary extends Component<{ children: ReactNode; onError?: () => void }, { hasError: boolean }> {
  constructor(props: { children: ReactNode; onError?: () => void }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('Model loading error:', error);
    this.props.onError?.();
  }

  render() {
    if (this.state.hasError) {
      return null; // Don't render anything if model failed to load
    }
    return this.props.children;
  }
}

// Helper to extract mesh info from a THREE.Mesh
function getMeshInfo(mesh: THREE.Mesh): ModelMeshInfo {
  // Compute bounding box
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox || new THREE.Box3();
  
  // Get world position
  const worldPos = new THREE.Vector3();
  mesh.getWorldPosition(worldPos);
  
  // Get world scale
  const worldScale = new THREE.Vector3();
  mesh.getWorldScale(worldScale);
  
  // Get world rotation (as euler)
  const worldQuat = new THREE.Quaternion();
  mesh.getWorldQuaternion(worldQuat);
  const worldEuler = new THREE.Euler().setFromQuaternion(worldQuat);
  
  // Calculate world-space dimensions
  const size = new THREE.Vector3();
  box.getSize(size);
  size.multiply(worldScale);
  
  return {
    name: mesh.name || 'Unnamed Mesh',
    uuid: mesh.uuid,
    position: [worldPos.x, worldPos.y, worldPos.z],
    rotation: [worldEuler.x, worldEuler.y, worldEuler.z],
    scale: [worldScale.x, worldScale.y, worldScale.z],
    boundingBox: {
      min: [box.min.x * worldScale.x + worldPos.x, box.min.y * worldScale.y + worldPos.y, box.min.z * worldScale.z + worldPos.z],
      max: [box.max.x * worldScale.x + worldPos.x, box.max.y * worldScale.y + worldPos.y, box.max.z * worldScale.z + worldPos.z]
    },
    worldWidth: Math.abs(size.x),
    worldHeight: Math.abs(size.y),
    worldDepth: Math.abs(size.z)
  };
}

// Helper function to clone material while preserving textures
function cloneMaterialWithTextures(material: THREE.Material): THREE.Material {
  const cloned = material.clone();
  
  // Copy all texture maps from the original material
  if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
    const stdMat = material as THREE.MeshStandardMaterial;
    const clonedStd = cloned as THREE.MeshStandardMaterial;
    
    // Preserve all texture maps
    if (stdMat.map) clonedStd.map = stdMat.map;
    if (stdMat.normalMap) clonedStd.normalMap = stdMat.normalMap;
    if (stdMat.roughnessMap) clonedStd.roughnessMap = stdMat.roughnessMap;
    if (stdMat.metalnessMap) clonedStd.metalnessMap = stdMat.metalnessMap;
    if (stdMat.aoMap) clonedStd.aoMap = stdMat.aoMap;
    if (stdMat.emissiveMap) clonedStd.emissiveMap = stdMat.emissiveMap;
    if (stdMat.envMap) clonedStd.envMap = stdMat.envMap;
    if (stdMat.lightMap) clonedStd.lightMap = stdMat.lightMap;
    if (stdMat.bumpMap) clonedStd.bumpMap = stdMat.bumpMap;
    if (stdMat.displacementMap) clonedStd.displacementMap = stdMat.displacementMap;
    if (stdMat.alphaMap) clonedStd.alphaMap = stdMat.alphaMap;
    
    // Copy material properties
    clonedStd.color = stdMat.color.clone();
    clonedStd.emissive = stdMat.emissive.clone();
    clonedStd.roughness = stdMat.roughness;
    clonedStd.metalness = stdMat.metalness;
    clonedStd.opacity = stdMat.opacity;
    clonedStd.transparent = stdMat.transparent;
    clonedStd.side = stdMat.side;
    
    clonedStd.needsUpdate = true;
  } else if (material instanceof THREE.MeshBasicMaterial) {
    const basicMat = material as THREE.MeshBasicMaterial;
    const clonedBasic = cloned as THREE.MeshBasicMaterial;
    
    if (basicMat.map) clonedBasic.map = basicMat.map;
    if (basicMat.alphaMap) clonedBasic.alphaMap = basicMat.alphaMap;
    if (basicMat.envMap) clonedBasic.envMap = basicMat.envMap;
    if (basicMat.lightMap) clonedBasic.lightMap = basicMat.lightMap;
    if (basicMat.aoMap) clonedBasic.aoMap = basicMat.aoMap;
    
    clonedBasic.color = basicMat.color.clone();
    clonedBasic.needsUpdate = true;
  }
  
  return cloned;
}

// Interactive Imported GLTF Model Component with clickable meshes
const InteractiveImportedModel: React.FC<{ 
  url: string; 
  isBuilder: boolean;
  selectedMeshIds: string[];
  onMeshClick: (mesh: THREE.Mesh, isMultiSelect: boolean) => void;
}> = ({ url, isBuilder, selectedMeshIds, onMeshClick }) => {
  const { scene } = useGLTF(url);
  const groupRef = useRef<THREE.Group>(null);
  
  // Clone the scene and store original materials while preserving textures
  const clonedScene = useMemo(() => {
    const cloned = scene.clone(true); // Deep clone
    
    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        
        // Clone materials while preserving textures
        if (Array.isArray(child.material)) {
          child.material = child.material.map(m => cloneMaterialWithTextures(m));
        } else if (child.material) {
          child.material = cloneMaterialWithTextures(child.material);
        }
      }
    });
    
    return cloned;
  }, [scene]);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    if (!isBuilder) return;
    
    const clickedObject = e.object;
    // Walk up the object tree to find the actual mesh
    let current: THREE.Object3D | null = clickedObject;
    while (current && !(current instanceof THREE.Mesh)) {
      current = current.parent;
    }
    
    if (current instanceof THREE.Mesh) {
      e.stopPropagation();
      // Check for multi-select (Ctrl/Cmd or Shift key)
      const isMultiSelect = e.nativeEvent.ctrlKey || e.nativeEvent.metaKey || e.nativeEvent.shiftKey;
      onMeshClick(current, isMultiSelect);
    }
  }, [isBuilder, onMeshClick]);

  // Apply selection highlight and attach click handlers to meshes
  useEffect(() => {
    if (!groupRef.current) return;
    
    groupRef.current.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const isSelected = selectedMeshIds.includes(child.uuid);
        
        // Handle both single and array materials
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        
        materials.forEach((mat) => {
          if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial) {
            if (isSelected) {
              mat.emissive = new THREE.Color('#ff6600');
              mat.emissiveIntensity = 0.8;
            } else {
              mat.emissive = new THREE.Color('#000000');
              mat.emissiveIntensity = 0;
            }
            mat.needsUpdate = true;
          } else if (mat instanceof THREE.MeshBasicMaterial) {
            // For basic materials, tint the color
            if (isSelected) {
              mat.color = new THREE.Color('#ff8844');
            }
            mat.needsUpdate = true;
          }
        });
      }
    });
  }, [selectedMeshIds]);

  // Make meshes interactive by setting userData
  useEffect(() => {
    if (!clonedScene) return;
    
    clonedScene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // Mark as interactive
        child.userData.interactive = true;
      }
    });
  }, [clonedScene]);

  return (
    <group ref={groupRef} onClick={handleClick}>
      <primitive 
        object={clonedScene} 
        onClick={handleClick}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          if (isBuilder) {
            let current: THREE.Object3D | null = e.object;
            while (current && !(current instanceof THREE.Mesh)) {
              current = current.parent;
            }
            if (current instanceof THREE.Mesh) {
              e.stopPropagation();
              document.body.style.cursor = 'pointer';
            }
          }
        }}
        onPointerOut={(e: ThreeEvent<PointerEvent>) => {
          if (isBuilder) {
            e.stopPropagation();
            document.body.style.cursor = 'default';
          }
        }}
      />
    </group>
  );
};

// Non-interactive model for Show Runner view
const StaticImportedModel: React.FC<{ url: string }> = ({ url }) => {
  const { scene } = useGLTF(url);
  
  const clonedScene = useMemo(() => {
    const cloned = scene.clone(true); // Deep clone to preserve hierarchy
    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        
        // Clone materials while preserving textures
        if (Array.isArray(child.material)) {
          child.material = child.material.map(m => cloneMaterialWithTextures(m));
        } else if (child.material) {
          child.material = cloneMaterialWithTextures(child.material);
        }
      }
    });
    return cloned;
  }, [scene]);

  return <primitive object={clonedScene} />;
};

// Safe model wrapper that handles loading errors gracefully
const SafeImportedModel: React.FC<{ 
  url: string; 
  isBuilder: boolean;
  selectedMeshIds: string[];
  onMeshClick: (mesh: THREE.Mesh, isMultiSelect: boolean) => void;
}> = ({ url, isBuilder, selectedMeshIds, onMeshClick }) => {
  const [loadError, setLoadError] = useState(false);
  
  useEffect(() => {
    setLoadError(false);
  }, [url]);
  
  if (loadError) {
    return (
      <Text position={[0, 2, 0]} fontSize={0.3} color="red" anchorX="center">
        Failed to load model
      </Text>
    );
  }
  
  return (
    <ModelErrorBoundary onError={() => setLoadError(true)}>
      <Suspense fallback={
        <Text position={[0, 2, 0]} fontSize={0.2} color="#888" anchorX="center">
          Loading model...
        </Text>
      }>
        {isBuilder ? (
          <InteractiveImportedModel 
            url={url} 
            isBuilder={isBuilder}
            selectedMeshIds={selectedMeshIds}
            onMeshClick={onMeshClick}
          />
        ) : (
          <StaticImportedModel url={url} />
        )}
      </Suspense>
    </ModelErrorBoundary>
  );
};

// LED Grid Visualization Component
const LEDGridOverlay: React.FC<{ screen: ScreenRegion }> = ({ screen }) => {
  const { ledConfig } = screen;
  if (!ledConfig || screen.screenType !== 'led_wall') return null;

  const { panelWidth, panelHeight, panelsWide, panelsHigh, pixelPitch } = ledConfig;
  
  // Calculate panel physical size in meters
  const panelWidthM = (panelWidth * pixelPitch) / 1000;
  const panelHeightM = (panelHeight * pixelPitch) / 1000;

  // Generate grid lines for panels
  const gridPoints = useMemo(() => {
    const lines: Array<{ points: [number, number, number][]; color: string }> = [];
    const totalW = screen.worldWidth;
    const totalH = screen.worldHeight;
    
    // Vertical lines
    for (let i = 0; i <= panelsWide; i++) {
      const x = -totalW / 2 + (i * panelWidthM);
      const isBorder = i === 0 || i === panelsWide;
      lines.push({
        points: [[x, -totalH / 2, 0.01], [x, totalH / 2, 0.01]],
        color: isBorder ? "#22c55e" : "#444"
      });
    }
    
    // Horizontal lines
    for (let j = 0; j <= panelsHigh; j++) {
      const y = -totalH / 2 + (j * panelHeightM);
      const isBorder = j === 0 || j === panelsHigh;
      lines.push({
        points: [[-totalW / 2, y, 0.01], [totalW / 2, y, 0.01]],
        color: isBorder ? "#22c55e" : "#444"
      });
    }
    
    return lines;
  }, [panelsWide, panelsHigh, panelWidthM, panelHeightM, screen.worldWidth, screen.worldHeight]);

  return (
    <group position={screen.position} rotation={screen.rotation}>
      {gridPoints.map((line, idx) => (
        <Line key={idx} points={line.points} color={line.color} lineWidth={1} />
      ))}
      {/* Resolution label */}
      <Text
        position={[0, screen.worldHeight / 2 + 0.15, 0.01]}
        fontSize={0.12}
        color="#22c55e"
        anchorX="center"
        anchorY="bottom"
      >
        {screen.resolutionWidth}×{screen.resolutionHeight} ({ledConfig.pixelPitch}mm)
      </Text>
    </group>
  );
};

// Single panel mesh for irregular screen
const IrregularPanelMesh: React.FC<{
  panel: LEDPanel;
  screenPosition: [number, number, number];
  screenRotation: [number, number, number];
  screenWidth: number;
  screenHeight: number;
  isSelected: boolean;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
}> = ({ panel, screenPosition, screenRotation, screenWidth, screenHeight, isSelected, onClick }) => {
  const panelPosition = useMemo(() => {
    const offsetX = panel.localX + panel.width / 2 - screenWidth / 2;
    const offsetY = panel.localY + panel.height / 2 - screenHeight / 2;
    
    const euler = new THREE.Euler(...screenRotation);
    const offset = new THREE.Vector3(offsetX, offsetY, 0);
    offset.applyEuler(euler);
    
    return new THREE.Vector3(
      screenPosition[0] + offset.x,
      screenPosition[1] + offset.y,
      screenPosition[2] + offset.z
    );
  }, [panel, screenPosition, screenRotation, screenWidth, screenHeight]);
  
  const baseColor = "#4a1d96"; // Purple for irregular
  const selectedColor = "#a855f7";
  
  return (
    <mesh
      position={panelPosition}
      rotation={screenRotation}
      onClick={onClick}
    >
      <planeGeometry args={[panel.width, panel.height]} />
      <meshStandardMaterial 
        color={isSelected ? selectedColor : baseColor} 
        emissive={isSelected ? baseColor : "#000"}
        emissiveIntensity={isSelected ? 0.3 : 0}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

// Clickable Screen Mesh
const SelectableScreen: React.FC<{
  screen: ScreenRegion;
  isSelected: boolean;
  onSelect: () => void;
  onTransform: (pos: [number, number, number], rot: [number, number, number]) => void;
  isBuilder: boolean;
  showGrid: boolean;
}> = ({ screen, isSelected, onSelect, onTransform, isBuilder, showGrid }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  
  const isLED = screen.screenType === 'led_wall';
  const isIrregular = screen.screenType === 'irregular';
  const baseColor = isIrregular ? "#4a1d96" : (isLED ? "#0d3320" : "#1e40af");
  const selectedColor = isIrregular ? "#a855f7" : (isLED ? "#22c55e" : "#3b82f6");

  // For irregular screens, render each panel separately
  if (isIrregular && screen.irregularConfig) {
    const { panels } = screen.irregularConfig;
    
    return (
      <>
        <group ref={groupRef}>
          {panels.map((panel) => (
            <IrregularPanelMesh
              key={panel.id}
              panel={panel}
              screenPosition={screen.position}
              screenRotation={screen.rotation}
              screenWidth={screen.worldWidth}
              screenHeight={screen.worldHeight}
              isSelected={isSelected}
              onClick={(e) => { e.stopPropagation(); onSelect(); }}
            />
          ))}
        </group>
        
        {/* Screen Label */}
        <Text
          position={[screen.position[0], screen.position[1] - screen.worldHeight / 2 - 0.15, screen.position[2]]}
          fontSize={0.15}
          color={isSelected ? "#fff" : "#888"}
          anchorX="center"
          anchorY="top"
        >
          {screen.name} ({panels.length} panels)
        </Text>
        
        {/* Panel count indicator */}
        <Text
          position={[screen.position[0], screen.position[1] + screen.worldHeight / 2 + 0.1, screen.position[2]]}
          fontSize={0.1}
          color="#a855f7"
          anchorX="center"
          anchorY="bottom"
        >
          {screen.irregularConfig.totalPixelWidth}×{screen.irregularConfig.totalPixelHeight}px
        </Text>
        
        {isBuilder && isSelected && groupRef.current && (
          <TransformControls
            object={groupRef.current}
            mode="translate"
            onObjectChange={() => {
              if (groupRef.current) {
                const pos = groupRef.current.position;
                const rot = groupRef.current.rotation;
                onTransform(
                  [pos.x, pos.y, pos.z],
                  [rot.x, rot.y, rot.z]
                );
              }
            }}
          />
        )}
      </>
    );
  }

  // Regular screen rendering
  return (
    <>
      <mesh
        ref={meshRef}
        position={screen.position}
        rotation={screen.rotation}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
      >
        <planeGeometry args={[screen.worldWidth, screen.worldHeight]} />
        <meshStandardMaterial 
          color={isSelected ? selectedColor : baseColor} 
          emissive={isSelected ? baseColor : "#000"}
          emissiveIntensity={isSelected ? 0.3 : 0}
          side={THREE.DoubleSide}
        />
      </mesh>
      
      {/* LED Grid Overlay */}
      {showGrid && isLED && <LEDGridOverlay screen={screen} />}
      
      {/* Screen Label */}
      <Text
        position={[screen.position[0], screen.position[1] - screen.worldHeight / 2 - 0.15, screen.position[2]]}
        fontSize={0.15}
        color={isSelected ? "#fff" : "#888"}
        anchorX="center"
        anchorY="top"
      >
        {screen.name}
      </Text>
      
      {isBuilder && isSelected && meshRef.current && (
        <TransformControls
          object={meshRef.current}
          mode="translate"
          onObjectChange={() => {
            if (meshRef.current) {
              const pos = meshRef.current.position;
              const rot = meshRef.current.rotation;
              onTransform(
                [pos.x, pos.y, pos.z],
                [rot.x, rot.y, rot.z]
              );
            }
          }}
        />
      )}
    </>
  );
};

// Clickable Stage Block
const SelectableStageBlock: React.FC<{
  block: StageBlock;
  isSelected: boolean;
  onSelect: () => void;
  onTransform: (pos: [number, number, number], rot: [number, number, number]) => void;
  isBuilder: boolean;
}> = ({ block, isSelected, onSelect, onTransform, isBuilder }) => {
  const meshRef = useRef<THREE.Mesh>(null);

  return (
    <>
      <mesh
        ref={meshRef}
        position={block.position}
        rotation={block.rotation}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[block.width, block.height, block.depth]} />
        <meshStandardMaterial 
          color={block.color} 
          emissive={isSelected ? "#ffffff" : "#000"}
          emissiveIntensity={isSelected ? 0.1 : 0}
        />
      </mesh>
      {isBuilder && isSelected && meshRef.current && (
        <TransformControls
          object={meshRef.current}
          mode="translate"
          onObjectChange={() => {
            if (meshRef.current) {
              const pos = meshRef.current.position;
              const rot = meshRef.current.rotation;
              onTransform(
                [pos.x, pos.y, pos.z],
                [rot.x, rot.y, rot.z]
              );
            }
          }}
        />
      )}
    </>
  );
};

const SceneViewer: React.FC<SceneViewerProps> = ({ videoUrl, isBuilder = false, muted = false, modelUrl, videoSeekTime, isVideoPlaying = false, onVideoEnded }) => {
  const { 
    screens, 
    stageBlocks, 
    virtualCanvas, 
    selectedId,
    setSelected,
    selectedModelMeshes: storeSelectedModelMeshes,
    addSelectedModelMesh,
    removeSelectedModelMesh,
    clearSelectedModelMeshes,
    updateScreen,
    updateStageBlock
  } = useProjectStore();
  
  // Ensure selectedModelMeshes is always an array
  const selectedModelMeshes = storeSelectedModelMeshes || [];
  
  // No default video - only play when explicitly set
  const activeVideo = videoUrl;

  const handleBackgroundClick = () => {
    if (isBuilder) {
      setSelected(null, null);
      clearSelectedModelMeshes();
    }
  };

  const handleModelMeshClick = useCallback((mesh: THREE.Mesh, isMultiSelect: boolean) => {
    const meshInfo = getMeshInfo(mesh);
    
    if (isMultiSelect) {
      // Toggle selection: if already selected, remove; otherwise add
      const isAlreadySelected = selectedModelMeshes.some(m => m.uuid === mesh.uuid);
      if (isAlreadySelected) {
        removeSelectedModelMesh(mesh.uuid);
      } else {
        addSelectedModelMesh(meshInfo);
      }
    } else {
      // Single select - clear others and select this one
      clearSelectedModelMeshes();
      addSelectedModelMesh(meshInfo);
    }
    setSelected(null, 'model_mesh');
  }, [selectedModelMeshes, addSelectedModelMesh, removeSelectedModelMesh, clearSelectedModelMeshes, setSelected]);

  return (
    <Canvas
      camera={{ position: [0, 5, 12], fov: 50 }}
      shadows
      gl={{ localClippingEnabled: true }}
      onPointerMissed={handleBackgroundClick}
      style={{ 
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: '#111'
      }}
    >
      <Suspense fallback={null}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
        
        <Grid 
          infiniteGrid 
          fadeDistance={30} 
          cellColor="#444" 
          sectionColor="#666"
          cellSize={1}
          sectionSize={5}
        />
        
        <OrbitControls makeDefault />
        <Environment preset="warehouse" />
        
        {/* Imported 3D Model from Capture */}
        {modelUrl && (
          <SafeImportedModel 
            url={modelUrl} 
            isBuilder={isBuilder}
            selectedMeshIds={selectedModelMeshes.map(m => m.uuid)}
            onMeshClick={handleModelMeshClick}
          />
        )}
        
        {/* Stage Blocks */}
        {stageBlocks.map((block) => (
          <SelectableStageBlock
            key={block.id}
            block={block}
            isSelected={selectedId === block.id}
            onSelect={() => setSelected(block.id, 'stage')}
            onTransform={(pos, rot) => updateStageBlock(block.id, { position: pos, rotation: rot })}
            isBuilder={isBuilder}
          />
        ))}
        
        {/* Screens - In builder mode show selectable, otherwise show with video */}
        {isBuilder ? (
          screens.map((screen) => (
            <SelectableScreen
              key={screen.id}
              screen={screen}
              isSelected={selectedId === screen.id}
              onSelect={() => setSelected(screen.id, 'screen')}
              onTransform={(pos, rot) => updateScreen(screen.id, { position: pos, rotation: rot })}
              isBuilder={isBuilder}
              showGrid={true}
            />
          ))
        ) : (
          <ScreenSystem 
            screens={screens}
            virtualCanvas={virtualCanvas}
            videoSrc={activeVideo}
            muted={muted}
            videoSeekTime={videoSeekTime}
            isVideoPlaying={isVideoPlaying}
            onVideoEnded={onVideoEnded}
          />
        )}
        
        {/* Floor */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
          <planeGeometry args={[50, 50]} />
          <meshStandardMaterial color="#222" />
        </mesh>
      </Suspense>
    </Canvas>
  );
};

export default SceneViewer;
