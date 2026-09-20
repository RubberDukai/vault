/**
 * Charts for Sheets: bar, line and pie, drawn on a canvas from a block of
 * cells. Pure drawing — the sheet decides what the block means and where the
 * chart sits. Colours follow the current theme.
 */
(() => {
  const SERIES_COLOURS = ['#4c8ee6', '#e3b341', '#3fb950', '#f85149', '#bc8cff', '#ff9a62', '#6cb6ff', '#d2a8ff'];

  const cssVar = (name, fallback) => (getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim() || fallback;

  /** Round axis bounds to sensible numbers: 0–87 becomes 0–100 in steps of 20. */
  function niceScale(min, max, ticks = 5) {
    if (min > 0) min = 0;
    if (max < 0) max = 0;
    if (min === max) { max = min + 1; }
    const span = max - min;
    const rough = span / ticks;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step };
  }

  const fmt = (n) => {
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(Math.abs(n) >= 1e7 ? 0 : 1)}M`;
    if (Math.abs(n) >= 1e4) return `${(n / 1e3).toFixed(0)}k`;
    return Number.isInteger(n) ? String(n) : n.toFixed(Math.abs(n) < 1 ? 2 : 1);
  };

  /**
   * data = { categories: ['Jan', …], series: [{ name, values: [..] }] }
   * spec = { type: 'bar' | 'line' | 'pie', title }
   */
  function drawChart(canvas, spec, data) {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 320;
    const H = canvas.clientHeight || 200;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const text = cssVar('--text', '#ddd');
    const dim = cssVar('--text-dim', '#999');
    const grid = cssVar('--border', '#444');
    const font = cssVar('--font', 'system-ui, sans-serif');
    ctx.font = `12px ${font}`;
    ctx.textBaseline = 'middle';

    let top = 8;
    if (spec.title) {
      ctx.fillStyle = text;
      ctx.font = `600 13px ${font}`;
      ctx.textAlign = 'center';
      ctx.fillText(spec.title, W / 2, 14);
      ctx.font = `12px ${font}`;
      top = 28;
    }

    const series = data.series.filter((s) => s.values.some((v) => typeof v === 'number'));
    if (!series.length || !data.categories.length) {
      ctx.fillStyle = dim;
      ctx.textAlign = 'center';
      ctx.fillText('No numbers in this range', W / 2, H / 2);
      return;
    }

    // Legend along the bottom when there is more than one series.
    let bottom = H - 8;
    if (series.length > 1 && spec.type !== 'pie') {
      bottom = H - 26;
      ctx.textAlign = 'left';
      const widths = series.map((s) => ctx.measureText(s.name).width + 22);
      let x = Math.max(8, (W - widths.reduce((a, b) => a + b, 0)) / 2);
      series.forEach((s, i) => {
        ctx.fillStyle = SERIES_COLOURS[i % SERIES_COLOURS.length];
        ctx.fillRect(x, H - 20, 10, 10);
        ctx.fillStyle = dim;
        ctx.fillText(s.name, x + 14, H - 15);
        x += widths[i];
      });
    }

    if (spec.type === 'pie') return drawPie(ctx, { W, H, top, text, dim, font }, series[0], data.categories);

    const all = series.flatMap((s) => s.values).filter((v) => typeof v === 'number');
    const scale = niceScale(Math.min(...all), Math.max(...all));
    ctx.textAlign = 'right';
    const labelW = Math.max(...[scale.min, scale.max].map((v) => ctx.measureText(fmt(v)).width)) + 10;
    const left = labelW + 4;
    const right = W - 10;
    const axisBottom = bottom - 18;
    const plotH = axisBottom - top;
    const plotW = right - left;
    const yOf = (v) => axisBottom - ((v - scale.min) / (scale.max - scale.min)) * plotH;

    // Gridlines and y labels.
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = dim;
    for (let v = scale.min; v <= scale.max + scale.step / 2; v += scale.step) {
      const y = Math.round(yOf(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      ctx.fillText(fmt(v), left - 6, y);
    }
    // Zero line a touch stronger.
    if (scale.min < 0 && scale.max > 0) {
      ctx.strokeStyle = dim;
      const y = Math.round(yOf(0)) + 0.5;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    }

    const n = data.categories.length;
    const slot = plotW / n;

    // Category labels, thinned so they never overlap.
    ctx.fillStyle = dim;
    ctx.textAlign = 'center';
    const maxLabel = Math.max(...data.categories.map((c) => ctx.measureText(String(c)).width));
    const every = Math.max(1, Math.ceil((maxLabel + 8) / slot));
    data.categories.forEach((c, i) => {
      if (i % every) return;
      const label = String(c);
      const shown = ctx.measureText(label).width > slot * every - 4 ? `${label.slice(0, Math.max(1, Math.floor(label.length * (slot * every - 4) / ctx.measureText(label).width)) - 1)}…` : label;
      ctx.fillText(shown, left + slot * (i + 0.5), axisBottom + 10);
    });

    if (spec.type === 'line') {
      series.forEach((s, si) => {
        ctx.strokeStyle = SERIES_COLOURS[si % SERIES_COLOURS.length];
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        let started = false;
        s.values.forEach((v, i) => {
          if (typeof v !== 'number') { started = false; return; }
          const x = left + slot * (i + 0.5);
          const y = yOf(v);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        });
        ctx.stroke();
        if (n <= 60) {
          s.values.forEach((v, i) => {
            if (typeof v !== 'number') return;
            ctx.beginPath(); ctx.arc(left + slot * (i + 0.5), yOf(v), 3, 0, Math.PI * 2); ctx.fill();
          });
        }
      });
      return;
    }

    // Grouped bars.
    const group = slot * 0.8;
    const barW = group / series.length;
    const y0 = yOf(Math.max(scale.min, Math.min(0, scale.max)));
    series.forEach((s, si) => {
      ctx.fillStyle = SERIES_COLOURS[si % SERIES_COLOURS.length];
      s.values.forEach((v, i) => {
        if (typeof v !== 'number') return;
        const x = left + slot * i + (slot - group) / 2 + barW * si;
        const y = yOf(v);
        ctx.fillRect(x, Math.min(y, y0), Math.max(1, barW - 1), Math.abs(y0 - y) || 1);
      });
    });
  }

  function drawPie(ctx, { W, H, top, text, dim, font }, series, categories) {
    const values = series.values.map((v) => (typeof v === 'number' && v > 0 ? v : 0));
    const total = values.reduce((a, b) => a + b, 0);
    if (!total) {
      ctx.fillStyle = dim; ctx.textAlign = 'center';
      ctx.fillText('Nothing positive to slice', W / 2, H / 2);
      return;
    }
    const legendW = Math.min(W * 0.45, Math.max(...categories.map((c) => ctx.measureText(String(c)).width)) + 60);
    const cx = (W - legendW) / 2;
    const cy = top + (H - top) / 2;
    const r = Math.max(20, Math.min(cx - 10, (H - top) / 2 - 10));
    let angle = -Math.PI / 2;
    values.forEach((v, i) => {
      if (!v) return;
      const sweep = (v / total) * Math.PI * 2;
      ctx.fillStyle = SERIES_COLOURS[i % SERIES_COLOURS.length];
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, angle, angle + sweep); ctx.closePath(); ctx.fill();
      if (sweep > 0.35) {
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.font = `600 12px ${font}`;
        ctx.fillText(`${Math.round((v / total) * 100)}%`, cx + Math.cos(angle + sweep / 2) * r * 0.62, cy + Math.sin(angle + sweep / 2) * r * 0.62);
        ctx.font = `12px ${font}`;
      }
      angle += sweep;
    });

    // Legend down the right.
    const rowH = 16;
    const shown = categories.slice(0, Math.floor((H - top) / rowH));
    let y = cy - (shown.length * rowH) / 2 + rowH / 2;
    const lx = W - legendW + 10;
    ctx.textAlign = 'left';
    shown.forEach((c, i) => {
      ctx.fillStyle = SERIES_COLOURS[i % SERIES_COLOURS.length];
      ctx.fillRect(lx, y - 5, 10, 10);
      ctx.fillStyle = text;
      const label = String(c);
      const max = legendW - 24;
      let out = label;
      while (out.length > 1 && ctx.measureText(out).width > max) out = `${out.slice(0, -2)}…`;
      ctx.fillText(out, lx + 14, y);
      y += rowH;
    });
  }

  window.vaultSheetCharts = { drawChart };
})();
