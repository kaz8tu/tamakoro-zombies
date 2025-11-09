import Phaser from 'phaser';
import tamakoroPng from './tamakoro.png';

class MainScene extends Phaser.Scene {
  constructor() {
    super('main');
    this.tilt = { x: 0, y: 0 };      // センサーからの傾き（生値）
    this.smooth = { x: 0, y: 0 };    // ローパス後
    this.alpha = 0.12;               // スムージング係数（大きいほど反応早い）
    this.forceK = 0.0008;            // 力のスケール（端末傾き→加える力）
    this.maxSpeed = 10.5;            // 最高速度（Matterの単位）
  }

  preload() {
    this.load.image('ball', tamakoroPng);
  }

  create() {
    // ===== 迷路定義（S=Start, G=Goal, #=Wall） =====
    this.map = [
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

    // ===== センサー許可（iOS） =====
    const needIOSPermission =
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function';

    const btn = document.createElement('button');
    btn.innerText = 'Enable Motion (iOS)';
    Object.assign(btn.style, {
      position: 'fixed', top: '10px', left: '10px', zIndex: 10,
      padding: '8px 12px'
    });
    document.body.appendChild(btn);
    btn.onclick = async () => {
      try {
        if (needIOSPermission) {
          if (DeviceMotionEvent.requestPermission) await DeviceMotionEvent.requestPermission();
          if (DeviceOrientationEvent?.requestPermission) await DeviceOrientationEvent.requestPermission();
        }
        this.setupSensors();
        btn.remove();
      } catch (e) {
        console.error(e);
        alert('Motion permission failed.');
      }
    };

    // ===== レイアウト構築（画面サイズからタイルサイズ決定） =====
    this.buildLayout();
    // リサイズはデバウンスで安全に再構築
    let t = null;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        this.scene.restart();
      }, 150);
    };
    window.addEventListener('resize', onResize, { passive: true });
    window.visualViewport?.addEventListener('resize', onResize, { passive: true });
  }

  setupSensors() {
    // devicemotion（重力込み加速度）を優先：反応が早くて滑らか
    const useMotion = (e) => {
      const g = e.accelerationIncludingGravity;
      if (!g) return;
      // 端末が縦持ちを想定：X→左右、Y→前後。向きに応じて調整
      const portrait = window.matchMedia('(orientation: portrait)').matches;
      const ax = portrait ? g.x : g.y;
      const ay = portrait ? g.y : -g.x;

      // 過剰に大きい値はクランプ
      const clamp = (v, m) => Math.max(-m, Math.min(m, v));
      this.tilt.x = clamp(ax, 9.8);
      this.tilt.y = clamp(ay, 9.8);
    };

    const useOrientation = (e) => {
      // フォールバック（度数→弱めの係数）
      const portrait = window.matchMedia('(orientation: portrait)').matches;
      const gamma = (e.gamma || 0) * 0.12;
      const beta  = (e.beta  || 0) * 0.12;
      this.tilt.x = portrait ? gamma : beta;
      this.tilt.y = portrait ? beta  : -gamma;
    };

    window.addEventListener('devicemotion', useMotion, { passive: true });
    window.addEventListener('deviceorientation', useOrientation, { passive: true });
  }

  buildLayout() {
    const rows = this.map.length;
    const cols = this.map[0].length;

    const viewW = Math.floor(window.visualViewport?.width  ?? window.innerWidth);
    const viewH = Math.floor(window.visualViewport?.height ?? window.innerHeight);

    const margin = 16;
    const tileSize = Math.max(
      18,
      Math.floor(Math.min(
        (viewW - margin * 2) / cols,
        (viewH - margin * 2) / rows
      ))
    );
    const mapW = cols * tileSize;
    const mapH = rows * tileSize;
    const offsetX = Math.floor(viewW / 2 - mapW / 2);
    const offsetY = Math.floor(viewH / 2 - mapH / 2);

    // ===== Matter 物理設定 =====
    this.matter.world.setBounds(0, 0, viewW, viewH, 32, true, true, true, true);
    this.matter.world.engine.world.gravity.x = 0;
    this.matter.world.engine.world.gravity.y = 0;
    this.matter.world.engine.timing.timeScale = 1;

    // ===== 壁を Matter の静的矩形で作成（すり抜け最強） =====
    this.walls = [];
    const toWorld = (cx, cy) => ({
      x: offsetX + cx * tileSize + tileSize / 2,
      y: offsetY + cy * tileSize + tileSize / 2,
    });

    let start = { x: viewW / 2, y: viewH / 2 };
    let goal  = null;

    this.map.forEach((row, y) => {
      [...row].forEach((cell, x) => {
        const { x: wx, y: wy } = toWorld(x, y);
        if (cell === '#') {
          const body = this.matter.add.rectangle(wx, wy, tileSize, tileSize, {
            isStatic: true,
            chamfer: 0,               // 角丸なし（必要なら少しだけ 2〜4）
            friction: 0,
            frictionStatic: 0,
            restitution: 0,
            label: 'wall',
          });
          this.walls.push(body);
          // 見た目の四角（任意）
          this.add.rectangle(wx, wy, tileSize, tileSize, 0x555555);
        } else if (cell === 'S') {
          start = { x: wx, y: wy };
        } else if (cell === 'G') {
          goal  = { x: wx, y: wy };
        }
      });
    });

    // ===== ゴール（静的円） =====
    const goalR = Math.max(10, Math.floor(tileSize * 0.35));
    this.add.circle(goal?.x ?? start.x, goal?.y ?? start.y, goalR, 0x00ff66);
    this.goalBody = this.matter.add.circle(goal?.x ?? start.x, goal?.y ?? start.y, goalR, {
      isStatic: true, label: 'goal'
    });

    // ===== プレイヤー：タマコロ（円） =====
    const ballR = Math.floor(tileSize * 0.38);
    this.ball = this.matter.add.image(start.x, start.y, 'ball', null, {
      shape: { type: 'circle', radius: ballR },
      restitution: 0.15,
      frictionAir: 0.06,     // 空気抵抗（減速）
      friction: 0.001,
      frictionStatic: 0,
      label: 'ball'
    });
    this.ball.setDisplaySize(ballR * 2, ballR * 2);

    // ===== ゾンビ（仮：赤丸） =====
    const zR = Math.floor(tileSize * 0.40);
    const zSpawn = goal ?? toWorld(cols - 2, rows - 2);
    this.zombieGfx = this.add.circle(zSpawn.x, zSpawn.y, zR, 0xff4d4d);
    this.zombie = this.matter.add.circle(zSpawn.x, zSpawn.y, zR, {
      restitution: 0.05,
      frictionAir: 0.05,
      label: 'zombie'
    });

    // ===== 衝突イベント =====
    this.matter.world.on('collisionstart', (evt) => {
      for (const pair of evt.pairs) {
        const A = pair.bodyA.label;
        const B = pair.bodyB.label;
        const hitGoal =
          (A === 'ball' && B === 'goal') ||
          (A === 'goal' && B === 'ball');
        const hitZombie =
          (A === 'ball' && B === 'zombie') ||
          (A === 'zombie' && B === 'ball');
        if (hitGoal) {
          this.showCenterText('GOAL! 🎉', '#00ff66', '#003300');
          this.time.delayedCall(900, () => this.scene.restart());
          return;
        }
        if (hitZombie) {
          this.showCenterText('GAME OVER 💀', '#ff4d4d', '#330000');
          this.time.delayedCall(900, () => this.scene.restart());
          return;
        }
      }
    });
  }

  showCenterText(msg, color, stroke) {
    const w = Math.floor(window.visualViewport?.width  ?? window.innerWidth);
    const h = Math.floor(window.visualViewport?.height ?? window.innerHeight);
    this.add.text(w / 2, h / 2, msg, {
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: Math.floor(w * 0.08) + 'px',
      color,
      stroke,
      strokeThickness: 2
    }).setOrigin(0.5);
  }

  update() {
    if (!this.ball) return;

    // ===== センサー値をローパスして滑らかに =====
    this.smooth.x = this.smooth.x + this.alpha * (this.tilt.x - this.smooth.x);
    this.smooth.y = this.smooth.y + this.alpha * (this.tilt.y - this.smooth.y);

    // ===== タマコロに力を加える（反応良く、すり抜けなし） =====
    const Body = Phaser.Physics.Matter.Matter.Body;
    const forceX = this.smooth.x * this.forceK;
    const forceY = this.smooth.y * this.forceK;
    Body.applyForce(this.ball.body, this.ball.body.position, { x: forceX, y: forceY });

    // 最高速度をクランプ（暴走防止）
    const v = this.ball.body.velocity;
    const speed = Math.hypot(v.x, v.y);
    if (speed > this.maxSpeed) {
      const scale = this.maxSpeed / speed;
      Body.setVelocity(this.ball.body, { x: v.x * scale, y: v.y * scale });
    }

    // ゾンビを追従（簡易に速度を向ける）
    if (this.zombie && this.zombieGfx) {
      const zv = this.zombie.velocity;
      const dx = this.ball.body.position.x - this.zombie.position.x;
      const dy = this.ball.body.position.y - this.zombie.position.y;
      const dist = Math.hypot(dx, dy) || 1;
      const speedZ = 6.5; // 追跡速度
      Phaser.Physics.Matter.Matter.Body.setVelocity(this.zombie, {
        x: (dx / dist) * speedZ,
        y: (dy / dist) * speedZ
      });
      // 描画位置同期
      this.zombieGfx.x = this.zombie.position.x;
      this.zombieGfx.y = this.zombie.position.y;
    }
  }
}

// ===== 起動（Matter 物理） =====
const game = new Phaser.Game({
  type: Phaser.AUTO,
  backgroundColor: '#111',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  physics: {
    default: 'matter',
    matter: {
      gravity: { x: 0, y: 0 },
      enableSleep: true
    }
  },
  scene: MainScene,
});