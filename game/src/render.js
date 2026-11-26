// The painter: a pseudo-3D chase view over the island, the plane, the HUD with its
// lit instruments, and the title / pause / end screens. Everything is drawn on one
// canvas, with no image or font loaded from anywhere.
import { CAMERA, RUNWAY, WORLD } from './config.js';
import { groundColour, groundHeight, isWater, riverCentre } from './terrain.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function normAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let width = 0;
  let height = 0;
  let focal = 600;

  function resize() {
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    focal = height * 1.05;
  }
  resize();
  window.addEventListener('resize', resize);

  // Camera basis from the plane: behind it, above it, rolled with its bank.
  function cameraBasis(state) {
    const fwd = {
      x: Math.sin(state.heading) * Math.cos(state.pitch),
      y: Math.sin(state.pitch),
      z: Math.cos(state.heading) * Math.cos(state.pitch),
    };
    const cam = {
      x: state.x - fwd.x * CAMERA.behind,
      y: state.y + CAMERA.above - fwd.y * CAMERA.behind,
      z: state.z - fwd.z * CAMERA.behind,
    };
    const look = {
      x: state.x + fwd.x * CAMERA.lookAhead,
      y: state.y + fwd.y * CAMERA.lookAhead,
      z: state.z + fwd.z * CAMERA.lookAhead,
    };
    let fx = look.x - cam.x;
    let fy = look.y - cam.y;
    let fz = look.z - cam.z;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    // Right = forward x world-up, then roll the right/up pair around forward by the bank.
    let rx = fz;
    let ry = 0;
    let rz = -fx;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const ux = fy * rz - fz * ry;
    const uy = fz * rx - fx * rz;
    const uz = fx * ry - fy * rx;
    const c = Math.cos(state.roll);
    const s = Math.sin(state.roll);
    const right = { x: rx * c + ux * s, y: ry * c + uy * s, z: rz * c + uz * s };
    const up = { x: ux * c - rx * s, y: uy * c - ry * s, z: uz * c - rz * s };
    return { cam, fwd: { x: fx, y: fy, z: fz }, right, up };
  }

  function project(basis, px, py, pz) {
    const dx = px - basis.cam.x;
    const dy = py - basis.cam.y;
    const dz = pz - basis.cam.z;
    const cz = dx * basis.fwd.x + dy * basis.fwd.y + dz * basis.fwd.z;
    if (cz < 2) return null;
    const cx = dx * basis.right.x + dy * basis.right.y + dz * basis.right.z;
    const cy = dx * basis.up.x + dy * basis.up.y + dz * basis.up.z;
    return {
      x: width / 2 + (cx / cz) * focal,
      y: height * 0.52 - (cy / cz) * focal,
      d: cz,
      scale: focal / cz,
    };
  }

  function drawSky(state, basis) {
    const g = ctx.createLinearGradient(0, 0, 0, height * 0.62);
    g.addColorStop(0, '#5fb2ef');
    g.addColorStop(0.55, '#8ecfee');
    g.addColorStop(1, '#d8f1fb');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height * 0.62 + 2);
    // The sun sits east of north and slides with the heading.
    const sunAz = normAngle(1.1 - state.heading);
    const sunX = width / 2 + Math.tan(clamp(sunAz, -1.2, 1.2)) * focal * 0.9;
    const sunY = height * 0.14;
    if (sunX > -80 && sunX < width + 80) {
      const sg = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 90);
      sg.addColorStop(0, 'rgba(255, 246, 200, 0.95)');
      sg.addColorStop(0.25, 'rgba(255, 224, 140, 0.55)');
      sg.addColorStop(1, 'rgba(255, 224, 140, 0)');
      ctx.fillStyle = sg;
      ctx.fillRect(sunX - 100, sunY - 100, 200, 200);
      ctx.fillStyle = '#fff7cf';
      ctx.beginPath();
      ctx.arc(sunX, sunY, 26, 0, Math.PI * 2);
      ctx.fill();
    }
    // A hazy far ridge closes the horizon.
    const horizonY = height * 0.52;
    ctx.beginPath();
    ctx.moveTo(0, horizonY + 2);
    for (let x = 0; x <= width; x += 32) {
      const y = horizonY - 26 - 34 * Math.sin(x * 0.006 + 1.3) - 18 * Math.sin(x * 0.017 + 4.0);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, horizonY + 2);
    ctx.closePath();
    ctx.fillStyle = '#9db8c9';
    ctx.fill();
  }

  function drawGround(state, basis, scenery) {
    const step = WORLD.sliceStep;
    const far = WORLD.viewDistance;
    // Ground strips, far to near, sampled along the camera's right axis.
    for (let d = far; d > 14; d -= step) {
      const d2 = d - step;
      const halfW = WORLD.halfViewWidth;
      const cols = 18;
      const wp = (dd, t) => {
        const wx = basis.cam.x + basis.fwd.x * dd + basis.right.x * t;
        const wz = basis.cam.z + basis.fwd.z * dd + basis.right.z * t;
        return { x: wx, y: groundHeight(wx, wz), z: wz };
      };
      for (let c = 0; c < cols; c += 1) {
        const t0 = -halfW + (2 * halfW * c) / cols;
        const t1 = -halfW + (2 * halfW * (c + 1)) / cols;
        const tc = (t0 + t1) / 2;
        const farC = wp(d, tc);
        const p00 = project(basis, ...Object.values(wp(d2, t0)));
        const p10 = project(basis, ...Object.values(wp(d2, t1)));
        const p01 = project(basis, ...Object.values(wp(d, t0)));
        const p11 = project(basis, ...Object.values(wp(d, t1)));
        if (!p00 || !p10 || !p01 || !p11) continue;
        ctx.fillStyle = groundColour(farC.x, farC.z, farC.y);
        ctx.beginPath();
        ctx.moveTo(p00.x, p00.y);
        ctx.lineTo(p10.x, p10.y);
        ctx.lineTo(p11.x, p11.y);
        ctx.lineTo(p01.x, p01.y);
        ctx.closePath();
        ctx.fill();
      }
    }
    drawRunway(basis);
  }

  function drawRunway(basis) {
    for (let z = RUNWAY.z0; z < RUNWAY.z1; z += 50) {
      const z2 = Math.min(RUNWAY.z1, z + 50);
      const a = project(basis, -RUNWAY.halfWidth, 0.4, z);
      const b = project(basis, RUNWAY.halfWidth, 0.4, z);
      const c = project(basis, RUNWAY.halfWidth, 0.4, z2);
      const d = project(basis, -RUNWAY.halfWidth, 0.4, z2);
      if (!a || !b || !c || !d) continue;
      ctx.fillStyle = '#454550';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
      ctx.closePath();
      ctx.fill();
      // Centreline dash.
      if (Math.floor(z / 50) % 2 === 0) {
        const m1 = project(basis, -1.2, 0.55, z + 8);
        const m2 = project(basis, 1.2, 0.55, z + 8);
        const m3 = project(basis, 1.2, 0.55, z + 32);
        const m4 = project(basis, -1.2, 0.55, z + 32);
        if (m1 && m2 && m3 && m4) {
          ctx.fillStyle = '#f2f2e8';
          ctx.beginPath();
          ctx.moveTo(m1.x, m1.y); ctx.lineTo(m2.x, m2.y); ctx.lineTo(m3.x, m3.y); ctx.lineTo(m4.x, m4.y);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
    // Threshold bars at both ends.
    for (const z of [RUNWAY.z0 + 4, RUNWAY.z1 - 4]) {
      for (const x of [-10, -4, 2, 8]) {
        const a = project(basis, x, 0.55, z);
        const b = project(basis, x + 3.5, 0.55, z);
        const c = project(basis, x + 3.5, 0.55, z + 18);
        const d = project(basis, x, 0.55, z + 18);
        if (!a || !b || !c || !d) continue;
        ctx.fillStyle = '#f2f2e8';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  function drawClouds(basis, scenery) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const cloud of scenery.clouds) {
      const p = project(basis, cloud.x, cloud.y, cloud.z);
      if (!p || p.d > 900) continue;
      const s = cloud.size * p.scale * 0.02;
      if (s < 4) continue;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, s, s * 0.36, 0, 0, Math.PI * 2);
      ctx.ellipse(p.x - s * 0.5, p.y + s * 0.08, s * 0.6, s * 0.28, 0, 0, Math.PI * 2);
      ctx.ellipse(p.x + s * 0.5, p.y + s * 0.06, s * 0.65, s * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawTrees(basis, scenery) {
    const items = [];
    for (const t of scenery.trees) {
      const p = project(basis, t.x, t.y, t.z);
      if (!p || p.d < 10 || p.d > 620) continue;
      items.push({ t, p });
    }
    items.sort((a, b) => b.p.d - a.p.d);
    for (const { t, p } of items.slice(0, 160)) {
      const s = t.size * p.scale * 0.055;
      if (s < 2) continue;
      const ground = project(basis, t.x, t.y, t.z);
      if (!ground) continue;
      ctx.fillStyle = '#3f7a2e';
      ctx.beginPath();
      ctx.moveTo(ground.x, ground.y - s);
      ctx.lineTo(ground.x - s * 0.55, ground.y);
      ctx.lineTo(ground.x + s * 0.55, ground.y);
      ctx.closePath();
      ctx.fill();
    }
    // Little towns: a cluster of rooftops.
    for (const town of scenery.towns) {
      const p = project(basis, town.x, town.y, town.z);
      if (!p || p.d < 12 || p.d > 640) continue;
      const s = town.size * p.scale * 0.05;
      if (s < 3) continue;
      ctx.fillStyle = '#b08a5e';
      ctx.fillRect(p.x - s / 2, p.y - s * 0.5, s, s * 0.5);
      ctx.fillStyle = '#7a4a3a';
      ctx.beginPath();
      ctx.moveTo(p.x - s / 2, p.y - s * 0.5);
      ctx.lineTo(p.x, p.y - s * 0.85);
      ctx.lineTo(p.x + s / 2, p.y - s * 0.5);
      ctx.closePath();
      ctx.fill();
    }
  }

  function ringBasis(ring, rings) {
    const prev = ring.index === 0 ? { x: 0, z: 300 } : rings[ring.index - 1];
    let nx = ring.x - prev.x;
    let nz = ring.z - prev.z;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    // u points sideways across the course, v points up-ish.
    return { u: { x: -nz, y: 0, z: nx }, v: { x: 0, y: 1, z: 0 }, n: { x: nx, y: 0, z: nz } };
  }

  function drawRings(state, basis) {
    const rings = state.rings;
    const ordered = [...rings].sort((a, b) => {
      const da = Math.hypot(a.x - state.x, a.z - state.z);
      const db = Math.hypot(b.x - state.x, b.z - state.z);
      return db - da;
    });
    for (const ring of ordered) {
      const rb = ringBasis(ring, rings);
      const pts = [];
      let visible = false;
      for (let i = 0; i <= 24; i += 1) {
        const a = (i / 24) * Math.PI * 2;
        const px = ring.x + (rb.u.x * Math.cos(a) + rb.v.x * Math.sin(a)) * ring.radius;
        const py = ring.y + (rb.u.y * Math.cos(a) + rb.v.y * Math.sin(a)) * ring.radius;
        const pz = ring.z + (rb.u.z * Math.cos(a) + rb.v.z * Math.sin(a)) * ring.radius;
        const p = project(basis, px, py, pz);
        pts.push(p);
        if (p) visible = true;
      }
      if (!visible) continue;
      const isNext = ring.index === state.ringsPassed;
      const colour = ring.passed ? 'rgba(90, 200, 90, 0.55)' : isNext ? '#ffd23f' : '#35d0ff';
      ctx.save();
      ctx.strokeStyle = colour;
      ctx.lineWidth = isNext ? 5 : 3;
      ctx.shadowColor = colour;
      ctx.shadowBlur = isNext ? 18 : 6;
      ctx.beginPath();
      let started = false;
      for (const p of pts) {
        if (!p) { started = false; continue; }
        if (!started) { ctx.moveTo(p.x, p.y); started = true; }
        else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      // A guide line from the next ring down to the ground, so its height reads.
      if (isNext) {
        const top = project(basis, ring.x, ring.y, ring.z);
        const bot = project(basis, ring.x, groundHeight(ring.x, ring.z), ring.z);
        if (top && bot) {
          ctx.strokeStyle = 'rgba(255, 210, 63, 0.5)';
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.moveTo(top.x, top.y);
          ctx.lineTo(bot.x, bot.y);
          ctx.stroke();
          ctx.setLineDash([]);
          // The label sits above the ring's top edge, never on the ring itself.
          let minY = Infinity;
          let labelX = top.x;
          for (const p of pts) {
            if (p && p.y < minY) { minY = p.y; labelX = p.x; }
          }
          ctx.fillStyle = '#ffd23f';
          ctx.font = 'bold 15px monospace';
          ctx.textAlign = 'center';
          if (Number.isFinite(minY)) ctx.fillText(`RING ${ring.index + 1}`, labelX, minY - 10);
        }
      }
    }
  }

  function drawPlaneShadow(state, basis) {
    const g = groundHeight(state.x, state.z);
    if (state.y - g < 1) return;
    const p = project(basis, state.x, g + 0.6, state.z);
    if (!p) return;
    const s = clamp(46 * p.scale * 0.05, 3, 90);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, s, s * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // The plane itself, seen from behind and slightly above: fuselage, swept wings,
  // tail fin, canopy, afterburner glow and navigation lights. It banks with the roll.
  function drawPlane(state) {
    const cx = width / 2;
    const cy = height * 0.56;
    const s = Math.min(width, height) / 720;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(state.roll);
    ctx.scale(s, s);
    // Afterburner glow.
    if (state.throttle > 0.55 && !state.onGround) {
      const flick = 0.8 + Math.random() * 0.4;
      const gg = ctx.createRadialGradient(0, 34, 2, 0, 40, 34 * flick);
      gg.addColorStop(0, 'rgba(255, 220, 120, 0.95)');
      gg.addColorStop(0.5, 'rgba(255, 140, 40, 0.7)');
      gg.addColorStop(1, 'rgba(255, 80, 20, 0)');
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.ellipse(0, 42, 12, 30 * flick, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Wings: swept, with tip lights.
    ctx.fillStyle = '#c8ccd4';
    ctx.beginPath();
    ctx.moveTo(-14, 6); ctx.lineTo(-108, 34); ctx.lineTo(-104, 46); ctx.lineTo(-12, 22);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(14, 6); ctx.lineTo(108, 34); ctx.lineTo(104, 46); ctx.lineTo(12, 22);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff3b30';
    ctx.beginPath(); ctx.arc(-106, 40, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2fd94a';
    ctx.beginPath(); ctx.arc(106, 40, 3.5, 0, Math.PI * 2); ctx.fill();
    // Tailplane and fin.
    ctx.fillStyle = '#9aa0ab';
    ctx.beginPath();
    ctx.moveTo(-8, -18); ctx.lineTo(-46, -2); ctx.lineTo(-44, 6); ctx.lineTo(-6, -6);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(8, -18); ctx.lineTo(46, -2); ctx.lineTo(44, 6); ctx.lineTo(6, -6);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#b7bcc7';
    ctx.beginPath();
    ctx.moveTo(0, -34); ctx.lineTo(-7, -4); ctx.lineTo(7, -4);
    ctx.closePath(); ctx.fill();
    // Fuselage with canopy highlight.
    const fg = ctx.createLinearGradient(-12, 0, 12, 0);
    fg.addColorStop(0, '#8f959f');
    fg.addColorStop(0.5, '#e8ebf0');
    fg.addColorStop(1, '#878d98');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(0, -38);
    ctx.quadraticCurveTo(13, -18, 12, 14);
    ctx.quadraticCurveTo(11, 34, 0, 38);
    ctx.quadraticCurveTo(-11, 34, -12, 14);
    ctx.quadraticCurveTo(-13, -18, 0, -38);
    ctx.fill();
    ctx.fillStyle = '#1d4e79';
    ctx.beginPath();
    ctx.ellipse(0, -16, 6.5, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(-2, -19, 2.5, 6, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function compassLabel(deg) {
    const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return names[Math.round(deg / 45) % 8];
  }

  function drawHud(state, time, basis) {
    const knots = Math.round(state.speed * 1.944);
    const feet = Math.round(state.y * 3.281);
    const headingDeg = Math.round(((state.heading * 180) / Math.PI + 360) % 360);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    // Top-left readouts: speed, altitude, vertical speed.
    ctx.fillStyle = 'rgba(6, 20, 30, 0.55)';
    ctx.fillRect(14, 12, 208, 92);
    ctx.strokeStyle = '#39e6a3';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(14, 12, 208, 92);
    ctx.fillStyle = '#7dffc4';
    ctx.font = 'bold 22px monospace';
    ctx.fillText(`SPD ${knots} kt`, 24, 40);
    ctx.fillText(`ALT ${feet} ft`, 24, 68);
    const vsi = Math.round(state.speed * Math.sin(state.pitch) * 196.85);
    ctx.font = '16px monospace';
    ctx.fillStyle = '#cfe8ff';
    ctx.fillText(`V/S ${vsi >= 0 ? '+' : ''}${vsi} fpm`, 24, 92);
    // Compass strip across the top.
    const stripW = Math.min(420, width * 0.36);
    const stripX = (width - stripW) / 2;
    ctx.fillStyle = 'rgba(6, 20, 30, 0.55)';
    ctx.fillRect(stripX, 12, stripW, 40);
    ctx.strokeStyle = '#39e6a3';
    ctx.strokeRect(stripX, 12, stripW, 40);
    ctx.fillStyle = '#cfe8ff';
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    for (let off = -60; off <= 60; off += 15) {
      const deg = (headingDeg + off + 360) % 360;
      const x = stripX + stripW / 2 + (off / 60) * (stripW / 2 - 14);
      const major = deg % 45 === 0;
      ctx.fillStyle = major ? '#7dffc4' : '#9db8c9';
      ctx.fillText(major ? compassLabel(deg) : String(deg).padStart(3, '0'), x, major ? 30 : 42);
      ctx.fillRect(x - 0.5, 16, 1, major ? 8 : 5);
    }
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.moveTo(stripX + stripW / 2 - 6, 14);
    ctx.lineTo(stripX + stripW / 2 + 6, 14);
    ctx.lineTo(stripX + stripW / 2, 22);
    ctx.closePath();
    ctx.fill();
    ctx.font = 'bold 15px monospace';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(`HDG ${String(headingDeg).padStart(3, '0')}°`, stripX + stripW / 2, 70);
    // Top-right: score, rings, time, fuel.
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(6, 20, 30, 0.55)';
    ctx.fillRect(width - 222, 12, 208, 92);
    ctx.strokeStyle = '#39e6a3';
    ctx.strokeRect(width - 222, 12, 208, 92);
    ctx.fillStyle = '#7dffc4';
    ctx.font = 'bold 22px monospace';
    ctx.fillText(`SCORE ${state.score}`, width - 24, 40);
    ctx.font = '16px monospace';
    ctx.fillStyle = '#cfe8ff';
    const mins = Math.floor(state.time / 60);
    const secs = Math.floor(state.time % 60);
    ctx.fillText(`RINGS ${state.ringsPassed}/${state.rings.length}   ${mins}:${String(secs).padStart(2, '0')}`, width - 24, 66);
    ctx.fillText('FUEL', width - 130, 92);
    ctx.fillStyle = '#123';
    ctx.fillRect(width - 118, 80, 94, 14);
    const fuelColour = state.fuel < 20 ? '#ff5a4a' : '#39e6a3';
    ctx.fillStyle = fuelColour;
    ctx.fillRect(width - 118, 80, 94 * (state.fuel / 100), 14);
    ctx.strokeStyle = '#39e6a3';
    ctx.strokeRect(width - 118, 80, 94, 14);
    // Throttle bar, left edge.
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(6, 20, 30, 0.55)';
    ctx.fillRect(14, height - 210, 34, 170);
    ctx.strokeStyle = '#39e6a3';
    ctx.strokeRect(14, height - 210, 34, 170);
    const thH = 150 * state.throttle;
    ctx.fillStyle = state.throttle > 0.85 ? '#ffb03a' : '#39e6a3';
    ctx.fillRect(20, height - 56 - thH, 22, thH);
    ctx.fillStyle = '#cfe8ff';
    ctx.font = '11px monospace';
    ctx.fillText('THR', 17, height - 26);
    ctx.fillText(`${Math.round(state.throttle * 100)}%`, 16, height - 196);
    // Centre message, kept clear of the ring guide above it.
    if (state.message) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 24px monospace';
      ctx.fillStyle = 'rgba(6, 20, 30, 0.6)';
      const tw = ctx.measureText(state.message).width + 36;
      ctx.fillRect(width / 2 - tw / 2, height * 0.3 - 32, tw, 44);
      ctx.fillStyle = '#ffe9a8';
      ctx.fillText(state.message, width / 2, height * 0.3);
    }
    // Stall / low-fuel warnings flash.
    const flashing = Math.floor(time * 2.5) % 2 === 0;
    if (flashing && !state.onGround && state.speed < 32) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 26px monospace';
      ctx.fillStyle = '#ff5a4a';
      ctx.fillText('⚠ STALL — THROTTLE UP, NOSE DOWN', width / 2, height * 0.32);
    } else if (flashing && state.fuel < 20 && state.fuel > 0) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 22px monospace';
      ctx.fillStyle = '#ffb03a';
      ctx.fillText('LOW FUEL', width / 2, height * 0.32);
    }
    drawNextRingGuide(state, basis);
    drawMinimap(state);
    drawPanel(state);
  }

  function drawNextRingGuide(state, basis) {
    const target = state.ringsPassed < state.rings.length
      ? state.rings[state.ringsPassed]
      : { x: RUNWAY.x, z: 300, y: 60, runway: true };
    const dx = target.x - state.x;
    const dz = target.z - state.z;
    const dist = Math.hypot(dx, state.y - target.y, dz);
    const bearing = Math.atan2(dx, dz);
    const rel = normAngle(bearing - state.heading);
    // The target is roughly ahead: put the arrow near the top centre.
    const ax = width / 2 + Math.sin(rel) * 260;
    const ay = height * 0.16 + (1 - Math.cos(rel)) * 60;
    if (Math.abs(rel) < 1.9) {
      ctx.save();
      ctx.translate(clamp(ax, 60, width - 60), clamp(ay, 70, height * 0.4));
      ctx.rotate(rel);
      ctx.fillStyle = target.runway ? '#7dffc4' : '#ffd23f';
      ctx.beginPath();
      ctx.moveTo(0, -16); ctx.lineTo(12, 10); ctx.lineTo(0, 4); ctx.lineTo(-12, 10);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px monospace';
      ctx.fillStyle = target.runway ? '#7dffc4' : '#ffd23f';
      ctx.fillText(target.runway ? `RUNWAY ${Math.round(dist)} m` : `RING ${state.ringsPassed + 1} — ${Math.round(dist)} m`, clamp(ax, 90, width - 90), clamp(ay, 70, height * 0.4) + 34);
    }
  }

  function drawMinimap(state) {
    const mw = 168;
    const mh = 132;
    const mx = width - mw - 16;
    const my = height - mh - 16;
    // The island is far longer than it is wide, so each axis gets its own scale:
    // x across -750..750, z along -300..6900.
    const xScale = mw / 1500;
    const zScale = mh / 7200;
    const toMap = (x, z) => ({ x: mx + mw / 2 + x * xScale, y: my + mh - (z + 300) * zScale });
    ctx.fillStyle = 'rgba(6, 20, 30, 0.72)';
    ctx.fillRect(mx, my, mw, mh);
    ctx.strokeStyle = '#39e6a3';
    ctx.strokeRect(mx, my, mw, mh);
    // River and lake.
    ctx.strokeStyle = '#3d8fd0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let z = -300; z < 7000; z += 400) {
      const p = toMap(riverCentre(z), z);
      if (z === -300) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    // Runway.
    const r0 = toMap(0, RUNWAY.z0);
    const r1 = toMap(0, RUNWAY.z1);
    ctx.strokeStyle = '#f2f2e8';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(r0.x, r0.y); ctx.lineTo(r1.x, r1.y); ctx.stroke();
    // Rings.
    for (const ring of state.rings) {
      const p = toMap(ring.x, ring.z);
      ctx.fillStyle = ring.passed ? '#5ac85a' : ring.index === state.ringsPassed ? '#ffd23f' : '#35d0ff';
      ctx.beginPath(); ctx.arc(p.x, p.y, ring.index === state.ringsPassed ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
    }
    // The plane.
    const pp = toMap(state.x, state.z);
    ctx.save();
    ctx.translate(pp.x, pp.y);
    ctx.rotate(state.heading);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#cfe8ff';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('ISLAND MAP', mx + 6, my + 13);
  }

  function drawGauge(cx, cy, r, label, value, max, unit, colour) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = '#0a1826';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2c4a5e';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = colour;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r - 5, -Math.PI * 0.75, -Math.PI * 0.75 + (value / max) * Math.PI * 1.5);
    ctx.stroke();
    const angle = -Math.PI * 0.75 + (value / max) * Math.PI * 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(angle) * (r - 10), Math.sin(angle) * (r - 10));
    ctx.stroke();
    ctx.fillStyle = '#7dffc4';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, 0, r * 0.45);
    ctx.fillStyle = '#cfe8ff';
    ctx.font = '12px monospace';
    ctx.fillText(unit, 0, r * 0.72);
    ctx.restore();
  }

  function drawPanel(state) {
    const ph = 108;
    const py = height - ph;
    const g = ctx.createLinearGradient(0, py, 0, height);
    g.addColorStop(0, 'rgba(8, 24, 38, 0.92)');
    g.addColorStop(1, 'rgba(4, 12, 20, 0.95)');
    ctx.fillStyle = g;
    ctx.fillRect(0, py, width, ph);
    ctx.strokeStyle = '#2c4a5e';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, py + 0.5); ctx.lineTo(width, py + 0.5); ctx.stroke();
    const cy = py + ph / 2 + 4;
    const cx0 = width / 2;
    drawGauge(cx0 - 150, cy, 40, 'AIRSPEED', state.speed, 110, `${Math.round(state.speed * 1.944)} kt`, '#39e6a3');
    drawGauge(cx0, cy, 40, 'ALTITUDE', state.y, 400, `${Math.round(state.y * 3.281)} ft`, '#39b6e6');
    drawGauge(cx0 + 150, cy, 40, 'THROTTLE', state.throttle * 100, 100, `${Math.round(state.throttle * 100)}%`, '#ffb03a');
    // Artificial horizon: a small ball that rolls with the plane.
    const hx = cx0 - 300;
    ctx.save();
    ctx.translate(hx, cy);
    ctx.fillStyle = '#0a1826';
    ctx.beginPath(); ctx.arc(0, 0, 40, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, 40, 0, Math.PI * 2); ctx.clip();
    ctx.rotate(-state.roll);
    ctx.fillStyle = '#3d8fd0';
    ctx.fillRect(-42, -42 - state.pitch * 90, 84, 42 + state.pitch * 90);
    ctx.fillStyle = '#8a6a3a';
    ctx.fillRect(-42, -state.pitch * 90, 84, 42 + state.pitch * 90);
    ctx.restore();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(-8, 0); ctx.moveTo(8, 0); ctx.lineTo(26, 0); ctx.stroke();
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#7dffc4';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ATTITUDE', hx, cy - 52);
    // Heading dial on the right of the panel.
    const hd = cx0 + 300;
    ctx.fillStyle = '#7dffc4';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('HEADING', hd, cy - 30);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px monospace';
    const headingDeg = Math.round(((state.heading * 180) / Math.PI + 360) % 360);
    ctx.fillText(`${String(headingDeg).padStart(3, '0')}° ${compassLabel(headingDeg)}`, hd, cy + 2);
    ctx.fillStyle = '#cfe8ff';
    ctx.font = '12px monospace';
    ctx.fillText(state.onGround ? 'ON GROUND' : 'AIRBORNE', hd, cy + 26);
  }

  function overlay(title, lines, accent) {
    ctx.fillStyle = 'rgba(4, 14, 24, 0.72)';
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = 'center';
    ctx.fillStyle = accent;
    ctx.font = 'bold 64px monospace';
    ctx.fillText(title, width / 2, height * 0.3);
    ctx.fillStyle = '#eaf6ff';
    ctx.font = '20px monospace';
    let y = height * 0.3 + 48;
    for (const line of lines) {
      ctx.fillText(line, width / 2, y);
      y += 30;
    }
    return y;
  }

  function drawTitle(state, best) {
    const y = overlay('LANGIT RUN', [
      'Island Ring Run — take off, thread 8 golden rings over the island,',
      'then bring her home onto the runway. Watch your fuel.',
      '',
      '↑ / W  climb      ↓ / S  descend      ← → / A D  bank & turn',
      'SHIFT  throttle up      CTRL  throttle down      Mouse steers · wheel = throttle',
      'P pause      R restart      M sound on/off',
      '',
      'Click or press ENTER to fly.',
    ], '#ffd23f');
    if (best > 0) {
      ctx.fillStyle = '#7dffc4';
      ctx.font = 'bold 18px monospace';
      ctx.fillText(`BEST SCORE ${best}`, width / 2, y + 8);
    }
  }

  function drawOver(state, best) {
    if (state.missionDone) {
      const y = overlay('MISSION COMPLETE', [
        `All ${state.rings.length} rings threaded and a clean landing on the strip.`,
        `Score ${state.score}   ·   Rings ${state.ringsPassed}/${state.rings.length}   ·   Time ${Math.floor(state.time / 60)}:${String(Math.floor(state.time % 60)).padStart(2, '0')}`,
        `Best score ${Math.max(best, state.score)}`,
        '',
        'Press R or click to fly again.',
      ], '#7dffc4');
      void y;
    } else {
      overlay('CRASHED', [
        state.crashReason || 'The flight ended badly.',
        `Score ${state.score}   ·   Rings ${state.ringsPassed}/${state.rings.length}   ·   Best ${best}`,
        '',
        'Press R or click to fly again.',
      ], '#ff5a4a');
    }
  }

  function draw(state, screen, best, time) {
    resize();
    const basis = cameraBasis(state);
    drawSky(state, basis);
    drawGround(state, basis, state.scenery);
    drawClouds(basis, state.scenery);
    drawTrees(basis, state.scenery);
    drawRings(state, basis);
    drawPlaneShadow(state, basis);
    drawPlane(state);
    if (screen === SCREEN_PLAY || screen === SCREEN_PAUSED) {
      drawHud(state, time, basis);
    }
    if (screen === SCREEN_TITLE) drawTitle(state, best);
    if (screen === SCREEN_PAUSED) {
      overlay('PAUSED', ['Press P or click to keep flying.'], '#cfe8ff');
    }
    if (screen === SCREEN_OVER) drawOver(state, best);
  }

  return { draw, resize };
}
