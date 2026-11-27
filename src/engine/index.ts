export * from "./types.ts"
export {
  connectObs,
  createObsFrameSource,
  createVideoFrameSource,
  listVideoSources,
  OBS_DEFAULT_URL,
  type FrameSource,
  type ObsClient,
  type ObsFrameSource,
  type ObsFrameSourceOptions,
  type VideoFrameSourceOptions,
  type VideoSourceInfo,
} from "./frame-source.ts"
export {
  analyzeCrop,
  computeSignature,
  cropRegion,
  encodePgm,
  grayToCanvas,
  preprocessFrame,
  regionToPixels,
  renderForOcr,
  signatureDistance,
  type CropAnalysis,
  type GrayImage,
  type PreprocessResult,
  type RgbaImage,
} from "./preprocess.ts"
export {
  createOcr,
  MODEL_CACHE_KEY,
  PSM,
  SUBTITLE_WHITELIST,
  type OcrEngine,
  type OcrOptions,
  type OcrResult,
  type PsmValue,
} from "./ocr.ts"
export { cleanOcrLines, isExtension, isPlausibleText, levenshtein, normalizeForCache, similarity, tidyText } from "./text.ts"
export { SubtitleReader, type SubtitleReaderOptions } from "./reader.ts"
