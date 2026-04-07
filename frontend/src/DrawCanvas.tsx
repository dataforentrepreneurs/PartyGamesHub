import React, { useRef, useState, useEffect } from 'react';
import { Eraser, RotateCcw, Trash2, Send } from 'lucide-react';

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
  
  const submitFnRef = useRef(onSubmit);
  const hasSubmittedRef = useRef(hasSubmitted);

  useEffect(() => {
    submitFnRef.current = onSubmit;
    hasSubmittedRef.current = hasSubmitted;
  }, [onSubmit, hasSubmitted]);

  // Auto-submit when time runs out
  useEffect(() => {
    if (timeLeft === 0 && !hasSubmitted) {
      setHasSubmitted(true);
      if (canvasRef.current) {
          onSubmit(canvasRef.current.toDataURL('image/jpeg', 0.6));
      }
    }
  }, [timeLeft, hasSubmitted, onSubmit]);

  // Auto-submit safety net on unmount (e.g. host forced judging)
  useEffect(() => {
    return () => {
      if (!hasSubmittedRef.current && canvasRef.current) {
        submitFnRef.current(canvasRef.current.toDataURL('image/jpeg', 0.6));
      }
    };
  }, []);

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
    if (canvasRef.current) onSubmit(canvasRef.current.toDataURL('image/jpeg', 0.6));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const preventScroll = (e: TouchEvent) => e.preventDefault();
    canvas.addEventListener('touchmove', preventScroll, { passive: false });
    return () => canvas.removeEventListener('touchmove', preventScroll);
  }, []);

  return (
    <div className="no-scroll-mobile max-w-md mx-auto" style={{ gap: '12px', padding: '16px' }}>
      <div className="glass-panel text-center flex-none" style={{padding: '12px'}}>
        <h3 className={`title-giant ${timeLeft <= 10 ? 'text-primary' : ''}`} style={{fontSize: '1.25rem', marginBottom: '4px', lineHeight: 1}}>
          {timeLeft}s
        </h3>
        <p className="subtitle" style={{margin: '0', color: 'white', fontWeight: 600, fontSize: '0.95rem', lineHeight: 1.2}}>
          "{blindHidden ? '???' : prompt}"
        </p>
      </div>

      <div style={{position: 'relative', width: '100%', flex: 1, minHeight: 0, borderRadius: '16px', overflow: 'hidden', border: '2px solid hsla(0,0%,100%,0.2)'}}>
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

      <div className="flex-row justify-between flex-none glass-panel" style={{padding: '8px', borderRadius: '16px', gap: '8px'}}>
        <button className={`btn-secondary ${!eraserMode ? 'text-primary' : ''}`} style={{padding: '8px', flex: 1}} onClick={() => setEraserMode(false)}>Pen</button>
        <button className={`btn-secondary ${eraserMode ? 'text-primary' : ''}`} style={{padding: '8px', flex: 1}} onClick={() => setEraserMode(true)}><Eraser size={20} /></button>
        <button className="btn-secondary" style={{padding: '8px', flex: 1}} onClick={() => setPaths(prev => prev.slice(0, -1))} disabled={paths.length === 0}><RotateCcw size={20} /></button>
        <button className="btn-secondary" style={{padding: '8px', flex: 1}} onClick={() => setPaths([])}><Trash2 size={20} /></button>
      </div>

      <button className="btn-primary flex-none" style={{padding: '14px', fontSize: '1.2rem'}} onClick={handleSubmit}>
        <Send size={20} /> Submit Art
      </button>
    </div>
  );
}
