import { useEffect, useRef, useState, useCallback } from "react";

// ── MediaPipe types (loaded via CDN) ──────────────────────────────────────
type FunnyEffect =
  | "bigEyes"
  | "squish"
  | "stretch"
  | "wobble"
  | "pixelate"
  | "rainbow"
  | "alien"
  | "mirror";

interface Effect {
  id: FunnyEffect;
  label: string;
  emoji: string;
}

const EFFECTS: Effect[] = [
  { id: "bigEyes",  label: "Big Eyes",  emoji: "👀" },
  { id: "squish",   label: "Squish",    emoji: "🥞" },
  { id: "stretch",  label: "Stretch",   emoji: "🦒" },
  { id: "wobble",   label: "Wobble",    emoji: "🌊" },
  { id: "pixelate", label: "Pixelate",  emoji: "👾" },
  { id: "rainbow",  label: "Rainbow",   emoji: "🌈" },
  { id: "alien",    label: "Alien",     emoji: "👽" },
  { id: "mirror",   label: "Mirror",    emoji: "🪞" },
];

const LM = {
  LEFT_EYE_CENTER:  468,
  RIGHT_EYE_CENTER: 473,
  LEFT_EYE_LEFT:    33,
  LEFT_EYE_RIGHT:   133,
  RIGHT_EYE_LEFT:   362,
  RIGHT_EYE_RIGHT:  263,
  NOSE_TIP:         4,
  MOUTH_LEFT:       61,
  MOUTH_RIGHT:      291,
  MOUTH_TOP:        13,
  MOUTH_BOTTOM:     14,
  CHIN:             152,
  FOREHEAD:         10,
  FACE_LEFT:        234,
  FACE_RIGHT:       454,
};

interface Landmark { x: number; y: number; z: number; }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let faceLandmarker: any = null;
let mediaPipeReady = false;

async function loadMediaPipe(): Promise<boolean> {
  if (mediaPipeReady) return true;
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.js";
    script.onload = async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { FaceLandmarker, FilesetResolver } = window as any;
        const filesetResolver = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );
        faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU",
          },
          outputFaceBlendshapes: false,
          runningMode: "VIDEO",
          numFaces: 4,
        });
        mediaPipeReady = true;
        resolve(true);
      } catch (e) {
        console.error("MediaPipe init failed", e);
        resolve(false);
      }
    };
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

export default function App() {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const animRef     = useRef<number>(0);
  const lastTimeRef = useRef(-1);
  const landmarksRef = useRef<Landmark[][]>([]);

  const [activeEffect, setActiveEffect] = useState<FunnyEffect>("bigEyes");
  const [cameraActive, setCameraActive]  = useState(false);
  const [modelStatus, setModelStatus]    = useState<"idle"|"loading"|"ready"|"failed">("idle");
  const [error, setError]                = useState<string | null>(null);
  const [faceCount, setFaceCount]        = useState(0);

  // Load MediaPipe on mount
  useEffect(() => {
    setModelStatus("loading");
    loadMediaPipe().then((ok) => setModelStatus(ok ? "ready" : "failed"));
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
      }
    } catch {
      setError("Camera access denied. Please allow camera permissions and try again.");
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    cancelAnimationFrame(animRef.current);
    landmarksRef.current = [];
    setFaceCount(0);
  }, []);

  // Render + detection loop
  useEffect(() => {
    if (!cameraActive) return;

    const render = (timestamp: number) => {
      const video  = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) {
        animRef.current = requestAnimationFrame(render);
        return;
      }

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw === 0) { animRef.current = requestAnimationFrame(render); return; }

      canvas.width  = vw;
      canvas.height = vh;
      const ctx = canvas.getContext("2d")!;

      // Mirrored video
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(video, -vw, 0, vw, vh);
      ctx.restore();

      // MediaPipe detection
      if (faceLandmarker && video.currentTime !== lastTimeRef.current) {
        lastTimeRef.current = video.currentTime;
        try {
          const results = faceLandmarker.detectForVideo(video, timestamp);
          if (results?.faceLandmarks) {
            landmarksRef.current = results.faceLandmarks;
            setFaceCount(results.faceLandmarks.length);
          }
        } catch { /* continue */ }
      }

      const t = timestamp / 1000;
      const faces = landmarksRef.current;

      if (faces.length === 0 && !faceLandmarker) {
        applyEffectHeuristic(ctx, canvas, activeEffect, t, vw, vh);
      }

      faces.forEach((landmarks) => {
        const mirrored = landmarks.map((lm) => ({ ...lm, x: 1 - lm.x }));
        applyEffect(ctx, canvas, mirrored, activeEffect, t, vw, vh);
      });

      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [cameraActive, activeEffect]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const modelDot =
    modelStatus === "ready"   ? "bg-green-400" :
    modelStatus === "loading" ? "bg-yellow-400 animate-pulse" :
    "bg-red-400";

  const modelLabel =
    modelStatus === "ready"   ? "478-pt landmarks" :
    modelStatus === "loading" ? "Loading model…" :
    "Heuristic mode";

  return (
    // Full-viewport container, no scroll
    <div className="fixed inset-0 overflow-hidden" style={{ background: "#000", fontFamily: "Manrope, sans-serif" }}>

      {/* Hidden video source */}
      <video ref={videoRef} className="hidden" playsInline muted />

      {/* Canvas fills entire screen */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ objectFit: "cover", display: cameraActive ? "block" : "none" }}
      />

      {/* ── START SCREEN ── */}
      {!cameraActive && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5"
          style={{ background: "linear-gradient(135deg,#0f0c29,#302b63,#24243e)" }}>
          <div className="text-7xl">🎭</div>
          <h1 className="text-4xl font-bold text-white" style={{ fontFamily: "Fraunces, serif" }}>
            Face Morpher
          </h1>
          <p className="text-sm text-center px-10" style={{ color: "rgba(255,255,255,0.6)" }}>
            Real-time funny face effects powered by on-device AI
          </p>
          {error && (
            <p className="text-sm px-5 py-2 rounded-xl text-red-300"
              style={{ background: "rgba(220,38,38,0.15)" }}>
              {error}
            </p>
          )}
          <button
            onClick={startCamera}
            disabled={modelStatus === "loading"}
            className="mt-2 px-8 py-3 rounded-2xl font-bold text-white text-lg disabled:opacity-50 transition-transform hover:scale-105 active:scale-95"
            style={{ background: "var(--accent, #2563eb)" }}
          >
            {modelStatus === "loading" ? "⏳ Loading model…" : "📷 Start Camera"}
          </button>
          <a href="https://freeappstore.online" target="_blank" rel="noopener noreferrer"
            className="text-xs mt-4" style={{ color: "rgba(255,255,255,0.3)" }}>
            Part of FreeAppStore — free forever
          </a>
        </div>
      )}

      {/* ── LIVE OVERLAYS ── */}
      {cameraActive && (
        <>
          {/* Top bar */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3"
            style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.55), transparent)" }}>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse inline-block" />
              <span className="text-white text-xs font-bold">LIVE · {faceCount} face{faceCount !== 1 ? "s" : ""}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full inline-block ${modelDot}`} />
              <span className="text-white text-xs opacity-80">{modelLabel}</span>
            </div>
            <button
              onClick={stopCamera}
              className="text-white text-xs font-bold px-3 py-1 rounded-full transition-opacity hover:opacity-70"
              style={{ background: "rgba(255,255,255,0.15)" }}
            >
              ✕ Stop
            </button>
          </div>

          {/* Effect pills — bottom overlay */}
          <div className="absolute bottom-0 left-0 right-0 px-3 pb-5 pt-8"
            style={{ background: "linear-gradient(to top, rgba(0,0,0,0.65), transparent)" }}>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide justify-center flex-wrap">
              {EFFECTS.map((effect) => {
                const active = activeEffect === effect.id;
                return (
                  <button
                    key={effect.id}
                    onClick={() => setActiveEffect(effect.id)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-all active:scale-95"
                    style={{
                      background: active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.18)",
                      color:      active ? "#111" : "#fff",
                      border:     active ? "2px solid white" : "2px solid transparent",
                      backdropFilter: "blur(8px)",
                      WebkitBackdropFilter: "blur(8px)",
                    }}
                  >
                    <span>{effect.emoji}</span>
                    <span>{effect.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function lm(landmarks: Landmark[], idx: number, vw: number, vh: number): [number, number] {
  const p = landmarks[idx] ?? { x: 0.5, y: 0.5 };
  return [p.x * vw, p.y * vh];
}

function eyeRadius(landmarks: Landmark[], leftIdx: number, rightIdx: number, vw: number): number {
  const [lx] = lm(landmarks, leftIdx, vw, 1);
  const [rx] = lm(landmarks, rightIdx, vw, 1);
  return Math.abs(rx - lx) * 0.9;
}

function applyEffect(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  landmarks: Landmark[],
  effect: FunnyEffect,
  t: number,
  vw: number,
  vh: number
) {
  switch (effect) {
    case "bigEyes":  drawBigEyes(ctx, landmarks, t, vw, vh); break;
    case "squish":   distortFace(ctx, canvas, landmarks, 1.6, 0.5, vw, vh); break;
    case "stretch":  distortFace(ctx, canvas, landmarks, 0.6, 1.7, vw, vh); break;
    case "wobble":   applyWobble(ctx, canvas, landmarks, t, vw, vh); break;
    case "pixelate": applyPixelate(ctx, landmarks, vw, vh); break;
    case "rainbow":  applyRainbow(ctx, landmarks, t, vw, vh); break;
    case "alien":    applyAlien(ctx, landmarks, t, vw, vh); break;
    case "mirror":   applyMirror(ctx, canvas, landmarks, vw, vh); break;
  }
}

function applyEffectHeuristic(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  effect: FunnyEffect,
  t: number,
  vw: number,
  vh: number
) {
  const fake: Landmark[] = Array.from({ length: 478 }, (_, i) => {
    const col = i % 22, row = Math.floor(i / 22);
    return { x: 0.2 + (col / 21) * 0.6, y: 0.1 + (row / 21) * 0.7, z: 0 };
  });
  fake[LM.LEFT_EYE_CENTER]  = { x: 0.35, y: 0.38, z: 0 };
  fake[LM.RIGHT_EYE_CENTER] = { x: 0.65, y: 0.38, z: 0 };
  fake[LM.LEFT_EYE_LEFT]    = { x: 0.25, y: 0.38, z: 0 };
  fake[LM.LEFT_EYE_RIGHT]   = { x: 0.42, y: 0.38, z: 0 };
  fake[LM.RIGHT_EYE_LEFT]   = { x: 0.58, y: 0.38, z: 0 };
  fake[LM.RIGHT_EYE_RIGHT]  = { x: 0.75, y: 0.38, z: 0 };
  fake[LM.NOSE_TIP]         = { x: 0.5,  y: 0.52, z: 0 };
  fake[LM.MOUTH_LEFT]       = { x: 0.38, y: 0.65, z: 0 };
  fake[LM.MOUTH_RIGHT]      = { x: 0.62, y: 0.65, z: 0 };
  fake[LM.MOUTH_TOP]        = { x: 0.5,  y: 0.62, z: 0 };
  fake[LM.MOUTH_BOTTOM]     = { x: 0.5,  y: 0.70, z: 0 };
  fake[LM.CHIN]             = { x: 0.5,  y: 0.80, z: 0 };
  fake[LM.FOREHEAD]         = { x: 0.5,  y: 0.15, z: 0 };
  fake[LM.FACE_LEFT]        = { x: 0.18, y: 0.50, z: 0 };
  fake[LM.FACE_RIGHT]       = { x: 0.82, y: 0.50, z: 0 };
  applyEffect(ctx, canvas, fake, effect, t, vw, vh);
}

function faceBBox(landmarks: Landmark[], vw: number, vh: number) {
  const xs = landmarks.map((l) => l.x * vw);
  const ys = landmarks.map((l) => l.y * vh);
  return {
    x: Math.min(...xs), y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function drawBigEyes(ctx: CanvasRenderingContext2D, landmarks: Landmark[], t: number, vw: number, vh: number) {
  const [lx, ly] = lm(landmarks, LM.LEFT_EYE_CENTER,  vw, vh);
  const [rx, ry] = lm(landmarks, LM.RIGHT_EYE_CENTER, vw, vh);
  const lR = eyeRadius(landmarks, LM.LEFT_EYE_LEFT,  LM.LEFT_EYE_RIGHT,  vw) * 1.8;
  const rR = eyeRadius(landmarks, LM.RIGHT_EYE_LEFT, LM.RIGHT_EYE_RIGHT, vw) * 1.8;

  [[lx, ly, lR, "#3b82f6"], [rx, ry, rR, "#10b981"]].forEach(([ex, ey, er, col], i) => {
    const eyeX = ex as number, eyeY = ey as number, eyeR = er as number;
    const pupilOffset = Math.sin(t * 1.5 + i) * eyeR * 0.15;
    const irisR = eyeR * 0.58;

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(eyeX, eyeY, eyeR, eyeR * 0.88, 0, 0, Math.PI * 2);
    ctx.fillStyle = "white"; ctx.fill();
    ctx.strokeStyle = "#222"; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(eyeX + pupilOffset, eyeY + pupilOffset * 0.5, irisR, irisR, 0, 0, Math.PI * 2);
    ctx.fillStyle = col as string; ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(eyeX + pupilOffset, eyeY + pupilOffset * 0.5, irisR * 0.44, irisR * 0.44, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#111"; ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(eyeX + pupilOffset - irisR * 0.22, eyeY + pupilOffset * 0.5 - irisR * 0.22, irisR * 0.16, irisR * 0.16, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.fill();
    ctx.restore();
  });
}

function distortFace(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, landmarks: Landmark[], scaleX: number, scaleY: number, vw: number, vh: number) {
  const bb = faceBBox(landmarks, vw, vh);
  const pad = 0.15;
  const sx = Math.max(0, bb.x - bb.width * pad);
  const sy = Math.max(0, bb.y - bb.height * pad);
  const sw = Math.min(canvas.width - sx, bb.width * (1 + pad * 2));
  const sh = Math.min(canvas.height - sy, bb.height * (1 + pad * 2));

  const off = document.createElement("canvas");
  off.width = sw; off.height = sh;
  off.getContext("2d")!.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  ctx.save();
  ctx.translate(sx + sw / 2, sy + sh / 2);
  ctx.scale(scaleX, scaleY);
  ctx.drawImage(off, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();
}

function applyWobble(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, landmarks: Landmark[], t: number, vw: number, vh: number) {
  const bb = faceBBox(landmarks, vw, vh);
  const pad = 0.2;
  const sx = Math.max(0, Math.floor(bb.x - bb.width * pad));
  const sy = Math.max(0, Math.floor(bb.y - bb.height * pad));
  const sw = Math.min(canvas.width - sx, Math.floor(bb.width * (1 + pad * 2)));
  const sh = Math.min(canvas.height - sy, Math.floor(bb.height * (1 + pad * 2)));

  const off = document.createElement("canvas");
  off.width = sw; off.height = sh;
  off.getContext("2d")!.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  const offCtx = off.getContext("2d")!;
  const imgData = offCtx.getImageData(0, 0, sw, sh);
  const src = new Uint8ClampedArray(imgData.data);
  const dst = imgData.data;
  const amp = bb.width * 0.06;

  for (let py = 0; py < sh; py++) {
    for (let px = 0; px < sw; px++) {
      const ox = Math.round(amp * Math.sin((py / sh) * Math.PI * 4 + t * 5));
      const oy = Math.round(amp * 0.5 * Math.sin((px / sw) * Math.PI * 4 + t * 4));
      const spx = Math.min(sw - 1, Math.max(0, px + ox));
      const spy = Math.min(sh - 1, Math.max(0, py + oy));
      const di = (py * sw + px) * 4, si = (spy * sw + spx) * 4;
      dst[di] = src[si]; dst[di+1] = src[si+1]; dst[di+2] = src[si+2]; dst[di+3] = src[si+3];
    }
  }
  offCtx.putImageData(imgData, 0, 0);
  ctx.drawImage(off, sx, sy, sw, sh);
}

function applyPixelate(ctx: CanvasRenderingContext2D, landmarks: Landmark[], vw: number, vh: number) {
  const bb = faceBBox(landmarks, vw, vh);
  const blockSize = Math.max(8, Math.round(bb.width / 14));
  const sx = Math.max(0, Math.floor(bb.x));
  const sy = Math.max(0, Math.floor(bb.y));
  const sw = Math.min(ctx.canvas.width - sx, Math.floor(bb.width));
  const sh = Math.min(ctx.canvas.height - sy, Math.floor(bb.height));
  if (sw <= 0 || sh <= 0) return;

  const imgData = ctx.getImageData(sx, sy, sw, sh);
  const d = imgData.data;
  for (let by = 0; by < sh; by += blockSize) {
    for (let bx = 0; bx < sw; bx += blockSize) {
      const cpx = Math.min(sw-1, bx + Math.floor(blockSize/2));
      const cpy = Math.min(sh-1, by + Math.floor(blockSize/2));
      const ci = (cpy * sw + cpx) * 4;
      const r = d[ci], g = d[ci+1], b = d[ci+2];
      for (let dy = 0; dy < blockSize && by+dy < sh; dy++)
        for (let dx = 0; dx < blockSize && bx+dx < sw; dx++) {
          const i = ((by+dy)*sw+(bx+dx))*4;
          d[i]=r; d[i+1]=g; d[i+2]=b;
        }
    }
  }
  ctx.putImageData(imgData, sx, sy);
}

function applyRainbow(ctx: CanvasRenderingContext2D, landmarks: Landmark[], t: number, vw: number, vh: number) {
  const bb = faceBBox(landmarks, vw, vh);
  const { x, y, width: fw, height: fh } = bb;
  const hue = (t * 60) % 360;
  const grad = ctx.createLinearGradient(x, y, x + fw, y + fh);
  grad.addColorStop(0,    `hsla(${hue},100%,50%,0.38)`);
  grad.addColorStop(0.25, `hsla(${(hue+60)%360},100%,50%,0.38)`);
  grad.addColorStop(0.5,  `hsla(${(hue+120)%360},100%,50%,0.38)`);
  grad.addColorStop(0.75, `hsla(${(hue+240)%360},100%,50%,0.38)`);
  grad.addColorStop(1,    `hsla(${(hue+300)%360},100%,50%,0.38)`);
  ctx.save();
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(x+fw/2, y+fh/2, fw/2, fh/2, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();

  for (let i = 0; i < 6; i++) {
    const angle = (i/6)*Math.PI*2 + t*2;
    const r = fw * 0.55;
    ctx.save();
    ctx.font = `${Math.max(12, fw*0.1)}px serif`;
    ctx.fillText("✨", x+fw/2 + Math.cos(angle)*r - fw*0.05, y+fh/2 + Math.sin(angle)*r + fw*0.04);
    ctx.restore();
  }
}

function applyAlien(ctx: CanvasRenderingContext2D, landmarks: Landmark[], t: number, vw: number, vh: number) {
  const bb = faceBBox(landmarks, vw, vh);
  const { x, y, width: fw, height: fh } = bb;

  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "rgba(0,220,80,0.42)";
  ctx.beginPath();
  ctx.ellipse(x+fw/2, y+fh/2, fw/2, fh/2, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();

  const [lx, ly] = lm(landmarks, LM.LEFT_EYE_CENTER,  vw, vh);
  const [rx, ry] = lm(landmarks, LM.RIGHT_EYE_CENTER, vw, vh);
  const eyeRx = eyeRadius(landmarks, LM.LEFT_EYE_LEFT, LM.LEFT_EYE_RIGHT, vw) * 1.4;
  const eyeRy = eyeRx * 0.65;

  [[lx, ly], [rx, ry]].forEach(([ex, ey]) => {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ex, ey, eyeRx, eyeRy, -0.3, 0, Math.PI*2);
    ctx.fillStyle = "#050505"; ctx.fill();
    ctx.beginPath();
    ctx.ellipse(ex - eyeRx*0.28, ey - eyeRy*0.28, eyeRx*0.22, eyeRy*0.22, 0, 0, Math.PI*2);
    ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.fill();
    ctx.restore();
  });

  const [fx, fy] = lm(landmarks, LM.FOREHEAD, vw, vh);
  const wobble = Math.sin(t*3) * fw*0.08;
  ctx.save();
  ctx.strokeStyle = "#00dc50"; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.quadraticCurveTo(fx+wobble, fy-fh*0.2, fx+wobble*1.5, fy-fh*0.38);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(fx+wobble*1.5, fy-fh*0.38, fw*0.05, 0, Math.PI*2);
  ctx.fillStyle = "#00ff80"; ctx.fill();
  ctx.restore();
}

function applyMirror(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, landmarks: Landmark[], vw: number, vh: number) {
  const bb = faceBBox(landmarks, vw, vh);
  const pad = 0.1;
  const sx = Math.max(0, bb.x - bb.width*pad);
  const sy = Math.max(0, bb.y - bb.height*pad);
  const sw = Math.min(canvas.width-sx, bb.width*(1+pad*2));
  const sh = Math.min(canvas.height-sy, bb.height*(1+pad*2));
  const half = sw/2;

  const off = document.createElement("canvas");
  off.width = sw; off.height = sh;
  off.getContext("2d")!.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  ctx.save();
  ctx.translate(sx+sw, sy);
  ctx.scale(-1, 1);
  ctx.drawImage(off, 0, 0, half, sh, 0, 0, half, sh);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = 2;
  ctx.setLineDash([6,4]);
  ctx.beginPath();
  ctx.moveTo(sx+half, sy); ctx.lineTo(sx+half, sy+sh);
  ctx.stroke();
  ctx.restore();
}
