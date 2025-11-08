import Phaser from 'phaser';

class MainScene extends Phaser.Scene {
  constructor() { super('main'); }

  create() {
    // ===== 1) 迷路定義（S=Start, G=Goal, #=Wall, .=Floor） =====
    // 手作りで "S→G" のパスを確認済み（複雑め）
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

    // ===== 2) 画面に必ず収まるタイルサイズを自動計算 =====
    const margin = 16; // 画面端の余白
    const tileSize = Math.max(
      18, // 最小サイズ（小さすぎ防止）
      Math.floor(
        Math.min(
          (this.scale.width - margin * 2) / cols,
          (this.scale.height - margin * 2) / rows
        )
      )
    );

    // 迷路の実サイズ & センタリング用オフセット
    const mapW = cols * tileSize;
    const mapH = rows * tileSize;
    const offsetX = Math.floor(this.scale.width / 2 - mapW / 2);
    const offsetY = Math.floor(this.scale.height / 2 - mapH / 2);

    // ===== 3) プレイヤー（玉） =====
    this.ball = this.add.circle(0, 0, Math.floor(tileSize * 0.45), 0x00bfff);
    this.physics.add.existing(this.ball);
    this.ball.body.setCircle(Math.floor(tileSize * 0.45));
    this.ball.body.setBounce(0.6);
    this.ball.body.setCollideWorldBounds(true);

    // ===== 4) iOS向けモーション許可（HTTPS必須） =====
    this.tilt = { x: 0, y: 0 };
    const needIOSPermission =
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function';

    const btn = document.createElement('button');
    btn.innerText = 'Enable Motion (iOS)';
    Object.assign(btn.style, {
      position: 'fixed', top: '10px', left: '10px',
      zIndex: '10', padding: '8px 12px'
    });
    document.body.appendChild(btn);

    btn.onclick = async () => {
      try {
        if (needIOSPermission) {
          if (DeviceMotionEvent.requestPermission) await DeviceMotionEvent.requestPermission();
          if (DeviceOrientationEvent?.requestPermission) await DeviceOrientationEvent.requestPermission();
        }
        window.addEventListener('deviceorientation', (e) => {
          this.tilt.x = (e.gamma || 0) * 0.06; // 左右
          this.tilt.y = (e.beta  || 0) * 0.06; // 前後
        });
        btn.remove();
      } catch (e) {
        console.error(e);
        alert('Failed to enable motion sensors. Please ensure HTTPS and try again.');
      }
    };

    // ===== 5) 壁・スタート・ゴール生成（中央配置） =====
    this.walls = this.physics.add.staticGroup();
    let startPos = { x: this.scale.width / 2, y: this.scale.height / 2 };
    let goalPos = null;

    map.forEach((row, y) => {
      [...row].forEach((cell, x) => {
        const cx = offsetX + x * tileSize + tileSize / 2;
        const cy = offsetY + y * tileSize + tileSize / 2;

        if (cell === '#') {
          const wall = this.add.rectangle(cx, cy, tileSize, tileSize, 0x555555);
          this.physics.add.existing(wall, true);
          this.walls.add(wall);
        } else if (cell === 'S') {
          startPos = { x: cx, y: cy };
        } else if (cell === 'G') {
          goalPos = { x: cx, y: cy };
        }
      });
    });

    // 玉の初期位置をSに合わせる
    this.ball.setPosition(startPos.x, startPos.y);

    // ゴール（緑の丸）
    const goalRadius = Math.max(10, Math.floor(tileSize * 0.35));
    this.goal = this.add.circle(goalPos?.x || startPos.x, goalPos?.y || startPos.y, goalRadius, 0x00ff66);
    this.physics.add.existing(this.goal, true);

    // ===== 6) 衝突＆ゴール判定 =====
    this.physics.add.collider(this.ball, this.walls);
    this.physics.add.overlap(this.ball, this.goal, () => {
      const text = this.add.text(this.scale.width / 2, this.scale.height / 2, 'GOAL! 🎉', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: Math.floor(this.scale.width * 0.08) + 'px',
        color: '#00ff66',
        stroke: '#003300',
        strokeThickness: 2,
      }).setOrigin(0.5);
      this.time.delayedCall(1100, () => this.scene.restart());
    });
  }

  update() {
    if (!this.ball?.body) return;
    // ジャイロ入力
    this.ball.body.setVelocity(this.tilt.x * 200, this.tilt.y * 200);
  }
}

// ===== 7) ゲーム起動（画面サイズは端末依存） =====
new Phaser.Game({
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#111',
  physics: { default: 'arcade' },
  scene: MainScene,
});