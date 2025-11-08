import Phaser from 'phaser';

class MainScene extends Phaser.Scene {
  constructor() { super('main'); }

  create() {
    // === 玉 ===
    this.ball = this.add.circle(400, 300, 20, 0x00bfff);
    this.physics.add.existing(this.ball);
    this.ball.body.setCircle(20);
    this.ball.body.setBounce(0.6);
    this.ball.body.setCollideWorldBounds(true);

    // 傾きデータ
    this.tilt = { x: 0, y: 0 };

    // === iOS/HTTPS: 許可ボタン（両方のAPIに対応） ===
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
        // iOS のときだけpermission APIを叩く
        if (needIOSPermission) {
          // 1) Motion
          try {
            const pm = await DeviceMotionEvent.requestPermission();
            console.log('DeviceMotion permission:', pm);
          } catch (e) { console.warn('DeviceMotion permission error:', e); }
          // 2) Orientation（iOS 16+ で必要になることがある）
          if (typeof DeviceOrientationEvent !== 'undefined' &&
              typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
              const po = await DeviceOrientationEvent.requestPermission();
              console.log('DeviceOrientation permission:', po);
            } catch (e) { console.warn('DeviceOrientation permission error:', e); }
          }
        }

        // 許可後にリスナー登録（ユーザー操作直後に設定するのが重要）
        window.addEventListener('deviceorientation', (e) => {
          // デバッグ用ログ（動作確認したら消してOK）
          // console.log('orientation:', e.beta, e.gamma, e.alpha);
          this.tilt.x = (e.gamma || 0) * 0.06;  // 左右
          this.tilt.y = (e.beta  || 0) * 0.06;  // 前後（端末の向きで符号が変わるなら * -1 して調整）
        });

        alert('Motion sensors enabled! Tilt your phone 🎉');
        btn.remove();
      } catch (err) {
        console.error(err);
        alert('Failed to enable sensors. Please ensure HTTPS and tap again.');
      }
    };

    btn.onclick = requestSensors;

    // === 迷路（壁） ===
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

    const tileSize = 64;
    this.walls = this.physics.add.staticGroup();

    map.forEach((row, y) => {
      [...row].forEach((cell, x) => {
        if (cell === '#') {
          const wall = this.add.rectangle(
            x * tileSize + tileSize / 2,
            y * tileSize + tileSize / 2,
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

    // PCテスト用（矢印キー）— iPhoneで動かない時の一時確認に使える
    this.cursors = this.input.keyboard.createCursorKeys();
  }

  update() {
    if (!this.ball?.body) return;

    // ジャイロで移動
    const sx = this.tilt.x, sy = this.tilt.y;
    if (Math.abs(sx) > 0.01 || Math.abs(sy) > 0.01) {
      this.ball.body.setVelocity(sx * 200, sy * 200);
      return;
    }

    // キー操作のフォールバック（PC検証用）
    const speed = 200;
    const vx = (this.cursors.left?.isDown ? -speed : this.cursors.right?.isDown ? speed : 0);
    const vy = (this.cursors.up?.isDown ? -speed : this.cursors.down?.isDown ? speed : 0);
    this.ball.body.setVelocity(vx, vy);
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