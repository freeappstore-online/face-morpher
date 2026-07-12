import { useEffect, useRef, useState, useCallback } from "react";

type FunnyEffect =
  | "bigEyes"
  | "squish"
  | "stretch"
  | "wobble"
  | "pixelate"
  | "rainbow"
  | "alien"
  | "mirror"
  | "dogMask"
  | "heartEyes"
  | "sunglasses"
  | "clownNose"
  | "crown"
  | "fireEyes";

interface Effect {
  id: FunnyEffect;
  label: string;
  emoji: string;
}

const EFFECTS: Effect[] = [
  { id: "bigEyes",    label: "Cute Eyes",   emoji: "🥺" },
  { id: "heartEyes",  label: "Heart Eyes",  emoji: "😍" },
  { id: "sunglasses", label: "Sunglasses",  emoji: "😎" },
  { id: "dogMask",    label: "Dog",         emoji: "🐶" },
  { id: "clownNose",  label: "Clown",       emoji: "🤡" },
  { id: "crown",      label: "Crown",       emoji: "👑" },
  { id: "fireEyes",   label: "Fire Eyes",   emoji: "🔥" },
  { id: "alien",      label: "Alien",       emoji: "👽" },
  { id: "rainbow",    label: "Rainbow",     emoji: "🌈" },
  { id: "squish",     label: "Squish",      emoji: "🥞" },
  { id: "stretch",    label: "Stretch",     emoji: "🦒" },
  { id: "wobble",     label: "Wobble",      emoji: "🌊" },
  { id: "pixelate",   label: "Pixelate",    emoji: "👾" },
  { id: "mirror",     label: "Mirror",      emoji: "🪞" },
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
  const videoRef     = useRef<HTMLVideoElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef<number>(0);
  const lastTimeRef  = useRef(-1);
  const landmarksRef = useRef<Landmark[][]>([]);

  const [activeEffect, setActiveEffect] = useState<FunnyEffect>("bigEyes");
  const [cameraActive, setCameraActive]  = useState(false);
  const [modelStatus, setModelStatus]    = useState<"idle"|"loading"|"ready"|"failed">("idle");
  const [error, setError]                = useState<string | null>(null);
  const [faceCount, setFaceCount]        = useState(0);

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

      // Draw mirrored video
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
        const mirrored = landmarks.map((l) => ({ ...l, x: 1 - l.x }));
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
    modelStatus === "loading" ? "bg-yellow-400 animate-pulse" : "bg-red-400";
  const modelLabel =
    modelStatus === "ready"   ? "478-pt AI" :
    modelStatus === "loading" ? "Loading…" : "Heuristic";

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: "#000", fontFamily: "Manrope, sans-serif" }}>
      <video ref={videoRef} className="hidden" playsInline muted />

      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ objectFit: "cover", display: cameraActive ? "block" : "none" }}
      />

      {/* START SCREEN */}
      {!cameraActive && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5"
          style={{ background: "linear-gradient(135deg,#0f0c29,#302b63,#24243e)" }}>
          <div className="text-7xl">🎭</div>
          <h1 className="text-4xl font-bold text-white" style={{ fontFamily: "Fraunces, serif" }}>
            Face Morpher
          </h1>
          <p className="text-sm text-center px-10" style={{ color: "rgba(255,255,255,0.6)" }}>
            Real-time face effects powered by on-device AI
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
            style={{ background: "#2563eb" }}
          >
            {modelStatus === "loading" ? "⏳ Loading model…" : "📷 Start Camera"}
          </button>
          <a href="https://freeappstore.online" target="_blank" rel="noopener noreferrer"
            className="text-xs mt-4" style={{ color: "rgba(255,255,255,0.3)" }}>
            Part of FreeAppStore — free forever
          </a>
        </div>
      )}

      {/* LIVE OVERLAYS */}
      {cameraActive && (
        <>
          {/* Top bar */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3"
            style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)" }}>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse inline-block" />
              <span className="text-white text-xs font-bold">LIVE · {faceCount} face{faceCount !== 1 ? "s" : ""}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full inline-block ${modelDot}`} />
              <span className="text-white text-xs opacity-70">{modelLabel}</span>
            </div>
            <button
              onClick={stopCamera}
              className="text-white text-xs font-bold px-3 py-1 rounded-full"
              style={{ background: "rgba(255,255,255,0.15)" }}
            >
              ✕ Stop
            </button>
          </div>

          {/* Effect pills */}
          <div className="absolute bottom-0 left-0 right-0 px-3 pb-6 pt-10"
            style={{ background: "linear-gradient(to top, rgba(0,0,0,0.65), transparent)" }}>
            <div className="flex gap-2 overflow-x-auto pb-1"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
              {EFFECTS.map((effect) => {
                const active = activeEffect === effect.id;
                return (
                  <button
                    key={effect.id}
                    onClick={() => setActiveEffect(effect.id)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-all active:scale-95 flex-shrink-0"
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

function lmPx(landmarks: Landmark[], idx: number, vw: number, vh: number): [number, number] {
  const p = landmarks[idx] ?? { x: 0.5, y: 0.5 };
  return [p.x * vw, p.y * vh];
}

function eyeSpan(landmarks: Landmark[], leftIdx: number, rightIdx: number, vw: number): number {
  const [lx] = lmPx(landmarks, leftIdx, vw, 1);
  const [rx] = lmPx(landmarks, rightIdx, vw, 1);
  return Math.abs(rx - lx);
}

function faceBBox(landmarks: Landmark[], vw: number, vh: number) {
  const xs = landmarks.map((l) => l.x * vw);
  const ys = landmarks.map((l) => l.y * vh);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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
    case "bigEyes":    drawCuteEyes(ctx, landmarks, t, vw, vh); break;
    case "heartEyes":  drawHeartEyes(ctx, landmarks, vw, vh); break;
    case "sunglasses": drawSunglasses(ctx, landmarks, vw, vh); break;
    case "dogMask":    drawDogMask(ctx, landmarks, t, vw, vh); break;
    case "clownNose":  drawClownNose(ctx, landmarks, t, vw, vh); break;
    case "crown":      drawCrown(ctx, landmarks, t, vw, vh); break;
    case "fireEyes":   drawFireEyes(ctx, landmarks, t, vw, vh); break;
    case "alien":      applyAlien(ctx, landmarks, t, vw, vh); break;
    case "rainbow":    applyRainbow(ctx, landmarks, t, vw, vh); break;
    case "squish":     applyWarpFace(ctx, canvas, landmarks, 1.45, 0.62, vw, vh); break;
    case "stretch":    applyWarpFace(ctx, canvas, landmarks, 0.65, 1.55, vw, vh); break;
    case "wobble":     applyWobble(ctx, canvas, landmarks, t, vw, vh); break;
    case "pixelate":   applyPixelate(ctx, landmarks, vw, vh); break;
    case "mirror":     applyMirror(ctx, canvas, landmarks, vw, vh); break;
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

// ── Cute small eyes ───────────────────────────────────────────────────────
function drawCuteEyes(ctx: CanvasRenderingContext2D, landmarks: Landmark[], t: number, vw: number, vh: number) {
  const [lx, ly] = lmPx(landmarks, LM.LEFT_EYE_CENTER,  vw, vh);
  const [rx, ry] = lmPx(landmarks, LM.RIGHT_EYE_CENTER, vw, vh);
  const span = eyeSpan(landmarks, LM.LEFT_EYE_LEFT, LM.LEFT_EYE_RIGHT, vw);
  const r = span * 0.72; // smaller than before

  [[lx, ly], [rx, ry]].forEach(([ex, ey], i) => {
    const blink = Math.abs(Math.sin(t * 0.4 + i * 1.2)) > 0.96;
    ctx.save();
    if (blink) {
      // closed eye — cute line
      ctx.strokeStyle = "#222";
      ctx.lineWidth = r * 0.22;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(ex, ey, r * 0.6, Math.PI * 0.1, Math.PI * 0.9);
      ctx.stroke();
    } else {
      // Sclera
      ctx.beginPath();
      ctx.ellipse(ex, ey, r, r * 0.85, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#222";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Iris — large relative to sclera for cute look
      const irisR = r * 0.65;
      const g = ctx.createRadialGradient(ex, ey - irisR * 0.2, irisR * 0.1, ex, ey, irisR);
      g.addColorStop(0, i === 0 ? "#60a5fa" : "#a78bfa");
      g.addColorStop(1, i === 0 ? "#1d4ed8" : "#6d28d9");
      ctx.beginPath();
      ctx.ellipse(ex, ey, irisR, irisR, 0, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();

      // Pupil
      ctx.beginPath();
      ctx.ellipse(ex, ey, irisR * 0.42, irisR * 0.42, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#111";
      ctx.fill();

      // Sparkle highlights
      ctx.beginPath();
      ctx.ellipse(ex - irisR * 0.3, ey - irisR * 0.3, irisR * 0.18, irisR * 0.18, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(ex + irisR * 0.2, ey - irisR * 0.1, irisR * 0.09, irisR * 0.09, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fill();

      // Lashes — top arc dots
      for (let d = 0; d < 5; d++) {
        const angle = Math.PI + (d / 4) * Math.PI;
        const lashX = ex + Math.cos(angle) * (r + 3);
        const lashY = ey + Math.sin(angle) * (r * 0.85 + 3);
        ctx.beginPath();
        ctx.arc(lashX, lashY, 2, 0, Math.PI * 2);
        ctx.fillStyle = "#111";
        ctx.fill();
      }
    }
    ctx.restore();
  });
}

// ── Heart Eyes ────────────────────────────────────────────────────────────
function drawHeartEyes(ctx: CanvasRenderingContext2D, landmarks: Landmark[], vw: number, vh: number) {
  const [lx, ly] = lmPx(landmarks, LM.LEFT_EYE_CENTER,  vw, vh);
  const [rx, ry] = lmPx(landmarks, LM.RIGHT_EYE_CENTER, vw, vh);
  const span = eyeSpan(landmarks, LM.LEFT_EYE_LEFT, LM.LEFT_EYE_RIGHT, vw);
  const s = span * 0.9;

  [[lx, ly], [rx, ry]].forEach(([ex, ey]) => {
    ctx.save();
    ctx.translate(ex, ey);
    ctx.scale(s / 40, s / 40); // normalise to ~40px design
    ctx.fillStyle = "#ef4444";
    ctx.shadowColor = "#ef4444";
    ctx.shadowBlur = 8;
    // Heart path centred at 0,0
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.bezierCurveTo(-20, -8, -20, -20, 0, -12);
    ctx.bezierCurveTo(20, -20, 20, -8, 0, 6);
    ctx.fill();
    // Highlight
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.ellipse(-7, -10, 4, 3, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

// ── Sunglasses ────────────────────────────────────────────────────────────
function drawSunglasses(ctx: CanvasRenderingContext2D, landmarks: Landmark[], vw: number, vh: number) {
  const [lx, ly] = lmPx(landmarks, LM.LEFT_EYE_CENTER,  vw, vh);
  const [rx, ry] = lmPx(landmarks, LM.RIGHT_EYE_CENTER, vw, vh);
  const span = eyeSpan(landmarks, LM.LEFT_EYE_LEFT, LM.LEFT_EYE_RIGHT, vw);
  const lensW = span * 1.05, lensH = span * 0.72;
  const angle = Math.atan2(ry - ly, rx - lx);

  ctx.save();
  ctx.strokeStyle = "#111";
  ctx.lineWidth = span * 0.12;

  // Bridge
  ctx.beginPath();
  ctx.moveTo(lx + Math.cos(angle) * lensW * 0.5, ly + Math.sin(angle) * lensW * 0.5);
  ctx.lineTo(rx - Math.cos(angle) * lensW * 0.5, ry - Math.sin(angle) * lensW * 0.5);
  ctx.stroke();

  // Lenses
  [[lx, ly], [rx, ry]].forEach(([ex, ey]) => {
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(angle);

    // Lens fill
    ctx.beginPath();
    ctx.ellipse(0, 0, lensW * 0.5, lensH * 0.5, 0, 0, Math.PI * 2);
    const g = ctx.createLinearGradient(-lensW * 0.5, -lensH * 0.5, lensW * 0.5, lensH * 0.5);
    g.addColorStop(0, "rgba(20,20,20,0.88)");
    g.addColorStop(1, "rgba(50,30,80,0.88)");
    ctx.fillStyle = g;
    ctx.fill();

    // Rim
    ctx.beginPath();
    ctx.ellipse(0, 0, lensW * 0.5, lensH * 0.5, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = span * 0.1;
    ctx.stroke();

    // Glare
    ctx.beginPath();
    ctx.ellipse(-lensW * 0.15, -lensH * 0.18, lensW * 0.14, lensH * 0.1, -0.4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fill();
    ctx.restore();
  });

  // Arms
  const armLen = span * 1.6;
  const [flx] = lmPx(landmarks, LM.FACE_LEFT,  vw, vh);
  const [frx] = lmPx(landmarks, LM.FACE_RIGHT, vw, vh);
  ctx.lineWidth = span * 0.1;
  ctx.strokeStyle = "#111";
  ctx.beginPath();
  ctx.moveTo(lx - Math.cos(angle) * lensW * 0.5, ly - Math.sin(angle) * lensW * 0.5);
  ctx.lineTo(flx - Math.cos(angle) * armLen * 0.2, ly - Math.sin(angle) * armLen * 0.1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(rx + Math.cos(angle) * lensW * 0.5, ry + Math.sin(angle) * lensW * 0.5);
  ctx.lineTo(frx + Math.cos(angle) * armLen * 0.2, ry + Math.sin(angle) * armLen * 0.1);
  ctx.stroke();

  ctx.restore();
}

// ── Dog mask ──────────────────────────────────────────────────────────────
function drawDogMask(ctx: CanvasRenderingContext2D, landmarks: Landmark[], t: number, vw: number, vh: number) {
  const [nx, ny] = lmPx(landmarks, LM.NOSE_TIP, vw, vh);
  const [lx, ly] = lmPx(landmarks, LM.FACE_LEFT,  vw, vh);
  const [rx]     = lmPx(landmarks, LM.FACE_RIGHT, vw, vh);
  const faceW = rx - lx;
  const noseR = faceW * 0.13;

  // Dog nose
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(nx, ny, noseR, noseR * 0.72, 0, 0, Math.PI * 2);
  const ng = ctx.createRadialGradient(nx - noseR * 0.2, ny - noseR * 0.2, noseR * 0.05, nx, ny, noseR);
  ng.addColorStop(0, "#555");
  ng.addColorStop(1, "#111");
  ctx.fillStyle = ng;
  ctx.fill();
  // Highlight
  ctx.beginPath();
  ctx.ellipse(nx - noseR * 0.28, ny - noseR * 0.22, noseR * 0.22, noseR * 0.16, -0.4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.fill();
  ctx.restore();

  // Ears — top of head
  const [fx, fy] = lmPx(landmarks, LM.FOREHEAD, vw, vh);
  const earW = faceW * 0.22, earH = faceW * 0.3;
  [[-1, -0.38], [1, 0.38]].forEach(([side, xOff]) => {
    ctx.save();
    ctx.translate(fx + faceW * (xOff as number), fy - earH * 0.2);
    ctx.rotate((side as number) * 0.22);
    ctx.beginPath();
    ctx.ellipse(0, 0, earW * 0.5, earH * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#8B4513";
    ctx.fill();
    // Inner ear
    ctx.beginPath();
    ctx.ellipse(0, earH * 0.05, earW * 0.28, earH * 0.32, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#d2691e";
    ctx.fill();
    ctx.restore();
  });

  // Tongue — bounces
  const [mx, my] = lmPx(landmarks, LM.MOUTH_BOTTOM, vw, vh);
  const [, chiny] = lmPx(landmarks, LM.CHIN, vw, vh);
  const tongueH = (chiny - my) * 0.9 + Math.sin(t * 4) * faceW * 0.03;
  const tongueW = faceW * 0.14;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(mx - tongueW, my);
  ctx.quadraticCurveTo(mx - tongueW, my + tongueH, mx, my + tongueH);
  ctx.quadraticCurveTo(mx + tongueW, my + tongueH, mx + tongueW, my);
  ctx.fillStyle = "#f472b6";
  ctx.fill();
  // Line down tongue
  ctx.beginPath();
  ctx.moveTo(mx, my + tongueH * 0.2);
  ctx.lineTo(mx, my + tongueH * 0.85);
  ctx.strokeStyle = "#ec4899";
  ctx.lineWidth = tongueW * 0.22;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();

  // Whiskers
  [[lx, ly], [rx, ly]].forEach(([wx, wy], side) => {
    const dir = side === 0 ? -1 : 1;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    for (let w = 0; w < 3; w++) {
      const yOff = (w - 1) * faceW * 0.06;
      ctx.beginPath();
      ctx.moveTo(nx + dir * noseR, ny + yOff);
      ctx.lineTo(wx + dir * faceW * 0.05, wy + yOff);
      ctx.stroke();
    }
    ctx.restore();
  });
}

// ── Clown nose ────────────────────────────────────────────────────────────
function drawClownNose(ctx: CanvasRenderingContext2D, landmarks: Landmark[], t: number, vw: number, vh: number) {
  const [nx, ny] = lmPx(landmarks, LM.NOSE_TIP, vw, vh);
  const [lx] = lmPx(landmarks, LM.FACE_LEFT,  vw, vh);
  const [rx] = lmPx(landmarks, LM.FACE_RIGHT, vw, vh);
  const faceW = rx - lx;
  const r = faceW * 0.1 + Math.sin(t * 3) * faceW * 0.008;

  const g = ctx.createRadialGradient(nx - r * 0.3, ny - r * 0.3, r * 0.05, nx, ny, r);
  g.addColorStop(0, "#ff6b6b");
  g.addColorStop(0.6, "#ef4444");
  g.addColorStop(1, "#b91c1c");

  ctx.save();
  ctx.beginPath();
  ctx.arc(nx, ny, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = r * 0.4;
  ctx.fill();
  ctx.shadowBlur = 0;
  // Highlight
  ctx.beginPath();
  ctx.arc(nx - r * 0.3, ny - r * 0.3, r * 0.25, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fill();
  ctx.restore();
}

// ── Crown ─────────────────────────────────────────────────────────────────
function drawCrown(ctx: CanvasRenderingContext2D, landmarks: Landmark[], t: number, vw: number, vh: number) {
  const [lx] = lmPx(landmarks, LM.FACE_LEFT,  vw, vh);
  const [rx] = lmPx(landmarks, LM.FACE_RIGHT, vw, vh);
  const [, fy] = lmPx(landmarks, LM.FOREHEAD, vw, vh);
  const faceW = rx - lx;
  const cw = faceW * 1.05;
  const ch = faceW * 0.38;
  const cx = lx + faceW / 2 - cw / 2;
  const cy = fy - ch * 0.85 + Math.sin(t * 1.5) * faceW * 0.015;

  ctx.save();
  // Crown body
  const gold = ctx.createLinearGradient(cx, cy, cx, cy + ch);
  gold.addColorStop(0, "#fde68a");
  gold.addColorStop(0.4, "#f59e0b");
  gold.addColorStop(1, "#b45309");

  ctx.beginPath();
  ctx.moveTo(cx, cy + ch);
  ctx.lineTo(cx, cy + ch * 0.45);
  ctx.lineTo(cx + cw * 0.2, cy + ch * 0.7);
  ctx.lineTo(cx + cw * 0.35, cy);
  ctx.lineTo(cx + cw * 0.5, cy + ch * 0.55);
  ctx.lineTo(cx + cw * 0.65, cy);
  ctx.lineTo(cx + cw * 0.8, cy + ch * 0.7);
  ctx.lineTo(cx + cw, cy + ch * 0.45);
  ctx.lineTo(cx + cw, cy + ch);
  ctx.closePath();
  ctx.fillStyle = gold;
  ctx.fill();
  ctx.strokeStyle = "#92400e";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Gems
  const gems = [
    { x: cx + cw * 0.35, y: cy + ch * 0.1, c: "#ef4444" },
    { x: cx + cw * 0.5,  y: cy + ch * 0.6, c: "#3b82f6" },
    { x: cx + cw * 0.65, y: cy + ch * 0.1, c: "#10b981" },
  ];
  gems.forEach(({ x: gx, y: gy, c }) => {
    ctx.beginPath();
    ctx.arc(gx, gy, faceW * 0.038, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(gx - faceW * 0.012, gy - faceW * 0.012, faceW * 0.012, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fill();
  });
  ctx.restore();
}

// ── Fire Eyes ─────────────────────────────────────────────────────────────
function drawFireEyes(ctx: CanvasRenderingContext2D, landmarks: Landmark[], t: number, vw: number, vh: number) {
  const [lx, ly] = lmPx(landmarks, LM.LEFT_EYE_CENTER,  vw, vh);
  const [rx, ry] = lmPx(landmarks, LM.RIGHT_EYE_CENTER, vw, vh);
  const span = eyeSpan(landmarks, LM.LEFT_EYE_LEFT, LM.LEFT_EYE_RIGHT, vw);
  const r = span * 0.72;

  [[lx, ly], [rx, ry]].forEach(([ex, ey]) => {
    // Dark sclera
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ex, ey, r, r * 0.85, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#1a0000";
    ctx.fill();
    ctx.restore();

    // Flame particles
    const numFlames = 8;
    for (let f = 0; f < numFlames; f++) {
      const phase = (f / numFlames) * Math.PI * 2 + t * 4;
      const wobble = Math.sin(phase + t * 3) * r * 0.25;
      const fh = r * (0.8 + Math.sin(phase * 1.3 + t * 2) * 0.4);
      const fx2 = ex + Math.cos((f / numFlames) * Math.PI * 2) * r * 0.55 + wobble * 0.3;
      const fy2 = ey + Math.sin((f / numFlames) * Math.PI * 2) * r * 0.45;

      const fg = ctx.createRadialGradient(fx2, fy2, 0, fx2, fy2 - fh, fh);
      fg.addColorStop(0, "rgba(255,255,100,0.9)");
      fg.addColorStop(0.3, "rgba(255,140,0,0.8)");
      fg.addColorStop(0.7, "rgba(255,50,0,0.5)");
      fg.addColorStop(1, "rgba(255,0,0,0)");

      ctx.save();
      ctx.beginPath();
      ctx.ellipse(fx2, fy2 - fh * 0.3, r * 0.2, fh * 0.6, wobble * 0.02, 0, Math.PI * 2);
      ctx.fillStyle = fg;
      ctx.fill();
      ctx.restore();
    }

    // Glowing iris
    const ig = ctx.createRadialGradient(ex, ey, 0, ex, ey, r * 0.55);
    ig.addColorStop(0, "rgba(255,220,0,0.95)");
    ig.addColorStop(0.5, "rgba(255,80,0,0.8)");
    ig.addColorStop(1, "rgba(200,0,0,0.3)");
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ex, ey, r * 0.55, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fillStyle = ig;
    ctx.fill();
    // Pupil
    ctx.beginPath();
    ctx.ellipse(ex, ey, r * 0.2, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.restore();
  });
}

// ── Alien ─────────────────────────────────────────────────────────────────
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

  const [lx, ly] = lmPx(landmarks, LM.LEFT_EYE_CENTER,  vw, vh);
  const [rx, ry] = lmPx(landmarks, LM.RIGHT_EYE_CENTER, vw, vh);
  const eyeRx = eyeSpan(landmarks, LM.LEFT_EYE_LEFT, LM.LEFT_EYE_RIGHT, vw) * 1.4;
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

  const [fx, fy] = lmPx(landmarks, LM.FOREHEAD, vw, vh);
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

// ── Rainbow ───────────────────────────────────────────────────────────────
function applyRainbow(ctx: CanvasRenderingContext2D, landmarks: Landmark[], t: number, vw: number, vh: number) {
  const bb = faceBBox(landmarks, vw, vh);
  const { x, y, width: fw, height: fh } = bb;
  const hue = (t * 60) % 360;
  const grad = ctx.createLinearGradient(x, y, x+fw, y+fh);
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
    ctx.save();
    ctx.font = `${Math.max(12, fw*0.1)}px serif`;
    ctx.fillText("✨", x+fw/2 + Math.cos(angle)*fw*0.55 - fw*0.05, y+fh/2 + Math.sin(angle)*fw*0.55 + fw*0.04);
    ctx.restore();
  }
}

// ── Squish / Stretch — seamless warp ─────────────────────────────────────
function applyWarpFace(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  landmarks: Landmark[],
  scaleX: number,
  scaleY: number,
  vw: number,
  vh: number
) {
  const bb = faceBBox(landmarks, vw, vh);
  const pad = 0.18;
  const sx = Math.max(0, Math.floor(bb.x - bb.width * pad));
  const sy = Math.max(0, Math.floor(bb.y - bb.height * pad));
  const sw = Math.min(canvas.width - sx, Math.floor(bb.width * (1 + pad * 2)));
  const sh = Math.min(canvas.height - sy, Math.floor(bb.height * (1 + pad * 2)));
  if (sw <= 0 || sh <= 0) return;

  // Grab the face region
  const off = document.createElement("canvas");
  off.width = sw; off.height = sh;
  off.getContext("2d")!.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  // Destination size after scaling
  const dw = Math.round(sw * scaleX);
  const dh = Math.round(sh * scaleY);
  const dx = sx + (sw - dw) / 2;
  const dy = sy + (sh - dh) / 2;

  // Feathered mask so edges blend into the original video
  const feather = Math.min(sw, sh) * 0.22;

  ctx.save();
  // Clip to a rounded rect with feathered edge using shadow
  ctx.beginPath();
  roundRect(ctx, dx + feather, dy + feather, dw - feather * 2, dh - feather * 2, feather * 0.6);
  ctx.shadowColor = "transparent";

  // Draw scaled face
  ctx.drawImage(off, dx, dy, dw, dh);

  // Feather the edges by drawing a radial gradient mask over the seam
  const grd = ctx.createRadialGradient(
    dx + dw / 2, dy + dh / 2, Math.min(dw, dh) * 0.28,
    dx + dw / 2, dy + dh / 2, Math.min(dw, dh) * 0.52
  );
  grd.addColorStop(0, "rgba(0,0,0,0)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  ctx.restore();

  // Blend seam: overdraw the border ring with the original pixels, fading in
  const borderOff = document.createElement("canvas");
  borderOff.width = dw; borderOff.height = dh;
  const bCtx = borderOff.getContext("2d")!;
  bCtx.drawImage(canvas, dx, dy, dw, dh, 0, 0, dw, dh);

  // Mask: transparent centre, opaque at edges
  const maskGrd = bCtx.createRadialGradient(
    dw / 2, dh / 2, Math.min(dw, dh) * 0.32,
    dw / 2, dh / 2, Math.min(dw, dh) * 0.52
  );
  maskGrd.addColorStop(0, "rgba(0,0,0,1)");
  maskGrd.addColorStop(1, "rgba(0,0,0,0)");
  bCtx.globalCompositeOperation = "destination-in";
  bCtx.fillStyle = maskGrd;
  bCtx.fillRect(0, 0, dw, dh);

  ctx.save();
  ctx.globalCompositeOperation = "destination-over";
  ctx.drawImage(borderOff, dx, dy, dw, dh);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Wobble ────────────────────────────────────────────────────────────────
function applyWobble(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, landmarks: Landmark[], t: number, vw: number, vh: number) {
  const bb = faceBBox(landmarks, vw, vh);
  const pad = 0.2;
  const sx = Math.max(0, Math.floor(bb.x - bb.width * pad));
  const sy = Math.max(0, Math.floor(bb.y - bb.height * pad));
  const sw = Math.min(canvas.width - sx, Math.floor(bb.width * (1 + pad * 2)));
  const sh = Math.min(canvas.height - sy, Math.floor(bb.height * (1 + pad * 2)));
  if (sw <= 0 || sh <= 0) return;

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
      const spx = Math.min(sw-1, Math.max(0, px + ox));
      const spy = Math.min(sh-1, Math.max(0, py + oy));
      const di = (py*sw+px)*4, si = (spy*sw+spx)*4;
      dst[di]=src[si]; dst[di+1]=src[si+1]; dst[di+2]=src[si+2]; dst[di+3]=src[si+3];
    }
  }
  offCtx.putImageData(imgData, 0, 0);
  ctx.drawImage(off, sx, sy, sw, sh);
}

// ── Pixelate ──────────────────────────────────────────────────────────────
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
      const ci = (cpy*sw+cpx)*4;
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

// ── Mirror ────────────────────────────────────────────────────────────────
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
