import Phaser from 'phaser';
import tamakoroPng from './tamakoro.png';

class MainScene extends Phaser.Scene {
  constructor() { super('main'); }

  preload() {
    this.load.image('ball', tamakoroPng);
  }

  create() {
    // ===== 迷路 =====
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

    // iOS センサー許可
    this.tilt = { x: 0, y: 0 };
    const needIOSPermission =
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function';

    const btn = document.createElement('button');
    btn.innerText = 'Enable Motion (iOS)';
    Object.assign(btn.style, { position:'fixed', top:'10px', left:'10px', zIndex:10, padding:'8px 12px' });
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
        }, { passive:true });
        btn.remove();
      } catch (e) {
        console.error(e);
        alert('Motion permission failed. Try again over HTTPS.');
      }
    };

    this.buildLayout();

    // 画面回転/アドレスバー変化に追従
    this.scale.on('resize', () => {
      document.querySelectorAll('button').forEach(b => {
        if (b.innerText.includes('Enable Motion')) b.remove();
      });
      this.scene.restart();
    });
  }

  buildLayout() {
    const rows = this.map.length;
    const cols = this.map[0].length;

    // ★ iOSで安定する this.scale.width/height を使用
    const viewW = Math.max(1, Math.floor(this.scale.width));
    const viewH = Math.max(1, Math.floor(this.scale.height));

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

    const cellToWorld = (cx, cy) => ({
      x: offsetX + cx * tileSize + tileSize / 2,
      y: offsetY + cy * tileSize + tileSize / 2,
    });

    // 物理
    this.physics.world.setFPS(180);

    // 壁
    this.walls = this.physics.add.staticGroup();
    let startPos = { x: viewW/2, y: viewH/2 };
    let goalPos = null;

    this.map.forEach((row, y) => {
      [...row].forEach((cell, x) => {
        const { x: cx, y: cy } = cellToWorld(x, y);
        if (cell === '#') {
          const wall = this.add.rectangle(cx, cy, tileSize, tileSize, 0x555555);
          this.physics.add.existing(wall, true);
          wall.refreshBody(); // 見た目と当たり判定を同期
          this.walls.add(wall);
        } else if (cell === 'S') {
          startPos = { x: cx, y: cy };
        } else if (cell === 'G') {
          goalPos = { x: cx, y: cy };
        }
      });
    });

    // プレイヤー（タマコロ）
    const ballR = Math.floor(tileSize * 0.38);
    const ballD = ballR * 2;
    this.ball = this.physics.add.image(startPos.x, startPos.y, 'ball');
    this.ball.setDisplaySize(ballD, ballD);
    this.ball.body.setCircle(ballR);
    this.ball.body.setCollideWorldBounds(true);
    this.ball.body.setMaxVelocity(200, 200);
    this.ball.body.setBounce(0.2);
    this.ball.body.setDamping(true);
    this.ball.body.setDrag(220, 220);

    // ゴール
    const goalR = Math.max(10, Math.floor(tileSize * 0.35));
    this.goal = this.add.circle(goalPos?.x || startPos.x, goalPos?.y || startPos.y, goalR, 0x00ff66);
    this.physics.add.existing(this.goal, true);

    // ゾンビ（仮：赤丸）
    const zombieR = Math.floor(tileSize * 0.40);
    const zSpawn = goalPos || cellToWorld(cols - 2, rows - 2);
    this.zombie = this.add.circle(zSpawn.x, zSpawn.y, zombieR, 0xff4d4d);
    this.physics.add.existing(this.zombie);
    this.zombie.body.setCircle(zombieR);
    this.zombie.body.setCollideWorldBounds(true);

    // 当たり
    this.physics.add.collider(this.ball, this.walls);
    this.physics.add.collider(this.zombie, this.walls);

    this.physics.add.overlap(this.ball, this.goal, () => {
      this.add.text(viewW/2, viewH/2, 'GOAL! 🎉', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: Math.floor(viewW * 0.08) + 'px',
        color: '#00ff66', stroke: '#003300', strokeThickness: 2,
      }).setOrigin(0.5);
      this.time.delayedCall(1100, () => this.scene.restart());
    });

    this.physics.add.overlap(this.ball, this.zombie, () => {
      this.add.text(viewW/2, viewH/2, 'GAME OVER 💀', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: Math.floor(viewW * 0.08) + 'px',
        color: '#ff4d4d', stroke: '#330000', strokeThickness: 2,
      }).setOrigin(0.5);
      this.time.delayedCall(1100, () => this.scene.restart());
    });

    // ゾンビ追跡
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

    this.ACCEL = 560;
  }

  update() {
    if (!this.ball?.body) return;
    this.ball.body.setAcceleration(this.tilt.x * this.ACCEL, this.tilt.y * this.ACCEL);
  }
}

// 起動：FIT + CENTER_BOTH（iOSで安定）
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
    default: 'arcade',
    arcade: {
      fps: 180,
      gravity: { x: 0, y: 0 },
      // debug: true,
    },
  },
  scene: MainScene,
});

// ウィンドウサイズ変化に追従
window.addEventListener('resize', () => {
  game.scale.resize(window.innerWidth, window.innerHeight);
});