import { useEffect, useRef, useState, useCallback } from "react";
import { Shell } from "./components/Shell";

// ── MediaPipe types (loaded via CDN) ──────────────────────────────────────
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    MediaPipeFaceLandmarker: any;
  }
}

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
  description: string;
}

const EFFECTS: Effect[] = [
  { id: "bigEyes",   label: "Big Eyes",  emoji: "👀", description: "Enormous googly eyes on real landmarks" },
  { id: "squish",    label: "Squish",    emoji: "🥞", description: "Squash your face flat" },
  { id: "stretch",   label: "Stretch",   emoji: "🦒", description: "Stretch your face tall" },
  { id: "wobble",    label: "Wobble",    emoji: "🌊", description: "Wavy liquid distortion" },
  { id: "pixelate",  label: "Pixelate",  emoji: "👾", description: "8-bit pixel face" },
  { id: "rainbow",   label: "Rainbow",   emoji: "🌈", description: "Animated rainbow overlay" },
  { id: "alien",     label: "Alien",     emoji: "👽", description: "Green alien with real eye positions" },
  { id: "mirror",    label: "Mirror",    emoji: "🪞", description: "Mirrored face split" },
];

// MediaPipe landmark indices
const LM = {
  // Eyes
  LEFT_EYE_CENTER: 468,   // with iris
  RIGHT_EYE_CENTER: 473,
  LEFT_EYE_LEFT: 33,
  LEFT_EYE_RIGHT: 133,
  RIGHT_EYE_LEFT: 362,
  RIGHT_EYE_RIGHT: 263,
  // Nose
  NOSE_TIP: 4,
  // Mouth
  MOUTH_LEFT: 61,
  MOUTH_RIGHT: 291,
  MOUTH_TOP: 13,
  MOUTH_BOTTOM: 14,
  // Face outline
  CHIN: 152,
  FOREHEAD: 10,
  FACE_LEFT: 234,
  FACE_RIGHT: 454,
};

interface Landmark { x: number; y: number; z: number; }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let faceLandmarker: any = null;
let mediaPipeReady = false;

async function loadMediaPipe(): Promise<boolean> {
  if (mediaPipeReady) return true;
  return new Promise((resolve) => {
    // Load the MediaPipe vision bundle from CDN
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.js";
    script.onload = async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const vision = (window as any);
        const { FaceLandmarker, FilesetResolver } = vision;

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const lastVideoTimeRef = useRef(-1);
  const landmarksRef = useRef<Landmark[][]>([]);

  const [activeEffect, setActiveEffect] = useState<FunnyEffect>("bigEyes");
  const [cameraActive, setCameraActive] = useState(false);
  const [modelStatus, setModelStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const [faceCount, setFaceCount] = useState(0);

  // ── Load MediaPipe on mount ───────────────────────────────────────────────
  useEffect(() => {
    setModelStatus("loading");
    loadMediaPipe().then((ok) => setModelStatus(ok ? "ready" : "failed"));
  }, []);

  // ── Start camera ──────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
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

  // ── Render + detection loop ───────────────────────────────────────────────
  useEffect(() => {
    if (!cameraActive) return;

    const render = (timestamp: number) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) {
        animRef.current = requestAnimationFrame(render);
        return;
      }

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw === 0) { animRef.current = requestAnimationFrame(render); return; }

      canvas.width = vw;
      canvas.height = vh;
      const ctx = canvas.getContext("2d")!;

      // Draw mirrored video frame
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(video, -vw, 0, vw, vh);
      ctx.restore();

      // Run MediaPipe detection (once per new video frame)
      if (faceLandmarker && video.currentTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = video.currentTime;
        try {
          const results = faceLandmarker.detectForVideo(video, timestamp);
          if (results?.faceLandmarks) {
            landmarksRef.current = results.faceLandmarks;
            setFaceCount(results.faceLandmarks.length);
          }
        } catch {
          // silently continue
        }
      }

      const t = timestamp / 1000;
      const faces = landmarksRef.current;

      faces.forEach((landmarks) => {
        // Mirror landmark X coords to match flipped canvas
        const mirroredLandmarks = landmarks.map((lm) => ({ ...lm, x: 1 - lm.x }));
        applyEffect(ctx, canvas, mirroredLandmarks, activeEffect, t, vw, vh);
      });

      // If no MediaPipe yet, fall back to heuristic
      if (!faceLandmarker && faces.length === 0) {
        applyEffectHeuristic(ctx, canvas, activeEffect, t, vw, vh);
      }

      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [cameraActive, activeEffect]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const statusColor =
    modelStatus === "ready" ? "var(--success)" :
    modelStatus === "loading" ? "var(--warning)" :
    modelStatus === "failed" ? "var(--error)" : "var(--muted)";

  const statusText =
    modelStatus === "ready" ? "✓ MediaPipe 478-point landmarks active" :
    modelStatus === "loading" ? "⏳ Loading face landmark model…" :
    modelStatus === "failed" ? "⚠ Model failed — using heuristic fallback" : "";

  return (
    <Shell>
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold mb-1" style={{ fontFamily: "Fraunces, serif", color: "var(--ink)" }}>
            😂 Face Morpher
          </h1>
          <p className="text-sm" style={{ color: statusColor }}>{statusText}</p>
        </div>

        {/* Camera view */}
        <div
          className="relative rounded-2xl overflow-hidden"
          style={{ background: "#111", border: "1px solid var(--line)", aspectRatio: "4/3" }}
        >
          <video ref={videoRef} className="hidden" playsInline muted />
          <canvas
            ref={canvasRef}
            className="w-full h-full object-contain"
            style={{ display: cameraActive ? "block" : "none" }}
          />

          {/* Idle state */}
          {!cameraActive && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
              <div className="text-6xl">🎭</div>
              <p className="text-lg font-semibold" style={{ color: "#fff" }}>Ready to get funny?</p>
              <p className="text-sm text-center px-8" style={{ color: "#aaa" }}>
                {modelStatus === "loading"
                  ? "Loading the face landmark model first…"
                  : "Click below to start your camera with real-time face morphing."}
              </p>
              {error && (
                <p className="text-sm text-center px-6 py-2 rounded-xl"
                  style={{ color: "var(--error)", background: "rgba(220,38,38,0.12)" }}>
                  {error}
                </p>
              )}
              <button
                onClick={startCamera}
                disabled={modelStatus === "loading"}
                className="px-6 py-3 rounded-xl font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "var(--accent)" }}
              >
                {modelStatus === "loading" ? "Loading model…" : "Start Camera"}
              </button>
            </div>
          )}

          {/* Live badge */}
          {cameraActive && (
            <div className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold text-white"
              style={{ background: "rgba(0,0,0,0.6)" }}>
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse inline-block" />
              LIVE · {faceCount} face{faceCount !== 1 ? "s" : ""}
            </div>
          )}

          {/* Stop button */}
          {cameraActive && (
            <button
              onClick={stopCamera}
              className="absolute top-3 right-3 px-3 py-1 rounded-full text-xs font-bold text-white transition-opacity hover:opacity-80"
              style={{ background: "rgba(0,0,0,0.6)" }}
            >
              ✕ Stop
            </button>
          )}
        </div>

        {/* Effect picker */}
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest mb-3" style={{ color: "var(--muted)" }}>
            Choose an Effect
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {EFFECTS.map((effect) => (
              <button
                key={effect.id}
                onClick={() => setActiveEffect(effect.id)}
                className="flex flex-col items-center gap-1 p-3 rounded-xl border transition-all hover:scale-105 active:scale-95"
                style={{
                  borderColor: activeEffect === effect.id ? "var(--accent)" : "var(--line)",
                  background: activeEffect === effect.id ? "rgba(37,99,235,0.08)" : "var(--panel)",
                  boxShadow: activeEffect === effect.id ? "0 0 0 2px var(--accent)" : "none",
                }}
              >
                <span className="text-2xl">{effect.emoji}</span>
                <span className="text-xs font-bold" style={{ color: "var(--ink)" }}>{effect.label}</span>
                <span className="text-xs text-center leading-tight" style={{ color: "var(--muted)" }}>
                  {effect.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Info */}
        <div className="rounded-xl p-4 text-sm" style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--muted)" }}>
          🧠 <strong style={{ color: "var(--ink)" }}>On-device AI:</strong> Uses MediaPipe Face Landmarker with 478 facial landmarks.
          Everything runs in your browser — no video is ever sent anywhere.
        </div>
      </div>
    </Shell>
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

// ── Dispatch ──────────────────────────────────────────────────────────────
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
    case "bigEyes":   drawBigEyes(ctx, landmarks, t, vw, vh); break;
    case "squish":    distortFace(ctx, canvas, landmarks, 1.6, 0.5, vw, vh); break;
    case "stretch":   distortFace(ctx, canvas, landmarks, 0.6, 1.7, vw, vh); break;
    case "wobble":    applyWobble(ctx, canvas, landmarks, t, vw, vh); break;
    case "pixelate":  applyPixelate(ctx, landmarks, vw, vh); break;
    case "rainbow":   applyRainbow(ctx, landmarks, t, vw, vh); break;
    case "alien":     applyAlien(ctx, landmarks, t, vw, vh); break;
    case "mirror":    applyMirror(ctx, canvas, landmarks, vw, vh); break;
  }
}

// Heuristic fallback (no landmarks)
function applyEffectHeuristic(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  effect: FunnyEffect,
  t: number,
  vw: number,
  vh: number
) {
  // Synthesise fake landmarks centred in frame
  const fake: Landmark[] = Array.from({ length: 478 }, (_, i) => {
    const col = i % 22;
    const row = Math.floor(i / 22);
    return { x: 0.2 + (col / 21) * 0.6, y: 0.1 + (row / 21) * 0.7, z: 0 };
  });
  // key points
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

// ── Big Eyes ──────────────────────────────────────────────────────────────
function drawBigEyes(ctx: CanvasRenderingContext2D, landmarks: Landmark[], t: number, vw: number, vh: number) {
  const [lx, ly] = lm(landmarks, LM.LEFT_EYE_CENTER,  vw, vh);
  const [rx, ry] = lm(landmarks, LM.RIGHT_EYE_CENTER, vw, vh);
  const lR = eyeRadius(landmarks, LM.LEFT_EYE_LEFT,  LM.LEFT_EYE_RIGHT,  vw) * 1.8;
  const rR = eyeRadius(landmarks, LM.RIGHT_EYE_LEFT, LM.RIGHT_EYE_RIGHT, vw) * 1.8;

  [[lx, ly, lR, "#3b82f6"], [rx, ry, rR, "#10b981"]].forEach(([ex, ey, er, col], i) => {
    const eyeX = ex as number, eyeY = ey as number, eyeR = er as number;
    const pupilOffset = Math.sin(t * 1.5 + i) * eyeR * 0.15;

    // Sclera
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(eyeX, eyeY, eyeR, eyeR * 0.88, 0, 0, Math.PI * 2);
    ctx.fillStyle = "white";
    ctx.fill();
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Iris
    const irisR = eyeR * 0.58;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(eyeX + pupilOffset, eyeY + pupilOffset * 0.5, irisR, irisR, 0, 0, Math.PI * 2);
    ctx.fillStyle = col as string;
    ctx.fill();
    ctx.restore();

    // Pupil
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(eyeX + pupilOffset, eyeY + pupilOffset * 0.5, irisR * 0.44, irisR * 0.44, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#111";
    ctx.fill();
    ctx.restore();

    // Highlight
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(eyeX + pupilOffset - irisR * 0.22, eyeY + pupilOffset * 0.5 - irisR * 0.22, irisR * 0.16, irisR * 0.16, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fill();
    ctx.restore();
  });
}

// ── Face bounding box from landmarks ─────────────────────────────────────
function faceBBox(landmarks: Landmark[], vw: number, vh: number) {
  const xs = landmarks.map((l) => l.x * vw);
  const ys = landmarks.map((l) => l.y * vh);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ── Squish / Stretch ──────────────────────────────────────────────────────
function distortFace(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  landmarks: Landmark[],
  scaleX: number,
  scaleY: number,
  vw: number,
  vh: number
) {
  const bb = faceBBox(landmarks, vw, vh);
  const pad = 0.15;
  const sx = Math.max(0, bb.x - bb.width * pad);
  const sy = Math.max(0, bb.y - bb.height * pad);
  const sw = Math.min(canvas.width - sx, bb.width * (1 + pad * 2));
  const sh = Math.min(canvas.height - sy, bb.height * (1 + pad * 2));
  const cx = sx + sw / 2;
  const cy = sy + sh / 2;

  const off = document.createElement("canvas");
  off.width = sw; off.height = sh;
  off.getContext("2d")!.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scaleX, scaleY);
  ctx.drawImage(off, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();
}

// ── Wobble ────────────────────────────────────────────────────────────────
function applyWobble(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  landmarks: Landmark[],
  t: number,
  vw: number,
  vh: number
) {
  const bb = faceBBox(landmarks, vw, vh);
  const pad = 0.2;
  const sx = Math.max(0, Math.floor(bb.x - bb.width * pad));
  const sy = Math.max(0, Math.floor(bb.y - bb.height * pad));
  const sw = Math.min(canvas.width - sx, Math.floor(bb.width * (1 + pad * 2)));
  const sh = Math.min(canvas.height - sy, Math.floor(bb.height * (1 + pad * 2)));

  const off = document.createElement("canvas");
  off.width = sw; off.height = sh;
  off.getContext("2d")!.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  const imgData = off.getContext("2d")!.getImageData(0, 0, sw, sh);
  const src = new Uint8ClampedArray(imgData.data);
  const dst = imgData.data;
  const amp = bb.width * 0.06;

  for (let py = 0; py < sh; py++) {
    for (let px = 0; px < sw; px++) {
      const ox = Math.round(amp * Math.sin((py / sh) * Math.PI * 4 + t * 5));
      const oy = Math.round(amp * 0.5 * Math.sin((px / sw) * Math.PI * 4 + t * 4));
      const spx = Math.min(sw - 1, Math.max(0, px + ox));
      const spy = Math.min(sh - 1, Math.max(0, py + oy));
      const di = (py * sw + px) * 4;
      const si = (spy * sw + spx) * 4;
      dst[di] = src[si]; dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2]; dst[di + 3] = src[si + 3];
    }
  }
  off.getContext("2d")!.putImageData(imgData, 0, 0);
  ctx.drawImage(off, sx, sy, sw, sh);
}

// ── Pixelate ──────────────────────────────────────────────────────────────
function applyPixelate(ctx: CanvasRenderingContext2D, landmarks: Landmark[], vw: number, vh: number) {
  const bb = faceBBox(landmarks, vw, vh);
  const blockSize = Math.max(8, Math.round(bb.width / 14));
  const sx = Math.max(0, Math.floor(bb.x));
  const sy = Math.max(0, Math.floor(bb.y));
  const sw = Math.min(canvas_w(ctx), Math.floor(bb.width));
  const sh = Math.min(canvas_h(ctx), Math.floor(bb.height));

  const imgData = ctx.getImageData(sx, sy, sw, sh);
  const d = imgData.data;

  for (let by = 0; by < sh; by += blockSize) {
    for (let bx = 0; bx < sw; bx += blockSize) {
      const cpx = Math.min(sw - 1, bx + Math.floor(blockSize / 2));
      const cpy = Math.min(sh - 1, by + Math.floor(blockSize / 2));
      const ci = (cpy * sw + cpx) * 4;
      const r = d[ci], g = d[ci + 1], b = d[ci + 2];
      for (let dy = 0; dy < blockSize && by + dy < sh; dy++) {
        for (let dx = 0; dx < blockSize && bx + dx < sw; dx++) {
          const i = ((by + dy) * sw + (bx + dx)) * 4;
          d[i] = r; d[i + 1] = g; d[i + 2] = b;
        }
      }
    }
  }
  ctx.putImageData(imgData, sx, sy);
}

function canvas_w(ctx: CanvasRenderingContext2D) { return ctx.canvas.width; }
function canvas_h(ctx: CanvasRenderingContext2D) { return ctx.canvas.height; }

// ── Rainbow ───────────────────────────────────────────────────────────────
function applyRainbow(ctx: CanvasRenderingContext2D, landmarks: Landmark[], t: number, vw: number, vh: number) {
  const bb = faceBBox(landmarks, vw, vh);
  const { x, y, width: fw, height: fh } = bb;
  const hue = (t * 60) % 360;

  const grad = ctx.createLinearGradient(x, y, x + fw, y + fh);
  grad.addColorStop(0,    `hsla(${hue},           100%, 50%, 0.38)`);
  grad.addColorStop(0.25, `hsla(${(hue+60)%360},  100%, 50%, 0.38)`);
  grad.addColorStop(0.5,  `hsla(${(hue+120)%360}, 100%, 50%, 0.38)`);
  grad.addColorStop(0.75, `hsla(${(hue+240)%360}, 100%, 50%, 0.38)`);
  grad.addColorStop(1,    `hsla(${(hue+300)%360}, 100%, 50%, 0.38)`);

  ctx.save();
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(x + fw / 2, y + fh / 2, fw / 2, fh / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Orbiting sparkles
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + t * 2;
    const r = fw * 0.55;
    const sx = x + fw / 2 + Math.cos(angle) * r;
    const sy2 = y + fh / 2 + Math.sin(angle) * r;
    ctx.save();
    ctx.font = `${Math.max(12, fw * 0.1)}px serif`;
    ctx.fillText("✨", sx - fw * 0.05, sy2 + fw * 0.04);
    ctx.restore();
  }
}

// ── Alien ─────────────────────────────────────────────────────────────────
function applyAlien(ctx: CanvasRenderingContext2D, landmarks: Landmark[], t: number, vw: number, vh: number) {
  const bb = faceBBox(landmarks, vw, vh);
  const { x, y, width: fw, height: fh } = bb;

  // Green tint
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "rgba(0,220,80,0.42)";
  ctx.beginPath();
  ctx.ellipse(x + fw / 2, y + fh / 2, fw / 2, fh / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Eyes at real landmark positions
  const [lx, ly] = lm(landmarks, LM.LEFT_EYE_CENTER,  vw, vh);
  const [rx, ry] = lm(landmarks, LM.RIGHT_EYE_CENTER, vw, vh);
  const eyeRx = eyeRadius(landmarks, LM.LEFT_EYE_LEFT, LM.LEFT_EYE_RIGHT, vw) * 1.4;
  const eyeRy = eyeRx * 0.65;

  [[lx, ly], [rx, ry]].forEach(([ex, ey]) => {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ex, ey, eyeRx, eyeRy, -0.3, 0, Math.PI * 2);
    ctx.fillStyle = "#050505";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(ex - eyeRx * 0.28, ey - eyeRy * 0.28, eyeRx * 0.22, eyeRy * 0.22, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fill();
    ctx.restore();
  });

  // Antenna from forehead
  const [fx, fy] = lm(landmarks, LM.FOREHEAD, vw, vh);
  const wobble = Math.sin(t * 3) * fw * 0.08;
  ctx.save();
  ctx.strokeStyle = "#00dc50";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.quadraticCurveTo(fx + wobble, fy - fh * 0.2, fx + wobble * 1.5, fy - fh * 0.38);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(fx + wobble * 1.5, fy - fh * 0.38, fw * 0.05, 0, Math.PI * 2);
  ctx.fillStyle = "#00ff80";
  ctx.fill();
  ctx.restore();
}

// ── Mirror ────────────────────────────────────────────────────────────────
function applyMirror(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  landmarks: Landmark[],
  vw: number,
  vh: number
) {
  const bb = faceBBox(landmarks, vw, vh);
  const pad = 0.1;
  const sx = Math.max(0, bb.x - bb.width * pad);
  const sy = Math.max(0, bb.y - bb.height * pad);
  const sw = Math.min(canvas.width - sx, bb.width * (1 + pad * 2));
  const sh = Math.min(canvas.height - sy, bb.height * (1 + pad * 2));
  const half = sw / 2;

  const off = document.createElement("canvas");
  off.width = sw; off.height = sh;
  off.getContext("2d")!.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  ctx.save();
  ctx.translate(sx + sw, sy);
  ctx.scale(-1, 1);
  ctx.drawImage(off, 0, 0, half, sh, 0, 0, half, sh);
  ctx.restore();

  // Seam
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(sx + half, sy);
  ctx.lineTo(sx + half, sy + sh);
  ctx.stroke();
  ctx.restore();
}
