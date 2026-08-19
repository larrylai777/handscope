/**
 * Design system: 精密觀測站 — 鏡頭為主、鈦白/石墨基底與觀測鈷藍訊號色。
 * Layout: 非對稱觀測工作台；所有狀態以標本標籤及準星角標呈現。
 */
import {
  Activity,
  Camera,
  CameraOff,
  Check,
  Download,
  Eye,
  EyeOff,
  Hand,
  Info,
  MousePointer2,
  RefreshCw,
  ScanLine,
  Sparkles,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FilesetResolver, HandLandmarker, type HandLandmarkerResult, type NormalizedLandmark } from "@mediapipe/tasks-vision";

type ModelState = "loading" | "ready" | "error";
type GestureName = "等待偵測" | "張開手掌" | "和平手勢" | "比讚" | "握拳" | "捏合" | "一般手勢";

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const gestureDescription: Record<GestureName, string> = {
  "等待偵測": "將手放入鏡頭範圍內",
  "張開手掌": "已辨識開放式手掌",
  "和平手勢": "已辨識 V 字手勢",
  "比讚": "已辨識向上拇指",
  "握拳": "已辨識封閉手勢",
  "捏合": "拇指與食指正在接近",
  "一般手勢": "關節點追蹤正常",
};

function distance(a: NormalizedLandmark, b: NormalizedLandmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function inferGesture(points: NormalizedLandmark[]): { label: GestureName; confidence: number } {
  if (points.length < 21) return { label: "等待偵測", confidence: 0 };

  const [wrist] = points;
  const indexUp = points[8].y < points[6].y - 0.025;
  const middleUp = points[12].y < points[10].y - 0.025;
  const ringUp = points[16].y < points[14].y - 0.025;
  const pinkyUp = points[20].y < points[18].y - 0.025;
  const extended = [indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;
  const pinchDistance = distance(points[4], points[8]);
  const tipToWrist = [4, 8, 12, 16, 20].map((index) => distance(points[index], wrist));
  const fistLike = tipToWrist.filter((value) => value < 0.24).length >= 4;
  const thumbUp = points[4].y < points[3].y - 0.04 && !indexUp && !middleUp && !ringUp && !pinkyUp;

  if (pinchDistance < 0.065) return { label: "捏合", confidence: Math.round((1 - pinchDistance / 0.065) * 28 + 70) };
  if (extended === 4) return { label: "張開手掌", confidence: 95 };
  if (indexUp && middleUp && !ringUp && !pinkyUp) return { label: "和平手勢", confidence: 92 };
  if (thumbUp) return { label: "比讚", confidence: 86 };
  if (fistLike || extended === 0) return { label: "握拳", confidence: 83 };
  return { label: "一般手勢", confidence: 74 };
}

function formatDuration(seconds: number) {
  return `00:${String(Math.min(seconds, 59)).padStart(2, "0")}`;
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastUiUpdateRef = useRef(0);
  const [modelState, setModelState] = useState<ModelState>("loading");
  const [isCameraLive, setIsCameraLive] = useState(false);
  const [isMirrored, setIsMirrored] = useState(true);
  const [showConnections, setShowConnections] = useState(true);
  const [gesture, setGesture] = useState<GestureName>("等待偵測");
  const [confidence, setConfidence] = useState(0);
  const [handCount, setHandCount] = useState(0);
  const [handedness, setHandedness] = useState("—");
  const [elapsed, setElapsed] = useState(0);
  const [cameraError, setCameraError] = useState("");

  useEffect(() => {
    let disposed = false;
    const loadModel = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm",
        );
        const instance = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
        });
        if (disposed) {
          instance.close();
          return;
        }
        landmarkerRef.current = instance;
        setModelState("ready");
      } catch {
        if (!disposed) setModelState("error");
      }
    };
    loadModel();
    return () => {
      disposed = true;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      landmarkerRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!isCameraLive) return;
    const timer = window.setInterval(() => setElapsed((time) => time + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isCameraLive]);

  const drawResult = useCallback((result: HandLandmarkerResult) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const context = canvas.getContext("2d");
    if (!context || video.videoWidth === 0 || video.videoHeight === 0) return;

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    result.landmarks.forEach((points) => {
      if (showConnections) {
        context.lineWidth = Math.max(2, canvas.width * 0.0028);
        context.strokeStyle = "rgba(74, 139, 255, 0.92)";
        context.shadowColor = "rgba(36, 123, 255, 0.70)";
        context.shadowBlur = 12;
        HAND_CONNECTIONS.forEach(([start, end]) => {
          const from = points[start];
          const to = points[end];
          context.beginPath();
          context.moveTo(from.x * canvas.width, from.y * canvas.height);
          context.lineTo(to.x * canvas.width, to.y * canvas.height);
          context.stroke();
        });
      }
      points.forEach((point, index) => {
        const radius = index === 0 ? canvas.width * 0.0105 : canvas.width * 0.007;
        context.beginPath();
        context.arc(point.x * canvas.width, point.y * canvas.height, Math.max(4, radius), 0, Math.PI * 2);
        context.fillStyle = index === 0 ? "#eaf2ff" : "#247bff";
        context.shadowColor = "rgba(36, 123, 255, 0.95)";
        context.shadowBlur = 14;
        context.fill();
      });
    });
    context.shadowBlur = 0;
  }, [showConnections]);

  const predictFrame = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !landmarker || !isCameraLive) return;
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const result = landmarker.detectForVideo(video, performance.now());
      drawResult(result);
      const now = performance.now();
      if (now - lastUiUpdateRef.current > 180) {
        lastUiUpdateRef.current = now;
        const firstHand = result.landmarks[0];
        const identified = firstHand ? inferGesture(firstHand) : { label: "等待偵測" as GestureName, confidence: 0 };
        setHandCount(result.landmarks.length);
        setGesture(identified.label);
        setConfidence(identified.confidence);
        setHandedness(result.handedness[0]?.[0]?.categoryName === "Left" ? "左手" : result.handedness[0]?.[0]?.categoryName === "Right" ? "右手" : "—");
      }
    }
    frameRef.current = requestAnimationFrame(predictFrame);
  }, [drawResult, isCameraLive]);

  useEffect(() => {
    if (isCameraLive) frameRef.current = requestAnimationFrame(predictFrame);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [isCameraLive, predictFrame]);

  const startCamera = async () => {
    if (modelState !== "ready") return;
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 960 },
          aspectRatio: { ideal: 4 / 3 },
        },
        audio: false,
      });
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setElapsed(0);
      setIsCameraLive(true);
    } catch {
      setCameraError("無法啟動鏡頭。請在瀏覽器權限設定中允許相機存取後再試一次。");
    }
  };

  const stopCamera = () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    canvasRef.current?.getContext("2d")?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setIsCameraLive(false);
    setGesture("等待偵測");
    setConfidence(0);
    setHandCount(0);
    setHandedness("—");
  };

  const saveSnapshot = () => {
    const video = videoRef.current;
    const overlay = canvasRef.current;
    if (!video || !overlay || !isCameraLive) return;
    const snapshot = document.createElement("canvas");
    snapshot.width = video.videoWidth;
    snapshot.height = video.videoHeight;
    const ctx = snapshot.getContext("2d");
    if (!ctx) return;
    if (isMirrored) {
      ctx.translate(snapshot.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, snapshot.width, snapshot.height);
    ctx.drawImage(overlay, 0, 0, snapshot.width, snapshot.height);
    const link = document.createElement("a");
    link.download = `handscope-${new Date().toISOString().replaceAll(":", "-")}.png`;
    link.href = snapshot.toDataURL("image/png");
    link.click();
  };

  const modelStatus = modelState === "ready" ? "模型已就緒" : modelState === "error" ? "模型載入失敗" : "正在校準模型";
  const disabledStart = modelState !== "ready";

  return (
    <div className="min-h-screen overflow-hidden bg-[#f3f2ef] text-[#171b21]">
      <header className="border-b border-[#171b21]/10 bg-[#f8f7f4]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-4 sm:px-8 lg:px-10">
          <div className="flex items-center gap-3.5">
            <img className="h-10 w-10 object-contain" src="/manus-storage/handscope-mark_c5f13ec6.png" alt="HandScope 圖示" />
            <div>
              <p className="font-display text-[1.1rem] font-extrabold leading-none tracking-[-0.055em]"><span>HandSc</span><span className="wordmark-o">o</span><span>pe</span></p>
              <p className="mt-1 font-mono text-[9px] font-medium uppercase tracking-[0.21em] text-[#68717c]">Hand observation tool</p>
            </div>
          </div>
          <div className="hidden items-center gap-3 sm:flex">
            <span className={`signal-dot ${modelState === "ready" ? "is-ready" : ""}`} />
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[#55606e]">{modelStatus}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-5 pb-8 pt-8 sm:px-8 lg:px-10 lg:pb-12 lg:pt-12">
        <section className="mb-8 grid gap-8 lg:mb-10 lg:grid-cols-[minmax(0,1fr)_318px] lg:items-end lg:gap-12">
          <div>
            <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[#247bff]">
              <span className="h-px w-8 bg-[#247bff]" />
              即時觀測介面
            </div>
            <h1 className="mt-4 max-w-4xl font-display text-4xl font-extrabold leading-[0.99] tracking-[-0.065em] text-[#171b21] sm:text-5xl lg:text-6xl">
              讓每一個關節，<br />
              留下清楚的軌跡。
            </h1>
          </div>
          <p className="max-w-sm border-l border-[#171b21]/15 pl-4 text-sm font-medium leading-6 text-[#626b76] lg:mb-1">
            使用裝置鏡頭在瀏覽器中即時追蹤雙手 42 個關節點；影像只在您的裝置上處理，不會上傳。
          </p>
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_318px] lg:gap-8">
          <div className="space-y-4">
            <div className="camera-stage aspect-[4/3]">
              <div className="absolute left-5 top-5 z-20 flex items-center gap-2.5 rounded-full border border-white/10 bg-[#0d1119]/70 px-3.5 py-2 backdrop-blur-md">
                <span className={`signal-dot ${isCameraLive ? "is-ready" : ""}`} />
                <span className="font-mono text-[10px] font-medium uppercase tracking-[0.17em] text-white/80">{isCameraLive ? "live / tracking" : "standby / camera"}</span>
              </div>
              <div className="absolute right-5 top-5 z-20 rounded-full border border-white/10 bg-[#0d1119]/70 px-3.5 py-2 font-mono text-[10px] font-medium tracking-[0.15em] text-white/70 backdrop-blur-md">
                SESSION {formatDuration(elapsed)}
              </div>
              <div className="corner corner-tl" /><div className="corner corner-tr" /><div className="corner corner-bl" /><div className="corner corner-br" />

              {!isCameraLive && (
                <div className="absolute inset-0 z-10 flex items-end bg-[#0b0f16]">
                  <div className="absolute inset-0 bg-cover bg-center opacity-60" style={{ backgroundImage: "url('/manus-storage/handscope-observatory-hero_5c081d17.jpg')" }} />
                  <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,12,19,0.94)_0%,rgba(8,12,19,0.58)_48%,rgba(8,12,19,0.12)_100%)]" />
                  <div className="relative max-w-lg p-7 sm:p-10">
                    <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-white/80">
                      <ScanLine className="h-3.5 w-3.5 text-[#63a0ff]" /> Vision ready
                    </div>
                    <h2 className="font-display text-3xl font-extrabold leading-[1.03] tracking-[-0.05em] text-white sm:text-4xl">你的手勢已進入<br />觀測範圍。</h2>
                    <p className="mt-4 max-w-md text-sm leading-6 text-white/65">啟動鏡頭後，系統會將關節座標即時轉換為骨架與手勢狀態。</p>
                  </div>
                </div>
              )}
              <video ref={videoRef} className={`absolute inset-0 h-full w-full object-cover ${isMirrored ? "-scale-x-100" : ""}`} playsInline muted />
              <canvas ref={canvasRef} className={`pointer-events-none absolute inset-0 h-full w-full ${isMirrored ? "-scale-x-100" : ""}`} />
              {cameraError && <div className="absolute inset-x-5 bottom-5 z-30 border border-red-300/30 bg-red-950/80 p-3 text-sm leading-5 text-red-50 backdrop-blur-md">{cameraError}</div>}
            </div>

            <div className="flex flex-col gap-3 border-y border-[#171b21]/10 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                {isCameraLive ? (
                  <button onClick={stopCamera} className="primary-action bg-[#222933] hover:bg-[#171b21]">
                    <CameraOff className="h-4 w-4" />停止鏡頭
                  </button>
                ) : (
                  <button onClick={startCamera} disabled={disabledStart} className="primary-action bg-[#247bff] hover:bg-[#176beb] disabled:cursor-not-allowed disabled:opacity-50">
                    {modelState === "loading" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                    {modelState === "loading" ? "正在載入" : "啟動鏡頭"}
                  </button>
                )}
                <button onClick={() => setIsMirrored((value) => !value)} className="control-action" aria-pressed={isMirrored}>
                  <RefreshCw className="h-3.5 w-3.5" />鏡像 {isMirrored ? "開" : "關"}
                </button>
                <button onClick={() => setShowConnections((value) => !value)} className="control-action" aria-pressed={showConnections}>
                  {showConnections ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}骨架 {showConnections ? "開" : "關"}
                </button>
              </div>
              <button onClick={saveSnapshot} disabled={!isCameraLive} className="control-action self-start disabled:cursor-not-allowed disabled:opacity-40 sm:self-auto">
                <Download className="h-3.5 w-3.5" />儲存觀測畫面
              </button>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="obs-card overflow-hidden" style={{ backgroundImage: "linear-gradient(145deg, rgba(12, 17, 26, 0.98), rgba(21, 33, 49, 0.90)), url('/manus-storage/handscope-signal-texture_7bb4ca28.jpg')" }}>
              <div className="relative z-10 flex items-center justify-between">
                <span className="font-mono text-[10px] font-medium uppercase tracking-[0.17em] text-white/55">辨識結果</span>
                <Sparkles className="h-4 w-4 text-[#5b96ff]" />
              </div>
              <div className="relative z-10 mt-10">
                <p className="font-display text-3xl font-extrabold tracking-[-0.055em] text-white">{gesture}</p>
                <p className="mt-2 text-sm leading-5 text-white/60">{gestureDescription[gesture]}</p>
              </div>
              <div className="relative z-10 mt-7">
                <div className="mb-2 flex justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-white/50"><span>辨識信心</span><span>{confidence}%</span></div>
                <div className="h-1 overflow-hidden bg-white/10"><div className="h-full bg-[#247bff] transition-all duration-200" style={{ width: `${confidence}%` }} /></div>
              </div>
            </div>

            <div className="obs-card bg-[#fbfaf7]">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-medium uppercase tracking-[0.17em] text-[#69727d]">即時資料</span>
                <Activity className="h-4 w-4 text-[#247bff]" />
              </div>
              <dl className="mt-5 divide-y divide-[#171b21]/10 border-y border-[#171b21]/10">
                <div className="data-row"><dt>偵測到的手</dt><dd>{handCount} / 2</dd></div>
                <div className="data-row"><dt>關節座標</dt><dd>{handCount * 21} 點</dd></div>
                <div className="data-row"><dt>主要方向</dt><dd>{handedness}</dd></div>
              </dl>
              <p className="mt-4 flex gap-2 text-xs leading-5 text-[#66707c]"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#247bff]" />模型以連續影格辨識結果，實際精度會受光線與手勢角度影響。</p>
            </div>

            <div className="obs-card bg-[#eeece7]">
              <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.17em] text-[#247bff]"><MousePointer2 className="h-3.5 w-3.5" />操作序列 / input protocol</div>
              <ol className="mt-4 space-y-3">
                {["CAM.01　授予相機存取權限", "OBS.02　掌心維持於取景範圍", "GST.03　依序轉換開掌、握拳、V 字"].map((step, index) => (
                  <li key={step} className="flex gap-3 text-sm leading-5 text-[#394555]"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#247bff]/35 font-mono text-[9px] text-[#247bff]">0{index + 1}</span>{step}</li>
                ))}
              </ol>
            </div>
          </aside>
        </section>

        <section className="mt-10 border-t border-[#171b21]/10 pt-8 lg:mt-14 lg:pt-10">
          <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-center">
            <div>
              <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[#247bff]"><span className="h-px w-8 bg-[#247bff]" />Gesture specimen index / 03</div>
              <h2 className="mt-3 font-display text-3xl font-extrabold tracking-[-0.055em]">先用這些動作<br />開始觀測。</h2>
              <p className="mt-4 max-w-xs text-sm leading-6 text-[#65707c]">此索引記錄三種基準姿態。每筆姿態以 21 個關節座標建立追蹤輪廓，便於確認觀測範圍與辨識邏輯。</p>
              <div className="mt-5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#52606f]"><Check className="h-3.5 w-3.5 text-[#247bff]" />local-only / no frame upload</div>
            </div>
            <div className="relative overflow-hidden border border-[#171b21]/10 bg-[#eeece7] p-2 sm:p-3">
              <div className="absolute left-5 top-5 z-10 flex items-center gap-2 border border-[#171b21]/12 bg-[#f8f7f4]/90 px-3 py-2 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-[#5f6975] backdrop-blur"><span className="h-1.5 w-1.5 rounded-full bg-[#247bff]" />Reference plate / calibrated</div>
              <img src="/manus-storage/handscope-gesture-index_a8f92aab.jpg" alt="張開手掌、握拳與和平手勢的追蹤示意" className="h-auto w-full object-cover" />
              <div className="absolute inset-x-5 bottom-5 z-10 grid grid-cols-3 gap-2 sm:gap-3">
                {[{ id: "G-01", title: "Open palm", detail: "五指延展 / 21 pts" }, { id: "G-02", title: "Closed fist", detail: "指尖收束 / 21 pts" }, { id: "G-03", title: "V sign", detail: "食中指延展 / 21 pts" }].map((item) => (
                  <div key={item.id} className="specimen-tag"><span className="text-[#247bff]">{item.id}</span><span className="mt-1 block text-[#26303b]">{item.title}</span><span className="mt-1 hidden text-[#747d87] sm:block">{item.detail}</span></div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-[1500px] items-center justify-between border-t border-[#171b21]/10 px-5 py-5 font-mono text-[10px] uppercase tracking-[0.15em] text-[#79818b] sm:px-8 lg:px-10">
        <span>HandScope / Browser vision</span><span className="flex items-center gap-2"><Hand className="h-3.5 w-3.5" />local processing</span>
      </footer>
    </div>
  );
}
