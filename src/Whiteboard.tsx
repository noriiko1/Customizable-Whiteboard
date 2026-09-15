import { useEffect, useRef, useState } from "react";
import "./Whiteboard.css";

type Point = { x: number; y: number };

type Tool = "draw" | "erase" | "line" | "square" | "circle" | "lasso";

type FreehandStroke = {
  kind: "freehand";
  points: Point[];
  color: string;
  size: number;
  erase: boolean;
};

type ShapeStroke = {
  kind: "line" | "square" | "circle";
  start: Point;
  end: Point;
  color: string;
  size: number;
};

type Stroke = FreehandStroke | ShapeStroke;

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

type Action = "idle" | "stroke" | "lasso-select" | "lasso-drag";
type InputMode = "keyboard" | "mouse";
type Pattern = "blank" | "grid";

const COLORS = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00", "#9c36b5"];
const CURSOR_SPEED = 450; // px/sec
const SELECTION_PADDING = 12;
const GRID_SIZE = 24;

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.strokeStyle = "#d7dbe0";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= width; x += GRID_SIZE) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
  }
  for (let y = 0; y <= height; y += GRID_SIZE) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
  }
  ctx.stroke();
}

function squareEnd(start: Point, point: Point): Point {
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  const signX = dx < 0 ? -1 : 1;
  const signY = dy < 0 ? -1 : 1;
  return { x: start.x + signX * side, y: start.y + signY * side };
}

const SNAP_ANGLE = Math.PI / 4;

function lineEnd(start: Point, point: Point): Point {
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  const distance = Math.hypot(dx, dy);
  const angle = Math.round(Math.atan2(dy, dx) / SNAP_ANGLE) * SNAP_ANGLE;
  return { x: start.x + distance * Math.cos(angle), y: start.y + distance * Math.sin(angle) };
}

function strokeBounds(stroke: Stroke): Bounds {
  const points = stroke.kind === "freehand" ? stroke.points : [stroke.start, stroke.end];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function unionBounds(boundsList: Bounds[]): Bounds | null {
  if (boundsList.length === 0) return null;
  return boundsList.reduce((acc, b) => ({
    minX: Math.min(acc.minX, b.minX),
    minY: Math.min(acc.minY, b.minY),
    maxX: Math.max(acc.maxX, b.maxX),
    maxY: Math.max(acc.maxY, b.maxY),
  }));
}

function boundsCenter(bounds: Bounds): Point {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

function pointInBounds(point: Point, bounds: Bounds, padding = 0): boolean {
  return (
    point.x >= bounds.minX - padding &&
    point.x <= bounds.maxX + padding &&
    point.y >= bounds.minY - padding &&
    point.y <= bounds.maxY + padding
  );
}

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function translateStroke(stroke: Stroke, dx: number, dy: number): Stroke {
  if (stroke.kind === "freehand") {
    return { ...stroke, points: stroke.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  }
  return {
    ...stroke,
    start: { x: stroke.start.x + dx, y: stroke.start.y + dy },
    end: { x: stroke.end.x + dx, y: stroke.end.y + dy },
  };
}

export default function Whiteboard() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inkCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const actionRef = useRef<Action>("idle");
  const canvasSizeRef = useRef({ width: 0, height: 0 });
  const cursorRef = useRef<Point>({ x: 0, y: 0 });
  const keysRef = useRef({ w: false, a: false, s: false, d: false });

  const lassoPathRef = useRef<Point[]>([]);
  const selectedIndicesRef = useRef<number[]>([]);
  const selectionBoundsRef = useRef<Bounds | null>(null);
  const dragStartRef = useRef<Point>({ x: 0, y: 0 });
  const dragOriginalRef = useRef<Stroke[]>([]);

  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(4);
  const [tool, setTool] = useState<Tool>("draw");
  const [canUndo, setCanUndo] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>("keyboard");
  const [pattern, setPattern] = useState<Pattern>("blank");

  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const sizeRef = useRef(size);
  const inputModeRef = useRef(inputMode);
  const patternRef = useRef(pattern);
  useEffect(() => {
    const previousTool = toolRef.current;
    toolRef.current = tool;
    colorRef.current = color;
    sizeRef.current = size;
    inputModeRef.current = inputMode;
    patternRef.current = pattern;

    if (previousTool === "lasso" && tool !== "lasso") {
      selectedIndicesRef.current = [];
      selectionBoundsRef.current = null;
      lassoPathRef.current = [];
      actionRef.current = "idle";
    }
  }, [tool, color, size, inputMode, pattern]);

  const redraw = () => {
    const canvas = canvasRef.current;
    const inkCanvas = inkCanvasRef.current;
    if (!canvas || !inkCanvas) return;
    const ctx = canvas.getContext("2d");
    const inkCtx = inkCanvas.getContext("2d");
    if (!ctx || !inkCtx) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    // grid drawn first so ink can render on top of it, while an eraser
    // "hole" cut into the ink layer still reveals this grid underneath
    if (patternRef.current === "grid") {
      drawGrid(ctx, canvasSizeRef.current.width, canvasSizeRef.current.height);
    }

    // build the ink layer on its own transparent canvas, using
    // destination-out for erase strokes so they cut holes instead of
    // painting white over the grid
    inkCtx.save();
    inkCtx.setTransform(1, 0, 0, 1, 0, 0);
    inkCtx.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
    inkCtx.restore();

    const allStrokes = currentStrokeRef.current
      ? [...strokesRef.current, currentStrokeRef.current]
      : strokesRef.current;

    inkCtx.lineJoin = "round";
    inkCtx.lineCap = "round";

    for (const stroke of allStrokes) {
      inkCtx.lineWidth = stroke.size;

      if (stroke.kind === "freehand") {
        if (stroke.points.length < 2) continue;
        inkCtx.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
        inkCtx.strokeStyle = stroke.erase ? "#000000" : stroke.color;
        inkCtx.beginPath();
        inkCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
          inkCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        inkCtx.stroke();
        inkCtx.globalCompositeOperation = "source-over";
        continue;
      }

      inkCtx.strokeStyle = stroke.color;

      if (stroke.kind === "line") {
        inkCtx.beginPath();
        inkCtx.moveTo(stroke.start.x, stroke.start.y);
        inkCtx.lineTo(stroke.end.x, stroke.end.y);
        inkCtx.stroke();
        continue;
      }

      const x = Math.min(stroke.start.x, stroke.end.x);
      const y = Math.min(stroke.start.y, stroke.end.y);
      const side = Math.max(Math.abs(stroke.end.x - stroke.start.x), Math.abs(stroke.end.y - stroke.start.y));

      if (stroke.kind === "square") {
        inkCtx.strokeRect(x, y, side, side);
      } else {
        inkCtx.beginPath();
        inkCtx.arc(x + side / 2, y + side / 2, side / 2, 0, Math.PI * 2);
        inkCtx.stroke();
      }
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(inkCanvas, 0, 0);
    ctx.restore();

    // lasso path while actively looping
    if (actionRef.current === "lasso-select" && lassoPathRef.current.length > 1) {
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#1971c2";
      ctx.beginPath();
      ctx.moveTo(lassoPathRef.current[0].x, lassoPathRef.current[0].y);
      for (let i = 1; i < lassoPathRef.current.length; i++) {
        ctx.lineTo(lassoPathRef.current[i].x, lassoPathRef.current[i].y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // selection bounding box
    if (selectedIndicesRef.current.length > 0 && selectionBoundsRef.current) {
      const b = selectionBoundsRef.current;
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#1971c2";
      ctx.fillStyle = "rgba(25, 113, 194, 0.08)";
      const rx = b.minX - SELECTION_PADDING;
      const ry = b.minY - SELECTION_PADDING;
      const rw = b.maxX - b.minX + SELECTION_PADDING * 2;
      const rh = b.maxY - b.minY + SELECTION_PADDING * 2;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
    }

    // draw the keyboard-controlled cursor on top
    const cursor = cursorRef.current;
    const cursorTool = toolRef.current;
    const isActive = actionRef.current !== "idle";
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, Math.max(sizeRef.current / 2, 3), 0, Math.PI * 2);
    ctx.fillStyle = cursorTool === "erase" ? "#ffffff" : cursorTool === "lasso" ? "#1971c2" : colorRef.current;
    ctx.globalAlpha = isActive ? 0.9 : 0.5;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#495057";
    ctx.globalAlpha = 1;
    ctx.stroke();
  };

  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext("2d");
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!inkCanvasRef.current) inkCanvasRef.current = document.createElement("canvas");
    const inkCanvas = inkCanvasRef.current;
    inkCanvas.width = canvas.width;
    inkCanvas.height = canvas.height;
    const inkCtx = inkCanvas.getContext("2d");
    inkCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);

    const wasEmpty = canvasSizeRef.current.width === 0 && canvasSizeRef.current.height === 0;
    canvasSizeRef.current = { width: rect.width, height: rect.height };
    if (wasEmpty) {
      cursorRef.current = { x: rect.width / 2, y: rect.height / 2 };
    } else {
      cursorRef.current = {
        x: Math.min(cursorRef.current.x, rect.width),
        y: Math.min(cursorRef.current.y, rect.height),
      };
    }
    redraw();
  };

  const startAction = () => {
    const point = { ...cursorRef.current };
    const tool = toolRef.current;

    if (tool === "lasso") {
      const bounds = selectionBoundsRef.current;
      if (selectedIndicesRef.current.length > 0 && bounds && pointInBounds(point, bounds, SELECTION_PADDING)) {
        actionRef.current = "lasso-drag";
        dragStartRef.current = point;
        dragOriginalRef.current = selectedIndicesRef.current.map((i) => strokesRef.current[i]);
      } else {
        actionRef.current = "lasso-select";
        lassoPathRef.current = [point];
        selectedIndicesRef.current = [];
        selectionBoundsRef.current = null;
      }
      return;
    }

    actionRef.current = "stroke";
    if (tool === "line" || tool === "square" || tool === "circle") {
      currentStrokeRef.current = {
        kind: tool,
        start: point,
        end: point,
        color: colorRef.current,
        size: sizeRef.current,
      };
    } else {
      currentStrokeRef.current = {
        kind: "freehand",
        points: [point],
        color: colorRef.current,
        size: tool === "erase" ? sizeRef.current * 3 : sizeRef.current,
        erase: tool === "erase",
      };
    }
  };

  const applyCursorUpdate = () => {
    const action = actionRef.current;
    if (action === "stroke" && currentStrokeRef.current) {
      const stroke = currentStrokeRef.current;
      const point = cursorRef.current;
      if (stroke.kind === "line") {
        stroke.end = lineEnd(stroke.start, point);
      } else if (stroke.kind === "square" || stroke.kind === "circle") {
        stroke.end = squareEnd(stroke.start, point);
      } else {
        stroke.points.push(point);
      }
    } else if (action === "lasso-select") {
      lassoPathRef.current.push({ ...cursorRef.current });
    } else if (action === "lasso-drag") {
      const deltaX = cursorRef.current.x - dragStartRef.current.x;
      const deltaY = cursorRef.current.y - dragStartRef.current.y;
      selectedIndicesRef.current.forEach((idx, i) => {
        strokesRef.current[idx] = translateStroke(dragOriginalRef.current[i], deltaX, deltaY);
      });
      selectionBoundsRef.current = unionBounds(
        selectedIndicesRef.current.map((idx) => strokeBounds(strokesRef.current[idx]))
      );
    }
  };

  const endAction = () => {
    const action = actionRef.current;
    if (action === "idle") return;

    if (action === "stroke") {
      const stroke = currentStrokeRef.current;
      if (stroke) {
        const isValid =
          stroke.kind === "freehand"
            ? stroke.points.length > 1
            : stroke.start.x !== stroke.end.x || stroke.start.y !== stroke.end.y;

        if (isValid) {
          strokesRef.current.push(stroke);
          setCanUndo(true);
        }
      }
      currentStrokeRef.current = null;
    } else if (action === "lasso-select") {
      const polygon = lassoPathRef.current;
      if (polygon.length >= 3) {
        const indices: number[] = [];
        strokesRef.current.forEach((s, i) => {
          if (pointInPolygon(boundsCenter(strokeBounds(s)), polygon)) indices.push(i);
        });
        selectedIndicesRef.current = indices;
        selectionBoundsRef.current = unionBounds(indices.map((i) => strokeBounds(strokesRef.current[i])));
      }
      lassoPathRef.current = [];
    }
    // lasso-drag: positions are already committed live, nothing further to do

    actionRef.current = "idle";
    redraw();
  };

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const isTypingTarget = (target: EventTarget | null) =>
      target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || inputModeRef.current !== "keyboard") return;
      const key = e.key.toLowerCase();

      if (key === "w" || key === "a" || key === "s" || key === "d") {
        keysRef.current[key] = true;
        e.preventDefault();
      } else if (key === "enter") {
        if (actionRef.current === "idle") startAction();
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || inputModeRef.current !== "keyboard") return;
      const key = e.key.toLowerCase();

      if (key === "w" || key === "a" || key === "s" || key === "d") {
        keysRef.current[key] = false;
        e.preventDefault();
      } else if (key === "enter") {
        endAction();
        e.preventDefault();
      }
    };

    const handleBlur = () => {
      keysRef.current = { w: false, a: false, s: false, d: false };
      endAction();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    let lastTime = performance.now();
    let frameId: number;

    const tick = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      const keys = keysRef.current;
      let dx = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
      let dy = (keys.s ? 1 : 0) - (keys.w ? 1 : 0);

      if (inputModeRef.current === "keyboard" && (dx !== 0 || dy !== 0)) {
        const length = Math.hypot(dx, dy);
        dx /= length;
        dy /= length;

        const { width, height } = canvasSizeRef.current;
        const cursor = cursorRef.current;
        const nextX = Math.max(0, Math.min(width, cursor.x + dx * CURSOR_SPEED * dt));
        const nextY = Math.max(0, Math.min(height, cursor.y + dy * CURSOR_SPEED * dt));
        cursorRef.current = { x: nextX, y: nextY };

        applyCursorUpdate();
      }

      redraw();
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      cancelAnimationFrame(frameId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getPointerPoint = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (inputModeRef.current !== "mouse") return;
    (e.target as Element).setPointerCapture(e.pointerId);
    cursorRef.current = getPointerPoint(e);
    if (actionRef.current === "idle") startAction();
    redraw();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (inputModeRef.current !== "mouse") return;
    cursorRef.current = getPointerPoint(e);
    if (actionRef.current !== "idle") applyCursorUpdate();
    redraw();
  };

  const handlePointerUp = () => {
    if (inputModeRef.current !== "mouse") return;
    endAction();
  };

  const handleUndo = () => {
    strokesRef.current.pop();
    setCanUndo(strokesRef.current.length > 0);
    selectedIndicesRef.current = [];
    selectionBoundsRef.current = null;
    redraw();
  };

  const handleClear = () => {
    strokesRef.current = [];
    setCanUndo(false);
    selectedIndicesRef.current = [];
    selectionBoundsRef.current = null;
    lassoPathRef.current = [];
    actionRef.current = "idle";
    redraw();
  };

  return (
    <div className="whiteboard-app">
      <div className="toolbar">
        <div className="toolbar-title">Whiteboard Tool</div>
        <div className="toolbar-groups">
        <div className="toolbar-group">
          <button
            className={tool === "draw" ? "tool active" : "tool"}
            onClick={() => setTool("draw")}
            title="Pen"
          >
            ✏️
          </button>
          <button
            className={tool === "erase" ? "tool active" : "tool"}
            onClick={() => setTool("erase")}
            title="Eraser"
          >
            🧽
          </button>
          <button
            className={tool === "line" ? "tool active" : "tool"}
            onClick={() => setTool("line")}
            title="Line"
          >
            📏
          </button>
          <button
            className={tool === "square" ? "tool active" : "tool"}
            onClick={() => setTool("square")}
            title="Square"
          >
            ▭
          </button>
          <button
            className={tool === "circle" ? "tool active" : "tool"}
            onClick={() => setTool("circle")}
            title="Circle"
          >
            ◯
          </button>
          <button
            className={tool === "lasso" ? "tool active" : "tool"}
            onClick={() => setTool("lasso")}
            title="Lasso"
          >
            ➰
          </button>
        </div>

        <div className="toolbar-group">
          {COLORS.map((c) => (
            <button
              key={c}
              className={color === c && tool !== "erase" ? "swatch active" : "swatch"}
              style={{ background: c }}
              onClick={() => {
                setColor(c);
                if (tool === "erase") setTool("draw");
              }}
              title={c}
            />
          ))}
        </div>

        <div className="toolbar-group">
          <label className="size-label">
            Size
            <input
              type="range"
              min={1}
              max={24}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="toolbar-group">
          <button className="tool" onClick={handleUndo} disabled={!canUndo}>
            Undo
          </button>
          <button className="tool" onClick={handleClear}>
            Clear
          </button>
        </div>

        <div className="toolbar-group">
          <button
            className={inputMode === "keyboard" ? "tool active" : "tool"}
            onClick={() => setInputMode("keyboard")}
            title="Keyboard control (WASD + Enter)"
          >
            ⌨️
          </button>
          <button
            className={inputMode === "mouse" ? "tool active" : "tool"}
            onClick={() => setInputMode("mouse")}
            title="Mouse / freehand control"
          >
            🖱️
          </button>
        </div>

        <div className="toolbar-group hint">
          {inputMode === "mouse"
            ? "Mouse mode · click and drag to draw"
            : tool === "lasso"
              ? "WASD to move · hold Enter to loop, then hold Enter inside the selection to drag"
              : "WASD to move · hold Enter to draw"}
        </div>
        </div>

        <div className="toolbar-pattern">
          <label className="size-label">
            Pattern
            <select value={pattern} onChange={(e) => setPattern(e.target.value as Pattern)}>
              <option value="blank">Blank</option>
              <option value="grid">Grid</option>
            </select>
          </label>
        </div>
      </div>

      <div className={`canvas-container ${inputMode === "mouse" ? "mouse-mode" : ""}`}>
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>
    </div>
  );
}
