import React, { useRef, useState, useEffect } from 'react';
import { Eraser, RotateCcw, Trash2, Send, Paintbrush } from 'lucide-react';
import { sound } from './sound_service';

interface DrawCanvasProps {
  onSubmit: (dataUrl: string) => void;
  prompt: string;
  timeLeft: number;
  mode: string;
}

const PALETTE = [
  { name: 'Crisp White', color: '#ffffff' },
  { name: 'Neon Coral', color: '#f43f5e' },
  { name: 'Cyber Blue', color: '#38bdf8' },
  { name: 'Sunburst Gold', color: '#facc15' },
  { name: 'Emerald Mint', color: '#10b981' },
  { name: 'Electric Violet', color: '#c084fc' },
];

const SIZES = [
  { label: 'Fine', width: 3, dotSize: 5 },
  { label: 'Medium', width: 7, dotSize: 9 },
  { label: 'Bold', width: 14, dotSize: 14 },
];

export default function DrawCanvas({ onSubmit, prompt, timeLeft, mode }: DrawCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [eraserMode, setEraserMode] = useState(false);
  const [currentColor, setCurrentColor] = useState('#ffffff');
  const [brushWidth, setBrushWidth] = useState(7);
  const [blindHidden, setBlindHidden] = useState(false);
  
  type Point = { x: number; y: number };
  type Path = { points: Point[]; color: string; width: number };
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
        sound.playChime();
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
      color: eraserMode ? '#1a1f33' : currentColor, 
      width: eraserMode ? brushWidth * 3.5 : brushWidth
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
    sound.playChime();
    navigator.vibrate?.([15, 40, 15]);
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
    <div className="no-scroll-mobile max-w-md mx-auto" style={{ gap: '8px', padding: '10px 14px', height: '100%', boxSizing: 'border-box' }}>
      {/* Top Banner: Timer & Prompt */}
      <div className="glass-panel text-center flex-none" style={{ padding: '8px 12px' }}>
        <h3 className={`title-giant ${timeLeft <= 10 ? 'text-primary' : ''}`} style={{ fontSize: '1.25rem', marginBottom: '2px', lineHeight: 1 }}>
          {timeLeft}s
        </h3>
        <p className="subtitle" style={{ margin: '0', color: 'white', fontWeight: 600, fontSize: '0.95rem', lineHeight: 1.2 }}>
          "{blindHidden ? '???' : prompt}"
        </p>
      </div>

      {/* Canvas Area */}
      <div style={{ position: 'relative', width: '100%', flex: 1, minHeight: 0, borderRadius: '16px', overflow: 'hidden', border: '2px solid hsla(0,0%,100%,0.2)' }}>
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          fontSize: 'clamp(5rem, 25vw, 12rem)', fontWeight: 900, 
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
          style={{ width: '100%', height: '100%', touchAction: 'none', display: 'block' }}
          onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseOut={stopDrawing}
          onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing} onTouchCancel={stopDrawing}
        />
      </div>

      {/* Studio Toolbar */}
      <div className="glass-panel flex-none" style={{ padding: '6px 10px', borderRadius: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {/* Row 1: Tools & Brush Sizes */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
          {/* Pen / Eraser */}
          <div style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.06)', padding: '2px', borderRadius: '10px' }}>
            <button
              type="button"
              className="btn-secondary"
              style={{
                padding: '4px 8px',
                minHeight: '28px',
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                background: !eraserMode ? 'linear-gradient(135deg, #e11d48, #be185d)' : 'transparent',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                boxShadow: !eraserMode ? '0 0 10px rgba(225, 29, 72, 0.4)' : 'none'
              }}
              onClick={() => {
                setEraserMode(false);
                sound.playPop();
                navigator.vibrate?.([8]);
              }}
              aria-label="Draw Pen"
            >
              <Paintbrush size={14} />
              <span>Pen</span>
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{
                padding: '4px 8px',
                minHeight: '28px',
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                background: eraserMode ? 'linear-gradient(135deg, #475569, #334155)' : 'transparent',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                boxShadow: eraserMode ? '0 0 10px rgba(71, 85, 105, 0.5)' : 'none'
              }}
              onClick={() => {
                setEraserMode(true);
                sound.playPop();
                navigator.vibrate?.([8]);
              }}
              aria-label="Eraser"
            >
              <Eraser size={14} />
              <span>Eraser</span>
            </button>
          </div>

          {/* Brush Sizes */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '10px' }}>
            {SIZES.map(s => {
              const isSelected = brushWidth === s.width;
              return (
                <button
                  key={s.label}
                  type="button"
                  style={{
                    width: '26px',
                    height: '26px',
                    borderRadius: '50%',
                    border: isSelected ? '2px solid #38bdf8' : '1px solid rgba(255,255,255,0.2)',
                    background: isSelected ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    padding: 0
                  }}
                  onClick={() => {
                    setBrushWidth(s.width);
                    sound.playPop();
                    navigator.vibrate?.([8]);
                  }}
                  title={`${s.label} Brush (${s.width}px)`}
                >
                  <span style={{
                    width: `${s.dotSize}px`,
                    height: `${s.dotSize}px`,
                    borderRadius: '50%',
                    background: eraserMode ? '#94a3b8' : currentColor,
                    display: 'inline-block'
                  }} />
                </button>
              );
            })}
          </div>

          {/* Undo & Clear */}
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: '4px 8px', minHeight: '28px', borderRadius: '8px' }}
              onClick={() => {
                setPaths(prev => prev.slice(0, -1));
                sound.playPop();
                navigator.vibrate?.([8]);
              }}
              disabled={paths.length === 0}
              title="Undo last stroke"
            >
              <RotateCcw size={14} />
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: '4px 8px', minHeight: '28px', borderRadius: '8px' }}
              onClick={() => {
                setPaths([]);
                sound.playPop();
                navigator.vibrate?.([15]);
              }}
              disabled={paths.length === 0 && !currentPath}
              title="Clear entire canvas"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Row 2: Color Palette Swatches */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '2px 0' }}>
          {PALETTE.map(p => {
            const isSelected = !eraserMode && currentColor === p.color;
            return (
              <button
                key={p.color}
                type="button"
                onClick={() => {
                  setCurrentColor(p.color);
                  setEraserMode(false);
                  sound.playPop();
                  navigator.vibrate?.([8]);
                }}
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  background: p.color,
                  border: isSelected ? '2px solid #ffffff' : '1px solid rgba(0,0,0,0.4)',
                  boxShadow: isSelected ? `0 0 8px ${p.color}, inset 0 0 2px rgba(0,0,0,0.5)` : '0 1px 3px rgba(0,0,0,0.4)',
                  transform: isSelected ? 'scale(1.2)' : 'scale(1)',
                  transition: 'all 0.15s ease',
                  cursor: 'pointer',
                  padding: 0
                }}
                title={p.name}
                aria-label={p.name}
              />
            );
          })}
        </div>
      </div>

      {/* Submit Button */}
      <button
        className="btn-primary flex-none"
        style={{
          padding: '10px 16px',
          fontSize: '1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          borderRadius: '12px',
          fontWeight: 700
        }}
        onClick={handleSubmit}
      >
        <Send size={16} /> Submit Artwork
      </button>
    </div>
  );
}
