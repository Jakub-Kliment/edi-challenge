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
      <div className="preview-frame">
        <img src={dataUri} alt="Live preview of the badge" />
      </div>
      <p className="preview-note">
        Rendered from the same template the contract uses.<br />
        What you see is what gets stored on-chain.
      </p>
    </div>
  );
}
