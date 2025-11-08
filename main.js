import Phaser from 'phaser';

class MainScene extends Phaser.Scene {
  constructor() { super('main'); }

  create() {
    // === 玉 ===
    this.ball = this.add.circle(0, 0, 15, 0x00bfff);
    this.physics.add.existing(this.ball);
    this.ball.body.setCircle(15);
    this.ball.body.setBounce(0.6);
    this.ball.body.setCollideWorldBounds(true);

    // === ジャイロ ===
    this.tilt = { x: 0, y: 0 };

    const needIOSPermission =
      typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';

    const btn = document.createElement('button');
    btn.innerText = 'Enable Motion (iOS)';
    Object.assign(btn.style, {
      position: 'fixed', top: '10px', left: '10px', zIndex: '10', padding: '8px 12px'
    });
    document.body.appendChild(btn);

    const requestSensors = async () => {
      try {
        if (needIOSPermission) {
          if (DeviceMotionEvent.requestPermission) await DeviceMotionEvent.requestPermission();
          if (DeviceOrientationEvent?.requestPermission)
            await DeviceOrientationEvent.requestPermission();
        }
        window.addEventListener('deviceorientation', (e) => {
          this.tilt.x = (e.gamma || 0) * 0.06;
          this.tilt.y = (e.beta || 0) * 0.06;
        });
        alert('Motion sensors enabled! 🎉');
        btn.remove();
      } catch (err) {
        console.error(err);
      }
    };
    btn.onclick = requestSensors;

    // === 迷路 ===
    const map = [
      '##########',
      '#........#',
      '#.######.#',
      '#.#....#.#',
      '#.#.##.#.#',
      '#.#....#.#',
      '#.######.#',
      '#........#',
      '##########',
    ];

    const tileSize = 32;
    const mapWidth = map[0].length * tileSize;
    const mapHeight = map.length * tileSize;

    const offsetX = this.scale.width / 2 - mapWidth / 2;
    const offsetY = this.scale.height / 2 - mapHeight / 2;

    this.walls = this.physics.add.staticGroup();

    map.forEach((row, y) => {
      [...row].forEach((cell, x) => {
        if (cell === '#') {
          const wall = this.add.rectangle(
            offsetX + x * tileSize + tileSize / 2,
            offsetY + y * tileSize + tileSize / 2,
            tileSize,
            tileSize,
            0x555555
          );
          this.physics.add.existing(wall, true);
          this.walls.add(wall);
        }
      });
    });

    this.physics.add.collider(this.ball, this.walls);

    // 玉の初期位置を迷路中央に
    this.ball.setPosition(this.scale.width / 2, this.scale.height / 2);
  }

  update() {
    if (!this.ball?.body) return;
    this.ball.body.setVelocity(this.tilt.x * 200, this.tilt.y * 200);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#111',
  physics: { default: 'arcade' },
  scene: MainScene,
});