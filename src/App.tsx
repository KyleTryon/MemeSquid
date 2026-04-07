import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { Stage, Layer, Image as KonvaImage, Text, Transformer, Line as KonvaLine } from 'react-konva';
import { Upload, Link as LinkIcon, Type, Download, Trash2, ClipboardPaste, Settings2, AlignLeft, Palette, Box, ChevronDown, Undo2, Redo2, AlignCenter, AlignRight, MoveHorizontal, MoveVertical, PenTool, MousePointer2, HelpCircle, X } from 'lucide-react';
import { TextElement, ImageElement, LineElement } from './types';

const round2 = (num: number) => Math.round(num * 100) / 100;

const App = () => {
  const [mainImage, setMainImage] = useState<ImageElement | null>(null);
  const [texts, setTexts] = useState<TextElement[]>([]);
  const [lines, setLines] = useState<LineElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  
  const [tool, setTool] = useState<'select' | 'draw'>('select');
  const [drawColor, setDrawColor] = useState('#ff0000');
  const [drawWidth, setDrawWidth] = useState(5);
  const isDrawing = useRef(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isMobilePropsOpen, setIsMobilePropsOpen] = useState(false);

  // --- History State ---
  const [past, setPast] = useState<{texts: TextElement[], mainImage: ImageElement | null, lines: LineElement[]}[]>([]);
  const [future, setFuture] = useState<{texts: TextElement[], mainImage: ImageElement | null, lines: LineElement[]}[]>([]);
  const isHistoryAction = useRef(false);
  const lastSaved = useRef({ texts, mainImage, lines });

  const stageRef = useRef<any>(null);

  // --- Image Handling Logic ---

  const handleImageLoad = useCallback((src: string) => {
    const img = new window.Image();
    img.src = src;
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      // Calculate dimensions to fit viewport roughly
      const isMobile = window.innerWidth < 768;
      const maxW = window.innerWidth * (isMobile ? 0.9 : 0.7);
      const maxH = window.innerHeight * (isMobile ? 0.6 : 0.8);
      const ratio = Math.min(maxW / img.width, maxH / img.height);
      
      setMainImage({
        id: 'bg-image',
        type: 'image',
        image: img,
        x: 0,
        y: 0,
        width: img.width * ratio,
        height: img.height * ratio
      });
    };
  }, []);

  const onFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (f) => handleImageLoad(f.target?.result as string);
      reader.readAsDataURL(file);
    }
  }, [handleImageLoad]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (file && validTypes.includes(file.type)) {
      const reader = new FileReader();
      reader.onload = (f) => handleImageLoad(f.target?.result as string);
      reader.readAsDataURL(file);
    }
  }, [handleImageLoad]);

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (validTypes.includes(items[i].type)) {
          const blob = items[i].getAsFile();
          if (blob) {
            const reader = new FileReader();
            reader.onload = (f) => handleImageLoad(f.target?.result as string);
            reader.readAsDataURL(blob);
          }
        }
      }
    }
  }, [handleImageLoad]);

  useEffect(() => {
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  // --- History Logic ---
  useEffect(() => {
    if (isHistoryAction.current) {
      isHistoryAction.current = false;
      lastSaved.current = { texts, mainImage, lines };
      return;
    }

    const timeout = setTimeout(() => {
      const textsChanged = JSON.stringify(lastSaved.current.texts) !== JSON.stringify(texts);
      const imageChanged = lastSaved.current.mainImage?.id !== mainImage?.id;
      const linesChanged = JSON.stringify(lastSaved.current.lines) !== JSON.stringify(lines);
      
      if (textsChanged || imageChanged || linesChanged) {
        setPast(p => [...p, lastSaved.current].slice(-50));
        setFuture([]);
        lastSaved.current = { texts, mainImage, lines };
      }
    }, 400);

    return () => clearTimeout(timeout);
  }, [texts, mainImage, lines]);

  const undo = useCallback(() => {
    setPast(p => {
      if (p.length === 0) return p;
      const previous = p[p.length - 1];
      const newPast = p.slice(0, -1);
      
      setFuture(f => [{ texts, mainImage, lines }, ...f]);
      isHistoryAction.current = true;
      setTexts(previous.texts);
      setMainImage(previous.mainImage);
      setLines(previous.lines);
      
      return newPast;
    });
  }, [texts, mainImage, lines]);

  const redo = useCallback(() => {
    setFuture(f => {
      if (f.length === 0) return f;
      const next = f[0];
      const newFuture = f.slice(1);
      
      setPast(p => [...p, { texts, mainImage, lines }]);
      isHistoryAction.current = true;
      setTexts(next.texts);
      setMainImage(next.mainImage);
      setLines(next.lines);
      
      return newFuture;
    });
  }, [texts, mainImage, lines]);

  const deleteSelected = useCallback(() => {
    if (selectedId) {
      setTexts(prev => prev.filter(t => t.id !== selectedId));
      setSelectedId(null);
    }
  }, [selectedId]);

  // --- Keyboard Shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, deleteSelected]);

  // --- Editor Logic ---

  const addText = useCallback(() => {
    const newText: TextElement = {
      id: `text-${Date.now()}`,
      type: 'text',
      text: 'TOP TEXT',
      x: 50,
      y: 50,
      fontSize: 40,
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: 2,
      fontFamily: 'Impact, sans-serif',
      fontWeight: 'bold',
      align: 'center',
      rotation: 0,
      shadowColor: '#000000',
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      shadowOpacity: 1,
    };
    setTexts(prev => [...prev, newText]);
    setSelectedId(newText.id);
  }, []);

  const updateText = useCallback((id: string, attrs: Partial<TextElement>) => {
    setTexts(prev => prev.map(t => t.id === id ? { ...t, ...attrs } : t));
  }, []);

  const alignTextToCanvas = useCallback((pos: string) => {
    if (!mainImage || !selectedId || !stageRef.current) return;
    const node = stageRef.current.findOne(`#${selectedId}`);
    if (node) {
      const updates: Partial<TextElement> = {};
      const padding = 20;
      const nodeW = node.width() * node.scaleX();
      const nodeH = node.height() * node.scaleY();
      const canvasW = mainImage.width;
      const canvasH = mainImage.height;

      // X alignment
      if (pos.endsWith('l')) {
        updates.x = padding;
        updates.align = 'left';
      } else if (pos.endsWith('c')) {
        updates.x = round2((canvasW - nodeW) / 2);
        updates.align = 'center';
      } else if (pos.endsWith('r')) {
        updates.x = round2(canvasW - nodeW - padding);
        updates.align = 'right';
      }

      // Y alignment
      if (pos.startsWith('t')) {
        updates.y = padding;
      } else if (pos.startsWith('m')) {
        updates.y = round2((canvasH - nodeH) / 2);
      } else if (pos.startsWith('b')) {
        updates.y = round2(canvasH - nodeH - padding);
      }

      updateText(selectedId, updates);
    }
  }, [mainImage, selectedId, updateText]);

  const handleRotationChange = useCallback((newRotation: number) => {
    if (!stageRef.current || !selectedId) return;
    const node = stageRef.current.findOne(`#${selectedId}`);
    if (node) {
      const w = node.width();
      const h = node.height();
      
      const center = node.getTransform().point({ x: w / 2, y: h / 2 });
      
      const oldRotation = node.rotation();
      node.rotation(newRotation);
      
      const newCenter = node.getTransform().point({ x: w / 2, y: h / 2 });
      node.rotation(oldRotation);
      
      const dx = center.x - newCenter.x;
      const dy = center.y - newCenter.y;
      
      updateText(selectedId, {
        rotation: newRotation,
        x: round2(node.x() + dx),
        y: round2(node.y() + dy)
      });
    }
  }, [selectedId, updateText]);

  const handleMouseDown = (e: any) => {
    if (tool === 'select') {
      if (e.target === e.target.getStage()) setSelectedId(null);
      return;
    }
    
    if (tool === 'draw') {
      isDrawing.current = true;
      const pos = e.target.getStage().getPointerPosition();
      setLines(prev => [...prev, {
        id: `line-${Date.now()}`,
        type: 'line',
        points: [pos.x, pos.y],
        color: drawColor,
        strokeWidth: drawWidth
      }]);
    }
  };

  const handleMouseMove = (e: any) => {
    if (tool !== 'draw' || !isDrawing.current) return;

    const stage = e.target.getStage();
    const point = stage.getPointerPosition();
    
    setLines(prev => {
      const newLines = [...prev];
      const lastLine = { ...newLines[newLines.length - 1] };
      
      const pts = lastLine.points;
      const lastX = pts[pts.length - 2];
      const lastY = pts[pts.length - 1];
      
      // Smoothing: only add point if distance is greater than 5px
      const dx = point.x - lastX;
      const dy = point.y - lastY;
      if (dx * dx + dy * dy >= 25) {
        lastLine.points = lastLine.points.concat([point.x, point.y]);
        newLines.splice(newLines.length - 1, 1, lastLine);
        return newLines;
      }
      return prev;
    });
  };

  const handleMouseUp = () => {
    if (tool === 'draw' && isDrawing.current) {
      isDrawing.current = false;
      // Force history save immediately on mouse up for drawing
      setPast(p => [...p, lastSaved.current].slice(-50));
      setFuture([]);
      lastSaved.current = { texts, mainImage, lines };
    }
  };

  const downloadMeme = useCallback(() => {
    setSelectedId(null);
    setTimeout(() => {
      if (stageRef.current) {
        const uri = stageRef.current.toDataURL();
        const link = document.createElement('a');
        link.download = 'meme.png';
        link.href = uri;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    }, 100);
  }, []);

  const selectedText = texts.find(t => t.id === selectedId);

  return (
    <div className="flex flex-col h-screen bg-neutral-900 text-neutral-100 font-sans">
      {/* Header */}
      <header className="border-b border-neutral-800 p-3 md:p-4 flex items-center justify-between bg-neutral-900/50 backdrop-blur-md z-20 relative">
        <h1 className="text-lg md:text-xl font-black tracking-tighter flex items-center gap-2">
          <span className="bg-yellow-400 text-black px-2 py-0.5 rounded">MEME</span> GEN
        </h1>
        
        <div className="flex items-center gap-2 md:gap-4">
          <div className="flex items-center gap-1 mr-1 md:mr-2 border-r border-neutral-800 pr-2 md:pr-6">
            <button 
              onClick={undo} 
              disabled={past.length === 0}
              className="p-1.5 md:p-2 text-neutral-400 hover:text-white disabled:opacity-30 disabled:hover:text-neutral-400 transition-colors rounded-lg hover:bg-neutral-800"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={18} className="w-4 h-4 md:w-[18px] md:h-[18px]" />
            </button>
            <button 
              onClick={redo} 
              disabled={future.length === 0}
              className="p-1.5 md:p-2 text-neutral-400 hover:text-white disabled:opacity-30 disabled:hover:text-neutral-400 transition-colors rounded-lg hover:bg-neutral-800"
              title="Redo (Ctrl+Y)"
            >
              <Redo2 size={18} className="w-4 h-4 md:w-[18px] md:h-[18px]" />
            </button>
          </div>
          <button 
            onClick={downloadMeme}
            className="flex items-center gap-1 md:gap-2 bg-yellow-400 text-black font-bold px-3 md:px-4 py-1.5 rounded-lg hover:bg-yellow-300 transition-colors text-xs md:text-sm"
          >
            <Download size={16} className="w-3.5 h-3.5 md:w-4 md:h-4" /> <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </header>

      <main className="flex flex-col md:flex-row flex-1 overflow-hidden relative">
        {/* Toolbar */}
        <aside className="w-full md:w-16 h-14 md:h-auto border-t md:border-t-0 md:border-r border-neutral-800 flex flex-row md:flex-col items-center justify-between md:justify-start py-2 md:py-4 px-4 md:px-0 bg-neutral-900 z-20 order-2 md:order-1 shrink-0">
          
          {/* Mobile About Button */}
          <button 
            onClick={() => setIsAboutOpen(true)}
            className="md:hidden p-2 text-neutral-400 hover:text-white transition-all"
            title="About"
          >
            <HelpCircle size={20} />
          </button>

          <div className="flex flex-row md:flex-col items-center gap-2 md:gap-4">
            <button 
              onClick={() => setTool('select')}
              className={`p-2 md:p-3 rounded-xl transition-all ${tool === 'select' ? 'bg-yellow-400 text-black' : 'bg-neutral-800 hover:bg-neutral-700 text-white'}`}
              title="Select Tool"
            >
              <MousePointer2 size={20} className="md:w-6 md:h-6" />
            </button>
            <button 
              onClick={() => setTool('draw')}
              className={`p-2 md:p-3 rounded-xl transition-all ${tool === 'draw' ? 'bg-yellow-400 text-black' : 'bg-neutral-800 hover:bg-neutral-700 text-white'}`}
              title="Draw Tool"
            >
              <PenTool size={20} className="md:w-6 md:h-6" />
            </button>
            <div className="w-[1px] h-6 md:w-8 md:h-[1px] bg-neutral-800 mx-1 md:my-2" />
            <button 
              onClick={addText}
              className="p-2 md:p-3 bg-neutral-800 rounded-xl hover:bg-yellow-400 hover:text-black transition-all"
              title="Add Text"
            >
              <Type size={20} className="md:w-6 md:h-6" />
            </button>
          </div>
          
          {/* Mobile Properties Toggle */}
          <button 
            onClick={() => setIsMobilePropsOpen(!isMobilePropsOpen)}
            className={`md:hidden p-2 rounded-xl transition-all ${isMobilePropsOpen ? 'bg-yellow-400 text-black' : 'bg-neutral-800 text-white'}`}
            title="Properties"
          >
            <Settings2 size={20} />
          </button>

          <div className="hidden md:block mt-auto p-3 text-neutral-500 text-[10px] text-center">
            <button 
              onClick={() => setIsAboutOpen(true)}
              className="p-2 bg-neutral-800 rounded-full hover:bg-yellow-400 hover:text-black transition-all mx-auto flex items-center justify-center"
              title="About"
            >
              <HelpCircle size={20} />
            </button>
          </div>
        </aside>

        {/* Canvas Area */}
        <section 
          className="flex-1 relative bg-[radial-gradient(#222_1px,transparent_1px)] [background-size:20px_20px] flex items-center justify-center p-4 md:p-8 overflow-auto order-1 md:order-2"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {!mainImage ? (
            <label className="flex flex-col items-center justify-center w-full max-w-2xl h-96 border-2 border-neutral-700 border-dashed rounded-2xl cursor-pointer hover:bg-neutral-800/50 hover:border-yellow-400 transition-all group">
              <div className="flex flex-col items-center justify-center pt-5 pb-6 text-neutral-500 group-hover:text-yellow-400 transition-colors">
                <Upload size={48} className="mb-4 opacity-50 group-hover:opacity-100" />
                <p className="mb-2 text-xl font-semibold">Click to upload or drag and drop</p>
                <p className="text-sm opacity-70">PNG, JPG, or WEBP</p>
                <div className="mt-6 flex items-center gap-2 text-sm bg-neutral-800 px-3 py-1.5 rounded-lg text-neutral-400">
                  <ClipboardPaste size={16} /> Or paste an image from clipboard
                </div>
              </div>
              <input type="file" className="hidden" onChange={onFileUpload} accept="image/png, image/jpeg, image/webp" />
            </label>
          ) : (
            <div className="shadow-2xl shadow-black/50 leading-[0]">
              <Stage 
                width={mainImage.width} 
                height={mainImage.height} 
                ref={stageRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <Layer>
                  <KonvaImage 
                    image={mainImage.image} 
                    width={mainImage.width} 
                    height={mainImage.height} 
                  />
                  {lines.map((line) => (
                    <KonvaLine
                      key={line.id}
                      points={line.points}
                      stroke={line.color}
                      strokeWidth={line.strokeWidth}
                      tension={0.6}
                      lineCap="round"
                      lineJoin="round"
                      globalCompositeOperation="source-over"
                    />
                  ))}
                  {texts.map((t) => (
                    <TextElementItem 
                      key={t.id} 
                      data={t} 
                      isSelected={t.id === selectedId && tool === 'select'}
                      onSelect={(id: string) => {
                        if (tool === 'select') setSelectedId(id);
                      }}
                      onChange={updateText}
                    />
                  ))}
                </Layer>
              </Stage>
            </div>
          )}
        </section>

        {/* Mobile Overlay */}
        {isMobilePropsOpen && (
          <div 
            className="md:hidden absolute inset-0 bg-black/50 z-20"
            onClick={() => setIsMobilePropsOpen(false)}
          />
        )}

        {/* Properties Panel */}
        <aside className={`absolute md:static top-0 right-0 bottom-14 md:bottom-0 w-80 md:w-80 border-l border-neutral-800 bg-neutral-900/95 backdrop-blur-xl flex flex-col shadow-2xl z-30 transition-transform duration-300 ${isMobilePropsOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'} order-3`}>
          <div className="p-4 border-b border-neutral-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Settings2 size={18} className="text-yellow-400" />
              <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-200">Properties</h2>
            </div>
            <button className="md:hidden text-neutral-400 hover:text-white p-1" onClick={() => setIsMobilePropsOpen(false)}>
              <X size={20} />
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-5">
            {tool === 'draw' ? (
              <div className="space-y-8">
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-neutral-400 mb-2">
                    <PenTool size={14} />
                    <h3 className="text-xs font-semibold uppercase tracking-wider">Draw Settings</h3>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-medium text-neutral-500 uppercase">Brush Color</label>
                      <div className="flex items-center gap-2 bg-neutral-950/50 rounded-lg border border-neutral-800 p-1 pr-3">
                        <input 
                          type="color" 
                          value={drawColor}
                          onChange={(e) => setDrawColor(e.target.value)}
                          className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent p-0"
                        />
                        <span className="text-xs text-neutral-300 uppercase font-mono">{drawColor}</span>
                      </div>
                    </div>
                    
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-medium text-neutral-500 uppercase">Brush Size</label>
                        <span className="text-[10px] text-neutral-400">{drawWidth}px</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <input 
                          type="range" 
                          min="1" max="50" step="1"
                          value={drawWidth}
                          onChange={(e) => setDrawWidth(Number(e.target.value))}
                          className="flex-1 accent-yellow-400"
                        />
                        <div className="w-10 h-10 flex items-center justify-center bg-neutral-950/50 rounded-lg border border-neutral-800">
                          <div 
                            className="rounded-full bg-yellow-400" 
                            style={{ 
                              width: `${Math.min(drawWidth, 38)}px`, 
                              height: `${Math.min(drawWidth, 38)}px`,
                              backgroundColor: drawColor
                            }} 
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : selectedText ? (
              <div className="space-y-8">
                {/* Content Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-neutral-400 mb-2">
                    <AlignLeft size={14} />
                    <h3 className="text-xs font-semibold uppercase tracking-wider">Content</h3>
                  </div>
                  <textarea 
                    value={selectedText.text}
                    onChange={(e) => updateText(selectedText.id, { text: e.target.value })}
                    className="w-full bg-neutral-950/50 rounded-xl border border-neutral-800 p-3 text-sm focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 outline-none transition-all resize-none"
                    rows={3}
                  />
                </div>

                {/* Typography Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-neutral-400 mb-2">
                    <Type size={14} />
                    <h3 className="text-xs font-semibold uppercase tracking-wider">Typography</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5 col-span-2">
                      <label className="text-[10px] font-medium text-neutral-500 uppercase">Font Family</label>
                      <div className="relative">
                        <select 
                          value={selectedText.fontFamily}
                          onChange={(e) => updateText(selectedText.id, { fontFamily: e.target.value })}
                          className="w-full bg-neutral-950/50 rounded-lg border border-neutral-800 p-2 text-sm focus:border-yellow-400 outline-none transition-all appearance-none pr-8"
                        >
                          <option value="Impact, sans-serif">Impact</option>
                          <option value="Arial, sans-serif">Arial</option>
                          <option value='"Comic Sans MS", Comic Sans, cursive'>Comic Sans</option>
                          <option value='"Times New Roman", Times, serif'>Times New Roman</option>
                          <option value='"Courier New", Courier, monospace'>Courier New</option>
                          <option value="Verdana, sans-serif">Verdana</option>
                          <option value="Georgia, serif">Georgia</option>
                          <option value='"Trebuchet MS", sans-serif'>Trebuchet MS</option>
                        </select>
                        <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-medium text-neutral-500 uppercase">Size</label>
                      <input 
                        type="number" 
                        step="1"
                        value={Math.round(selectedText.fontSize)}
                        onChange={(e) => updateText(selectedText.id, { fontSize: Number(e.target.value) })}
                        className="w-full bg-neutral-950/50 rounded-lg border border-neutral-800 p-2 text-sm focus:border-yellow-400 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-medium text-neutral-500 uppercase">Stroke</label>
                      <input 
                        type="number" 
                        step="1"
                        value={Math.round(selectedText.strokeWidth)}
                        onChange={(e) => updateText(selectedText.id, { strokeWidth: Number(e.target.value) })}
                        className="w-full bg-neutral-950/50 rounded-lg border border-neutral-800 p-2 text-sm focus:border-yellow-400 outline-none transition-all"
                      />
                    </div>
                  </div>
                </div>

                {/* Appearance Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-neutral-400 mb-2">
                    <Palette size={14} />
                    <h3 className="text-xs font-semibold uppercase tracking-wider">Colors</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-medium text-neutral-500 uppercase">Fill</label>
                      <div className="flex items-center gap-2 bg-neutral-950/50 rounded-lg border border-neutral-800 p-1 pr-3">
                        <input 
                          type="color" 
                          value={selectedText.fill}
                          onChange={(e) => updateText(selectedText.id, { fill: e.target.value })}
                          className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent p-0"
                        />
                        <span className="text-xs text-neutral-300 uppercase font-mono">{selectedText.fill}</span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-medium text-neutral-500 uppercase">Outline</label>
                      <div className="flex items-center gap-2 bg-neutral-950/50 rounded-lg border border-neutral-800 p-1 pr-3">
                        <input 
                          type="color" 
                          value={selectedText.stroke}
                          onChange={(e) => updateText(selectedText.id, { stroke: e.target.value })}
                          className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent p-0"
                        />
                        <span className="text-xs text-neutral-300 uppercase font-mono">{selectedText.stroke}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Shadow Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-neutral-400 mb-2">
                    <Box size={14} />
                    <h3 className="text-xs font-semibold uppercase tracking-wider">Shadow</h3>
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="space-y-1.5 shrink-0">
                        <label className="text-[10px] font-medium text-neutral-500 uppercase">Color</label>
                        <div className="flex items-center gap-2 bg-neutral-950/50 rounded-lg border border-neutral-800 p-1">
                          <input 
                            type="color" 
                            value={selectedText.shadowColor || '#000000'}
                            onChange={(e) => updateText(selectedText.id, { shadowColor: e.target.value })}
                            className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent p-0"
                          />
                        </div>
                      </div>
                      <div className="flex-1 space-y-3">
                        <div className="space-y-1">
                          <div className="flex justify-between">
                            <label className="text-[10px] font-medium text-neutral-500 uppercase">Blur</label>
                            <span className="text-[10px] text-neutral-400">{round2(selectedText.shadowBlur || 0)}</span>
                          </div>
                          <input 
                            type="range" 
                            min="0" max="50" step="1"
                            value={selectedText.shadowBlur || 0}
                            onChange={(e) => updateText(selectedText.id, { shadowBlur: Number(e.target.value) })}
                            className="w-full accent-yellow-400"
                          />
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between">
                            <label className="text-[10px] font-medium text-neutral-500 uppercase">Opacity</label>
                            <span className="text-[10px] text-neutral-400">{round2(selectedText.shadowOpacity ?? 1)}</span>
                          </div>
                          <input 
                            type="range" 
                            min="0" max="1" step="0.05"
                            value={selectedText.shadowOpacity ?? 1}
                            onChange={(e) => updateText(selectedText.id, { shadowOpacity: Number(e.target.value) })}
                            className="w-full accent-yellow-400"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-medium text-neutral-500 uppercase">Offset X</label>
                        <input 
                          type="number" 
                          step="1"
                          value={Math.round(selectedText.shadowOffsetX || 0)}
                          onChange={(e) => updateText(selectedText.id, { shadowOffsetX: Number(e.target.value) })}
                          className="w-full bg-neutral-950/50 rounded-lg border border-neutral-800 p-2 text-sm focus:border-yellow-400 outline-none transition-all"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-medium text-neutral-500 uppercase">Offset Y</label>
                        <input 
                          type="number" 
                          step="1"
                          value={Math.round(selectedText.shadowOffsetY || 0)}
                          onChange={(e) => updateText(selectedText.id, { shadowOffsetY: Number(e.target.value) })}
                          className="w-full bg-neutral-950/50 rounded-lg border border-neutral-800 p-2 text-sm focus:border-yellow-400 outline-none transition-all"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Layout Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-neutral-400 mb-2">
                    <Box size={14} />
                    <h3 className="text-xs font-semibold uppercase tracking-wider">Layout</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-medium text-neutral-500 uppercase">Position X</label>
                      <input 
                        type="number" 
                        step="1"
                        value={Math.round(selectedText.x)}
                        onChange={(e) => updateText(selectedText.id, { x: Number(e.target.value) })}
                        className="w-full bg-neutral-950/50 rounded-lg border border-neutral-800 p-2 text-sm focus:border-yellow-400 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-medium text-neutral-500 uppercase">Position Y</label>
                      <input 
                        type="number" 
                        step="1"
                        value={Math.round(-selectedText.y)}
                        onChange={(e) => updateText(selectedText.id, { y: -Number(e.target.value) })}
                        className="w-full bg-neutral-950/50 rounded-lg border border-neutral-800 p-2 text-sm focus:border-yellow-400 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-1.5 col-span-2">
                      <label className="text-[10px] font-medium text-neutral-500 uppercase">Align to Canvas</label>
                      <div className="relative w-16 h-16 border-2 border-neutral-700 mx-auto mt-4 mb-2">
                        {/* Top Left */}
                        <button onClick={() => alignTextToCanvas('tl')} className="absolute -top-2 -left-2 w-4 h-4 bg-neutral-800 border-2 border-neutral-500 hover:border-yellow-400 hover:bg-yellow-400 rounded-full transition-colors" title="Top Left" />
                        {/* Top Center */}
                        <button onClick={() => alignTextToCanvas('tc')} className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-neutral-800 border-2 border-neutral-500 hover:border-yellow-400 hover:bg-yellow-400 rounded-full transition-colors" title="Top Center" />
                        {/* Top Right */}
                        <button onClick={() => alignTextToCanvas('tr')} className="absolute -top-2 -right-2 w-4 h-4 bg-neutral-800 border-2 border-neutral-500 hover:border-yellow-400 hover:bg-yellow-400 rounded-full transition-colors" title="Top Right" />
                        {/* Mid Left */}
                        <button onClick={() => alignTextToCanvas('ml')} className="absolute top-1/2 -translate-y-1/2 -left-2 w-4 h-4 bg-neutral-800 border-2 border-neutral-500 hover:border-yellow-400 hover:bg-yellow-400 rounded-full transition-colors" title="Middle Left" />
                        {/* Mid Center */}
                        <button onClick={() => alignTextToCanvas('mc')} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 bg-neutral-800 border-2 border-neutral-500 hover:border-yellow-400 hover:bg-yellow-400 rounded-full transition-colors" title="Center" />
                        {/* Mid Right */}
                        <button onClick={() => alignTextToCanvas('mr')} className="absolute top-1/2 -translate-y-1/2 -right-2 w-4 h-4 bg-neutral-800 border-2 border-neutral-500 hover:border-yellow-400 hover:bg-yellow-400 rounded-full transition-colors" title="Middle Right" />
                        {/* Bottom Left */}
                        <button onClick={() => alignTextToCanvas('bl')} className="absolute -bottom-2 -left-2 w-4 h-4 bg-neutral-800 border-2 border-neutral-500 hover:border-yellow-400 hover:bg-yellow-400 rounded-full transition-colors" title="Bottom Left" />
                        {/* Bottom Center */}
                        <button onClick={() => alignTextToCanvas('bc')} className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-neutral-800 border-2 border-neutral-500 hover:border-yellow-400 hover:bg-yellow-400 rounded-full transition-colors" title="Bottom Center" />
                        {/* Bottom Right */}
                        <button onClick={() => alignTextToCanvas('br')} className="absolute -bottom-2 -right-2 w-4 h-4 bg-neutral-800 border-2 border-neutral-500 hover:border-yellow-400 hover:bg-yellow-400 rounded-full transition-colors" title="Bottom Right" />
                      </div>
                    </div>
                    <div className="space-y-1.5 col-span-2">
                      <div className="flex justify-between">
                        <label className="text-[10px] font-medium text-neutral-500 uppercase">Rotation</label>
                        <span className="text-[10px] text-neutral-400">{round2(selectedText.rotation || 0)}°</span>
                      </div>
                      <input 
                        type="range" 
                        min="-180" max="180" step="1"
                        value={selectedText.rotation || 0}
                        onChange={(e) => handleRotationChange(Number(e.target.value))}
                        className="w-full accent-yellow-400"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-neutral-800/50">
                  <button 
                    onClick={deleteSelected}
                    className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30 transition-all font-medium text-sm"
                  >
                    <Trash2 size={16} /> Delete Element
                  </button>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-neutral-500 space-y-4 opacity-50">
                <Settings2 size={48} strokeWidth={1} />
                <p className="text-sm text-center">Select an element on the canvas<br/>to edit its properties</p>
              </div>
            )}
          </div>
        </aside>
      </main>

      {/* About Modal */}
      {isAboutOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl relative">
            <button 
              onClick={() => setIsAboutOpen(false)}
              className="absolute top-4 right-4 text-neutral-500 hover:text-white transition-colors"
            >
              <X size={20} />
            </button>
            <h2 className="text-xl font-bold text-white mb-4">About</h2>
            <div className="space-y-4 text-neutral-300 text-sm">
              <p>
                Vibe Coded with <a href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer" className="text-yellow-400 hover:underline">Google AI Studio</a> using Gemini 3.1 Pro.
              </p>
              <div className="pt-4 border-t border-neutral-800 space-y-3">
                <a 
                  href="https://github.com/KyleTryon/Gemini-Meme-Generator" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors"
                >
                  <LinkIcon size={16} /> GitHub Repository
                </a>
                <a 
                  href="https://x.com/TechSquidTV" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors"
                >
                  <LinkIcon size={16} /> @TechSquidTV
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- Sub-component for individual text nodes ---

const TextElementItem = memo(({ data, isSelected, onSelect, onChange }: any) => {
  const shapeRef = useRef<any>(null);
  const trRef = useRef<any>(null);
  const dragStartPos = useRef<{ x: number, y: number } | null>(null);
  const lockedAxis = useRef<'x' | 'y' | null>(null);

  useEffect(() => {
    if (isSelected) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer().batchDraw();
    }
  }, [isSelected]);

  const handleDragStart = (e: any) => {
    dragStartPos.current = { x: e.target.x(), y: e.target.y() };
    lockedAxis.current = null;
  };

  const handleDragMove = (e: any) => {
    if (e.evt.shiftKey && dragStartPos.current) {
      if (!lockedAxis.current) {
        const dx = Math.abs(e.target.x() - dragStartPos.current.x);
        const dy = Math.abs(e.target.y() - dragStartPos.current.y);
        if (dx > dy) {
          lockedAxis.current = 'x'; // Moving horizontally, lock Y
        } else if (dy > dx) {
          lockedAxis.current = 'y'; // Moving vertically, lock X
        }
      }

      if (lockedAxis.current === 'x') {
        e.target.y(dragStartPos.current.y);
      } else if (lockedAxis.current === 'y') {
        e.target.x(dragStartPos.current.x);
      }
    } else {
      lockedAxis.current = null;
    }
  };

  return (
    <React.Fragment>
      <Text
        ref={shapeRef}
        {...data}
        draggable
        onClick={() => onSelect(data.id)}
        onTap={() => onSelect(data.id)}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={(e) => {
          onChange(data.id, {
            x: round2(e.target.x()),
            y: round2(e.target.y()),
          });
        }}
        onTransformEnd={() => {
          const node = shapeRef.current;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          onChange(data.id, {
            x: round2(node.x()),
            y: round2(node.y()),
            fontSize: round2(Math.max(5, node.fontSize() * scaleY)),
            width: round2(node.width() * scaleX),
            strokeWidth: round2(node.strokeWidth() * scaleY),
            rotation: round2(node.rotation()),
          });
        }}
      />
      {isSelected && (
        <Transformer
          ref={trRef}
          boundBoxFunc={(oldBox, newBox) => {
            newBox.width = Math.max(30, newBox.width);
            return newBox;
          }}
        />
      )}
    </React.Fragment>
  );
});

export default App;
