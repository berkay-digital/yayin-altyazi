import type { OBSWebSocket } from "obs-websocket-js"

/** Something that hands out the current video frame on demand. */
export interface FrameSource {
  /** Current frame, or null if none is available right now. */
  grab(): Promise<ImageBitmap | HTMLCanvasElement | null>
  close(): void
}

export type ObsClient = OBSWebSocket

export const OBS_DEFAULT_URL = "ws://127.0.0.1:4455"

/**
 * Connect to obs-websocket v5. The library is imported lazily so this module
 * is safe to import during SSR.
 */
export async function connectObs(url: string = OBS_DEFAULT_URL, password?: string): Promise<ObsClient> {
  const { default: OBSWebSocketCtor } = await import("obs-websocket-js")
  const obs = new OBSWebSocketCtor()
  await obs.connect(url, password || undefined, { rpcVersion: 1 })
  return obs
}

export interface VideoSourceInfo {
  name: string
  uuid?: string
  /** Input kind, or "scene" for scenes. */
  kind: string
  /** True for kinds that usually carry console or game video. */
  preferred: boolean
}

const PREFERRED_KINDS = [
  "dshow_input",
  "av_capture_input",
  "av_capture_input_v2",
  "v4l2_input",
  "ffmpeg_source",
  "game_capture",
  "window_capture",
  "monitor_capture",
  "screen_capture",
  "xcomposite_input",
  "pipewire-screen-capture-source",
  "pipewire-desktop-capture-source",
  "macos-avcapture",
  "macos-avcapture-fast",
  "decklink-input",
  "elgato",
]

function isPreferredKind(kind: string): boolean {
  return PREFERRED_KINDS.some((k) => kind === k || kind.startsWith(`${k}_`) || kind.includes("capture"))
}

/**
 * List inputs and scenes for the setup UI dropdown. Preferred capture kinds
 * come first, then other inputs, then scenes.
 */
export async function listVideoSources(obs: ObsClient): Promise<VideoSourceInfo[]> {
  const [inputs, scenes] = await Promise.all([obs.call("GetInputList"), obs.call("GetSceneList")])
  const out: VideoSourceInfo[] = []
  for (const input of inputs.inputs) {
    const name = String(input.inputName ?? "")
    if (!name) continue
    const kind = String(input.inputKind ?? input.unversionedInputKind ?? "unknown")
    // Audio-only inputs cannot be screenshotted.
    if (/wasapi|pulse|coreaudio|alsa|jack|audio/i.test(kind)) continue
    out.push({
      name,
      uuid: typeof input.inputUuid === "string" ? input.inputUuid : undefined,
      kind,
      preferred: isPreferredKind(kind),
    })
  }
  out.sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.name.localeCompare(b.name))
  for (const scene of scenes.scenes) {
    const name = String(scene.sceneName ?? "")
    if (!name) continue
    out.push({
      name,
      uuid: typeof scene.sceneUuid === "string" ? scene.sceneUuid : undefined,
      kind: "scene",
      preferred: false,
    })
  }
  return out
}

export interface ObsFrameSourceOptions {
  /** An existing client. If omitted, url/password are used to connect. */
  obs?: ObsClient
  url?: string
  password?: string
  sourceName: string
  /**
   * Screenshot width, default 1920. Subtitles are small: on GTA V footage
   * 1920 read 94% of lines at >= 0.9 similarity versus about 87% at 1280.
   * Use the capture's real width; going above it adds nothing.
   */
  imageWidth?: number
  /** JPEG quality 0..100. */
  quality?: number
}

export interface ObsFrameSource extends FrameSource {
  obs: ObsClient
}

async function decodeDataUrl(dataUrl: string): Promise<ImageBitmap> {
  const comma = dataUrl.indexOf(",")
  const mime = /^data:([^;]+)/.exec(dataUrl)?.[1] ?? "image/jpeg"
  const bin = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return createImageBitmap(new Blob([bytes], { type: mime }))
}

/** Grabs frames with GetSourceScreenshot. */
export async function createObsFrameSource(opts: ObsFrameSourceOptions): Promise<ObsFrameSource> {
  const ownsClient = !opts.obs
  const obs = opts.obs ?? (await connectObs(opts.url, opts.password))
  const imageWidth = opts.imageWidth ?? 1920
  const quality = opts.quality ?? 85
  let closed = false

  return {
    obs,
    async grab() {
      if (closed) return null
      const res = await obs.call("GetSourceScreenshot", {
        sourceName: opts.sourceName,
        imageFormat: "jpg",
        imageWidth,
        imageCompressionQuality: quality,
      })
      if (!res.imageData) return null
      return decodeDataUrl(res.imageData)
    },
    close() {
      closed = true
      if (ownsClient) void obs.disconnect().catch(() => {})
    },
  }
}

export interface VideoFrameSourceOptions {
  /**
   * Simulate an OBS screenshot: scale to this width and round-trip through
   * JPEG at `jpegQuality`. Used by the test harness for realistic numbers.
   */
  simulateWidth?: number
  jpegQuality?: number
}

/** Grabs the current frame of a playing <video>. For demos and tests. */
export function createVideoFrameSource(video: HTMLVideoElement, opts: VideoFrameSourceOptions = {}): FrameSource {
  let canvas: HTMLCanvasElement | null = null
  return {
    async grab() {
      if (video.readyState < 2 || !video.videoWidth) return null
      if (!opts.simulateWidth) return createImageBitmap(video)
      const w = opts.simulateWidth
      const h = Math.round((video.videoHeight / video.videoWidth) * w)
      canvas ??= document.createElement("canvas")
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      const ctx = canvas.getContext("2d")
      if (!ctx) return null
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(video, 0, 0, w, h)
      if (opts.jpegQuality === undefined) return createImageBitmap(canvas)
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas!.toBlob(resolve, "image/jpeg", opts.jpegQuality! / 100),
      )
      return blob ? createImageBitmap(blob) : null
    },
    close() {
      canvas = null
    },
  }
}
