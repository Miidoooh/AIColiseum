const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789<>/{}[]#$%&*+=';

/** A sparse falling-glyph layer drawn on a transparent canvas, so it can sit over the 3D scene. */
export function startCodeRain(canvas: HTMLCanvasElement, opts: { size?: number; fps?: number; density?: number } = {}): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const size = opts.size ?? 15;
  const fps = opts.fps ?? 14;
  const density = opts.density ?? 0.35;
  let width = 0;
  let height = 0;
  let drops: { y: number; active: boolean }[] = [];

  const resize = () => {
    width = canvas.width = canvas.clientWidth;
    height = canvas.height = canvas.clientHeight;
    drops = Array.from({ length: Math.ceil(width / size) }, () => ({
      y: Math.random() * -(height / size),
      active: Math.random() < density,
    }));
  };
  resize();
  window.addEventListener('resize', resize);

  let last = 0;
  let raf = 0;
  const frame = (t: number) => {
    raf = requestAnimationFrame(frame);
    if (t - last < 1000 / fps) return;
    last = t;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = `${size}px monospace`;
    drops.forEach((drop, i) => {
      if (!drop.active) return;
      ctx.fillStyle = Math.random() < 0.08 ? '#d8ffe8' : '#39ff88';
      ctx.fillText(GLYPHS[Math.floor(Math.random() * GLYPHS.length)], i * size, drop.y * size);
      drop.y += 1;
      if (drop.y * size > height && Math.random() > 0.96) {
        drop.y = 0;
        drop.active = Math.random() < density;
      }
    });
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
  };
}
