import Phaser from 'phaser';

class MainScene extends Phaser.Scene {
  constructor() { super('main'); }

  create() {
    // ====== 設定 ======
    const tileSize = 32;

    // ====== 複雑めの迷路（S=スタート, G=ゴール） ======
    const map = [
      '#####################',
      '#S......#......#...G#',
      '###.####.#.####.#.###',
      '#.....#..#....#.#...#',
      '#.###.#.###.##.#.#.##',
      '#.#...#....#....#.#.#',
      '#.#.######.######.#.#',
      '#.#.#....#.#....#.#.#',
      '#...#.#..#.#..#.#...#',
      '#####.#.##.##.#.#####',
      '#.....#........#.....',
      '#.#####.######.#####.',
      '#.#...#.#....#.#...#.',
      '#.#.#.#.#.##.#.#.#.#.',
      '#...#...#....#...#..#',
      '#####################',
    ];

    // 迷路のサイズと中央配置オフセット
    const mapW = map[0].length * tileSize;
    const mapH = map.length * tileSize;
    const offsetX = this.scale.width / 2 - mapW / 2;
    const offsetY = this.scale.height / 2 - mapH / 2;

    // ====== 物理：玉 ======
    this.ball = this.add.circle(0, 0, 14, 0x00bfff);
    this.physics.add.existing(this.ball);
    this.ball.body.setCircle(14);
    this.ball.body.setBounce(0.6);
    this.ball.body.setCollideWorldBounds(true);

    // ====== iOS用：モーション許可 → 許可後にリスナー登録 ======
    this.tilt = { x: 0, y: 0 };

    const needIOSPermission =
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function';

    const btn = document.createElement('button');
    btn.innerText = 'Enable Motion (iOS)';
    Object.assign(btn.style, { position: 'fixed', top: '10px', left: '10px', zIndex: '10', padding: '8px 12px' });
    document.body.appendChild(btn);

    const enableSensors = async () => {
      try {
        if (needIOSPermission) {
          if (DeviceMotionEvent.requestPermission) await DeviceMotionEvent.requestPermission();
          if (DeviceOrientationEvent?.requestPermission) await DeviceOrientationEvent.requestPermission();
        }
        window.addEventListener('deviceorientation', (e) => {
          this.tilt.x = (e.gamma || 0) * 0.06; // 左右
          this.tilt.y = (e.beta || 0) * 0.06;  // 前後
        });
        btn.remove();
      } catch (e) {
        console.error(e);
        alert('Failed to enable motion sensors. Please ensure HTTPS and try again.');
      }
    };
    btn.onclick = enableSensors;

    // ====== 壁＆スタート/ゴール配置 ======
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

    // 玉の初期位置＝S
    this.ball.setPosition(startPos.x, startPos.y);

    // ====== ゴール（緑の丸） ======
    this.goal = this.add.circle(goalPos?.x || startPos.x, goalPos?.y || startPos.y, 12, 0x00ff66);
    this.physics.add.existing(this.goal, true);

    // 衝突＆ゴール判定
    this.physics.add.collider(this.ball, this.walls);

    this.physics.add.overlap(this.ball, this.goal, () => {
      // 簡易クリア演出
      const text = this.add.text(this.scale.width / 2, this.scale.height / 2, 'GOAL! 🎉', {
        fontFamily: 'sans-serif',
        fontSize: '48px',
        color: '#00ff66',
      }).setOrigin(0.5);
      this.time.delayedCall(1200, () => this.scene.restart());
    });
  }

  update() {
    if (!this.ball?.body) return;
    this.ball.body.setVelocity(this.tilt.x * 200, this.tilt.y * 200);
  }
}

// ====== ゲーム設定＆起動 ======
new Phaser.Game({
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#111',
  physics: { default: 'arcade' },
  scene: MainScene,
});