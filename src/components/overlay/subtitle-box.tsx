import { useEffect } from "react"
import { FONTS, type OverlaySettings, type SubtitleStyle } from "@/shared/settings"
import type { TextBox } from "@/engine/types"
import { loadFont } from "./fonts"

/**
 * Renders the Turkish line where and how the streamer wants it.
 * All pixel values are on a 1080p reference and scale with the source height.
 */
export function SubtitleBox({
  settings,
  tr,
  en,
  visible,
  box,
  objective,
  unit = "vh",
}: {
  settings: OverlaySettings
  tr: string
  en?: string
  visible: boolean
  /** Where the English line sits (from the reader). Used by the "cover" placement. */
  box?: TextBox
  /** The current mission objective, drawn smaller under the dialogue in its own color. */
  objective?: { tr: string; visible: boolean; box?: TextBox } | null
  /** "cqh" when rendered inside a size container (dashboard preview). */
  unit?: "vh" | "cqh"
}) {
  const { region } = settings
  const s = settings.style
  const px = (n: number) => `${(n / 1080) * 100}${unit}`

  useEffect(() => {
    loadFont(s.font)
  }, [s.font])

  // Cover: one box exactly over each English text (dialogue, objective), sized to it.
  if (s.placement === "cover") {
    const showObjective = s.objectives && Boolean(objective?.tr)
    return (
      <>
        {tr ? (
          <CoverBox style={s} tr={tr} visible={visible} box={box ?? fallbackBox(settings, 0.5)} unit={unit} />
        ) : null}
        {showObjective ? (
          <CoverBox
            style={s}
            tr={objective!.tr}
            visible={objective!.visible}
            box={objective!.box ?? fallbackBox(settings, 0.8)}
            unit={unit}
            color={s.objectiveColor}
            scale={s.objectiveScale / 0.8}
          />
        ) : null}
      </>
    )
  }

  // Anchor point and how the block hangs from it.
  const centerX = region.x + region.w / 2
  let left = centerX
  let top = 0
  let translateY = "0%"
  const width = s.width
  switch (s.placement) {
    case "above":
      top = region.y
      translateY = "-100%"
      break
    case "below":
      top = region.y + region.h
      break
    case "top":
      left = 0.5
      top = 0.04
      break
    case "custom":
      left = s.customX
      top = s.customY
      translateY = "-50%"
      break
  }

  const justify = s.align === "left" ? "flex-start" : s.align === "right" ? "flex-end" : "center"
  const shadow = s.shadow
    ? `0 0 ${px(s.shadowBlur)} ${s.shadowColor}, 0 ${px(2)} ${px(s.shadowBlur / 2)} ${s.shadowColor}`
    : undefined
  const anim = s.animation === "none" ? undefined : `ya-${s.animation} 180ms ease-out both`
  const showDialogue = visible && Boolean(tr)
  const showObjective = s.objectives && Boolean(objective?.visible && objective.tr)

  return (
    <div
      className="pointer-events-none absolute flex"
      style={{
        left: `${left * 100}%`,
        top: `${top * 100}%`,
        width: `${width * 100}%`,
        transform: `translate(-50%, ${translateY}) translateY(${px(s.offsetY)})`,
        justifyContent: justify,
        opacity: showDialogue || showObjective ? 1 : 0,
        transition: "opacity 160ms ease",
      }}
    >
      <div
        style={{
          width: s.background && s.boxFullWidth ? "100%" : undefined,
          maxWidth: "100%",
          background: s.background ? hexToRgba(s.boxColor, s.boxOpacity) : undefined,
          padding: s.background ? `${s.boxPadding * 0.5}em ${s.boxPadding}em` : 0,
          borderRadius: s.background ? px(s.boxRadius) : undefined,
          textAlign: s.align,
          fontFamily: FONTS[s.font].family,
          fontSize: px(s.fontSize),
          fontWeight: s.fontWeight,
          fontStyle: s.italic ? "italic" : undefined,
          lineHeight: s.lineHeight,
          letterSpacing: `${s.letterSpacing}em`,
          textTransform: s.uppercase ? "uppercase" : undefined,
          color: s.textColor,
          textWrap: "balance",
        }}
      >
        {tr ? (
          <div key={tr} style={{ display: showDialogue || !showObjective ? undefined : "none", animation: showDialogue ? anim : undefined }}>
            <div
              style={{
                WebkitTextStroke: s.outlineWidth ? `${px(s.outlineWidth * 2)} ${s.outlineColor}` : undefined,
                paintOrder: "stroke fill",
                textShadow: shadow,
              }}
            >
              {tr}
            </div>
            {s.showEnglish && en ? (
              <div
                style={{
                  fontSize: `${s.englishScale}em`,
                  fontWeight: 500,
                  color: s.englishColor,
                  marginTop: "0.25em",
                  textTransform: "none",
                  WebkitTextStroke: s.outlineWidth ? `${px(Math.max(1, s.outlineWidth))} ${s.outlineColor}` : undefined,
                  paintOrder: "stroke fill",
                  textShadow: shadow,
                }}
              >
                {en}
              </div>
            ) : null}
          </div>
        ) : null}
        {showObjective ? (
          <div
            key={`objective:${objective!.tr}`}
            style={{
              fontSize: `${s.objectiveScale}em`,
              color: s.objectiveColor,
              marginTop: showDialogue ? "0.35em" : 0,
              textTransform: "none",
              animation: anim,
              WebkitTextStroke: s.outlineWidth ? `${px(Math.max(1, s.outlineWidth * 1.6))} ${s.outlineColor}` : undefined,
              paintOrder: "stroke fill",
              textShadow: shadow,
            }}
          >
            {objective!.tr}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Before the reader has located a line (and in the dashboard preview): a band in the subtitle area. */
function fallbackBox(settings: OverlaySettings, at: number): TextBox {
  const r = settings.region
  return { x: r.x + r.w * 0.2, y: r.y + r.h * at - r.h * 0.07, w: r.w * 0.6, h: r.h * 0.14, glyph: 13 / 1080 }
}

/**
 * The Turkish line on an opaque box centered on the English text it replaces. The box is at least as big
 * as the English (plus padding) and grows to fit the Turkish; the font follows the game's own subtitle
 * size, with the chosen font size as the upper limit.
 */
function CoverBox({
  style: s,
  tr,
  visible,
  box,
  unit,
  color,
  scale = 1,
}: {
  style: SubtitleStyle
  tr: string
  visible: boolean
  box: TextBox
  unit: "vh" | "cqh"
  color?: string
  scale?: number
}) {
  const wUnit = unit === "vh" ? "vw" : "cqw"
  const px = (n: number) => `${(n / 1080) * 100}${unit}`
  // A glyph (about the x-height) is roughly half the font size; 2.1x lands a little above the game's text.
  const fontPx = Math.min(s.fontSize, Math.max(18, box.glyph * 1080 * 2.1)) * scale
  const padX = fontPx * 0.55
  const padY = fontPx * 0.25
  const shadow = s.shadow ? `0 0 ${px(s.shadowBlur)} ${s.shadowColor}` : undefined
  return (
    <div
      className="pointer-events-none absolute flex items-center justify-center"
      style={{
        left: `${(box.x + box.w / 2) * 100}%`,
        top: `${(box.y + box.h / 2) * 100}%`,
        transform: `translate(-50%, -50%) translateY(${px(s.offsetY)})`,
        minWidth: `calc(${box.w * 100}${wUnit} + ${px(padX * 2)})`,
        minHeight: `calc(${box.h * 100}${unit} + ${px(padY * 2)})`,
        maxWidth: `${Math.max(s.width, box.w) * 100}%`,
        padding: `${px(padY)} ${px(padX)}`,
        background: s.background ? hexToRgba(s.boxColor, Math.max(s.boxOpacity, 0.96)) : undefined,
        borderRadius: s.background ? px(s.boxRadius) : undefined,
        opacity: visible && tr ? 1 : 0,
        transition: "opacity 160ms ease",
        fontFamily: FONTS[s.font].family,
        fontSize: px(fontPx),
        fontWeight: s.fontWeight,
        fontStyle: s.italic ? "italic" : undefined,
        lineHeight: 1.2,
        letterSpacing: `${s.letterSpacing}em`,
        textTransform: s.uppercase ? "uppercase" : undefined,
        textAlign: "center",
        color: color ?? s.textColor,
        textWrap: "balance",
        textShadow: shadow,
        WebkitTextStroke: s.outlineWidth ? `${px(s.outlineWidth * 2)} ${s.outlineColor}` : undefined,
        paintOrder: "stroke fill",
      }}
    >
      {tr}
    </div>
  )
}

function hexToRgba(hex: string, alpha: number) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return `rgba(0,0,0,${alpha})`
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`
}
