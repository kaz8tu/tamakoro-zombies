import Phaser from 'phaser';
import tamakoroPng from './tamakoro.png';

class MainScene extends Phaser.Scene {
  constructor(){
    super('main');

    // センサー状態
    this.tilt = { x:0, y:0 };
    this.smooth = { x:0, y:0 };
    this.alpha = 0.12;      // ローパス
    this.dead = 0.15;       // デッドゾーン
    this.motionGranted = false;

    // 操作
    this.useGyro = false;   // 許可が取れたら true
    this.joy = null;        // バーチャルスティック

    // 迷路関係
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
  }

  preload(){
    this.load.image('ball', tamakoroPng);
  }

  async create(){
    // ====== 画面レイアウト ======
    const rows = this.map.length, cols = this.map[0].length;
    const vw = Math.floor(window.visualViewport?.width ?? innerWidth);
    const vh = Math.floor(window.visualViewport?.height ?? innerHeight);
    const margin = 16;
    const tile = Math.max(18, Math.floor(Math.min((vw-margin*2)/cols, (vh-margin*2)/rows)));
    const mapW = cols*tile, mapH = rows*tile;
    const offX = Math.floor(vw/2 - mapW/2);
    const offY = Math.floor(vh/2 - mapH/2);
    const toXY = (cx,cy)=>({x:offX+cx*tile+tile/2, y:offY+cy*tile+tile/2});

    // 背景
    this.add.rectangle(offX+mapW/2, offY+mapH/2, mapW, mapH, 0x111111);

    // Arcade 物理
    this.physics.world.setBounds(offX, offY, mapW, mapH);

    // 壁
    const walls = this.physics.add.staticGroup();
    for(let y=0;y<rows;y++){
      for(let x=0;x<cols;x++){
        if(this.map[y][x]==='#'){
          const {x:wx,y:wy}=toXY(x,y);
          const r = this.add.rectangle(wx, wy, tile, tile, 0x555555);
          this.physics.add.existing(r, true); // static
          walls.add(r);
        }
      }
    }

    // Start / Goal
    let start=toXY(1,1), goal=toXY(cols-2,1);
    for(let y=0;y<rows;y++){
      for(let x=0;x<cols;x++){
        if(this.map[y][x]==='S') start=toXY(x,y);
        if(this.map[y][x]==='G') goal =toXY(x,y);
      }
    }
    const goalCircle = this.add.circle(goal.x, goal.y, Math.max(10, Math.floor(tile*0.35)), 0x00ff66);
    this.physics.add.existing(goalCircle, true);

    // プレイヤー（タマコロ）
    const r = Math.floor(tile*0.35);
    this.ball = this.physics.add.image(start.x, start.y, 'ball');
    this.ball.setCircle(r);
    this.ball.setDisplaySize(r*2, r*2);
    this.ball.setCollideWorldBounds(true);
    this.ball.setDamping(true).setDrag(0.92).setBounce(0.05);

    this.physics.add.collider(this.ball, walls);

    // ゾンビ（パトロール）
    const zr = Math.floor(tile*0.35);
    this.zombie = this.add.circle(start.x + tile*4, start.y + tile*6, zr, 0xff4d4d);
    this.physics.add.existing(this.zombie);
    this.zombie.body.setCircle(zr);
    this.zombie.body.setCollideWorldBounds(true);
    this.zombie.body.setBounce(0.05);
    this.physics.add.collider(this.zombie, walls);

    // ゴール or 接触
    this.physics.add.overlap(this.ball, goalCircle, ()=>{
      this.scene.restart(); // ひとまずリスタート
    });
    this.physics.add.overlap(this.ball, this.zombie, ()=>{
      this.cameras.main.shake(120, 0.005);
    });

    // ====== 操作系（ジャイロ or ジョイスティック） ======
    // まずは1秒待っても許可が取れなければジョイスティック表示
    this.addIOSButtons();

    setTimeout(() => {
      if (!this.motionGranted) this.attachJoystick();
    }, 1000);

    // ====== ゾンビのパトロール ======
    // 迷路内の安全なウェイポイントをいくつか定義
    const wp = [
      toXY(3,2),  toXY(13,2),
      toXY(13,8), toXY(3,8),
    ];
    let idx = 0, zSpeed = 90;
    const goNext = ()=>{
      const p = wp[idx % wp.length];
      this.physics.moveTo(this.zombie, p.x, p.y, zSpeed);
      idx++;
    };
    goNext();
    this.time.addEvent({
      delay: 300,
      loop: true,
      callback: ()=>{
        const p = wp[(idx-1+wp.length)%wp.length];
        const dx = p.x - this.zombie.x, dy = p.y - this.zombie.y;
        if (dx*dx + dy*dy < (tile*tile*0.3)) goNext();
      }
    });

    // ====== HUD（簡易） ======
    this.hud = this.add.text(8,8,'', {fontSize:'12px', color:'#0f0'}).setDepth(1000);
    this.updateHUD = ()=> {
      this.hud.setText([
        `gyro=${this.useGyro} granted=${this.motionGranted}`,
        `tilt=(${this.tilt.x.toFixed(2)}, ${this.tilt.y.toFixed(2)})`
      ].join('\n'));
    };
  }

  addIOSButtons(){
    // Enable Motion
    const needIOS =
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function';

    const btn = document.createElement('button');
    btn.textContent = 'Enable Motion (iOS)';
    Object.assign(btn.style,{position:'fixed',top:'10px',left:'10px',zIndex:10,padding:'8px 12px'});
    document.body.appendChild(btn);

    btn.onclick = async () => {
      try{
        if (needIOS) {
          const m = await DeviceMotionEvent.requestPermission();
          if (DeviceOrientationEvent?.requestPermission) { try{ await DeviceOrientationEvent.requestPermission(); }catch{} }
          this.motionGranted = (m === 'granted');
        } else {
          // iOS以外はそのまま使える
          this.motionGranted = true;
        }
        if (this.motionGranted){
          this.useGyro = true;
          this.setupSensors();
          btn.remove();
        } else {
          alert('設定アプリ>Safari（またはご利用ブラウザ）で「モーションと画面の向きのアクセスを許可」をONにしてください。');
        }
      }catch(e){
        console.error(e);
        alert('モーションの許可に失敗しました。Safariの設定から許可してください。');
      }
    };
  }

  setupSensors(){
    // devicemotion を使用（重力込み）
    window.addEventListener('devicemotion', (e)=>{
      if (!this.useGyro) return;
      const g = e.accelerationIncludingGravity; if (!g) return;
      const portrait = window.matchMedia('(orientation: portrait)').matches;
      const ax = portrait ? g.x : g.y;
      const ay = portrait ? g.y : -g.x;
      // ローパス＋デッドゾーン
      this.smooth.x += this.alpha * (ax - this.smooth.x);
      this.smooth.y += this.alpha * (ay - this.smooth.y);
      this.tilt.x = Math.abs(this.smooth.x) < this.dead ? 0 : this.smooth.x;
      this.tilt.y = Math.abs(this.smooth.y) < this.dead ? 0 : this.smooth.y;
    }, {passive:true});
  }

  attachJoystick(){
    if (this.joy) return;
    // rex-virtual-joystick（UMD）
    // @ts-ignore
    const Joy = window.rexvirtualjoystickplugin;
    if (!Joy) return;

    // @ts-ignore
    this.joy = this.plugins.get('rexvirtualjoystickplugin') ||
               this.plugins.install('rexvirtualjoystickplugin', Joy, true);

    // 実体を作る
    // @ts-ignore
    this.vjoy = this.plugins.get('rexvirtualjoystickplugin').add(this, {
      x: 90, y: this.scale.height - 90,
      radius: 55,
      base: this.add.circle(0,0,55,0x333333).setAlpha(0.8),
      thumb: this.add.circle(0,0,30,0x888888).setAlpha(0.9)
    });
  }

  update(time, delta){
    // 入力（ジャイロ or ジョイスティック）
    let vx = 0, vy = 0;

    if (this.useGyro){
      // 傾きに比例した力（Arcadeは速度で）
      const k = 40; // 反応係数
      vx = Phaser.Math.Clamp(this.tilt.x * k, -180, 180);
      vy = Phaser.Math.Clamp(this.tilt.y * k, -180, 180);
    } else if (this.vjoy){
      const force = 160;
      vx = this.vjoy.forceX * force;
      vy = this.vjoy.forceY * force;
    }

    // プレイヤー速度
    this.ball.setVelocity(vx, vy);

    // HUD
    this.updateHUD && this.updateHUD();
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  backgroundColor: '#111',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x:0, y:0 },
      debug: false
    }
  },
  scene: MainScene
});