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

interface Effect { id: FunnyEffect; label: string; emoji: string; }

const EFFECTS: Effect[] = [
  { id: "bigEyes",    label: "Cute Eyes",  emoji: "🥺" },
  { id: "heartEyes",  label: "Heart Eyes", emoji: "😍" },
  { id: "sunglasses", label: "Sunglasses", emoji: "😎" },
  { id: "dogMask",    label: "Dog",        emoji: "🐶" },
  { id: "clownNose",  label: "Clown",      emoji: "🤡" },
  { id: "crown",      label: "Crown",      emoji: "👑" },
  { id: "fireEyes",   label: "Fire Eyes",  emoji: "🔥" },
  { id: "alien",      label: "Alien",      emoji: "👽" },
  { id: "rainbow",    label: "Rainbow",    emoji: "🌈" },
  { id: "squish",     label: "Squish",     emoji: "🥞" },
  { id: "stretch",    label: "Stretch",    emoji: "🦒" },
  { id: "wobble",     label: "Wobble",     emoji: "🌊" },
  { id: "pixelate",   label: "Pixelate",   emoji: "👾" },
  { id: "mirror",     label: "Mirror",     emoji: "🪞" },
];

// Safe landmark indices that exist in the standard 468-point model
// (indices 468–477 are iris points — only present when iris tracking is on)
const LM = {
  // Eyes — using mesh points, not iris points
  LEFT_EYE_LEFT:    33,
  LEFT_EYE_RIGHT:   133,
  LEFT_EYE_TOP:     159,
  LEFT_EYE_BOTTOM:  145,
  RIGHT_EYE_LEFT:   362,
  RIGHT_EYE_RIGHT:  263,
  RIGHT_EYE_TOP:    386,
  RIGHT_EYE_BOTTOM: 374,
  // Face structure
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
  const videoRef      = useRef<HTMLVideoElement>(null);
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const animRef       = useRef<number>(0);
  const lastTimeRef   = useRef(-1);
  const landmarksRef  = useRef<Landmark[][]>([]);
  const effectRef     = useRef<FunnyEffect>("bigEyes");

  const [activeEffect, setActiveEffect] = useState<FunnyEffect>("bigEyes");
  const [cameraActive, setCameraActive]  = useState(false);
  const [modelStatus, setModelStatus]    = useState<"idle"|"loading"|"ready"|"failed">("idle");
  const [error, setError]                = useState<string | null>(null);
  const [faceCount, setFaceCount]        = useState(0);

  // Keep effectRef in sync so the render loop always has the latest value
  useEffect(() => { effectRef.current = activeEffect; }, [activeEffect]);

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
      if (vw === 0 || vh === 0) { animRef.current = requestAnimationFrame(render); return; }

      canvas.width  = vw;
      canvas.height = vh;
      const ctx = canvas.getContext("2d")!;

      // ── Draw mirrored video ──
      // We flip horizontally so it acts like a mirror (selfie view)
      ctx.save();
      ctx.translate(vw, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, vw, vh);
      ctx.restore();

      // ── Run MediaPipe detection on the ORIGINAL (unmirrored) video frame ──
      // Landmark x coords from MediaPipe are in [0,1] relative to the original video.
      // Because we drew the video mirrored, we flip x: mirroredX = 1 - landmarkX
      // That maps correctly onto the mirrored canvas.
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
      const effect = effectRef.current;
      const faces = landmarksRef.current;

      if (faces.length > 0) {
        faces.forEach((raw) => {
          // Mirror the x coordinates to match the mirrored canvas draw
          const landmarks: Landmark[] = raw.map((l: Landmark) => ({
            x: 1 - l.x,
            y: l.y,
            z: l.z,
          }));
          applyEffect(ctx, canvas, landmarks, effect, t, vw, vh);
        });
      } else {
        // Heuristic fallback — always draw something so user sees the effect
        applyEffectHeuristic(ctx, canvas, effect, t, vw, vh);
      }

      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [cameraActive]); // intentionally NOT including activeEffect — we use effectRef

  useEffect(() => () => stopCamera(), [stopCamera]);

  const modelDot =
    modelStatus === "ready"   ? "bg-green-400" :
    modelStatus === "loading" ? "bg-yellow-400 animate-pulse" : "bg-red-400";
  const modelLabel =
    modelStatus === "ready"   ? "AI active" :
    modelStatus === "loading" ? "Loading…"  : "Heuristic";

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
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3"
            style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)" }}>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse inline-block" />
              <span className="text-white text-xs font-bold">
                LIVE · {faceCount} face{faceCount !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full inline-block ${modelDot}`} />
              <span className="text-white text-xs opacity-70">{modelLabel}</span>
            </div>
            <button onClick={stopCamera}
              className="text-white text-xs font-bold px-3 py-1 rounded-full"
              style={{ background: "rgba(255,255,255,0.15)" }}>
              ✕ Stop
            </button>
          </div>

          <div className="absolute bottom-0 left-0 right-0 px-3 pb-6 pt-10"
            style={{ background: "linear-gradient(to top, rgba(0,0,0,0.65), transparent)" }}>
            <div className="flex gap-2 overflow-x-auto pb-1 flex-nowrap"
              style={{ scrollbarWidth: "none" }}>
              {EFFECTS.map((effect) => {
                const active = activeEffect === effect.id;
                return (
                  <button key={effect.id}
                    onClick={() => setActiveEffect(effect.id)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-all active:scale-95 flex-shrink-0"
                    style={{
                      background: active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.18)",
                      color:      active ? "#111" : "#fff",
                      border:     active ? "2px solid white" : "2px solid transparent",
                      backdropFilter: "blur(8px)",
                      WebkitBackdropFilter: "blur(8px)",
                    }}>
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
// Core helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Convert a normalised landmark to canvas pixels */
function px(lm: Landmark, vw: number, vh: number): [number, number] {
  return [lm.x * vw, lm.y * vh];
}

/** Get a landmark safely (falls back to centre if index missing) */
function getLM(landmarks: Landmark[], idx: number): Landmark {
  return landmarks[idx] ?? { x: 0.5, y: 0.5, z: 0 };
}

/** Midpoint between two landmarks in pixel space */
function midPx(a: Landmark, b: Landmark, vw: number, vh: number): [number, number] {
  return [((a.x + b.x) / 2) * vw, ((a.y + b.y) / 2) * vh];
}

/** Eye centre from corner landmarks */
function eyeCentre(landmarks: Landmark[], leftIdx: number, rightIdx: number, vw: number, vh: number): [number, number] {
  return midPx(getLM(landmarks, leftIdx), getLM(landmarks, rightIdx), vw, vh);
}

/** Half-width of eye in pixels */
function eyeHalfWidth(landmarks: Landmark[], leftIdx: number, rightIdx: number, vw: number): number {
  const lx = getLM(landmarks, leftIdx).x * vw;
  const rx = getLM(landmarks, rightIdx).x * vw;
  return Math.abs(rx - lx) / 2;
}

function faceBBox(landmarks: Landmark[], vw: number, vh: number) {
  const xs = landmarks.map((l) => l.x * vw);
  const ys = landmarks.map((l) => l.y * vh);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY,
           cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

// ═══════════════════════════════════════════════════════════════════════════
// Effect dispatcher
// ═══════════════════════════════════════════════════════════════════════════

function applyEffect(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  landmarks: Landmark[],
  effect: FunnyEffect,
  t: number,
  vw: number,
  vh: number,
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

/** Heuristic landmarks for when MediaPipe hasn't detected a face yet */
function applyEffectHeuristic(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  effect: FunnyEffect,
  t: number,
  vw: number,
  vh: number,
) {
  // Build a fake 478-landmark array centred in the frame
  const fake: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const set = (i: number, x: number, y: number) => { fake[i] = { x, y, z: 0 }; };

  set(LM.LEFT_EYE_LEFT,    0.34, 0.40); set(LM.LEFT_EYE_RIGHT,   0.43, 0.40);
  set(LM.LEFT_EYE_TOP,     0.38, 0.37); set(LM.LEFT_EYE_BOTTOM,  0.38, 0.43);
  set(LM.RIGHT_EYE_LEFT,   0.57, 0.40); set(LM.RIGHT_EYE_RIGHT,  0.66, 0.40);
  set(LM.RIGHT_EYE_TOP,    0.62, 0.37); set(LM.RIGHT_EYE_BOTTOM, 0.62, 0.43);
  set(LM.NOSE_TIP,         0.50, 0.54);
  set(LM.MOUTH_LEFT,       0.40, 0.66); set(LM.MOUTH_RIGHT,      0.60, 0.66);
  set(LM.MOUTH_TOP,        0.50, 0.63); set(LM.MOUTH_BOTTOM,     0.50, 0.70);
  set(LM.CHIN,             0.50, 0.80);
  set(LM.FOREHEAD,         0.50, 0.22);
  set(LM.FACE_LEFT,        0.22, 0.52); set(LM.FACE_RIGHT,       0.78, 0.52);

  applyEffect(ctx, canvas, fake, effect, t, vw, vh);
}

// ═══════════════════════════════════════════════════════════════════════════
// Individual effects
// ═══════════════════════════════════════════════════════════════════════════

// ── Cute Eyes ─────────────────────────────────────────────────────────────
function drawCuteEyes(ctx: CanvasRenderingContext2D, landmarks: Landmark[], t: number, vw: number, vh: number) {
  const eyes = [
    { cx: eyeCentre(landmarks, LM.LEFT_EYE_LEFT,  LM.LEFT_EYE_RIGHT,  vw, vh),
      hw: eyeHalfWidth(landmarks, LM.LEFT_EYE_LEFT,  LM.LEFT_EYE_RIGHT,  vw), color: "#3b82f6" },
    { cx: eyeCentre(landmarks, LM.RIGHT_EYE_LEFT, LM.RIGHT_EYE_RIGHT, vw, vh),
      hw: eyeHalfWidth(landmarks, LM.RIGHT_EYE_LEFT, LM.RIGHT_EYE_RIGHT, vw), color: "#a78bfa" },
  ];

  eyes.forEach(({ cx: [ex, ey], hw, color }, i) => {
    const r = hw * 1.3; // slightly larger than the real eye
    const blink = Math.abs(Math.sin(t * 0.4 + i * 1.2)) > 0.96;

    ctx.save();
    if (blink) {
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = r * 0.22;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(ex, ey, r * 0.6, Math.PI * 0.1, Math.PI * 0.9);
      ctx.stroke();
    } else {
      // Sclera
      ctx.beginPath();
      ctx.ellipse(ex, ey, r, r * 0.88, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Iris
      const irisR = r * 0.64;
      const g = ctx.createRadialGradient(ex, ey - irisR * 0.2, irisR * 0.1, ex, ey, irisR);
      g.addColorStop(0, color === "#3b82f6" ? "#93c5fd" : "#c4b5fd");
      g.addColorStop(1, color);
      ctx.beginPath();
      ctx.ellipse(ex, ey, irisR, irisR, 0, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();

      // Pupil
      ctx.beginPath();
      ctx.ellipse(ex, ey, irisR * 0.42, irisR * 0.42, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#111";
      ctx.fill();

      // Sparkles
      ctx.beginPath();
      ctx.ellipse(ex - irisR * 0.28, ey - irisR * 0.28, irisR * 0.18, irisR * 0.18, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(ex + irisR * 0.18, ey - irisR * 0.1, irisR * 0.09, irisR * 0.09, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fill();
    }
    ctx.restore();
  });
}

// ── Heart Eyes ────────────────────────────────────────────────────────────
function drawHeartEyes(ctx: CanvasRenderingContext2D, landmarks: Landmark[], vw: number, vh: number) {
  const eyes = [
    eyeCentre(landmarks, LM.LEFT_EYE_LEFT,  LM.LEFT_EYE_RIGHT,  vw, vh),
    eyeCentre(landmarks, LM.RIGHT_EYE_LEFT, LM.RIGHT_EYE_RIGHT, vw, vh),
  ];
  const hw = eyeHalfWidth(landmarks, LM.LEFT_EYE_LEFT, LM.LEFT_EYE_RIGHT, vw);
  const s = hw * 1.8;

  eyes.forEach(([ex, ey]) => {
    ctx.save();
    ctx.translate(ex, ey);
    const scale = s / 22;
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ef4444";
    ctx.shadowColor = "#ef4444";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.bezierCurveTo(-20, -8, -20, -22, 0, -12);
    ctx.bezierCurveTo(20, -22, 20, -8, 0, 6);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.beginPath();
    ctx.ellipse(-7, -12, 4, 3, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

// ── Sunglasses ────────────────────────────────────────────────────────────
function drawSunglasses(ctx: CanvasRenderingContext2D, landmarks: Landmark[], vw: number, vh: number) {
  const [lx, ly] = eyeCentre(landmarks, LM.LEFT_EYE_LEFT,  LM.LEFT_EYE_RIGHT,  vw, vh);
  const [rx, ry] = eyeCentre(landmarks, LM.RIGHT_EYE_LEFT, LM.RIGHT_EYE_RIGHT, vw, vh);
  const lhw = eyeHalfWidth(landmarks, LM.LEFT_EYE_LEFT,  LM.LEFT_EYE_RIGHT,  vw);
  const rhw = eyeHalfWidth(landmarks, LM.RIGHT_EYE_LEFT, LM.RIGHT_EYE_RIGHT, vw);
  const lensW = lhw * 2.2;
  const lensH = lhw * 1.4;
  const angle = Math.atan2(ry - ly, rx - lx);
  const rimW = lhw * 0.18;

  ctx.save();

  // Bridge between lenses
  ctx.strokeStyle = "#111";
  ctx.lineWidth = rimW;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(lx + Math.cos(angle) * lensW * 0.55, ly + Math.sin(angle) * lensW * 0.55);
  ctx.lineTo(rx - Math.cos(angle) * rhw * 2.2 * 0.55, ry - Math.sin(angle) * rhw * 2.2 * 0.55);
  ctx.stroke();

  // Left lens
  ctx.save();
  ctx.translate(lx, ly);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.ellipse(0, 0, lensW * 0.55, lensH * 0.55, 0, 0, Math.PI * 2);
  const g1 = ctx.createLinearGradient(-lensW * 0.5, -lensH * 0.5, lensW * 0.5, lensH * 0.5);
  g1.addColorStop(0, "rgba(10,10,30,0.92)");
  g1.addColorStop(1, "rgba(40,20,70,0.92)");
  ctx.fillStyle = g1;
  ctx.fill();
  ctx.strokeStyle = "#111"; ctx.lineWidth = rimW; ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.ellipse(-lensW * 0.14, -lensH * 0.16, lensW * 0.16, lensH * 0.1, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Right lens
  const rlensW = rhw * 2.2;
  const rlensH = rhw * 1.4;
  ctx.save();
  ctx.translate(rx, ry);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.ellipse(0, 0, rlensW * 0.55, rlensH * 0.55, 0, 0, Math.PI * 2);
  const g2 = ctx.createLinearGradient(-rlensW * 0.5, -rlensH * 0.5, rlensW * 0.5, rlensH * 0.5);
  g2.addColorStop(0, "rgba(10,10,30,0.92)");
  g2.addColorStop(1, "rgba(40,20,70,0.92)");
  ctx.fillStyle = g2;
  ctx.fill();
  ctx.strokeStyle = "#111"; ctx.lineWidth = rimW; ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.ellipse(-rlensW * 0.14, -rlensH * 0.16, rlensW * 0.16, rlensH * 0.1, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Arms (temples)
  const [flx, fly] = px(getLM(landmarks, LM.FACE_LEFT),  vw, vh);
  const [frx, fry] = px(getLM(landmarks, LM.FACE_RIGHT), vw, vh);
  ctx.lineWidth = rimW * 0.8;
  ctx.strokeStyle = "#222";
  ctx.beginPath();
  ctx.moveTo(lx - Math.cos(angle) * lensW * 0.55, ly - Math.sin(angle) * lensW * 0.55);
  ctx.lineTo(flx, fly);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(rx + Math.cos(angle) * rlensW * 0.55, ry + Math.sin(angle) * rlensW * 0.55);
  ctx.lineTo(frx, fry);
  ctx.stroke();

  ctx.restore();
}

// ── Dog Mask ──────────────────────────────────────────────────────────────
function drawDogMask(ctx: CanvasRenderingContext2D, landmarks: Landmark[], t: number, vw: number, vh: number) {
  const [nx, ny] = px(getLM(landmarks, LM.NOSE_TIP), vw, vh);
  const [flx]    = px(getLM(landmarks, LM.FACE_LEFT),  vw, vh);
  const [frx]    = px(getLM(landmarks, LM.FACE_RIGHT), vw, vh);
  const faceW    = frx - flx;
  const noseR    = faceW * 0.11;

  // Dog nose
  ctx.save();
  const ng = ctx.createRadialGradient(nx - noseR * 0.25, ny - noseR * 0.25, noseR * 0.05, nx, ny, noseR);
  ng.addColorStop(0, "#555"); ng.addColorStop(1, "#111");
  ctx.beginPath();
  ctx.ellipse(nx, ny, noseR, noseR * 0.72, 0, 0, Math.PI * 2);
  ctx.fillStyle = ng; ctx.fill();
  ctx.beginPath();
  ctx.ellipse(nx - noseR * 0.28, ny - noseR * 0.25, noseR * 0.22, noseR * 0.16, -0.4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.fill();
  ctx.restore();

  // Ears
  const [fx, fy] = px(getLM(landmarks, LM.FOREHEAD), vw, vh);
  const earW = faceW * 0.22, earH = faceW * 0.32;
  [[-1, -0.36], [1, 0.36]].forEach(([side, xOff]) => {
    ctx.save();
    ctx.translate(fx + faceW * (xOff as number), fy - earH * 0.15);
    ctx.rotate((side as number) * 0.2);
    ctx.beginPath();
    ctx.ellipse(0, 0, earW * 0.5, earH * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#8B4513"; ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, earH * 0.06, earW * 0.28, earH * 0.32, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#d2691e"; ctx.fill();
    ctx.restore();
  });

  // Tongue
  const [mx, my] = px(getLM(landmarks, LM.MOUTH_BOTTOM), vw, vh);
  const [, chiny] = px(getLM(landmarks, LM.CHIN), vw, vh);
  const tongueH = (chiny - my) * 0.85 + Math.sin(t * 4) * faceW * 0.025;
  const tongueW = faceW * 0.12;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(mx - tongueW, my);
  ctx.quadraticCurveTo(mx - tongueW, my + tongueH, mx, my + tongueH);
  ctx.quadraticCurveTo(mx + tongueW, my + tongueH, mx + tongueW, my);
  ctx.fillStyle = "#f472b6"; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(mx, my + tongueH * 0.2);
  ctx.lineTo(mx, my + tongueH * 0.85);
  ctx.strokeStyle = "#ec4899"; ctx.lineWidth = tongueW * 0.22; ctx.lineCap = "round"; ctx.stroke();
  ctx.restore();

  // Whiskers
  [[flx, ny], [frx, ny]].forEach(([wx, wy], side) => {
    const dir = side === 0 ? -1 : 1;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.75)"; ctx.lineWidth = 1.5; ctx.lineCap = "round";
    for (let w = 0; w < 3; w++) {
      const yOff = (w - 1) * faceW * 0.055;
      ctx.beginPath();
      ctx.moveTo(nx + dir * noseR * 1.1, ny + yOff);
      ctx.lineTo((wx as number) + dir * faceW * 0.04, (wy as number) + yOff);
      ctx.stroke();
    }
    ctx.restore();
  });
}

// ── Clown Nose ────────────────────────────────────────────────────────────
function drawClownNose(ctx: CanvasRenderingContext2D, landmarks: Landmark[], t: number, vw: number, vh: number) {
  const [nx, ny] = px(getLM(landmarks, LM.NOSE_TIP), vw, vh);
  const [flx]    = px(getLM(landmarks, LM.FACE_LEFT),  vw, vh);
  const [frx]    = px(getLM(landmarks, LM.FACE_RIGHT), vw, vh);
  const faceW    = frx - flx;
  const r        = faceW * 0.1 + Math.sin(t * 3) * faceW * 0.007;

  const g = ctx.createRadialGradient(nx - r * 0.3, ny - r * 0.3, r * 0.05, nx, ny, r);
  g.addColorStop(0, "#ff6b6b");
  g.addColorStop(0.6, "#ef4444");
  g.addColorStop(1, "#b91c1c");

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = r * 0.5;
  ctx.beginPath();
  ctx.arc(nx, ny, r, 0, Math.PI * 2);
  ctx.fillStyle = g; ctx.fill();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(nx - r * 0.3, ny - r * 0.3, r * 0.25, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fill();
  ctx.restore();
}

// ── Crown ─────────────────────────────────────────────────────────────────
function drawCrown(ctx: CanvasRenderingContext2D, landmarks: Landmark[], t: number, vw: number, vh: number) {
  const [flx] = px(getLM(landmarks, LM.FACE_LEFT),  vw, vh);
  const [frx] = px(getLM(landmarks, LM.FACE_RIGHT), vw, vh);
  const [, fy] = px(getLM(landmarks, LM.FOREHEAD),  vw, vh);
  const faceW  = frx - flx;
  const cw     = faceW * 1.1;
  const ch     = faceW * 0.4;
  // Crown sits above the forehead landmark
  const cx     = flx + faceW / 2 - cw / 2;
  const cy     = fy - ch + Math.sin(t * 1.5) * faceW * 0.012;

  ctx.save();
  const gold = ctx.createLinearGradient(cx, cy, cx, cy + ch);
  gold.addColorStop(0, "#fde68a");
  gold.addColorStop(0.4, "#f59e0b");
  gold.addColorStop(1, "#b45309");

  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(cx,        cy + ch);
  ctx.lineTo(cx,        cy + ch * 0.48);
  ctx.lineTo(cx + cw * 0.18, cy + ch * 0.72);
  ctx.lineTo(cx + cw * 0.33, cy + ch * 0.05);
  ctx.lineTo(cx + cw * 0.5,  cy + ch * 0.58);
  ctx.lineTo(cx + cw * 0.67, cy + ch * 0.05);
  ctx.lineTo(cx + cw * 0.82, cy + ch * 0.72);
  ctx.lineTo(cx + cw,        cy + ch * 0.48);
  ctx.lineTo(cx + cw,        cy + ch);
  ctx.closePath();
  ctx.fillStyle = gold; ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#92400e"; ctx.lineWidth = 2; ctx.stroke();

  // Gems
  const gemR = faceW * 0.036;
  [
    { x: cx + cw * 0.33, y: cy + ch * 0.12, c: "#ef4444" },
    { x: cx + cw * 0.50, y: cy + ch * 0.62, c: "#3b82f6" },
    { x: cx + cw * 0.67, y: cy + ch * 0.12, c: "#10b981" },
  ].forEach(({ x: gx, y: gy, c }) => {
    ctx.beginPath();
    ctx.arc(gx, gy, gemR, 0, Math.PI * 2);
    ctx.fillStyle = c; ctx.fill();
    ctx.beginPath();
    ctx.arc(gx - gemR * 0.3, gy - gemR * 0.3, gemR * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.fill();
  });
  ctx.restore();
}

// ── Fire Eyes ─────────────────────────────────────────────────────────────
function drawFireEyes(ctx: CanvasRenderingContext2D, landmarks: Landmark[], t: number, vw: number, vh: number) {
  const eyes = [
    { c: eyeCentre(landmarks, LM.LEFT_EYE_LEFT,  LM.LEFT_EYE_RIGHT,  vw, vh),
      hw: eyeHalfWidth(landmarks, LM.LEFT_EYE_LEFT,  LM.LEFT_EYE_RIGHT,  vw) },
    { c: eyeCentre(landmarks, LM.RIGHT_EYE_LEFT, LM.RIGHT_EYE_RIGHT, vw, vh),
      hw: eyeHalfWidth(landmarks, LM.RIGHT_EYE_LEFT, LM.RIGHT_EYE_RIGHT, vw) },
  ];

  eyes.forEach(({ c: [ex, ey], hw }) => {
    const r = hw * 1.3;
    // Dark sclera
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ex, ey, r, r * 0.85, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#1a0000"; ctx.fill();
    ctx.restore();

    // Flame particles around the eye
    for (let f = 0; f < 10; f++) {
      const phase  = (f / 10) * Math.PI * 2 + t * 4;
      const wobble = Math.sin(phase + t * 3) * r * 0.2;
      const fh     = r * (0.9 + Math.sin(phase * 1.3 + t * 2) * 0.35);
      const fx2    = ex + Math.cos((f / 10) * Math.PI * 2) * r * 0.6 + wobble * 0.3;
      const fy2    = ey + Math.sin((f / 10) * Math.PI * 2) * r * 0.5;

      const fg = ctx.createRadialGradient(fx2, fy2, 0, fx2, fy2 - fh, fh);
      fg.addColorStop(0,   "rgba(255,240,80,0.95)");
      fg.addColorStop(0.3, "rgba(255,130,0,0.85)");
      fg.addColorStop(0.7, "rgba(255,40,0,0.5)");
      fg.addColorStop(1,   "rgba(255,0,0,0)");
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(fx2, fy2 - fh * 0.3, r * 0.18, fh * 0.55, wobble * 0.02, 0, Math.PI * 2);
      ctx.fillStyle = fg; ctx.fill();
      ctx.restore();
    }

    // Glowing iris
    const ig = ctx.createRadialGradient(ex, ey, 0, ex, ey, r * 0.55);
    ig.addColorStop(0, "rgba(255,220,0,0.95)");
    ig.addColorStop(0.5, "rgba(255,80,0,0.8)");
    ig.addColorStop(1, "rgba(180,0,0,0.3)");
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ex, ey, r * 0.55, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fillStyle = ig; ctx.fill();
    ctx.beginPath();
    ctx.ellipse(ex, ey, r * 0.2, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#000"; ctx.fill();
    ctx.restore();
  });
}

// ── Alien ─────────────────────────────────────────────────────────────────
function applyAlien(ctx: CanvasRenderingContext2D, landmarks: Landmark[], t: number, vw: number, vh: number) {
  const bb = faceBBox(landmarks, vw, vh);
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "rgba(0,220,80,0.42)";
  ctx.beginPath();
  ctx.ellipse(bb.cx, bb.cy, bb.w / 2, bb.h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const eyes = [
    { c: eyeCentre(landmarks, LM.LEFT_EYE_LEFT,  LM.LEFT_EYE_RIGHT,  vw, vh),
      hw: eyeHalfWidth(landmarks, LM.LEFT_EYE_LEFT,  LM.LEFT_EYE_RIGHT,  vw) },
    { c: eyeCentre(landmarks, LM.RIGHT_EYE_LEFT, LM.RIGHT_EYE_RIGHT, vw, vh),
      hw: eyeHalfWidth(landmarks, LM.RIGHT_EYE_LEFT, LM.RIGHT_EYE_RIGHT, vw) },
  ];
  eyes.forEach(({ c: [ex, ey], hw }) => {
    const rx2 = hw * 1.5, ry2 = hw * 0.9;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ex, ey, rx2, ry2, -0.3, 0, Math.PI * 2);
    ctx.fillStyle = "#050505"; ctx.fill();
    ctx.beginPath();
    ctx.ellipse(ex - rx2 * 0.28, ey - ry2 * 0.28, rx2 * 0.22, ry2 * 0.22, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.fill();
    ctx.restore();
  });

  const [fx, fy] = px(getLM(landmarks, LM.FOREHEAD), vw, vh);
  const wobble   = Math.sin(t * 3) * bb.w * 0.08;
  ctx.save();
  ctx.strokeStyle = "#00dc50"; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.quadraticCurveTo(fx + wobble, fy - bb.h * 0.2, fx + wobble * 1.5, fy - bb.h * 0.38);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(fx + wobble * 1.5, fy - bb.h * 0.38, bb.w * 0.05, 0, Math.PI * 2);
  ctx.fillStyle = "#00ff80"; ctx.fill();
  ctx.restore();
}

// ── Rainbow ───────────────────────────────────────────────────────────────
function applyRainbow(ctx: CanvasRenderingContext2D, landmarks: Landmark[], t: number, vw: number, vh: number) {
  const bb  = faceBBox(landmarks, vw, vh);
  const hue = (t * 60) % 360;
  const grad = ctx.createLinearGradient(bb.x, bb.y, bb.x + bb.w, bb.y + bb.h);
  grad.addColorStop(0,    `hsla(${hue},100%,50%,0.38)`);
  grad.addColorStop(0.25, `hsla(${(hue + 60) % 360},100%,50%,0.38)`);
  grad.addColorStop(0.5,  `hsla(${(hue + 120) % 360},100%,50%,0.38)`);
  grad.addColorStop(0.75, `hsla(${(hue + 240) % 360},100%,50%,0.38)`);
  grad.addColorStop(1,    `hsla(${(hue + 300) % 360},100%,50%,0.38)`);
  ctx.save();
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(bb.cx, bb.cy, bb.w / 2, bb.h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + t * 2;
    ctx.save();
    ctx.font = `${Math.max(12, bb.w * 0.1)}px serif`;
    ctx.fillText("✨",
      bb.cx + Math.cos(angle) * bb.w * 0.58 - bb.w * 0.05,
      bb.cy + Math.sin(angle) * bb.h * 0.58 + bb.w * 0.04);
    ctx.restore();
  }
}

// ── Squish / Stretch — seamless face warp ────────────────────────────────
function applyWarpFace(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  landmarks: Landmark[],
  scaleX: number,
  scaleY: number,
  vw: number,
  vh: number,
) {
  const bb = faceBBox(landmarks, vw, vh);
  const pad = 0.18;
  const sx = Math.max(0, Math.floor(bb.x - bb.w * pad));
  const sy = Math.max(0, Math.floor(bb.y - bb.h * pad));
  const sw = Math.min(canvas.width - sx, Math.floor(bb.w * (1 + pad * 2)));
  const sh = Math.min(canvas.height - sy, Math.floor(bb.h * (1 + pad * 2)));
  if (sw <= 0 || sh <= 0) return;

  const off = document.createElement("canvas");
  off.width = sw; off.height = sh;
  off.getContext("2d")!.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  const dw = Math.round(sw * scaleX);
  const dh = Math.round(sh * scaleY);
  const dx = sx + (sw - dw) / 2;
  const dy = sy + (sh - dh) / 2;

  ctx.save();
  ctx.drawImage(off, dx, dy, dw, dh);
  ctx.restore();

  // Feather the seam
  const borderOff = document.createElement("canvas");
  borderOff.width = dw; borderOff.height = dh;
  const bCtx = borderOff.getContext("2d")!;
  bCtx.drawImage(canvas, dx, dy, dw, dh, 0, 0, dw, dh);
  const maskGrd = bCtx.createRadialGradient(
    dw / 2, dh / 2, Math.min(dw, dh) * 0.32,
    dw / 2, dh / 2, Math.min(dw, dh) * 0.52,
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

// ── Wobble ────────────────────────────────────────────────────────────────
function applyWobble(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, landmarks: Landmark[], t: number, vw: number, vh: number) {
  const bb = faceBBox(landmarks, vw, vh);
  const pad = 0.2;
  const sx = Math.max(0, Math.floor(bb.x - bb.w * pad));
  const sy = Math.max(0, Math.floor(bb.y - bb.h * pad));
  const sw = Math.min(canvas.width - sx, Math.floor(bb.w * (1 + pad * 2)));
  const sh = Math.min(canvas.height - sy, Math.floor(bb.h * (1 + pad * 2)));
  if (sw <= 0 || sh <= 0) return;

  const off = document.createElement("canvas");
  off.width = sw; off.height = sh;
  off.getContext("2d")!.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  const offCtx = off.getContext("2d")!;
  const imgData = offCtx.getImageData(0, 0, sw, sh);
  const src = new Uint8ClampedArray(imgData.data);
  const dst = imgData.data;
  const amp = bb.w * 0.06;
  for (let py = 0; py < sh; py++) {
    for (let px2 = 0; px2 < sw; px2++) {
      const ox  = Math.round(amp * Math.sin((py / sh) * Math.PI * 4 + t * 5));
      const oy  = Math.round(amp * 0.5 * Math.sin((px2 / sw) * Math.PI * 4 + t * 4));
      const spx = Math.min(sw - 1, Math.max(0, px2 + ox));
      const spy = Math.min(sh - 1, Math.max(0, py + oy));
      const di  = (py * sw + px2) * 4, si = (spy * sw + spx) * 4;
      dst[di] = src[si]; dst[di+1] = src[si+1]; dst[di+2] = src[si+2]; dst[di+3] = src[si+3];
    }
  }
  offCtx.putImageData(imgData, 0, 0);
  ctx.drawImage(off, sx, sy, sw, sh);
}

// ── Pixelate ──────────────────────────────────────────────────────────────
function applyPixelate(ctx: CanvasRenderingContext2D, landmarks: Landmark[], vw: number, vh: number) {
  const bb = faceBBox(landmarks, vw, vh);
  const bs = Math.max(8, Math.round(bb.w / 14));
  const sx = Math.max(0, Math.floor(bb.x));
  const sy = Math.max(0, Math.floor(bb.y));
  const sw = Math.min(ctx.canvas.width - sx, Math.floor(bb.w));
  const sh = Math.min(ctx.canvas.height - sy, Math.floor(bb.h));
  if (sw <= 0 || sh <= 0) return;
  const imgData = ctx.getImageData(sx, sy, sw, sh);
  const d = imgData.data;
  for (let by = 0; by < sh; by += bs)
    for (let bx = 0; bx < sw; bx += bs) {
      const ci = (Math.min(sh-1, by + (bs>>1)) * sw + Math.min(sw-1, bx + (bs>>1))) * 4;
      const r = d[ci], g = d[ci+1], b = d[ci+2];
      for (let dy = 0; dy < bs && by+dy < sh; dy++)
        for (let dx = 0; dx < bs && bx+dx < sw; dx++) {
          const i = ((by+dy)*sw+(bx+dx))*4;
          d[i]=r; d[i+1]=g; d[i+2]=b;
        }
    }
  ctx.putImageData(imgData, sx, sy);
}

// ── Mirror ────────────────────────────────────────────────────────────────
function applyMirror(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, landmarks: Landmark[], vw: number, vh: number) {
  const bb = faceBBox(landmarks, vw, vh);
  const pad = 0.1;
  const sx = Math.max(0, bb.x - bb.w * pad);
  const sy = Math.max(0, bb.y - bb.h * pad);
  const sw = Math.min(canvas.width - sx, bb.w * (1 + pad * 2));
  const sh = Math.min(canvas.height - sy, bb.h * (1 + pad * 2));
  const half = sw / 2;

  const off = document.createElement("canvas");
  off.width = sw; off.height = sh;
  off.getContext("2d")!.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  ctx.save();
  ctx.translate(sx + sw, sy);
  ctx.scale(-1, 1);
  ctx.drawImage(off, 0, 0, half, sh, 0, 0, half, sh);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(sx + half, sy); ctx.lineTo(sx + half, sy + sh);
  ctx.stroke();
  ctx.restore();
}
