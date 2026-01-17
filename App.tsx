import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Monitor, 
  Video, 
  Circle, 
  Square, 
  Download, 
  LayoutTemplate,
  MousePointer2,
  Settings2,
  Smartphone,
  Info,
  ScanEye
} from 'lucide-react';
import { Minimap } from './components/Minimap';
import { GeminiCaption } from './components/GeminiCaption';
import { lerp, formatTime, clamp } from './utils/math';
import { TrackingMode, Position } from './types';

function App() {
  // Config State
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [recordedBlobUrl, setRecordedBlobUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<TrackingMode>(TrackingMode.AUTO_TRACK);
  
  // Dimensions
  const [videoDims, setVideoDims] = useState({ width: 1920, height: 1080 }); // Source resolution

  // OUTPUT (CANVAS) RESOLUTION - High Quality 720p Vertical
  const CANVAS_WIDTH = 720;
  const CANVAS_HEIGHT = 1280;

  // CROP DIMENSIONS
  const [cropSize, setCropSize] = useState({ width: 607, height: 1080 });

  // State for UI
  const [targetCrop, setTargetCrop] = useState<Position>({ x: 0, y: 0 });
  
  // Refs for high-freq loop
  const targetCropRef = useRef<Position>({ x: 0, y: 0 });
  const currentCropRef = useRef<Position>({ x: 0, y: 0 });

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Fix: Initialize useRef with null to satisfy TypeScript requirement
  const animationFrameRef = useRef<number | null>(null);

  // Motion Detection Refs
  const motionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevFrameDataRef = useRef<Uint8ClampedArray | null>(null);
  const lastActiveTimeRef = useRef<number>(Date.now());
  const edgeTimerRef = useRef<number | null>(null);
  
  // --- OPTICAL TRACKING SETTINGS ---
  // NOTE: Browser security sandboxes prevent accessing global OS mouse coordinates (X, Y) 
  // in a standard web application. We cannot just "import" mouse coordinates.
  // Instead, we use a refined "Optical Flow" algorithm to track the cursor visually.
  const MOTION_THRESHOLD = 15; // Increased sensitivity (was 20) to detect faint cursor changes
  const JITTER_THRESHOLD = 5;  // Lowered deadzone to follow small micro-movements
  const EDGE_BUFFER = 50;      // Pixels from edge to consider "about to leave"

  // --- Handlers ---

  const startStream = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor', // Prefer full screen
          height: { ideal: 2160 }, // Request high res
          frameRate: 60,
          cursor: 'always' // CRITICAL: We need the cursor visible to track it
        } as any,
        audio: false
      });

      setStream(mediaStream);

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.onloadedmetadata = () => {
          if (!videoRef.current) return;
          
          videoRef.current.play();
          
          const vW = videoRef.current.videoWidth;
          const vH = videoRef.current.videoHeight;
          setVideoDims({ width: vW, height: vH });

          // Calculate Crop Size based on SOURCE height for 9:16
          const cH = vH;
          const cW = Math.floor(cH * (9 / 16));
          setCropSize({ width: cW, height: cH });

          // Start Center
          const initialX = (vW - cW) / 2;
          const initialY = 0; 
          
          const initialPos = { x: initialX, y: initialY };
          setTargetCrop(initialPos);
          targetCropRef.current = initialPos;
          currentCropRef.current = initialPos;
          
          lastActiveTimeRef.current = Date.now();
        };
      }
      
      mediaStream.getVideoTracks()[0].onended = () => {
        stopRecording();
        setStream(null);
      };

    } catch (err) {
      console.error("Error starting stream:", err);
      alert("Could not start screen capture. Please ensure you have granted permission.");
    }
  };

  const startRecording = () => {
    if (!canvasRef.current) return;
    const canvasStream = canvasRef.current.captureStream(60);
    const recorder = new MediaRecorder(canvasStream, {
      mimeType: 'video/webm;codecs=vp9'
    });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      setRecordedBlobUrl(url);
      chunksRef.current = [];
    };
    recorder.start();
    setIsRecording(true);
    mediaRecorderRef.current = recorder;
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setDuration(0);
  };

  const detectMotion = (video: HTMLVideoElement) => {
    // 1. Setup small canvas for analysis
    if (!motionCanvasRef.current) {
      const mc = document.createElement('canvas');
      mc.width = 320; 
      mc.height = 320 * (video.videoHeight / video.videoWidth);
      motionCanvasRef.current = mc;
    }

    const mc = motionCanvasRef.current;
    const ctx = mc.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // 2. Draw current frame
    ctx.drawImage(video, 0, 0, mc.width, mc.height);
    const frameData = ctx.getImageData(0, 0, mc.width, mc.height).data;

    if (prevFrameDataRef.current) {
      let totalX = 0;
      let totalY = 0;
      let changedPixelCount = 0;
      
      // 3. Pixel Diff Loop
      // Optimization: Check every 4th pixel (step 16 bytes)
      for (let i = 0; i < frameData.length; i += 16) { 
        const rDiff = Math.abs(frameData[i] - prevFrameDataRef.current[i]);
        const gDiff = Math.abs(frameData[i + 1] - prevFrameDataRef.current[i + 1]);
        const bDiff = Math.abs(frameData[i + 2] - prevFrameDataRef.current[i + 2]);

        // Lower threshold to capture faint cursor shadows or hand icons
        if (rDiff + gDiff + bDiff > MOTION_THRESHOLD) {
          const pixelIndex = i / 4;
          const x = pixelIndex % mc.width;
          const y = Math.floor(pixelIndex / mc.width);
          totalX += x;
          totalY += y;
          changedPixelCount++;
        }
      }

      // 4. Analysis
      const totalSampledPixels = frameData.length / 16;
      const changeRatio = changedPixelCount / totalSampledPixels;

      const isScrolling = changeRatio > 0.15; // Ignore massive changes (Scene cuts/Scrolling)
      // Ultra-sensitive lower bound to catch "Hover" animations
      const hasMotion = changeRatio > 0.00005; 

      if (hasMotion && !isScrolling) {
        // --- MOTION DETECTED ---
        const avgX = totalX / changedPixelCount;
        const avgY = totalY / changedPixelCount;

        // Map to video space
        let targetX = (avgX / mc.width) * video.videoWidth - (cropSize.width / 2);
        let targetY = (avgY / mc.height) * video.videoHeight - (cropSize.height / 2);

        // Clamp to screen bounds
        targetX = clamp(targetX, 0, video.videoWidth - cropSize.width);
        targetY = clamp(targetY, 0, video.videoHeight - cropSize.height);

        // Check if cursor is near edge (off-screen detection heuristic)
        // If the center of motion is very close to the edge, we might be leaving
        const motionCenterX = (avgX / mc.width) * video.videoWidth;
        const isNearEdge = 
             motionCenterX < EDGE_BUFFER || 
             motionCenterX > (video.videoWidth - EDGE_BUFFER);

        if (isNearEdge) {
           // We are at the edge. If motion stops next frame, it might be gone.
           // Start a timer? No, let's keep it simple.
           // We just track it to the edge.
           if (edgeTimerRef.current) clearTimeout(edgeTimerRef.current);
           edgeTimerRef.current = window.setTimeout(() => {
              // If we stayed at the edge for 3 seconds, maybe return to center?
              // User asked for "Initial position".
              const centerX = (video.videoWidth - cropSize.width) / 2;
              setTargetCrop({ x: centerX, y: 0 }); // Reset to top-center
              targetCropRef.current = { x: centerX, y: 0 };
           }, 3000);
        } else {
           // We are inside the screen, cancel any "leaving" timer
           if (edgeTimerRef.current) {
             clearTimeout(edgeTimerRef.current);
             edgeTimerRef.current = null;
           }
        }

        // Apply Movement if outside jitter deadzone
        const dist = Math.sqrt(
          Math.pow(targetX - targetCropRef.current.x, 2) + 
          Math.pow(targetY - targetCropRef.current.y, 2)
        );

        if (dist > JITTER_THRESHOLD) {
          targetCropRef.current = { x: targetX, y: targetY };
          setTargetCrop({ x: targetX, y: targetY }); 
          lastActiveTimeRef.current = Date.now();
        }
      } else {
        // --- NO MOTION ---
        // CRITICAL FIX: Do NOT return to center immediately.
        // We assume the user is reading or hovering.
        // We only reset if the "Edge Timer" fires (handled in the block above)
        
        // Update: We cleared the timer if inside screen, so we are safe.
        // The view stays locked on the last known position.
      }
    }

    prevFrameDataRef.current = frameData;
  };

  // --- Main Loop ---
  const updateFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (video && canvas && !video.paused && !video.ended) {
      const ctx = canvas.getContext('2d', { alpha: false });
      if (ctx) {
        if (mode === TrackingMode.AUTO_TRACK) {
           detectMotion(video);
        } else {
           targetCropRef.current = targetCrop;
        }

        // SMOOTHING: 0.25 is snappy but smooth
        const smoothing = mode === TrackingMode.MANUAL ? 1 : 0.25; 
        
        currentCropRef.current.x = lerp(currentCropRef.current.x, targetCropRef.current.x, smoothing);
        currentCropRef.current.y = lerp(currentCropRef.current.y, targetCropRef.current.y, smoothing);

        ctx.drawImage(
          video,
          currentCropRef.current.x,
          currentCropRef.current.y,
          cropSize.width,
          cropSize.height, // Source Rect
          0, 0, canvas.width, canvas.height // Dest Rect
        );
      }
    }
    animationFrameRef.current = requestAnimationFrame(updateFrame);
  }, [cropSize, mode, targetCrop]); 

  useEffect(() => {
    if (stream) {
      animationFrameRef.current = requestAnimationFrame(updateFrame);
    }
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [stream, updateFrame]);

  // Timer
  useEffect(() => {
    let interval: number;
    if (isRecording) {
      interval = window.setInterval(() => setDuration(d => d + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white font-sans selection:bg-brand-500 selection:text-white">
      <video ref={videoRef} className="hidden" muted playsInline />

      <header className="border-b border-gray-800 bg-[#0f0f13]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-brand-500 to-purple-600 rounded-lg flex items-center justify-center">
              <Video className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
              CineStream
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-[10px] font-mono text-gray-400">
              v3.4 Optical
            </span>
          </div>

          <div className="flex items-center gap-4">
            {isRecording && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-full animate-pulse-slow">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-red-400 font-mono text-sm">{formatTime(duration)}</span>
              </div>
            )}
            
            <button 
              onClick={() => window.open('https://github.com/google/generative-ai-js', '_blank')}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <Info className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {!stream ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-8 animate-in fade-in zoom-in-95 duration-500">
            <div className="relative">
              <div className="absolute -inset-4 bg-brand-500/20 rounded-full blur-xl"></div>
              <Monitor className="w-24 h-24 text-gray-700 relative z-10" strokeWidth={1} />
              <Smartphone className="absolute bottom-0 -right-2 w-12 h-12 text-brand-500 bg-[#0a0a0c] p-2 rounded-xl border border-gray-800" />
            </div>
            
            <div className="max-w-lg space-y-3">
              <h2 className="text-4xl font-bold tracking-tight text-white">
                Vertical Screen Recorder
              </h2>
              <p className="text-gray-400 text-lg">
                The smart recorder that <span className="text-brand-400 font-semibold">follows your mouse</span> automatically.
                Optical tracking ensures your content is always in focus.
              </p>
            </div>

            <button
              onClick={startStream}
              className="group relative inline-flex items-center justify-center px-8 py-4 font-semibold text-white transition-all duration-200 bg-brand-600 rounded-full hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-600 focus:ring-offset-[#0a0a0c]"
            >
              <span className="mr-2 text-lg">Select Screen & Start</span>
              <LayoutTemplate className="w-5 h-5 group-hover:scale-110 transition-transform" />
            </button>
            
            <div className="grid grid-cols-3 gap-6 text-left max-w-2xl mt-12 w-full">
               <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
                 <MousePointer2 className="w-6 h-6 text-brand-500 mb-3" />
                 <h3 className="font-semibold text-gray-200">Optical Tracking</h3>
                 <p className="text-sm text-gray-500 mt-1">Advanced visual algorithm detects cursor movement without needing system permissions.</p>
               </div>
               <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
                 <Smartphone className="w-6 h-6 text-purple-500 mb-3" />
                 <h3 className="font-semibold text-gray-200">9:16 Ready</h3>
                 <p className="text-sm text-gray-500 mt-1">Native vertical format optimized for TikTok, Reels, and YouTube Shorts.</p>
               </div>
               <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
                 <Settings2 className="w-6 h-6 text-emerald-500 mb-3" />
                 <h3 className="font-semibold text-gray-200">AI Captions</h3>
                 <p className="text-sm text-gray-500 mt-1">Generate viral descriptions instantly using Gemini models.</p>
               </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-[calc(100vh-140px)]">
            <div className="lg:col-span-8 flex flex-col gap-6 h-full">
              <div className="flex-1 bg-gray-900/50 rounded-2xl border border-gray-800 flex items-center justify-center p-8 relative overflow-hidden backdrop-blur-sm shadow-2xl">
                 <div className="relative shadow-2xl rounded-lg overflow-hidden border-4 border-gray-800">
                    <canvas 
                      ref={canvasRef} 
                      width={CANVAS_WIDTH} 
                      height={CANVAS_HEIGHT} 
                      className="max-h-[60vh] w-auto bg-black block"
                    />
                    <div className="absolute top-4 right-4 bg-black/60 backdrop-blur text-white text-xs px-2 py-1 rounded font-mono border border-white/10">
                       PREVIEW • 9:16
                    </div>
                    {mode === TrackingMode.AUTO_TRACK && (
                      <div className="absolute top-4 left-4 flex items-center gap-2 bg-purple-500/80 backdrop-blur text-white text-xs px-2 py-1 rounded font-mono shadow-lg animate-pulse">
                        <ScanEye className="w-3 h-3" />
                        SMART FOLLOW
                      </div>
                    )}
                 </div>
              </div>

              <div className="h-24 bg-gray-800/50 rounded-xl border border-gray-700 flex items-center justify-between px-6 backdrop-blur-sm">
                <div className="flex items-center gap-4">
                  {!isRecording ? (
                    <button
                      onClick={startRecording}
                      className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-bold transition-all shadow-lg shadow-red-900/20"
                    >
                      <Circle className="w-3 h-3 fill-current" />
                      REC
                    </button>
                  ) : (
                    <button
                      onClick={stopRecording}
                      className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white px-6 py-3 rounded-lg font-bold transition-all border border-gray-600"
                    >
                      <Square className="w-3 h-3 fill-current" />
                      STOP
                    </button>
                  )}
                  
                  <div className="h-8 w-px bg-gray-700 mx-2"></div>
                  
                  <div className="flex flex-col gap-1">
                     <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">Tracking Mode</span>
                     <div className="flex bg-gray-900 rounded-lg p-1 border border-gray-700">
                        <button 
                          onClick={() => setMode(TrackingMode.AUTO_TRACK)}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${mode === TrackingMode.AUTO_TRACK ? 'bg-purple-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}
                        >
                          <ScanEye className="w-3 h-3" />
                          Smart Follow
                        </button>
                        <button 
                          onClick={() => setMode(TrackingMode.SMOOTH_FOLLOW)}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${mode === TrackingMode.SMOOTH_FOLLOW ? 'bg-brand-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}
                        >
                          Manual Pan
                        </button>
                     </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                   <div className="text-right">
                      <div className="text-xs text-gray-400">Resolution</div>
                      <div className="font-mono text-sm font-medium">{CANVAS_WIDTH}x{CANVAS_HEIGHT}</div>
                   </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-4 flex flex-col gap-6 h-full overflow-y-auto pr-2">
              <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700 backdrop-blur-sm">
                 <div className="flex items-center justify-between mb-3">
                   <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                     <Monitor className="w-4 h-4 text-brand-500" />
                     Full Screen View
                   </h3>
                   <span className="text-[10px] text-brand-400 bg-brand-500/10 px-2 py-0.5 rounded border border-brand-500/20">
                     {mode === TrackingMode.AUTO_TRACK ? 'AUTO-TRACKING' : 'MANUAL'}
                   </span>
                 </div>
                 
                 <Minimap 
                   videoRef={videoRef}
                   cropPosition={targetCrop}
                   setCropPosition={setTargetCrop}
                   cropSize={cropSize}
                   streamWidth={videoDims.width}
                   streamHeight={videoDims.height}
                   mode={mode}
                 />
                 
                 <div className="mt-3 text-xs text-gray-500 leading-relaxed">
                   {mode === TrackingMode.AUTO_TRACK && (
                     <span className="text-purple-400 font-medium">
                       Smart Follow Active. The view will lock onto the last known cursor position and only reset if the mouse lingers at the screen edge for 3 seconds.
                     </span>
                   )}
                   {mode === TrackingMode.SMOOTH_FOLLOW && "Manual Mode: Click the map above to move the camera."}
                 </div>
              </div>

              {recordedBlobUrl && (
                <div className="bg-green-900/10 border border-green-500/30 p-4 rounded-xl animate-in fade-in slide-in-from-right-4">
                  <h3 className="text-sm font-semibold text-green-400 mb-2 flex items-center gap-2">
                     <Download className="w-4 h-4" />
                     Ready for Download
                  </h3>
                  <a 
                    href={recordedBlobUrl} 
                    download={`cinestream_${new Date().getTime()}.webm`}
                    className="block w-full text-center bg-green-600 hover:bg-green-500 text-white text-sm font-medium py-2 rounded-lg transition-colors shadow-lg shadow-green-900/20"
                  >
                    Save Video (.webm)
                  </a>
                </div>
              )}

              <div className="flex-1">
                <GeminiCaption />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;