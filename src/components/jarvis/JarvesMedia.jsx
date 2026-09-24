import { useEffect, useRef } from "react";

export const JARVES_BEHAVIOURS = Object.freeze(["behaviour_1", "behaviour_2", "behaviour_3"]);
export const DEFAULT_JARVES_MEDIA = Object.freeze({
  behaviour_1: "/jarves.mp4",
  behaviour_2: "/jarves.mp4",
  behaviour_3: "/jarves.mp4",
});

/**
 * Canonical JARVES media surface. Each behaviour owns an independently
 * replaceable video slot. The source video is never distorted; workflows
 * select a behaviour and the component selects its configured asset.
 */
export default function JarvesMedia({ behaviour = "behaviour_1", sources = DEFAULT_JARVES_MEDIA, className = "", muted = true, loop = true }) {
  const videoRef = useRef(null);
  const safeBehaviour = JARVES_BEHAVIOURS.includes(behaviour) ? behaviour : "behaviour_1";
  const src = sources?.[safeBehaviour] || DEFAULT_JARVES_MEDIA[safeBehaviour];

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.load();
    video.play().catch(() => {});
  }, [src]);

  return (
    <video
      ref={videoRef}
      className={className}
      data-testid="jarves-media"
      data-behaviour={safeBehaviour}
      src={src}
      autoPlay
      playsInline
      muted={muted}
      loop={loop}
      preload="auto"
      aria-hidden="true"
    />
  );
}
