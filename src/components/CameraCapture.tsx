import React, { useRef, useState, useCallback } from 'react';
import { Camera, RefreshCw, X, Zap, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface CameraCaptureProps {
  onCapture: (base64: string) => void;
  onClose: () => void;
  isProcessing: boolean;
  extractionError?: string | null;
}

export const CameraCapture: React.FC<CameraCaptureProps> = ({ onCapture, onClose, isProcessing, extractionError }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      setError("Could not access camera. Please ensure permissions are granted.");
      console.error(err);
    }
  }, []);

  React.useEffect(() => {
    startCamera();
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [startCamera]);

  const captureFrame = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      
      if (context) {
        // Calculate new dimensions (max 800px)
        const MAX_DIMENSION = 800;
        let width = video.videoWidth;
        let height = video.videoHeight;
        
        if (width > height) {
          if (width > MAX_DIMENSION) {
            height = Math.round((height * MAX_DIMENSION) / width);
            width = MAX_DIMENSION;
          }
        } else {
          if (height > MAX_DIMENSION) {
            width = Math.round((width * MAX_DIMENSION) / height);
            height = MAX_DIMENSION;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        context.drawImage(video, 0, 0, width, height);
        
        // Use higher compression to ensure it fits in Firestore (1MB limit)
        const base64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
        onCapture(base64);
      }
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center"
    >
      <div className="relative w-full h-full max-w-md mx-auto overflow-hidden">
        {error ? (
          <div className="p-8 text-center text-white">
            <p className="mb-4">{error}</p>
            <button 
              onClick={onClose}
              className="px-6 py-2 bg-white/10 border border-white/20 rounded-full text-white backdrop-blur-md"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              className="w-full h-full object-cover"
            />
            
            {/* Glossy Overlays */}
            <div className="absolute inset-0 pointer-events-none border-[20px] border-black/40">
              <div className="w-full h-full border-2 border-white/30 rounded-2xl relative">
                <div className="absolute top-1/2 left-0 w-full h-[1px] bg-white/10" />
                <div className="absolute top-0 left-1/2 w-[1px] h-full bg-white/10" />
              </div>
            </div>

            <div className="absolute top-6 left-6 right-6 flex justify-between items-center z-10">
              <button 
                onClick={onClose}
                className="p-3 bg-black/40 backdrop-blur-xl border border-white/10 rounded-full text-white"
              >
                <X size={24} />
              </button>
              <div className="px-4 py-1.5 bg-black/40 backdrop-blur-xl border border-white/10 rounded-full text-white text-xs font-medium tracking-widest uppercase">
                Scanning Mode
              </div>
            </div>

            <AnimatePresence>
              {extractionError && (
                <motion.div 
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="absolute top-24 left-6 right-6 bg-red-500/20 border border-red-500/50 backdrop-blur-xl rounded-2xl p-4 text-center shadow-2xl z-10"
                >
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <AlertTriangle size={16} className="text-red-400" />
                    <p className="text-red-400 font-bold text-sm uppercase tracking-wider">Scan Failed</p>
                  </div>
                  <p className="text-white/90 text-sm">{extractionError}</p>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="absolute bottom-12 left-0 right-0 flex flex-col items-center gap-8 z-10">
              <p className="text-white/70 text-sm font-light tracking-wide px-8 text-center">
                Position the medicine label within the frame for AI analysis
              </p>
              
              <button 
                onClick={captureFrame}
                disabled={isProcessing}
                className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all ${
                  isProcessing ? 'opacity-50 scale-90' : 'active:scale-95'
                }`}
              >
                <div className="absolute inset-0 bg-white/20 backdrop-blur-md rounded-full border border-white/40" />
                <div className="relative w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(255,255,255,0.4)]">
                  {isProcessing ? (
                    <RefreshCw className="animate-spin text-black" size={32} />
                  ) : (
                    <Zap className="text-black fill-black" size={32} />
                  )}
                </div>
              </button>
            </div>
          </>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </motion.div>
  );
};
