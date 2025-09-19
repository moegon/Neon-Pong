(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const overlay = document.getElementById('overlay');
  const playBtn = document.getElementById('playBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const menuBtn = document.getElementById('menuBtn');
  const pScoreEl = document.getElementById('pScore');
  const cScoreEl = document.getElementById('cScore');
  const diffButtons = Array.from(document.querySelectorAll('.difficulty button'));

  let DPR = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
  let W = 0, H = 0;
  let time = 0;
  let last = performance.now();
  let paused = false;
  let inMenu = true;
  let shakeT = 0, shakeAmp = 0;
  let playerScore = 0, cpuScore = 0;
  let serveCooldown = 0;
  let mouseY = null;
  let keys = new Set();

  const cfg = {
    ballBaseSpeed: 460,
    ballMaxSpeed: 1600,
    ballAccel: 1.015,
    ballRadius: 9,
    paddleW: 14,
    paddleH: 100,
    paddleSpeed: 860,
    wallBounceBoost: 1.003,
    spinFactor: 6.0,
    trailLen: 12,
    centerDash: 14,
  };

  const difficulties = {
    easy: { aiMax: 360, reaction: 0.24, jitter: 42, miss: 0.12 },
    normal: { aiMax: 540, reaction: 0.12, jitter: 18, miss: 0.05 },
    hard: { aiMax: 900, reaction: 0.03, jitter: 7, miss: 0.015 },
  };
  let DIFF = 'normal';
  let AI = { ...difficulties[DIFF], targetY: 0, reactT: 0 };

  const player = { x: 0, y: 0, w: cfg.paddleW, h: cfg.paddleH, vy: 0, color: '#7df9ff' };
  const cpu = { x: 0, y: 0, w: cfg.paddleW, h: cfg.paddleH, vy: 0, color: '#b36bff' };
  const ball = { x: 0, y: 0, r: cfg.ballRadius, vx: 0, vy: 0, speed: cfg.ballBaseSpeed, color: '#00ffd1' };
  const trail = [];
  const particles = [];

  function resize() {
    DPR = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    W = Math.floor(window.innerWidth);
    H = Math.floor(window.innerHeight);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    player.x = 32;
    cpu.x = W - 32 - cpu.w;
    player.y = (H - player.h) / 2;
    cpu.y = (H - cpu.h) / 2;
    if (inMenu) centerBall(Math.random() < 0.5 ? 1 : -1);
  }

  function centerBall(dir) {
    ball.x = W / 2;
    ball.y = H / 2;
    ball.speed = cfg.ballBaseSpeed * (0.9 + Math.random() * 0.2);
    const ang = (Math.random() * 0.5 - 0.25) * Math.PI / 4;
    ball.vx = Math.cos(ang) * ball.speed * dir;
    ball.vy = Math.sin(ang) * ball.speed * (Math.random() < 0.5 ? -1 : 1);
    trail.length = 0;
    serveCooldown = 0.7;
  }

  function setDifficulty(name) {
    DIFF = name;
    AI = { ...difficulties[name], targetY: H/2, reactT: 0 };
    diffButtons.forEach(b => b.classList.toggle('active', b.dataset.diff === name));
  }

  function spawnBurst(x, y, color, count = 26, speed = 300) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.9 + Math.random() * 0.5, age: 0, color, size: 2 + Math.random() * 3 });
    }
  }

  function spawnStreak(x, y, color, count = 16) {
    for (let i = 0; i < count; i++) {
      const a = (Math.random() * 0.6 - 0.3) + Math.atan2(ball.vy, ball.vx);
      const s = 220 + Math.random() * 300;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.25 + Math.random() * 0.3, age: 0, color, size: 1 + Math.random() * 2 });
    }
  }

  function update(dt) {
    time += dt;
    if (serveCooldown > 0) serveCooldown = Math.max(0, serveCooldown - dt);

    const pSpeed = cfg.paddleSpeed;
    let py = player.y;
    let target = py;
    if (mouseY != null) target = mouseY - player.h / 2;
    if (keys.has('ArrowUp') || keys.has('w')) target = py - pSpeed * 0.9 * dt;
    if (keys.has('ArrowDown') || keys.has('s')) target = py + pSpeed * 0.9 * dt;
    if (mouseY != null) player.y += (Math.max(0, Math.min(H - player.h, target)) - player.y) * Math.min(1, dt * 12);
    else player.y = Math.max(0, Math.min(H - player.h, target));

    if (serveCooldown <= 0 && !paused) {
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
    }

    if (ball.y - ball.r <= 0 && ball.vy < 0) {
      ball.y = ball.r; ball.vy = -ball.vy * cfg.wallBounceBoost;
      spawnStreak(ball.x, ball.y, '#5ef1ff', 18);
    }
    if (ball.y + ball.r >= H && ball.vy > 0) {
      ball.y = H - ball.r; ball.vy = -ball.vy * cfg.wallBounceBoost;
      spawnStreak(ball.x, ball.y, '#b36bff', 18);
    }

    const hitPlayer = circleRectOverlap(ball, player);
    if (hitPlayer && ball.vx < 0) {
      const rel = ((ball.y - (player.y + player.h / 2)) / (player.h / 2));
      const ang = rel * Math.PI / cfg.spinFactor;
      ball.speed = Math.min(cfg.ballMaxSpeed, ball.speed * cfg.ballAccel);
      const s = Math.max(ball.speed, Math.abs(ball.vx));
      ball.vx = Math.abs(Math.cos(ang) * s);
      ball.vy = Math.sin(ang) * s * (rel >= 0 ? 1 : -1);
      ball.x = player.x + player.w + ball.r + 1;
      spawnBurst(ball.x, ball.y, '#7df9ff', 22, 340);
    }

    const hitCpu = circleRectOverlap(ball, cpu);
    if (hitCpu && ball.vx > 0) {
      const rel = ((ball.y - (cpu.y + cpu.h / 2)) / (cpu.h / 2));
      const ang = rel * Math.PI / cfg.spinFactor;
      ball.speed = Math.min(cfg.ballMaxSpeed, ball.speed * cfg.ballAccel);
      const s = Math.max(ball.speed, Math.abs(ball.vx));
      ball.vx = -Math.abs(Math.cos(ang) * s);
      ball.vy = Math.sin(ang) * s * (rel >= 0 ? 1 : -1);
      ball.x = cpu.x - ball.r - 1;
      spawnBurst(ball.x, ball.y, '#b36bff', 22, 340);
    }

    if (ball.x + ball.r < 0) {
      cpuScore++;
      cScoreEl.textContent = cpuScore;
      shake(12, 0.35);
      centerBall(-1);
    }
    if (ball.x - ball.r > W) {
      playerScore++;
      pScoreEl.textContent = playerScore;
      shake(12, 0.35);
      centerBall(1);
    }

    if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);

    updateAI(dt);
    updateParticles(dt);
    updateTrail();
  }

  function updateAI(dt) {
    const cfgAI = AI;
    if (ball.vx > 0) {
      cfgAI.reactT -= dt;
      if (cfgAI.reactT <= 0) {
        const t = (cpu.x - ball.x) / Math.max(60, ball.vx);
        let predictY = ball.y + ball.vy * t;
        let b = ball.r;
        let top = b, bottom = H - b;
        let yy = predictY, vy = ball.vy;
        while (yy < top || yy > bottom) {
          if (yy < top) { yy = top + (top - yy); vy = -vy; }
          else if (yy > bottom) { yy = bottom - (yy - bottom); vy = -vy; }
        }
        const jitter = (Math.random() * 2 - 1) * cfgAI.jitter;
        cfgAI.targetY = yy + jitter - cpu.h / 2;
        cfgAI.reactT = cfgAI.reaction * (0.75 + Math.random() * 0.6);
      }
    } else {
      cfgAI.targetY = (H - cpu.h) / 2 + Math.sin(time * 0.7) * 24;
    }
    const miss = difficulties[DIFF].miss;
    const bias = (Math.random() < miss && ball.vx > 0) ? (Math.random() * 120 - 60) : 0;
    cfgAI.targetY += bias;
    const dy = cfgAI.targetY - cpu.y;
    const step = Math.sign(dy) * Math.min(Math.abs(dy), difficulties[DIFF].aiMax * dt);
    cpu.y = Math.max(0, Math.min(H - cpu.h, cpu.y + step));
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.995; p.vy *= 0.995;
      p.vy += 40 * dt;
      if (p.age >= p.life) particles.splice(i, 1);
    }
  }

  function updateTrail() {
    trail.push({ x: ball.x, y: ball.y });
    if (trail.length > cfg.trailLen) trail.shift();
  }

  function circleRectOverlap(c, r) {
    const cx = Math.max(r.x, Math.min(c.x, r.x + r.w));
    const cy = Math.max(r.y, Math.min(c.y, r.y + r.h));
    const dx = c.x - cx, dy = c.y - cy;
    return (dx * dx + dy * dy) <= c.r * c.r;
  }

  function shake(amp, dur) { shakeAmp = amp; shakeT = dur; }

  function render() {
    const ox = (Math.random() * 2 - 1) * shakeAmp * (shakeT > 0 ? (shakeT) : 0);
    const oy = (Math.random() * 2 - 1) * shakeAmp * (shakeT > 0 ? (shakeT) : 0);
    ctx.save();
    ctx.translate(ox, oy);
    drawBackground();
    drawCenterLine();
    drawPaddle(player, '#7df9ff');
    drawPaddle(cpu, '#b36bff');
    drawTrail();
    drawBall();
    drawParticles();
    ctx.restore();
    drawVignette();
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#07121a');
    g.addColorStop(1, '#0b0820');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const gridSize = 40;
    const shift = (time * 22) % gridSize;
    ctx.lineWidth = 1;
    for (let x = -gridSize; x < W + gridSize; x += gridSize) {
      ctx.strokeStyle = 'rgba(125,249,255,0.05)';
      ctx.beginPath();
      ctx.moveTo(x + shift, 0);
      ctx.lineTo(x + shift + 120, H);
      ctx.stroke();
    }
    for (let y = -gridSize; y < H + gridSize; y += gridSize) {
      ctx.strokeStyle = 'rgba(179,107,255,0.05)';
      ctx.beginPath();
      ctx.moveTo(0, y + shift);
      ctx.lineTo(W, y + shift + 120);
      ctx.stroke();
    }
  }

  function drawVignette() {
    const g = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.2, W/2, H/2, Math.max(W,H)*0.7);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawCenterLine() {
    const dash = cfg.centerDash;
    const gap = dash * 0.8;
    const x = W / 2 | 0;
    ctx.save();
    ctx.translate(0.5, 0.5);
    for (let y = dash; y < H - dash; y += dash + gap) {
      const alpha = 0.22 + 0.08 * Math.sin((y + time * 120) * 0.02);
      ctx.strokeStyle = `rgba(125,249,255,${alpha})`;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#3ee6ff88';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + dash);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPaddle(p, color) {
    ctx.save();
    ctx.shadowBlur = 24;
    ctx.shadowColor = color;
    ctx.fillStyle = color;
    roundRect(ctx, p.x, p.y, p.w, p.h, 8);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, p.x - 4, p.y + 4, p.w + 8, p.h + 8, 10);
    ctx.fill();
    ctx.restore();
  }

  function drawBall() {
    ctx.save();
    ctx.shadowBlur = 26;
    ctx.shadowColor = '#00ffd1';
    ctx.fillStyle = '#00ffd1';
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ball.x + 3, ball.y + 3, ball.r + 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawTrail() {
    if (trail.length < 2) return;
    for (let i = 0; i < trail.length; i++) {
      const t = i / (trail.length - 1);
      const a = (t * 0.25);
      const r = ball.r * (0.6 + t * 0.8);
      const p = trail[i];
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = '#00ffd1';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const t = 1 - Math.min(1, p.age / p.life);
      ctx.save();
      ctx.globalAlpha = Math.max(0, t * 0.9);
      ctx.shadowBlur = 10 * t;
      ctx.shadowColor = p.color;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + t), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function roundRect(c, x, y, w, h, r) {
    const rr = Math.min(r, w/2, h/2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function frame(t) {
    const now = t || performance.now();
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.033) dt = 0.033;
    if (!paused && !inMenu) update(dt);
    render();
    requestAnimationFrame(frame);
  }

  function play() {
    inMenu = false;
    overlay.classList.add('hidden');
    paused = false;
    centerBall(Math.random() < 0.5 ? 1 : -1);
  }

  function showMenu() {
    inMenu = true;
    overlay.classList.remove('hidden');
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  window.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseY = e.clientY - rect.top;
  });
  window.addEventListener('mouseleave', () => { mouseY = null; });
  window.addEventListener('keydown', (e) => {
    if (['ArrowUp','ArrowDown','w','s','W','S'].includes(e.key)) e.preventDefault();
    const k = e.key;
    keys.add(k === 'W' ? 'w' : k === 'S' ? 's' : k);
    if (k === 'p' || k === 'P') paused = !paused;
    if (k === 'Escape') showMenu();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key;
    keys.delete(k === 'W' ? 'w' : k === 'S' ? 's' : k);
  });

  playBtn.addEventListener('click', play);
  pauseBtn.addEventListener('click', () => { paused = !paused; });
  menuBtn.addEventListener('click', showMenu);
  diffButtons.forEach(b => b.addEventListener('click', () => setDifficulty(b.dataset.diff)));

  resize();
  requestAnimationFrame(frame);
})();

