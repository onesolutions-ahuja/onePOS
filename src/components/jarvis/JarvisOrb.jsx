/*
 * JARVES Orb - the assistant's presence in the till UI.
 *
 * Deliberately NOT a microphone button: it is a living MULTI-COLOUR "energy
 * core" - teal, cyan, emerald, violet and pink plasma layers orbit, drift and
 * bleed through each other while a slow hue drift continuously reshuffles the
 * whole spectrum, so JARVES reads as alive and thinking even at idle (never a
 * plain teal ball, and never a static circular gradient). A light sweep
 * rotates, two glints glide across the surface, the aura breathes and a spark
 * occasionally flares on its own orbit. Every animation is transform/opacity
 * only (plus one cheap hue-rotate on the small core) so it stays negligible
 * for an all-day POS terminal. Microphone control lives INSIDE the panel;
 * this orb only opens/closes JARVES.
 *
 * Branding note: the user-facing identity was rebranded from JARVIS to
 * JARVES; the code keeps its original jarvis-* naming for stability.
 *
 * Placement is provided by the application-level JarvisCorner surface.
 * States: idle | listening | thinking | response (a short energetic flare
 * when an answer lands, then a smooth return to idle).
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import JarvisStyles from "./JarvisStyles.jsx";

export const ORB_STATES = Object.freeze({
  IDLE: "idle",
  LISTENING: "listening",
  THINKING: "thinking",
  RESPONSE: "response",
});

/* Copy shown under the orb while a state is active (hidden while open). */
const STATE_COPY = Object.freeze({
  [ORB_STATES.LISTENING]: "Listening…",
  [ORB_STATES.THINKING]: "Thinking…",
  [ORB_STATES.RESPONSE]: "Here you go",
});

function JarvisVideoCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const video = document.createElement("video");
    video.src = "/jarves.mp4";
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      powerPreference: "low-power",
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(50, 50, false);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { map: { value: texture } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        varying vec2 vUv;
        void main() {
          vec4 color = texture2D(map, vUv);
          float brightness = max(max(color.r, color.g), color.b);
          float alpha = smoothstep(0.025, 0.12, brightness);
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(color.rgb, color.a * alpha);
        }
      `,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(mesh);

    let frameId;
    const render = () => {
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(render);
    };
    video.play().catch(() => {});
    render();

    return () => {
      cancelAnimationFrame(frameId);
      texture.dispose();
      material.dispose();
      mesh.geometry.dispose();
      renderer.dispose();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, []);

  return <canvas ref={canvasRef} className="jarvis-orb-video" data-legacy-layer="jarvis-orb-core" aria-hidden="true" />;
}

function describeOrbState(state, open) {
  if (open) return "JARVES panel is open";
  if (state === ORB_STATES.LISTENING) return "JARVES is listening - open the panel";
  if (state === ORB_STATES.THINKING) return "JARVES is thinking - open the panel";
  if (state === ORB_STATES.RESPONSE) return "JARVES has an answer - open the panel";
  return "Ask JARVES";
}

export default function JarvisOrb({ state = ORB_STATES.IDLE, open = false, onClick, buttonRef, className = "" }) {
  const label = describeOrbState(state, open);

  return (
    <div
      className={`relative z-40 flex flex-col items-center gap-1 ${className}`}
      data-testid="jarvis-orb-host"
    >
      <JarvisStyles />
      <div className="jarvis-orb-container" data-testid="jarvis-orb-container">
        <button
          type="button"
          ref={buttonRef}
          onClick={onClick}
          aria-label={label}
          title={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-testid="jarvis-orb"
          data-state={state}
          className={`jarvis-orb jarvis-orb--${state} rounded-full outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600`}
        >
          <span className="jarvis-orb-halo" aria-hidden="true" />
          <span className="jarvis-orb-ring" aria-hidden="true" />
          <JarvisVideoCanvas />
        </button>
      </div>
      {STATE_COPY[state] && !open && (
        <span className="text-[10px] font-medium text-blue-800 select-none" data-testid="jarvis-orb-state" role="status">
          {STATE_COPY[state]}
        </span>
      )}
    </div>
  );
}