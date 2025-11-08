import Phaser from 'phaser';

class MainScene extends Phaser.Scene {
  constructor() { super('main'); }

  preload() {}

  create() {
    // 玉を作成
    this.ball = this.add.circle(400, 300, 20, 0x00bfff);
    this.physics.add.existing(this.ball);
    this.ball.body.setCircle(20);
    this.ball.body.setBounce(0.6);
    this.ball.body.setCollideWorldBounds(true);

    // 傾き制御
    this.tilt = { x: 0, y: 0 };
    window.addEventListener('deviceorientation', (e) => {
      this.tilt.x = (e.gamma || 0) * 0.05;
      this.tilt.y = (e.beta || 0) * 0.05;
    });

    // iOSのセンサー許可対応
    if (window.DeviceMotionEvent && DeviceMotionEvent.requestPermission) {
      const btn = document.createElement('button');
      btn.innerText = 'センサー許可（iOS）';
      btn.style.position = 'fixed';
      btn.style.top = '10px';
      btn.style.left = '10px';
      btn.style.zIndex = '10';
      btn.onclick = async () => {
        await DeviceMotionEvent.requestPermission();
        btn.remove();
      };
      document.body.appendChild(btn);
    }
  }

  update() {
    if (this.ball?.body) {
      this.ball.body.setVelocity(this.tilt.x * 200, this.tilt.y * 200);
    }
  }
}

const config = {
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#111',
  physics: { default: 'arcade' },
  scene: MainScene,
};

new Phaser.Game(config);