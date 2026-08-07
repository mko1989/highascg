import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import type { ScreenRegion, LEDPanel, VirtualCanvas } from '../../../store';

interface ScreenSystemProps {
  screens: ScreenRegion[];
  virtualCanvas: VirtualCanvas;
  videoSrc?: string;
  muted?: boolean;
  videoSeekTime?: number;
  isVideoPlaying?: boolean;
  onVideoEnded?: () => void;
}

// Check if URL is an image
const isImageUrl = (url: string): boolean => {
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
  const lowerUrl = url.toLowerCase();
  return imageExtensions.some(ext => lowerUrl.includes(ext));
};

// Content Layer - Displays content using canvas mapping
// Each screen shows only its portion of the virtual canvas
// Content smaller than virtual canvas is displayed at original size, centered
const ContentLayer = React.memo<{
  region: ScreenRegion;
  texture: THREE.Texture;
  virtualCanvas: VirtualCanvas;
}>(({ region, texture, virtualCanvas }) => {
  const [contentDims, setContentDims] = useState<{ width: number; height: number } | null>(null);
  const lastDimsRef = useRef<string>('');
  const geometryRef = useRef<THREE.PlaneGeometry>(null);
  
  // Memoize rotation euler to avoid recreation every render
  const rotationEuler = useMemo(() => 
    new THREE.Euler(region.rotation[0], region.rotation[1], region.rotation[2]),
    [region.rotation[0], region.rotation[1], region.rotation[2]]
  );
  
  // Get content dimensions from texture - only update state when dimensions actually change
  useEffect(() => {
    if (!texture.image) {
      if (lastDimsRef.current !== '') {
        lastDimsRef.current = '';
        setContentDims(null);
      }
      return;
    }
    
    const updateDims = () => {
      const img = texture.image as HTMLImageElement | HTMLVideoElement | null;
      if (!img) return;
      const width = (img as HTMLImageElement).width || (img as HTMLVideoElement).videoWidth || 0;
      const height = (img as HTMLImageElement).height || (img as HTMLVideoElement).videoHeight || 0;
      
      if (width > 0 && height > 0) {
        const key = `${width}x${height}`;
        if (lastDimsRef.current !== key) {
          lastDimsRef.current = key;
          setContentDims({ width, height });
        }
      }
    };
    
    updateDims();
    
    if (texture.image instanceof HTMLVideoElement) {
      const video = texture.image as HTMLVideoElement;
      video.addEventListener('loadedmetadata', updateDims);
      return () => video.removeEventListener('loadedmetadata', updateDims);
    }
  }, [texture]);

  // Calculate content placement and mesh geometry
  const contentLayout = useMemo(() => {
    const contentWidth = contentDims?.width || virtualCanvas.width;
    const contentHeight = contentDims?.height || virtualCanvas.height;
    
    // Content is centered on virtual canvas if smaller, otherwise fills it
    const effectiveWidth = Math.min(contentWidth, virtualCanvas.width);
    const effectiveHeight = Math.min(contentHeight, virtualCanvas.height);
    
    // Content position on virtual canvas (centered if smaller)
    const contentStartX = (virtualCanvas.width - effectiveWidth) / 2;
    const contentStartY = (virtualCanvas.height - effectiveHeight) / 2;
    const contentEndX = contentStartX + effectiveWidth;
    const contentEndY = contentStartY + effectiveHeight;
    
    // Screen's position on virtual canvas
    const screenStartX = region.canvasX;
    const screenEndX = region.canvasX + region.canvasWidth;
    const screenStartY = region.canvasY;
    const screenEndY = region.canvasY + region.canvasHeight;
    
    // Calculate overlap between screen and content
    const overlapStartX = Math.max(screenStartX, contentStartX);
    const overlapEndX = Math.min(screenEndX, contentEndX);
    const overlapStartY = Math.max(screenStartY, contentStartY);
    const overlapEndY = Math.min(screenEndY, contentEndY);
    
    // Check if there's any overlap
    if (overlapStartX >= overlapEndX || overlapStartY >= overlapEndY) {
      return null; // No content visible on this screen
    }
    
    // Calculate UVs for the overlapping portion
    // Note: Canvas Y=0 is at top, but UV V=0 is at bottom, so we invert V
    const uLeft = (overlapStartX - contentStartX) / effectiveWidth;
    const uRight = (overlapEndX - contentStartX) / effectiveWidth;
    const vBottom = 1 - (overlapEndY - contentStartY) / effectiveHeight;
    const vTop = 1 - (overlapStartY - contentStartY) / effectiveHeight;
    
    // Calculate mesh size (portion of screen that shows content)
    const overlapWidthCanvas = overlapEndX - overlapStartX;
    const overlapHeightCanvas = overlapEndY - overlapStartY;
    const meshWidth = (overlapWidthCanvas / region.canvasWidth) * region.worldWidth;
    const meshHeight = (overlapHeightCanvas / region.canvasHeight) * region.worldHeight;
    
    // Calculate mesh offset from screen center
    // Note: Canvas Y=0 is at top, but 3D Y+ is up, so we invert Y offset
    const overlapCenterX = (overlapStartX + overlapEndX) / 2;
    const overlapCenterY = (overlapStartY + overlapEndY) / 2;
    const screenCenterX = (screenStartX + screenEndX) / 2;
    const screenCenterY = (screenStartY + screenEndY) / 2;
    const offsetX = ((overlapCenterX - screenCenterX) / region.canvasWidth) * region.worldWidth;
    const offsetY = -((overlapCenterY - screenCenterY) / region.canvasHeight) * region.worldHeight;
    
    return {
      uvs: { uLeft, uRight, vBottom, vTop },
      meshWidth,
      meshHeight,
      offsetX,
      offsetY
    };
  }, [contentDims, virtualCanvas.width, virtualCanvas.height, 
      region.canvasX, region.canvasY, region.canvasWidth, region.canvasHeight,
      region.worldWidth, region.worldHeight]);

  // Update UVs when layout changes
  useEffect(() => {
    if (!geometryRef.current || !contentLayout) return;
    
    const uvAttribute = geometryRef.current.attributes.uv;
    if (!uvAttribute) return;
    
    const { uvs } = contentLayout;
    const uvArray = uvAttribute.array as Float32Array;
    uvArray[0] = uvs.uLeft;  uvArray[1] = uvs.vTop;
    uvArray[2] = uvs.uRight; uvArray[3] = uvs.vTop;
    uvArray[4] = uvs.uLeft;  uvArray[5] = uvs.vBottom;
    uvArray[6] = uvs.uRight; uvArray[7] = uvs.vBottom;
    uvAttribute.needsUpdate = true;
  }, [contentLayout]);

  // Calculate content mesh position (screen position + offset)
  const contentPosition = useMemo((): [number, number, number] => {
    if (!contentLayout) return region.position;
    
    const offset = new THREE.Vector3(contentLayout.offsetX, contentLayout.offsetY, 0.001);
    offset.applyEuler(rotationEuler);
    
    return [
      region.position[0] + offset.x,
      region.position[1] + offset.y,
      region.position[2] + offset.z
    ];
  }, [contentLayout, region.position, rotationEuler]);

  return (
    <group>
      {/* Canvas layer: black background at screen boundaries */}
      <mesh position={region.position} rotation={rotationEuler}>
        <planeGeometry args={[region.worldWidth, region.worldHeight]} />
        <meshBasicMaterial color="#000000" side={THREE.DoubleSide} />
      </mesh>
      
      {/* Content: sized and positioned based on content/screen overlap */}
      {contentLayout && (
        <mesh position={contentPosition} rotation={rotationEuler}>
          <planeGeometry 
            ref={geometryRef} 
            args={[contentLayout.meshWidth, contentLayout.meshHeight]} 
          />
          <meshBasicMaterial 
            map={texture} 
            side={THREE.DoubleSide} 
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
});

// Placeholder screen when no media
const PlaceholderScreen: React.FC<{ region: ScreenRegion }> = ({ region }) => (
  <mesh 
    position={region.position} 
    rotation={new THREE.Euler(...region.rotation)}
  >
    <planeGeometry args={[region.worldWidth, region.worldHeight]} />
    <meshBasicMaterial color="#1a1a2e" side={THREE.DoubleSide} />
  </mesh>
);

// Individual panel of an irregular screen - memoized for performance
const IrregularPanel = React.memo<{
  panel: LEDPanel;
  screenPosition: [number, number, number];
  screenRotation: [number, number, number];
  screenWidth: number;
  screenHeight: number;
  texture: THREE.Texture;
  canvasX: number;
  canvasY: number;
  canvasWidth: number;
  canvasHeight: number;
  contentBounds: { startX: number; startY: number; width: number; height: number };
}>(({ 
  panel, screenPosition, screenRotation, screenWidth, screenHeight, texture,
  canvasX, canvasY, canvasWidth, canvasHeight, contentBounds
}) => {
  const geometryRef = useRef<THREE.PlaneGeometry>(null);
  
  // Memoize rotation euler to avoid recreation
  const rotationEuler = useMemo(() => 
    new THREE.Euler(screenRotation[0], screenRotation[1], screenRotation[2]),
    [screenRotation[0], screenRotation[1], screenRotation[2]]
  );
  
  // Calculate all layout data in one memoized calculation
  const layoutData = useMemo(() => {
    // Panel's normalized position within the screen (0-1)
    const panelNormMinX = panel.localX / screenWidth;
    const panelNormMaxX = (panel.localX + panel.width) / screenWidth;
    // Note: Panel localY is in 3D coordinates (Y+ up), but canvas Y=0 is at top
    // So we invert the Y position when mapping to canvas
    const panelNormMinY = 1 - (panel.localY + panel.height) / screenHeight;
    const panelNormMaxY = 1 - panel.localY / screenHeight;
    
    // Panel's position on virtual canvas
    const panelStartX = canvasX + panelNormMinX * canvasWidth;
    const panelEndX = canvasX + panelNormMaxX * canvasWidth;
    const panelStartY = canvasY + panelNormMinY * canvasHeight;
    const panelEndY = canvasY + panelNormMaxY * canvasHeight;
    
    // Calculate overlap between panel and content
    const overlapStartX = Math.max(panelStartX, contentBounds.startX);
    const overlapEndX = Math.min(panelEndX, contentBounds.startX + contentBounds.width);
    const overlapStartY = Math.max(panelStartY, contentBounds.startY);
    const overlapEndY = Math.min(panelEndY, contentBounds.startY + contentBounds.height);
    
    // Panel position in world space
    const offsetX = panel.localX + panel.width / 2 - screenWidth / 2;
    const offsetY = panel.localY + panel.height / 2 - screenHeight / 2;
    
    // Apply rotation to offset for panel position
    const euler = new THREE.Euler(screenRotation[0], screenRotation[1], screenRotation[2]);
    const panelOffset = new THREE.Vector3(offsetX, offsetY, 0.001);
    panelOffset.applyEuler(euler);
    
    const panelPos: [number, number, number] = [
      screenPosition[0] + panelOffset.x,
      screenPosition[1] + panelOffset.y,
      screenPosition[2] + panelOffset.z
    ];
    
    // Panel dimensions with overlap for gap elimination
    const overlapMeters = 0.001;
    const basePanelWidth = panel.width + overlapMeters;
    const basePanelHeight = panel.height + overlapMeters;
    
    // Check if there's any content overlap
    if (overlapStartX >= overlapEndX || overlapStartY >= overlapEndY) {
      return {
        hasContent: false,
        panelPosition: panelPos,
        panelWidth: basePanelWidth,
        panelHeight: basePanelHeight,
        contentPosition: panelPos,
        contentWidth: 0,
        contentHeight: 0,
        uvs: { uvMinX: 0, uvMaxX: 1, uvMinY: 0, uvMaxY: 1 }
      };
    }
    
    // Calculate UVs for the overlapping portion
    // Note: Canvas Y=0 is at top, but UV V=0 is at bottom, so we invert V
    const uvMinX = (overlapStartX - contentBounds.startX) / contentBounds.width;
    const uvMaxX = (overlapEndX - contentBounds.startX) / contentBounds.width;
    const uvMinY = 1 - (overlapEndY - contentBounds.startY) / contentBounds.height;
    const uvMaxY = 1 - (overlapStartY - contentBounds.startY) / contentBounds.height;
    
    // Calculate content mesh size
    const panelCanvasWidth = panelEndX - panelStartX;
    const panelCanvasHeight = panelEndY - panelStartY;
    const widthRatio = (overlapEndX - overlapStartX) / panelCanvasWidth;
    const heightRatio = (overlapEndY - overlapStartY) / panelCanvasHeight;
    
    // Calculate content position offset
    // Note: Canvas Y=0 is at top, but 3D Y+ is up, so we invert Y offset
    const overlapCenterX = (overlapStartX + overlapEndX) / 2;
    const overlapCenterY = (overlapStartY + overlapEndY) / 2;
    const panelCenterX = (panelStartX + panelEndX) / 2;
    const panelCenterY = (panelStartY + panelEndY) / 2;
    const offsetRatioX = (overlapCenterX - panelCenterX) / panelCanvasWidth;
    const offsetRatioY = -(overlapCenterY - panelCenterY) / panelCanvasHeight;
    
    const contentOffsetX = offsetX + offsetRatioX * panel.width;
    const contentOffsetY = offsetY + offsetRatioY * panel.height;
    const contentOffset = new THREE.Vector3(contentOffsetX, contentOffsetY, 0.002);
    contentOffset.applyEuler(euler);
    
    const contentPos: [number, number, number] = [
      screenPosition[0] + contentOffset.x,
      screenPosition[1] + contentOffset.y,
      screenPosition[2] + contentOffset.z
    ];
    
    return {
      hasContent: true,
      panelPosition: panelPos,
      panelWidth: basePanelWidth,
      panelHeight: basePanelHeight,
      contentPosition: contentPos,
      contentWidth: basePanelWidth * widthRatio,
      contentHeight: basePanelHeight * heightRatio,
      uvs: { uvMinX, uvMaxX, uvMinY, uvMaxY }
    };
  }, [panel.localX, panel.localY, panel.width, panel.height,
      screenWidth, screenHeight, canvasX, canvasY, canvasWidth, canvasHeight,
      contentBounds.startX, contentBounds.startY, contentBounds.width, contentBounds.height,
      screenPosition[0], screenPosition[1], screenPosition[2],
      screenRotation[0], screenRotation[1], screenRotation[2]]);

  // Update UVs when layout changes
  useEffect(() => {
    if (!geometryRef.current || !layoutData.hasContent) return;
    
    const uvAttribute = geometryRef.current.attributes.uv;
    if (!uvAttribute) return;
    
    const { uvs } = layoutData;
    const uvArray = uvAttribute.array as Float32Array;
    uvArray[0] = uvs.uvMinX; uvArray[1] = uvs.uvMaxY;
    uvArray[2] = uvs.uvMaxX; uvArray[3] = uvs.uvMaxY;
    uvArray[4] = uvs.uvMinX; uvArray[5] = uvs.uvMinY;
    uvArray[6] = uvs.uvMaxX; uvArray[7] = uvs.uvMinY;
    uvAttribute.needsUpdate = true;
  }, [layoutData]);

  if (!layoutData.hasContent) {
    return (
      <mesh position={layoutData.panelPosition} rotation={rotationEuler}>
        <planeGeometry args={[layoutData.panelWidth, layoutData.panelHeight]} />
        <meshBasicMaterial color="#000000" side={THREE.DoubleSide} />
      </mesh>
    );
  }

  return (
    <group>
      <mesh position={layoutData.panelPosition} rotation={rotationEuler}>
        <planeGeometry args={[layoutData.panelWidth, layoutData.panelHeight]} />
        <meshBasicMaterial color="#000000" side={THREE.DoubleSide} />
      </mesh>
      <mesh position={layoutData.contentPosition} rotation={rotationEuler}>
        <planeGeometry
          ref={geometryRef}
          args={[layoutData.contentWidth, layoutData.contentHeight]}
        />
        <meshBasicMaterial map={texture} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  );
});

// Irregular screen content layer - renders each panel separately
// Uses canvas mapping to determine which portion of content to display
// Content smaller than virtual canvas is displayed at original size, centered
const IrregularContentLayer: React.FC<{
  region: ScreenRegion;
  texture: THREE.Texture;
  virtualCanvas: VirtualCanvas;
}> = ({ region, texture, virtualCanvas }) => {
  const [contentDims, setContentDims] = useState<{ width: number; height: number } | null>(null);
  const lastDimsRef = useRef<string>('');
  
  // Get content dimensions from texture - only update state when dimensions actually change
  useEffect(() => {
    if (!texture.image) {
      if (lastDimsRef.current !== '') {
        lastDimsRef.current = '';
        setContentDims(null);
      }
      return;
    }
    
    const updateDims = () => {
      const img = texture.image as HTMLImageElement | HTMLVideoElement | null;
      if (!img) return;
      const width = (img as HTMLImageElement).width || (img as HTMLVideoElement).videoWidth || 0;
      const height = (img as HTMLImageElement).height || (img as HTMLVideoElement).videoHeight || 0;
      
      if (width > 0 && height > 0) {
        const key = `${width}x${height}`;
        if (lastDimsRef.current !== key) {
          lastDimsRef.current = key;
          setContentDims({ width, height });
        }
      }
    };
    
    updateDims();
    
    if (texture.image instanceof HTMLVideoElement) {
      const video = texture.image as HTMLVideoElement;
      video.addEventListener('loadedmetadata', updateDims);
      return () => video.removeEventListener('loadedmetadata', updateDims);
    }
  }, [texture]);
  
  // Calculate content bounds on virtual canvas (centered if smaller)
  const contentBounds = useMemo(() => {
    const contentWidth = contentDims?.width || virtualCanvas.width;
    const contentHeight = contentDims?.height || virtualCanvas.height;
    
    // Content is centered on virtual canvas if smaller
    const effectiveWidth = Math.min(contentWidth, virtualCanvas.width);
    const effectiveHeight = Math.min(contentHeight, virtualCanvas.height);
    
    return {
      startX: (virtualCanvas.width - effectiveWidth) / 2,
      startY: (virtualCanvas.height - effectiveHeight) / 2,
      width: effectiveWidth,
      height: effectiveHeight
    };
  }, [contentDims, virtualCanvas.width, virtualCanvas.height]);
  
  if (!region.irregularConfig || region.screenType !== 'irregular') {
    return null;
  }
  
  const { panels } = region.irregularConfig;
  
  return (
    <group>
      {/* Render each panel - no bounding box background, panels define the screen shape */}
      {panels.map((panel) => (
        <IrregularPanel
          key={panel.id}
          panel={panel}
          screenPosition={region.position}
          screenRotation={region.rotation}
          screenWidth={region.worldWidth}
          screenHeight={region.worldHeight}
          texture={texture}
          canvasX={region.canvasX}
          canvasY={region.canvasY}
          canvasWidth={region.canvasWidth}
          canvasHeight={region.canvasHeight}
          contentBounds={contentBounds}
        />
      ))}
    </group>
  );
};

// Placeholder for irregular screen when no media
const IrregularPlaceholderScreen: React.FC<{ region: ScreenRegion }> = ({ region }) => {
  if (!region.irregularConfig || region.screenType !== 'irregular') {
    return null;
  }
  
  const { panels } = region.irregularConfig;
  
  return (
    <group>
      {panels.map((panel) => {
        const offsetX = panel.localX + panel.width / 2 - region.worldWidth / 2;
        const offsetY = panel.localY + panel.height / 2 - region.worldHeight / 2;
        
        const euler = new THREE.Euler(...region.rotation);
        const offset = new THREE.Vector3(offsetX, offsetY, 0);
        offset.applyEuler(euler);
        
        const panelPosition: [number, number, number] = [
          region.position[0] + offset.x,
          region.position[1] + offset.y,
          region.position[2] + offset.z
        ];
        
        return (
          <mesh
            key={panel.id}
            position={panelPosition}
            rotation={new THREE.Euler(...region.rotation)}
          >
            <planeGeometry args={[panel.width, panel.height]} />
            <meshBasicMaterial color="#1a1a2e" side={THREE.DoubleSide} />
          </mesh>
        );
      })}
    </group>
  );
};

// Screen System Controller
export const ScreenSystem: React.FC<ScreenSystemProps> = ({ 
  screens,
  virtualCanvas,
  videoSrc,
  muted = false,
  videoSeekTime,
  isVideoPlaying = false,
  onVideoEnded
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);

  // Track user interaction for autoplay
  useEffect(() => {
    const handleInteraction = () => {
      setHasUserInteracted(true);
      // Try to play video if it exists and is paused
      if (videoRef.current && videoRef.current.paused) {
        videoRef.current.play().catch(() => {});
      }
    };

    window.addEventListener('click', handleInteraction, { once: true });
    window.addEventListener('keydown', handleInteraction, { once: true });
    
    return () => {
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    };
  }, []);
  
  useEffect(() => {
    // Cleanup function
    const cleanup = () => {
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
        videoRef.current = null;
      }
      if (textureRef.current) {
        textureRef.current.dispose();
        textureRef.current = null;
      }
      setIsReady(false);
    };

    // No source - just show placeholder
    if (!videoSrc) {
      cleanup();
      return;
    }

    // Validate URL format - skip if it's clearly not a URL (like placeholder text)
    const trimmedSrc = videoSrc.trim();
    if (!trimmedSrc || 
        trimmedSrc === 'STANDBY' || 
        trimmedSrc === 'N/A' || 
        trimmedSrc === '-' ||
        (!trimmedSrc.startsWith('http://') && 
         !trimmedSrc.startsWith('https://') && 
         !trimmedSrc.startsWith('blob:') && 
         !trimmedSrc.startsWith('/') &&
         !trimmedSrc.startsWith('./') &&
         !trimmedSrc.includes('.'))) { // If it doesn't have a file extension, it's probably not a file
      // This is likely a placeholder or description, not a real URL
      cleanup();
      return;
    }

    // Clean up previous before creating new
    cleanup();

    // Determine if it's an image or video
    const isImage = isImageUrl(videoSrc);

    if (isImage) {
      // Load as image texture
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin('anonymous');
      
      loader.load(
        videoSrc,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          textureRef.current = texture;
          setIsReady(true);
        },
        undefined,
        (error) => {
          console.error("Image load error:", error);
          setIsReady(false);
        }
      );
    } else {
      // Load as video
      const video = document.createElement('video');
      video.playsInline = true;
      // Start muted to allow autoplay, user can unmute
      video.muted = true;
      // Only loop if not controlled by timeline (when videoSeekTime is undefined)
      video.loop = videoSeekTime === undefined;
      video.preload = 'auto';
      video.crossOrigin = 'anonymous';
      
      videoRef.current = video;

      const handleCanPlay = () => {
        if (!videoRef.current) return;
        
        // Create simple video texture - no custom update override
        const texture = new THREE.VideoTexture(videoRef.current);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        
        textureRef.current = texture;
        setIsReady(true);
        
        // Don't autoplay when timeline-controlled - let the play/pause effect handle it
        // Only autoplay if not timeline-controlled (videoSeekTime is undefined)
        if (videoSeekTime === undefined) {
          videoRef.current.play().catch(e => {
            console.warn("Video autoplay blocked, will play on user interaction:", e.message);
          });
        }
      };

      const handleError = (e: Event) => {
        const vid = e.target as HTMLVideoElement;
        const errorDetails: any = {
          src: vid.src,
          networkState: vid.networkState,
          readyState: vid.readyState
        };
        
        if (vid.error) {
          // Add detailed error information
          errorDetails.errorCode = vid.error.code;
          errorDetails.errorMessage = vid.error.message;
          
          // Error code meanings:
          // 1 = MEDIA_ERR_ABORTED - The user aborted the loading
          // 2 = MEDIA_ERR_NETWORK - A network error occurred
          // 3 = MEDIA_ERR_DECODE - An error occurred while decoding
          // 4 = MEDIA_ERR_SRC_NOT_SUPPORTED - The source is not supported
          const errorMessages: { [key: number]: string } = {
            1: 'Video loading was aborted',
            2: 'Network error while loading video',
            3: 'Error decoding video',
            4: 'Video format not supported'
          };
          errorDetails.errorDescription = errorMessages[vid.error.code] || 'Unknown error';
        } else {
          errorDetails.errorMessage = 'No error object available';
        }
        
        // Only log if it's a real error (not just a warning)
        if (vid.error && vid.error.code !== 1) {
          console.error("Video load error:", errorDetails);
        }
        setIsReady(false);
      };

      video.addEventListener('canplay', handleCanPlay);
      video.addEventListener('error', handleError);
      
      video.src = videoSrc;
    }

    return cleanup;
  }, [videoSrc]); // Only recreate when videoSrc changes, not when videoSeekTime changes

  // Update muted state dynamically (but only after user interaction to enable audio)
  useEffect(() => {
    if (videoRef.current && hasUserInteracted) {
      videoRef.current.muted = muted;
    }
  }, [muted, hasUserInteracted]);

  // Seek video when timeline position changes
  useEffect(() => {
    if (!videoRef.current || !videoSrc || isImageUrl(videoSrc) || !isReady) return;
    if (videoSeekTime === undefined) return;

    const video = videoRef.current;
    
    // Only seek if the time difference is significant (>0.5s to reduce seeks)
    if (Math.abs(video.currentTime - videoSeekTime) > 0.5) {
      video.currentTime = videoSeekTime;
    }
  }, [videoSeekTime, videoSrc, isReady]);

  // Control play/pause based on timeline state - simplified
  useEffect(() => {
    if (!videoRef.current || !videoSrc || isImageUrl(videoSrc) || !isReady) return;
    if (videoSeekTime === undefined) return;

    const video = videoRef.current;

    if (isVideoPlaying) {
      if (video.paused && video.readyState >= 2) {
        video.play().catch(() => {});
      }
    } else {
      if (!video.paused) {
        video.pause();
      }
    }
  }, [isVideoPlaying, videoSrc, videoSeekTime, isReady]);

  // Handle video ended event - pause timeline when video reaches end
  useEffect(() => {
    if (!videoRef.current || !videoSrc || isImageUrl(videoSrc) || videoSeekTime === undefined) return;

    const video = videoRef.current;
    
    const handleEnded = () => {
      // When video ends, notify parent to pause timeline
      onVideoEnded?.();
    };

    video.addEventListener('ended', handleEnded);
    
    return () => {
      video.removeEventListener('ended', handleEnded);
    };
  }, [videoSrc, videoSeekTime, onVideoEnded]);

  // No screens at all
  if (screens.length === 0) {
    return null;
  }

  // Show placeholders if not ready or no media
  if (!isReady || !textureRef.current) {
    return (
      <group>
        {screens.map((screen) => (
          screen.screenType === 'irregular' 
            ? <IrregularPlaceholderScreen key={screen.id} region={screen} />
            : <PlaceholderScreen key={screen.id} region={screen} />
        ))}
      </group>
    );
  }

  return (
    <group>
      {screens.map((screen) => (
        <group key={screen.id}>
          {screen.screenType === 'irregular' ? (
            /* Irregular screen - render each panel separately */
            <IrregularContentLayer 
              region={screen} 
              texture={textureRef.current!} 
              virtualCanvas={virtualCanvas}
            />
          ) : (
            /* Regular screen - content layer uses canvas mapping */
            <ContentLayer 
              region={screen} 
              texture={textureRef.current!} 
              virtualCanvas={virtualCanvas}
            />
          )}
        </group>
      ))}
    </group>
  );
};
