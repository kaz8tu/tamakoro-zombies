import Phaser from 'phaser';
import tamakoroPng from './tamakoro.png'; // タマコロちゃん画像（import方式）

class MainScene extends Phaser.Scene {
  constructor() { super('main'); }

  preload() {
    this.load.image('ball', tamakoroPng);
  }

  create() {
    // ==== 迷路定義（S=Start, G=Goal, #=Wall, .=Floor） ====
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

    // ==== 端末傾き ====
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
        }, { passive: true });
        btn.remove();
      } catch (e) {
        console.error(e);
        alert('Failed to enable motion sensors. Please ensure HTTPS and try again.');
      }
    };

    // ==== レイアウト構築（画面サイズ依存） ====
    this.buildLayout();

    // ==== リサイズで安全に再レイアウト ====
    this.scale.on('resize', () => {
      // ボタンが重複しないように一旦消す
      document.querySelectorAll('button').forEach(b => (b.innerText.includes('Enable Motion') ? b.remove() : null));
      this.scene.restart(); // 画面サイズを取り直して最初から描画
    });
  }

  buildLayout() {
    const rows = this.map.length;
    const cols = this.map[0].length;

    // iOSバーの出入りで innerHeight が変動するため、scale.gameSize から取得
    const viewW = Math.max(1, Math.floor(this.scale.gameSize.width));
    const viewH = Math.max(1, Math.floor(this.scale.gameSize.height));

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

    // --- ヘルパ ---
    const cellToWorld = (cx, cy) => ({
      x: offsetX + cx * tileSize + tileSize / 2,
      y: offsetY + cy * tileSize + tileSize / 2,
    });

    // ==== 物理セットアップ ====
    this.physics.world.setFPS(180);

    // ==== 壁配置 ====
    this.walls = this.physics.add.staticGroup();
    let startPos = { x: viewW / 2, y: viewH / 2 };
    let goalPos = null;

    this.map.forEach((row, y) => {
      [...row].forEach((cell, x) => {
        const { x: cx, y: cy } = cellToWorld(x, y);
        if (cell === '#') {
          const wall = this.add.rectangle(cx, cy, tileSize, tileSize, 0x555555);
          this.physics.add.existing(wall, true);  // static body
          wall.refreshBody();                      // ★見た目と物理の同期
          this.walls.add(wall);
        } else if (cell === 'S') {
          startPos = { x: cx, y: cy };
        } else if (cell === 'G') {
          goalPos = { x: cx, y: cy };
        }
      });
    });

    // ==== プレイヤー（タマコロちゃん） ====
    const ballR = Math.floor(tileSize * 0.38); // 通路幅より少し余裕
    const ballD = ballR * 2;
    this.ball = this.physics.add.image(startPos.x, startPos.y, 'ball');
    this.ball.setDisplaySize(ballD, ballD);
    this.ball.body.setCircle(ballR);
    this.ball.body.setCollideWorldBounds(true);
    this.ball.body.setMaxVelocity(200, 200);
    this.ball.body.setBounce(0.2);
    this.ball.body.setDamping(true);
    this.ball.body.setDrag(220, 220);

    // ==== ゴール ====
    const goalR = Math.max(10, Math.floor(tileSize * 0.35));
    this.goal = this.add.circle(goalPos?.x || startPos.x, goalPos?.y || startPos.y, goalR, 0x00ff66);
    this.physics.add.existing(this.goal, true);

    // ==== ゾンビ（③で画像差し替え予定） ====
    const zombieR = Math.floor(tileSize * 0.40);
    const zSpawn = goalPos || cellToWorld(cols - 2, rows - 2);
    this.zombie = this.add.circle(zSpawn.x, zSpawn.y, zombieR, 0xff4d4d);
    this.physics.add.existing(this.zombie);
    this.zombie.body.setCircle(zombieR);
    this.zombie.body.setCollideWorldBounds(true);

    // ==== 衝突・判定 ====
    this.physics.add.collider(this.ball, this.walls);
    this.physics.add.collider(this.zombie, this.walls);

    this.physics.add.overlap(this.ball, this.goal, () => {
      this.add.text(viewW / 2, viewH / 2, 'GOAL! 🎉', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: Math.floor(viewW * 0.08) + 'px',
        color: '#00ff66',
        stroke: '#003300',
        strokeThickness: 2,
      }).setOrigin(0.5);
      this.time.delayedCall(1100, () => this.scene.restart());
    });

    this.physics.add.overlap(this.ball, this.zombie, () => {
      this.add.text(viewW / 2, viewH / 2, 'GAME OVER 💀', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: Math.floor(viewW * 0.08) + 'px',
        color: '#ff4d4d',
        stroke: '#330000',
        strokeThickness: 2,
      }).setOrigin(0.5);
      this.time.delayedCall(1100, () => this.scene.restart());
    });

    // ==== ゾンビ追跡（簡易） ====
    const ZOMBIE_SPEED = Math.max(50, Math.floor(tileSize * 2.2));
    this.time.addEvent({
      delay: 500, loop: true,
      callback: () => {
        const dx = this.ball.x - this.zombie.x;
        const dy = this.ball.y - this.zombie.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 5) {
          this.zombie.body.setVelocity((dx / dist) * ZOMBIE_SPEED, (dy / dist) * ZOMBIE_SPEED);
        } else {
          this.zombie.body.setVelocity(0, 0);
        }
      },
    });

    // update で参照できるよう保存
    this.ACCEL = 560;
  }

  update() {
    if (!this.ball?.body) return;
    this.ball.body.setAcceleration(this.tilt.x * this.ACCEL, this.tilt.y * this.ACCEL);
  }
}

// ==== ゲーム起動（RESIZEモードで常に画面にフィット） ====
const game = new Phaser.Game({
  type: Phaser.AUTO,
  backgroundColor: '#111',
  scale: {
    mode: Phaser.Scale.RESIZE,   // 画面サイズに追従
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  physics: {
    default: 'arcade',
    arcade: {
      // debug: true,
      fps: 180,
      gravity: { x: 0, y: 0 },
    },
  },
  scene: MainScene,
});