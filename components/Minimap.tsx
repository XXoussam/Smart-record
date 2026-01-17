import React, { useRef, useEffect, useState } from 'react';
import { Position, TrackingMode } from '../types';
import { clamp } from '../utils/math';

interface MinimapProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  cropPosition: Position;
  setCropPosition: (pos: Position) => void;
  cropSize: { width: number; height: number };
  streamWidth: number;
  streamHeight: number;
  mode: TrackingMode;
}

export const Minimap: React.FC<MinimapProps> = ({
  videoRef,
  cropPosition,
  setCropPosition,
  cropSize,
  streamWidth,
  streamHeight,
  mode
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // Dynamic Minimap Dimensions
  // We fix the width to 320px and let the height adjust to match the source aspect ratio
  const minimapWidth = 320;
  const aspectRatio = streamWidth > 0 && streamHeight > 0 ? streamWidth / streamHeight : 16 / 9;
  const minimapHeight = minimapWidth / aspectRatio;

  // Draw the minimap loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const render = () => {
      // Draw the live video feed scaled down
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Calculate scaled crop box
      const scaleX = canvas.width / streamWidth;
      const scaleY = canvas.height / streamHeight;

      const boxX = cropPosition.x * scaleX;
      const boxY = cropPosition.y * scaleY;
      const boxW = cropSize.width * scaleX;
      const boxH = cropSize.height * scaleY;

      // Draw overlay (dimmed background)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Clear the "active" area (the crop box)
      ctx.clearRect(boxX, boxY, boxW, boxH);
      
      // Redraw video inside the crop box to make it "bright"
      ctx.drawImage(
        video, 
        cropPosition.x, cropPosition.y, cropSize.width, cropSize.height, // Source
        boxX, boxY, boxW, boxH // Destination
      );

      // Draw border around crop box
      ctx.strokeStyle = mode === TrackingMode.AUTO_TRACK ? '#9333ea' : '#3b82f6'; // Purple for Auto, Blue for Manual
      ctx.lineWidth = 2;
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      // Draw "Handle" visual
      if (mode !== TrackingMode.AUTO_TRACK) {
        ctx.fillStyle = '#3b82f6';
        ctx.beginPath();
        ctx.arc(boxX + boxW / 2, boxY + boxH / 2, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [cropPosition, cropSize, streamWidth, streamHeight, videoRef, mode, minimapHeight]);

  // Handle Dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    if (mode === TrackingMode.MANUAL || mode === TrackingMode.SMOOTH_FOLLOW) {
      setIsDragging(true);
      updatePosition(e);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && (mode === TrackingMode.MANUAL || mode === TrackingMode.SMOOTH_FOLLOW)) {
      updatePosition(e);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const updatePosition = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const scaleX = streamWidth / canvas.width;
    const scaleY = streamHeight / canvas.height;

    // Center the box on the mouse
    const newX = (x * scaleX) - (cropSize.width / 2);
    const newY = (y * scaleY) - (cropSize.height / 2);

    setCropPosition({
      x: clamp(newX, 0, streamWidth - cropSize.width),
      y: clamp(newY, 0, streamHeight - cropSize.height)
    });
  };

  return (
    <div 
      className="relative group rounded-lg overflow-hidden border border-gray-700 shadow-xl bg-black transition-all duration-300"
      style={{ width: minimapWidth, height: minimapHeight }}
    >
       <canvas
        ref={canvasRef}
        width={minimapWidth}
        height={minimapHeight}
        className={`w-full h-full cursor-crosshair touch-none ${mode === TrackingMode.AUTO_TRACK ? 'cursor-not-allowed opacity-90' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
      <div className="absolute bottom-2 left-2 text-[10px] text-gray-400 font-mono bg-black/60 px-1 rounded pointer-events-none">
        FULL SCREEN PREVIEW
      </div>
      {mode === TrackingMode.SMOOTH_FOLLOW && (
         <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20">
           <span className="text-xs font-bold text-white bg-red-500 px-2 py-1 rounded animate-pulse">MANUAL PAN ACTIVE</span>
         </div>
      )}
      {mode === TrackingMode.AUTO_TRACK && (
         <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20">
           <span className="text-xs font-bold text-white bg-purple-600 px-2 py-1 rounded animate-pulse">SMART FOLLOW ACTIVE</span>
         </div>
      )}
    </div>
  );
};