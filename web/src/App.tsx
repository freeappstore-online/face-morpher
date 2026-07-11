import { useEffect, useRef, useState, useCallback } from "react";
import { Shell } from "./components/Shell";

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
  { id: "bigEyes", label: "Big Eyes", emoji: "👀", description: "Enormous googly eyes" },
  { id: "squish", label: "Squish", emoji: "🥞", description: "Squash your face flat" },
  { id: "stretch", label: "Stretch", emoji: "🦒", description: "Stretch your face tall" },
  { id: "wobble", label: "Wobble", emoji: "🌊", description: "Wavy face distortion" },
  { id: "pixelate", label: "Pixelate", emoji: "👾", description: "8-bit pixel face" },
  { id: "rainbow", label: "Rainbow", emoji: "🌈", description: "Rainbow colour overlay" },
  { id: "alien", label: "Alien", emoji: "👽", description: "Green alien makeover" },
  { id: "mirror", label: "Mirror", emoji: "🪞", description: "Mirrored face split" },
];

// Minimal face-landmark simulation using colour analysis + canvas
// We use the browser's native FaceDetector API where available,
// falling back to a centre-of-frame heuristic.

declare global {
  interface Window {
    FaceDetector?: new (options?: { maxDetectedFaces?: number; fastMode?: boolean }) => {
      detect: (source: HTMLVideoElement) => Promise<Array<{ boundingBox: DOMRectReadOnly }>>;
    };
  }
}

interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const detectorRef = useRef<InstanceType<NonNullable<typeof window.FaceDetector>> | null>(null);
  const facesRef = useRef<FaceBox[]>([]);
  const timeRef = useRef(0);

  const [activeEffect, setActiveEffect] = useState<FunnyEffect>("bigEyes");
  const [cameraActive, setCameraActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFaceAPI, setHasFaceAPI] = useState(false);
  const [faceCount, setFaceCount] = useState(0);

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
  }, []);

  // ── Init FaceDetector API ─────────────────────────────────────────────────
  useEffect(() => {
    if (window.FaceDetector) {
      try {
        detectorRef.current = new window.FaceDetector({ maxDetectedFaces: 4, fastMode: true });
        setHasFaceAPI(true);
      } catch {
        setHasFaceAPI(false);
      }
    }
  }, []);

  // ── Face detection loop (runs every ~200ms) ───────────────────────────────
  useEffect(() => {
    if (!cameraActive) return;
    let running = true;

    const detectLoop = async () => {
      while (running) {
        if (videoRef.current && videoRef.current.readyState >= 2) {
          if (detectorRef.current) {
            try {
              const results = await detectorRef.current.detect(videoRef.current);
              facesRef.current = results.map((r) => ({
                x: r.boundingBox.x,
                y: r.boundingBox.y,
                width: r.boundingBox.width,
                height: r.boundingBox.height,
              }));
              setFaceCount(results.length);
            } catch {
              // fallback below
            }
          } else {
            // Heuristic: assume face in centre-ish area
            const vw = videoRef.current.videoWidth;
            const vh = videoRef.current.videoHeight;
            if (vw > 0) {
              facesRef.current = [
                {
                  x: vw * 0.2,
                  y: vh * 0.1,
                  width: vw * 0.6,
                  height: vh * 0.7,
                },
              ];
              setFaceCount(1);
            }
          }
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    };

    detectLoop();
    return () => { running = false; };
  }, [cameraActive]);

  // ── Render loop ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!cameraActive) return;

    const render = (timestamp: number) => {
      timeRef.current = timestamp;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) {
        animRef.current = requestAnimationFrame(render);
        return;
      }

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw === 0) {
        animRef.current = requestAnimationFrame(render);
        return;
      }

      canvas.width = vw;
      canvas.height = vh;
      const ctx = canvas.getContext("2d")!;

      // Draw base video frame (mirrored for selfie feel)
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(video, -vw, 0, vw, vh);
      ctx.restore();

      const faces = facesRef.current;
      const t = timestamp / 1000;

      faces.forEach((rawFace) => {
        // Mirror the face box X since we flipped the canvas
        const face: FaceBox = {
          x: vw - rawFace.x - rawFace.width,
          y: rawFace.y,
          width: rawFace.width,
          height: rawFace.height,
        };
        applyEffect(ctx, canvas, face, activeEffect, t, vw, vh);
      });

      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [cameraActive, activeEffect]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => () => stopCamera(), [stopCamera]);

  return (
    <Shell>
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        {/* Header */}
        <div>
          <h1
            className="text-3xl font-bold mb-1"
            style={{ fontFamily: "Fraunces, serif", color: "var(--ink)" }}
          >
            😂 Face Morpher
          </h1>
          <p style={{ color: "var(--muted)" }}>
            Real-time funny face effects using your camera.{" "}
            {hasFaceAPI ? (
              <span style={{ color: "var(--success)" }}>✓ Native face detection active</span>
            ) : (
              <span style={{ color: "var(--warning)" }}>⚠ Using centre-frame heuristic</span>
            )}
          </p>
        </div>

        {/* Camera view */}
        <div
          className="relative rounded-2xl overflow-hidden"
          style={{
            background: "var(--panel)",
            border: "1px solid var(--line)",
            aspectRatio: "4/3",
          }}
        >
          {/* Hidden video source */}
          <video ref={videoRef} className="hidden" playsInline muted />

          {/* Output canvas */}
          <canvas
            ref={canvasRef}
            className="w-full h-full object-contain"
            style={{ display: cameraActive ? "block" : "none" }}
          />

          {/* Idle state */}
          {!cameraActive && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
              <div className="text-6xl">🎭</div>
              <p className="text-lg font-semibold" style={{ color: "var(--ink)" }}>
                Ready to get funny?
              </p>
              <p className="text-sm text-center px-8" style={{ color: "var(--muted)" }}>
                Click below to start your camera and apply real-time face effects.
              </p>
              {error && (
                <p
                  className="text-sm text-center px-6 py-2 rounded-xl"
                  style={{ color: "var(--error)", background: "rgba(220,38,38,0.08)" }}
                >
                  {error}
                </p>
              )}
              <button
                onClick={startCamera}
                className="px-6 py-3 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: "var(--accent)" }}
              >
                Start Camera
              </button>
            </div>
          )}

          {/* Live badge */}
          {cameraActive && (
            <div className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold text-white"
              style={{ background: "rgba(0,0,0,0.55)" }}>
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse inline-block" />
              LIVE · {faceCount} face{faceCount !== 1 ? "s" : ""}
            </div>
          )}

          {/* Stop button */}
          {cameraActive && (
            <button
              onClick={stopCamera}
              className="absolute top-3 right-3 px-3 py-1 rounded-full text-xs font-bold text-white transition-opacity hover:opacity-80"
              style={{ background: "rgba(0,0,0,0.55)" }}
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
                className="flex flex-col items-center gap-1 p-3 rounded-xl border transition-all hover:scale-105"
                style={{
                  borderColor: activeEffect === effect.id ? "var(--accent)" : "var(--line)",
                  background: activeEffect === effect.id ? "rgba(37,99,235,0.08)" : "var(--panel)",
                  boxShadow: activeEffect === effect.id ? "0 0 0 2px var(--accent)" : "none",
                }}
              >
                <span className="text-2xl">{effect.emoji}</span>
                <span className="text-xs font-bold" style={{ color: "var(--ink)" }}>
                  {effect.label}
                </span>
                <span className="text-xs text-center leading-tight" style={{ color: "var(--muted)" }}>
                  {effect.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Tips */}
        <div
          className="rounded-xl p-4 text-sm"
          style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--muted)" }}
        >
          💡 <strong style={{ color: "var(--ink)" }}>Tips:</strong> Face the camera straight-on for best results.
          Good lighting helps detection. Switch effects anytime — changes apply instantly!
        </div>
      </div>
    </Shell>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Effect rendering functions
// ═══════════════════════════════════════════════════════════════════════════

function applyEffect(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  face: FaceBox,
  effect: FunnyEffect,
  t: number,
  vw: number,
  vh: number
) {
  const { x, y, width: fw, height: fh } = face;
  const cx = x + fw / 2;
  const cy = y + fh / 2;

  switch (effect) {
    case "bigEyes":
      drawBigEyes(ctx, face, t);
      break;
    case "squish":
      distortFaceRegion(ctx, canvas, face, 1.6, 0.5, cx, cy);
      break;
    case "stretch":
      distortFaceRegion(ctx, canvas, face, 0.6, 1.7, cx, cy);
      break;
    case "wobble":
      applyWobble(ctx, canvas, face, t);
      break;
    case "pixelate":
      applyPixelate(ctx, face);
      break;
    case "rainbow":
      applyRainbow(ctx, face, t);
      break;
    case "alien":
      applyAlien(ctx, face, t);
      break;
    case "mirror":
      applyMirror(ctx, canvas, face, vw);
      break;
  }
}

// ── Big Eyes ──────────────────────────────────────────────────────────────
function drawBigEyes(ctx: CanvasRenderingContext2D, face: FaceBox, t: number) {
  const { x, y, width: fw, height: fh } = face;
  const eyeY = y + fh * 0.38;
  const eyeR = fw * 0.22 + Math.sin(t * 3) * fw * 0.02;

  // Left eye
  const lx = x + fw * 0.3;
  // Right eye
  const rx = x + fw * 0.7;

  [lx, rx].forEach((ex, i) => {
    // White sclera
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeR, eyeR * 0.85, 0, 0, Math.PI * 2);
    ctx.fillStyle = "white";
    ctx.fill();
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Iris
    const irisR = eyeR * 0.6;
    const pupilOffset = Math.sin(t * 1.5 + i) * eyeR * 0.15;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ex + pupilOffset, eyeY + pupilOffset * 0.5, irisR, irisR, 0, 0, Math.PI * 2);
    ctx.fillStyle = i === 0 ? "#3b82f6" : "#10b981";
    ctx.fill();
    ctx.restore();

    // Pupil
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ex + pupilOffset, eyeY + pupilOffset * 0.5, irisR * 0.45, irisR * 0.45, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#111";
    ctx.fill();
    ctx.restore();

    // Highlight
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ex + pupilOffset - irisR * 0.2, eyeY + pupilOffset * 0.5 - irisR * 0.2, irisR * 0.15, irisR * 0.15, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fill();
    ctx.restore();
  });
}

// ── Distort (squish / stretch) ────────────────────────────────────────────
function distortFaceRegion(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  face: FaceBox,
  scaleX: number,
  scaleY: number,
  cx: number,
  cy: number
) {
  const pad = 0.15;
  const sx = Math.max(0, face.x - face.width * pad);
  const sy = Math.max(0, face.y - face.height * pad);
  const sw = Math.min(canvas.width - sx, face.width * (1 + pad * 2));
  const sh = Math.min(canvas.height - sy, face.height * (1 + pad * 2));

  // Grab the region
  const offscreen = document.createElement("canvas");
  offscreen.width = sw;
  offscreen.height = sh;
  const offCtx = offscreen.getContext("2d")!;
  offCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  // Clear region and redraw scaled
  ctx.save();
  ctx.clearRect(sx, sy, sw, sh);
  // Redraw background first (just fill with black to mask)
  ctx.translate(cx, cy);
  ctx.scale(scaleX, scaleY);
  ctx.drawImage(offscreen, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();
}

// ── Wobble ────────────────────────────────────────────────────────────────
function applyWobble(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  face: FaceBox,
  t: number
) {
  const { x, y, width: fw, height: fh } = face;
  const pad = 0.2;
  const sx = Math.max(0, x - fw * pad);
  const sy = Math.max(0, y - fh * pad);
  const sw = Math.min(canvas.width - sx, fw * (1 + pad * 2));
  const sh = Math.min(canvas.height - sy, fh * (1 + pad * 2));

  const offscreen = document.createElement("canvas");
  offscreen.width = sw;
  offscreen.height = sh;
  const offCtx = offscreen.getContext("2d")!;
  offCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  const imgData = offCtx.getImageData(0, 0, sw, sh);
  const src = new Uint8ClampedArray(imgData.data);
  const dst = imgData.data;
  const amp = fw * 0.06;
  const freq = 4;

  for (let py = 0; py < sh; py++) {
    for (let px = 0; px < sw; px++) {
      const ox = Math.round(amp * Math.sin((py / sh) * Math.PI * freq + t * 5));
      const oy = Math.round(amp * 0.5 * Math.sin((px / sw) * Math.PI * freq + t * 4));
      const spx = Math.min(sw - 1, Math.max(0, px + ox));
      const spy = Math.min(sh - 1, Math.max(0, py + oy));
      const di = (py * sw + px) * 4;
      const si = (spy * sw + spx) * 4;
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }
  offCtx.putImageData(imgData, 0, 0);
  ctx.drawImage(offscreen, sx, sy, sw, sh);
}

// ── Pixelate ──────────────────────────────────────────────────────────────
function applyPixelate(ctx: CanvasRenderingContext2D, face: FaceBox) {
  const { x, y, width: fw, height: fh } = face;
  const blockSize = Math.max(8, Math.round(fw / 12));
  const sx = Math.max(0, Math.floor(x));
  const sy = Math.max(0, Math.floor(y));
  const sw = Math.floor(fw);
  const sh = Math.floor(fh);

  const imgData = ctx.getImageData(sx, sy, sw, sh);
  const d = imgData.data;

  for (let by = 0; by < sh; by += blockSize) {
    for (let bx = 0; bx < sw; bx += blockSize) {
      // Sample centre pixel
      const cpx = Math.min(sw - 1, bx + Math.floor(blockSize / 2));
      const cpy = Math.min(sh - 1, by + Math.floor(blockSize / 2));
      const ci = (cpy * sw + cpx) * 4;
      const r = d[ci], g = d[ci + 1], b = d[ci + 2];

      // Fill block
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

// ── Rainbow ───────────────────────────────────────────────────────────────
function applyRainbow(ctx: CanvasRenderingContext2D, face: FaceBox, t: number) {
  const { x, y, width: fw, height: fh } = face;
  const grad = ctx.createLinearGradient(x, y, x + fw, y + fh);
  const hue = (t * 60) % 360;
  grad.addColorStop(0, `hsla(${hue}, 100%, 50%, 0.35)`);
  grad.addColorStop(0.25, `hsla(${(hue + 60) % 360}, 100%, 50%, 0.35)`);
  grad.addColorStop(0.5, `hsla(${(hue + 120) % 360}, 100%, 50%, 0.35)`);
  grad.addColorStop(0.75, `hsla(${(hue + 240) % 360}, 100%, 50%, 0.35)`);
  grad.addColorStop(1, `hsla(${(hue + 300) % 360}, 100%, 50%, 0.35)`);
  ctx.save();
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(x + fw / 2, y + fh / 2, fw / 2, fh / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Stars / sparkles
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + t * 2;
    const r = fw * 0.55;
    const sx2 = x + fw / 2 + Math.cos(angle) * r;
    const sy2 = y + fh / 2 + Math.sin(angle) * r;
    ctx.save();
    ctx.font = `${fw * 0.1}px serif`;
    ctx.fillText("✨", sx2 - fw * 0.05, sy2 + fw * 0.04);
    ctx.restore();
  }
}

// ── Alien ─────────────────────────────────────────────────────────────────
function applyAlien(ctx: CanvasRenderingContext2D, face: FaceBox, t: number) {
  const { x, y, width: fw, height: fh } = face;

  // Green tint overlay
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = `rgba(0, 220, 80, 0.45)`;
  ctx.beginPath();
  ctx.ellipse(x + fw / 2, y + fh / 2, fw / 2, fh / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Big black alien eyes
  const eyeY = y + fh * 0.35;
  const eyeRx = fw * 0.2;
  const eyeRy = fw * 0.14;
  [[0.28, 0], [0.72, 0]].forEach(([ex]) => {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x + fw * ex, eyeY, eyeRx, eyeRy, -0.3, 0, Math.PI * 2);
    ctx.fillStyle = "#050505";
    ctx.fill();
    // Glint
    ctx.beginPath();
    ctx.ellipse(x + fw * ex - eyeRx * 0.3, eyeY - eyeRy * 0.3, eyeRx * 0.2, eyeRy * 0.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fill();
    ctx.restore();
  });

  // Antenna
  const antX = x + fw / 2;
  const antY = y - fh * 0.05;
  const wobble = Math.sin(t * 3) * fw * 0.08;
  ctx.save();
  ctx.strokeStyle = "#00dc50";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(antX, antY);
  ctx.quadraticCurveTo(antX + wobble, antY - fh * 0.25, antX + wobble * 1.5, antY - fh * 0.4);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(antX + wobble * 1.5, antY - fh * 0.4, fw * 0.05, 0, Math.PI * 2);
  ctx.fillStyle = "#00ff80";
  ctx.fill();
  ctx.restore();
}

// ── Mirror ────────────────────────────────────────────────────────────────
function applyMirror(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  face: FaceBox,
  _vw: number
) {
  const { x, y, width: fw, height: fh } = face;
  const pad = 0.1;
  const sx = Math.max(0, x - fw * pad);
  const sy = Math.max(0, y - fh * pad);
  const sw = Math.min(canvas.width - sx, fw * (1 + pad * 2));
  const sh = Math.min(canvas.height - sy, fh * (1 + pad * 2));
  const half = sw / 2;

  // Grab left half
  const offscreen = document.createElement("canvas");
  offscreen.width = sw;
  offscreen.height = sh;
  const offCtx = offscreen.getContext("2d")!;
  offCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  // Draw left half mirrored onto right
  ctx.save();
  ctx.translate(sx + sw, sy);
  ctx.scale(-1, 1);
  ctx.drawImage(offscreen, 0, 0, half, sh, 0, 0, half, sh);
  ctx.restore();

  // Seam line
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
