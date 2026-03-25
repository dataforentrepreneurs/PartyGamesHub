import React, { useRef, useState, useEffect } from 'react';
import { Eraser, RotateCcw, Trash2, Send } from 'lucide-react';

const trimCanvas = (canvas: HTMLCanvasElement): string => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas.toDataURL('image/png');
  
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const l = pixels.data.length;
  let bound = { top: null as number | null, left: null as number | null, right: null as number | null, bottom: null as number | null };
  
  for (let i = 0; i < l; i += 4) {
    // The default canvas background is #1a1f33 which equals rgb(26, 31, 51)
    // Using a tolerance to account for anti-aliasing and JS color profile blending
    if (pixels.data[i] > 40 || pixels.data[i+1] > 45 || pixels.data[i+2] > 70) { 
      const x = (i / 4) % canvas.width;
      const y = ~~((i / 4) / canvas.width);
      
      if (bound.top === null) bound.top = y;
      if (bound.left === null || x < bound.left) bound.left = x;
      if (bound.right === null || x > bound.right) bound.right = x;
      if (bound.bottom === null || y > bound.bottom) bound.bottom = y;
    }
  }
  
  if (bound.top === null || bound.left === null || bound.right === null || bound.bottom === null) {
    return canvas.toDataURL('image/png'); // Blank canvas
  }
  
  // Apply a 30px padding for aesthetics
  const padding = 30;
  bound.top = Math.max(0, bound.top - padding);
  bound.left = Math.max(0, bound.left - padding);
  bound.right = Math.min(canvas.width, bound.right + padding);
  bound.bottom = Math.min(canvas.height, bound.bottom + padding);
  
  const trimWidth = bound.right - bound.left;
  const trimHeight = bound.bottom - bound.top;
  
  const trimmed = document.createElement('canvas');
  trimmed.width = trimWidth;
  trimmed.height = trimHeight;
  const tCtx = trimmed.getContext('2d');
  if (tCtx) {
    tCtx.fillStyle = '#1a1f33'; 
    tCtx.fillRect(0, 0, trimWidth, trimHeight);
    tCtx.putImageData(ctx.getImageData(bound.left, bound.top, trimWidth, trimHeight), 0, 0);
  }
  
  return trimmed.toDataURL('image/jpeg', 0.9);
};

interface DrawCanvasProps {
  onSubmit: (dataUrl: string) => void;
  prompt: string;
  timeLeft: number;
  mode: string;
}

export default function DrawCanvas({ onSubmit, prompt, timeLeft, mode }: DrawCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [eraserMode, setEraserMode] = useState(false);
  const [blindHidden, setBlindHidden] = useState(false);
  
  type Point = {x: number, y: number};
  type Path = { points: Point[], color: string, width: number };
  const [paths, setPaths] = useState<Path[]>([]);
  const [currentPath, setCurrentPath] = useState<Path | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  // Auto-submit when time runs out
  useEffect(() => {
    if (timeLeft === 0 && !hasSubmitted) {
      setHasSubmitted(true);
      if (canvasRef.current) onSubmit(trimCanvas(canvasRef.current));
    }
  }, [timeLeft, hasSubmitted, onSubmit]);

  // Blind Draw logic
  useEffect(() => {
    if (mode === 'blind') {
      const t = setTimeout(() => setBlindHidden(true), 3000);
      return () => clearTimeout(t);
    }
  }, [mode]);

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent): Point | null => {
    if (!canvasRef.current) return null;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX = 0, clientY = 0;
    if ('touches' in e) {
      if (e.touches.length === 0) return null;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault(); 
    const coords = getCoordinates(e);
    if (!coords) return;
    setIsDrawing(true);
    setCurrentPath({
      points: [coords],
      color: eraserMode ? '#1a1f33' : '#ffffff', 
      width: eraserMode ? 20 : 4
    });
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !currentPath) return;
    e.preventDefault(); 
    const coords = getCoordinates(e);
    if (!coords) return;
    setCurrentPath(prev => prev ? { ...prev, points: [...prev.points, coords] } : null);
  };

  const stopDrawing = () => {
    if (isDrawing && currentPath) setPaths(prev => [...prev, currentPath]);
    setIsDrawing(false);
    setCurrentPath(null);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    ctx.fillStyle = '#1a1f33';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const drawPath = (path: Path) => {
      if (path.points.length === 0) return;
      ctx.beginPath();
      ctx.strokeStyle = path.color;
      ctx.lineWidth = path.width;
      ctx.moveTo(path.points[0].x, path.points[0].y);
      for (let i = 1; i < path.points.length; i++) ctx.lineTo(path.points[i].x, path.points[i].y);
      ctx.stroke();
    };

    paths.forEach(drawPath);
    if (currentPath) drawPath(currentPath);
  }, [paths, currentPath]);

  const handleSubmit = () => {
    if (canvasRef.current) onSubmit(trimCanvas(canvasRef.current));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const preventScroll = (e: TouchEvent) => e.preventDefault();
    canvas.addEventListener('touchmove', preventScroll, { passive: false });
    return () => canvas.removeEventListener('touchmove', preventScroll);
  }, []);

  return (
    <div className="flex-col w-full h-full max-w-md">
      <div className="glass-panel text-center mb-4" style={{padding: '16px'}}>
        <h3 className={`title-giant ${timeLeft <= 10 ? 'text-primary' : ''}`} style={{fontSize: '1.5rem', marginBottom: '8px'}}>
          {timeLeft}s
        </h3>
        <p className="subtitle" style={{margin: '0', color: 'white', fontWeight: 600}}>
          "{blindHidden ? '???' : prompt}"
        </p>
      </div>

      <div style={{position: 'relative', width: '100%', aspectRatio: '3/4', borderRadius: '16px', overflow: 'hidden', border: '2px solid hsla(0,0%,100%,0.2)'}}>
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          fontSize: 'clamp(5rem, 30vw, 15rem)', fontWeight: 900, 
          color: timeLeft <= 10 ? 'hsla(320, 90%, 65%, 0.15)' : 'hsla(0,0%,100%,0.05)',
          pointerEvents: 'none', zIndex: 10, userSelect: 'none',
          transition: 'color 0.3s'
        }}>
          {timeLeft}
        </div>
        <canvas
          ref={canvasRef}
          width={600}
          height={800} 
          style={{ width: '100%', height: '100%', touchAction: 'none' }}
          onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseOut={stopDrawing}
          onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing} onTouchCancel={stopDrawing}
        />
      </div>

      <div className="flex-row justify-between mb-4 mt-4 glass-panel" style={{padding: '16px', borderRadius: '16px'}}>
        <button className={`btn-secondary ${!eraserMode ? 'text-primary' : ''}`} style={{width: 'auto', padding: '12px'}} onClick={() => setEraserMode(false)}>Pen</button>
        <button className={`btn-secondary ${eraserMode ? 'text-primary' : ''}`} style={{width: 'auto', padding: '12px'}} onClick={() => setEraserMode(true)}><Eraser size={20} /></button>
        <button className="btn-secondary" style={{width: 'auto', padding: '12px'}} onClick={() => setPaths(prev => prev.slice(0, -1))} disabled={paths.length === 0}><RotateCcw size={20} /></button>
        <button className="btn-secondary" style={{width: 'auto', padding: '12px'}} onClick={() => setPaths([])}><Trash2 size={20} /></button>
      </div>

      <button className="btn-primary" onClick={handleSubmit}>
        <Send size={24} /> Submit Art
      </button>
    </div>
  );
}
