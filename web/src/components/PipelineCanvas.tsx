/* Landing hero centerpiece — a lightweight 2D canvas "pipeline" showing raw
   artifact bytes normalizing into canonical events and converging into a
   finding. No WebGL. Paused when off-screen, hidden, or reduced-motion.
   A static SVG frame renders for reduced-motion users. */

import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "../lib/hooks";

const GLYPHS = "0123456789ABCDEFabcdef<>[]{}/\\|*+=—·";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  kind: "byte" | "event";
  text: string;
  hue: number;
}

export function PipelineCanvas({ height = 420 }: { height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let raf = 0;
    let running = true;
    let w = 0;
    let h = 0;
    let dpr = 1;
    const particles: Particle[] = [];
    const start = performance.now();

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = wrap.clientWidth;
      h = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const spawnByte = () => {
      const y = 20 + Math.random() * (h - 40);
      particles.push({
        x: -40 - Math.random() * 120,
        y,
        vx: 0.55 + Math.random() * 0.9,
        vy: (h / 2 - y) * 0.00035 + (Math.random() - 0.5) * 0.08,
        life: 0,
        maxLife: 460 + Math.random() * 320,
        kind: "byte",
        text: Array.from(
          { length: 2 + ((Math.random() * 4) | 0) },
          () => GLYPHS[(Math.random() * GLYPHS.length) | 0],
        ).join(""),
        hue: 0,
      });
    };

    const EVENT_LABELS = [
      "process.create",
      "network.connect",
      "file.create",
      "image.load",
      "service.state",
      "driver.load",
      "thread.remote",
      "registry.set",
    ];

    const spawnEvent = (x: number, y: number) => {
      particles.push({
        x,
        y,
        vx: 0.75 + Math.random() * 0.5,
        vy: (Math.random() - 0.5) * 0.05,
        life: 0,
        maxLife: 260 + Math.random() * 120,
        kind: "event",
        text: EVENT_LABELS[(Math.random() * EVENT_LABELS.length) | 0],
        hue: 0,
      });
    };

    let accBytes = 0;
    let accEvents = 0;

    const draw = (now: number) => {
      if (!running) return;
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, w, h);

      const gateX = w * 0.46;
      const nodeX = w * 0.82;
      const midY = h / 2;

      /* pipeline rails */
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(gateX, midY);
      ctx.lineTo(nodeX, midY);
      ctx.stroke();

      /* normalize gate */
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
      ctx.strokeStyle = `rgba(240,168,46,${0.35 + pulse * 0.35})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(gateX, midY - 46);
      ctx.lineTo(gateX, midY + 46);
      ctx.stroke();
      ctx.fillStyle = "rgba(240,168,46,0.9)";
      ctx.font = "10px 'JetBrains Mono Variable', monospace";
      ctx.fillText("NORMALIZE", gateX - 34, midY - 56);

      /* finding node */
      ctx.strokeStyle = "rgba(240,168,46,0.7)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(nodeX, midY, 10 + pulse * 2.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(240,168,46,0.95)";
      ctx.beginPath();
      ctx.arc(nodeX, midY, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(233,235,238,0.85)";
      ctx.fillText("FINDING", nodeX - 22, midY + 34);

      /* spawn */
      accBytes += 1;
      if (accBytes >= 9) {
        accBytes = 0;
        spawnByte();
      }
      accEvents += 1;
      if (accEvents >= 42) {
        accEvents = 0;
        spawnEvent(gateX + 8, midY + (Math.random() - 0.5) * 54);
      }

      /* step + draw particles */
      ctx.font = "10px 'JetBrains Mono Variable', monospace";
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += 1;
        p.x += p.vx;
        p.y += p.vy;

        /* funnel toward the rail after the gate */
        if (p.kind === "event" && p.x > gateX) {
          p.vy += (midY - p.y) * 0.004;
        }
        if (p.kind === "byte" && p.x > gateX - 60) {
          p.vy += (midY - p.y) * 0.0016;
        }

        const k = 1 - p.life / p.maxLife;
        if (k <= 0 || p.x > w + 60) {
          particles.splice(i, 1);
          continue;
        }

        if (p.kind === "byte") {
          ctx.fillStyle = `rgba(154,161,171,${0.55 * k})`;
        } else {
          const nearNode = Math.abs(p.x - nodeX) < 90;
          ctx.fillStyle = nearNode
            ? `rgba(240,168,46,${0.95 * k})`
            : `rgba(200,215,232,${0.8 * k})`;
        }
        ctx.fillText(p.text, p.x, p.y);
      }

      raf = requestAnimationFrame(draw);
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !running) {
            running = true;
            raf = requestAnimationFrame(draw);
          } else if (!e.isIntersecting && running) {
            running = false;
            cancelAnimationFrame(raf);
          }
        }
      },
      { threshold: 0.05 },
    );
    io.observe(wrap);

    const onVis = () => {
      if (document.hidden && running) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!document.hidden && !running) {
        running = true;
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    raf = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [reduced]);

  if (reduced) {
    return (
      <div
        ref={wrapRef}
        style={{ height, width: "100%", position: "relative" }}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 600 200"
          style={{ width: "100%", height: "100%" }}
          role="img"
          aria-label="Static pipeline diagram: raw bytes flow through a normalize gate into a finding node."
        >
          <line
            x1="20"
            y1="100"
            x2="580"
            y2="100"
            stroke="rgba(255,255,255,0.08)"
          />
          <line
            x1="276"
            y1="60"
            x2="276"
            y2="140"
            stroke="rgba(240,168,46,0.5)"
          />
          <circle
            cx="490"
            cy="100"
            r="12"
            fill="none"
            stroke="rgba(240,168,46,0.7)"
          />
          <circle cx="490" cy="100" r="3" fill="rgba(240,168,46,0.9)" />
          <text
            x="242"
            y="50"
            fill="rgba(240,168,46,0.8)"
            fontSize="10"
            fontFamily="monospace"
          >
            NORMALIZE
          </text>
          <text
            x="470"
            y="132"
            fill="rgba(233,235,238,0.8)"
            fontSize="10"
            fontFamily="monospace"
          >
            FINDING
          </text>
          <text
            x="30"
            y="94"
            fill="rgba(154,161,171,0.7)"
            fontSize="10"
            fontFamily="monospace"
          >
            4d5a 90 03 00 00 00 …
          </text>
        </svg>
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      style={{ height, width: "100%", position: "relative" }}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
