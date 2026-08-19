"use client";

import { useMemo } from "react";
import { buildSVG, type BadgeData } from "@/shared/badge-template";

/**
 * The live preview.
 *
 * Rendered through <img src={dataUri}> rather than inlined into the DOM, on
 * purpose. Inlined SVG inherits the page's CSS and loads external resources
 * happily, so it would look right here and wrong in a wallet. An <img> tag
 * reproduces the wallet's isolated rendering context — including the
 * subresource blocking that forced the embedded-image design in the first
 * place. If the picture shows here, it will show there.
 *
 * The floating/tilt motion below is presentational only — CSS only, on
 * wrapper elements around the <img>. It never touches buildSVG() or the
 * bytes that get minted, so "what renders here" and "what's on-chain" stay
 * identical; only how this page presents the preview differs.
 *
 * The tilt is a plain CSS `:hover` transform, not a JS pointer-tracking
 * effect. A cursor-following version was tried first and hit several real
 * bugs (a transition fighting a value that updates on every event,
 * getBoundingClientRect() returning a post-transform box, missed release
 * events). None of that can happen here: the browser's own hover state
 * machine drives it, with no event stream to get out of sync.
 *
 * .preview-frame is the ONE element that both tilts and carries the visual
 * frame (rounded corners, border, shadow) — it does not sit inside a
 * separate overflow:hidden clipping wrapper. A clipping ancestor needs
 * overflow:hidden, which forces transform-style back to flat per spec, so
 * an earlier version where the clip wrapper was a separate parent produced
 * a frame that stayed visually still while only the image inside it
 * tilted. The SVG badge is already a plain rectangle with no rounding of
 * its own, so rounding the <img> element directly gives the same rounded
 * look without needing any clipping container at all — nothing has to
 * clip against a box that isn't tilting with it.
 */
export function BadgePreview({ data }: { data: BadgeData }) {
  const dataUri = useMemo(() => {
    const svg = buildSVG(data);
    // encodeURIComponent rather than btoa: btoa throws on any non-Latin1
    // character, and names legitimately contain them.
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [data]);

  return (
    <div className="preview-wrap">
      <div className="preview-float">
        {/* Four invisible corner zones, siblings placed BEFORE
           .preview-frame (required for the ~ sibling selector in
           globals.css to reach it). Each is a :hover trigger for a
           different tilt direction, which is what makes the tilt actually
           correspond to which part of the card the cursor is over. */}
        <div className="preview-zone preview-zone-tl" />
        <div className="preview-zone preview-zone-tr" />
        <div className="preview-zone preview-zone-bl" />
        <div className="preview-zone preview-zone-br" />
        <div className="preview-frame">
          <img src={dataUri} alt="Live preview of the badge" />
        </div>
      </div>
    </div>
  );
}
