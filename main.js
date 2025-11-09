import Phaser from 'phaser';
import tamakoroPng from './tamakoro.png'; // タマコロちゃん画像をバンドル

class MainScene extends Phaser.Scene {
  constructor() {
    super('main');
  }

  preload() {
    this.load.image('ball', tamakoroPng);
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

    // 画面に収まるようにスケール（※レスポンシブ最適化は②で本格対応）
    const margin = 16;
    const tileSize = Math.max(
      18,
      Math.floor(
        Math.min(
          (this.scale.width - margin * 2) / cols,
          (this.scale.height - margin * 2) / rows
        )
      )
    );
    const mapW = cols * tileSize;
    const mapH = rows * tileSize;
    const offsetX = Math.floor(this.scale.width / 2 - mapW / 2);
    const offsetY = Math.floor(this.scale.height / 2 - mapH / 2);

    // ===== iOSモーションセンサー許可 =====
    this.tilt = { x: 0, y: 0 };
    const needIOSPermission =
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function';

    const btn = document.createElement('button');
    btn.innerText = 'Enable Motion (iOS)';
    Object.assign(btn.style, {
      position: 'fixed',
      top: '10px',
      left: '10px',
      zIndex: '10',
      padding: '8px 12px',
    });
    document.body.appendChild(btn);
    btn.onclick = async () => {
      try {
        if (needIOSPermission) {
          if (DeviceMotionEvent.requestPermission)
            await DeviceMotionEvent.requestPermission();
          if (DeviceOrientationEvent?.requestPermission)
            await DeviceOrientationEvent.requestPermission();
        }
        window.addEventListener('deviceorientation', (e) => {
          this.tilt.x = (e.gamma || 0) * 0.06;
          this.tilt.y = (e.beta || 0) * 0.06;
        });
        btn.remove();
      } catch (e) {
        console.error(e);
        alert('Failed to enable motion sensors. Please ensure HTTPS and try again.');
      }
    };

    // ===== 壁・S/G 生成 =====
    this.walls = this.physics.add.staticGroup();
    let startPos = { x: this.scale.width / 2, y: this.scale.height / 2 };
    let goalPos = null;

    const cellToWorld = (cx, cy) => ({
      x: offsetX + cx * tileSize + tileSize / 2,
      y: offsetY + cy * tileSize + tileSize / 2,
    });

    map.forEach((row, y) => {
      [...row].forEach((cell, x) => {
        const { x: cx, y: cy } = cellToWorld(x, y);
        if (cell === '#') {
          const wall = this.add.rectangle(cx, cy, tileSize, tileSize, 0x555555);
          this.physics.add.existing(wall, true); // static = true
          this.walls.add(wall);
        } else if (cell === 'S') {
          startPos = { x: cx, y: cy };
        } else if (cell === 'G') {
          goalPos = { x: cx, y: cy };
        }
      });
    });

    // ===== プレイヤー：タマコロちゃん（すり抜け防止チューニング） =====
    const ballR = Math.floor(tileSize * 0.45);
    const ballD = ballR * 2;
    this.ball = this.physics.add.image(startPos.x, startPos.y, 'ball');
    this.ball.setDisplaySize(ballD, ballD);
    this.ball.body.setCircle(ballR);
    this.ball.body.setCollideWorldBounds(true);

    // ★ すり抜け防止のためのチューニング
    this.physics.world.setFPS(120);          // 物理更新頻度UP（安定性UP）
    this.ball.body.setMaxVelocity(230, 230); // 最大速度を制限
    this.ball.body.setBounce(0.3);           // 跳ねすぎ防止で少し低めに
    this.ball.body.setDamping(true);         // 速度減衰を有効
    this.ball.body.setDrag(180, 180);        // ドラッグで減速（数値はお好みで）

    // ===== ゴール =====
    const goalR = Math.max(10, Math.floor(tileSize * 0.35));
    this.goal = this.add.circle(goalPos?.x || startPos.x, goalPos?.y || startPos.y, goalR, 0x00ff66);
    this.physics.add.existing(this.goal, true);

    // ===== ゾンビ（赤丸のまま）※③で画像に差し替え =====
    const zombieR = Math.floor(tileSize * 0.42);
    const zSpawn = goalPos || cellToWorld(cols - 2, rows - 2);
    this.zombie = this.add.circle(zSpawn.x, zSpawn.y, zombieR, 0xff4d4d);
    this.physics.add.existing(this.zombie);
    this.zombie.body.setCircle(zombieR);
    this.zombie.body.setCollideWorldBounds(true);

    // ===== 衝突・判定 =====
    this.physics.add.collider(this.ball, this.walls);
    this.physics.add.collider(this.zombie, this.walls);

    this.physics.add.overlap(this.ball, this.goal, () => {
      this.add
        .text(this.scale.width / 2, this.scale.height / 2, 'GOAL! 🎉', {
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: Math.floor(this.scale.width * 0.08) + 'px',
          color: '#00ff66',
          stroke: '#003300',
          strokeThickness: 2,
        })
        .setOrigin(0.5);
      this.time.delayedCall(1100, () => this.scene.restart());
    });

    this.physics.add.overlap(this.ball, this.zombie, () => {
      this.add
        .text(this.scale.width / 2, this.scale.height / 2, 'GAME OVER 💀', {
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: Math.floor(this.scale.width * 0.08) + 'px',
          color: '#ff4d4d',
          stroke: '#330000',
          strokeThickness: 2,
        })
        .setOrigin(0.5);
      this.time.delayedCall(1100, () => this.scene.restart());
    });

    // ===== ゾンビの簡易追跡（速度は控えめ） =====
    const ZOMBIE_SPEED = Math.max(50, Math.floor(tileSize * 2.4));
    this.time.addEvent({
      delay: 500,
      loop: true,
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
  }

  update() {
    if (!this.ball?.body) return;

    // ★ 速度を直接ガンガン上げるのではなく、加速度でじわっと動かす
    const ACCEL = 700; // 端末傾きの強度に対する加速度（お好みで調整）
    this.ball.body.setAcceleration(this.tilt.x * ACCEL, this.tilt.y * ACCEL);
    // 最大速度は setMaxVelocity で制限済み
  }
}

// ===== ゲーム起動 =====
const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#111',
  physics: {
    default: 'arcade',
    arcade: {
      // debug: true,        // 必要なら有効化して動きを確認
      fps: 120,              // ワールド既定FPS（create内でも setFPS 済み）
      gravity: { x: 0, y: 0 }
    },
  },
  scene: MainScene,
});