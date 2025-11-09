import Phaser from 'phaser';

class MainScene extends Phaser.Scene {
  constructor() { super('main'); }

  // ← ここが正しい位置！
  preload() {
    // public/tamakoro.png を読み込み
    this.load.image('ball', '/tamakoro.png');
  }

  create() {
    // ===== 迷路（S=Start, G=Goal, #=Wall, .=Floor） =====
    const map = [
      '#################',
      '#S..#.....#....G#',
      '#.#.#.###.#.#####',
      '#.#...#.#.#.....#',
      '#.#####.#.###.#.#',
      '#.....#.#.....#.#',
      '###.#.#.#####.#.#',
      '#...#.#.....#.#.#',
      '#.###.###.#.#.#.#',
      '#.....#...#...#.#',
      '#################',
    ];
    const rows = map.length;
    const cols = map[0].length;

    // 画面に収まるタイルサイズ
    const margin = 16;
    const tileSize = Math.max(
      18,
      Math.floor(Math.min(
        (this.scale.width - margin * 2) / cols,
        (this.scale.height - margin * 2) / rows
      ))
    );
    const mapW = cols * tileSize;
    const mapH = rows * tileSize;
    const offsetX = Math.floor(this.scale.width / 2 - mapW / 2);
    const offsetY = Math.floor(this.scale.height / 2 - mapH / 2);

    // 入力（iOSモーション許可）
    this.tilt = { x: 0, y: 0 };
    const needIOSPermission =
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function';

    const btn = document.createElement('button');
    btn.innerText = 'Enable Motion (iOS)';
    Object.assign(btn.style, { position: 'fixed', top: '10px', left: '10px', zIndex: '10', padding: '8px 12px' });
    document.body.appendChild(btn);
    btn.onclick = async () => {
      try {
        if (needIOSPermission) {
          if (DeviceMotionEvent.requestPermission) await DeviceMotionEvent.requestPermission();
          if (DeviceOrientationEvent?.requestPermission) await DeviceOrientationEvent.requestPermission();
        }
        window.addEventListener('deviceorientation', (e) => {
          this.tilt.x = (e.gamma || 0) * 0.06;
          this.tilt.y = (e.beta  || 0) * 0.06;
        });
        btn.remove();
      } catch (e) {
        console.error(e);
        alert('Failed to enable motion sensors. Please ensure HTTPS and try again.');
      }
    };

    // 壁・S/G 生成
    this.walls = this.physics.add.staticGroup();
    let startPos = { x: this.scale.width / 2, y: this.scale.height / 2 };
    let goalPos = null;

    const cellToWorld = (cx, cy) => ({
      x: offsetX + cx * tileSize + tileSize / 2,
      y: offsetY + cy * tileSize + tileSize / 2
    });
    const worldToCell = (wx, wy) => ({
      cx: Phaser.Math.Clamp(Math.floor((wx - offsetX) / tileSize), 0, cols - 1),
      cy: Phaser.Math.Clamp(Math.floor((wy - offsetY) / tileSize), 0, rows - 1)
    });

    map.forEach((row, y) => {
      [...row].forEach((cell, x) => {
        const { x: wx, y: wy } = cellToWorld(x, y);
        if (cell === '#') {
          const wall = this.add.rectangle(wx, wy, tileSize, tileSize, 0x555555);
          this.physics.add.existing(wall, true);
          this.walls.add(wall);
        } else if (cell === 'S') {
          startPos = { x: wx, y: wy };
        } else if (cell === 'G') {
          goalPos = { x: wx, y: wy };
        }
      });
    });

    // ===== プレイヤー（画像の玉：タマコロちゃん） =====
    const ballR = Math.floor(tileSize * 0.45);
    const ballD = ballR * 2;
    this.ball = this.physics.add.image(startPos.x, startPos.y, 'ball');
    this.ball.setDisplaySize(ballD, ballD);     // 表示を玉サイズに
    this.ball.body.setCircle(ballR);            // 当たり判定は円
    this.ball.body.setBounce(0.6);
    this.ball.body.setCollideWorldBounds(true);

    // ===== ゴール（緑） =====
    const goalR = Math.max(10, Math.floor(tileSize * 0.35));
    this.goal = this.add.circle(goalPos?.x || startPos.x, goalPos?.y || startPos.y, goalR, 0x00ff66);
    this.physics.add.existing(this.goal, true);

    // ===== ゾンビ（赤） =====
    const zombieR = Math.floor(tileSize * 0.42);
    const zSpawn = goalPos || cellToWorld(cols - 2, rows - 2);
    this.zombie = this.physics.add.image(zSpawn.x, zSpawn.y, undefined);
    // 赤丸の簡易見た目（画像がないので塗り円を上に重ね）
    const zCircle = this.add.circle(zSpawn.x, zSpawn.y, zombieR, 0xff4d4d);
    this.physics.add.existing(zCircle);
    this.zombie = zCircle;
    this.zombie.body.setCircle(zombieR);
    this.zombie.body.setCollideWorldBounds(true);

    // コリジョン・判定
    this.physics.add.collider(this.ball, this.walls);
    this.physics.add.collider(this.zombie, this.walls);

    this.physics.add.overlap(this.ball, this.goal, () => {
      this.add.text(this.scale.width / 2, this.scale.height / 2, 'GOAL! 🎉', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: Math.floor(this.scale.width * 0.08) + 'px',
        color: '#00ff66',
        stroke: '#003300', strokeThickness: 2
      }).setOrigin(0.5);
      this.time.delayedCall(1100, () => this.scene.restart());
    });

    this.physics.add.overlap(this.ball, this.zombie, () => {
      this.add.text(this.scale.width / 2, this.scale.height / 2, 'GAME OVER 💀', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: Math.floor(this.scale.width * 0.08) + 'px',
        color: '#ff4d4d',
        stroke: '#330000', strokeThickness: 2
      }).setOrigin(0.5);
      this.time.delayedCall(1100, () => this.scene.restart());
    });

    // ===== 経路探索（簡易A*） =====
    const isBlocked = (x, y) => map[y]?.[x] === '#' || x < 0 || y < 0 || x >= cols || y >= rows;
    const neighbors4 = (x, y) => {
      const n = [];
      if (!isBlocked(x + 1, y)) n.push({ x: x + 1, y });
      if (!isBlocked(x - 1, y)) n.push({ x: x - 1, y });
      if (!isBlocked(x, y + 1)) n.push({ x, y: y + 1 });
      if (!isBlocked(x, y - 1)) n.push({ x, y: y - 1 });
      return n;
    };
    const findPath = (sx, sy, tx, ty, maxExpand = 4000) => {
      const key = (x, y) => `${x},${y}`;
      const open = new Map(); const closed = new Set();
      const start = { x: sx, y: sy, g: 0, h: Math.abs(tx - sx) + Math.abs(ty - sy) };
      start.f = start.g + start.h; open.set(key(sx, sy), start);
      let expanded = 0;
      while (open.size && expanded < maxExpand) {
        let ck = null, c = null;
        for (const [k, v] of open) { if (!c || v.f < c.f) { c = v; ck = k; } }
        open.delete(ck);
        if (c.x === tx && c.y === ty) {
          const path = []; let p = c; while (p) { path.push({ x: p.x, y: p.y }); p = p.parent; }
          return path.reverse();
        }
        closed.add(ck);
        for (const nb of neighbors4(c.x, c.y)) {
          const nk = key(nb.x, nb.y); if (closed.has(nk)) continue;
          const g = c.g + 1, h = Math.abs(tx - nb.x) + Math.abs(ty - nb.y), f = g + h;
          const ex = open.get(nk);
          if (!ex || g < ex.g) open.set(nk, { x: nb.x, y: nb.y, g, h, f, parent: c });
        }
        expanded++;
      }
      return null;
    };

    const ZOMBIE_SPEED = Math.max(60, Math.floor(tileSize * 3));
    let path = null; let pathIndex = 0;

    this.time.addEvent({
      delay: 300, loop: true,
      callback: () => {
        const zc = worldToCell(this.zombie.x, this.zombie.y);
        const pc = worldToCell(this.ball.x, this.ball.y);
        path = findPath(zc.cx, zc.cy, pc.cx, pc.cy);
        pathIndex = 0;
      }
    });

    this.updateHandler = () => {
      // プレイヤー移動（ジャイロ）
      if (this.ball?.body) {
        this.ball.body.setVelocity(this.tilt.x * 200, this.tilt.y * 200);
      }
      // ゾンビ移動
      if (this.zombie?.body && path && path.length > 1) {
        const targetCell = path[Math.min(pathIndex + 1, path.length - 1)];
        const wp = cellToWorld(targetCell.x, targetCell.y);
        const dx = wp.x - this.zombie.x, dy = wp.y - this.zombie.y;
        const dist = Math.hypot(dx, dy);
        if (dist < tileSize * 0.15) {
          if (pathIndex < path.length - 2) pathIndex++;
        } else {
          this.zombie.body.setVelocity((dx / dist) * ZOMBIE_SPEED, (dy / dist) * ZOMBIE_SPEED);
        }
      }
    };
  }

  update() { this.updateHandler?.(); }
}

// 起動
new Phaser.Game({
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#111',
  physics: { default: 'arcade' },
  scene: MainScene,
});