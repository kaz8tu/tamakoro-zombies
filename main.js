import Phaser from 'phaser';
import tamakoroPng from './tamakoro.png';

class MainScene extends Phaser.Scene {
  constructor(){
    super('main');

    // センサー
    this.tilt   = { x:0, y:0 };   // 最終入力（デッドゾーン後）
    this.smooth = { x:0, y:0 };   // ローパス前
    this.alpha  = 0.18;           // ローパス係数（やや速め）
    this.dead   = 0.06;           // デッドゾーン（小さめで反応良く）

    this.motionGranted = false;
    this.useGyro = false;

    // イベント監視
    this.dmCount = 0;             // devicemotion 受信数
    this.doCount = 0;             // deviceorientation 受信数
    this.lastMotionTs = 0;

    // 操作フォールバック
    this.joy = null;
    this.vjoy = null;

    // 迷路
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

  preload(){ this.load.image('ball', tamakoroPng); }

  create(){
    // ===== レイアウト =====
    const rows = this.map.length, cols = this.map[0].length;
    const vw = Math.floor(window.visualViewport?.width ?? innerWidth);
    const vh = Math.floor(window.visualViewport?.height ?? innerHeight);
    const margin = 16;
    const tile = Math.max(18, Math.floor(Math.min((vw - margin*2)/cols, (vh - margin*2)/rows)));
    const mapW = cols*tile, mapH = rows*tile;
    const offX = Math.floor(vw/2 - mapW/2);
    const offY = Math.floor(vh/2 - mapH/2);
    const toXY = (cx,cy)=>({x:offX+cx*tile+tile/2, y:offY+cy*tile+tile/2});

    this.add.rectangle(offX+mapW/2, offY+mapH/2, mapW, mapH, 0x111111);
    this.physics.world.setBounds(offX, offY, mapW, mapH);

    // 壁
    const walls = this.physics.add.staticGroup();
    for (let y=0;y<rows;y++){
      for (let x=0;x<cols;x++){
        if (this.map[y][x] === '#'){
          const {x:wx,y:wy} = toXY(x,y);
          const r = this.add.rectangle(wx, wy, tile, tile, 0x555555);
          this.physics.add.existing(r, true);
          walls.add(r);
        }
      }
    }

    // Start / Goal
    let start = toXY(1,1), goal = toXY(cols-2,1);
    for (let y=0;y<rows;y++){
      for (let x=0;x<cols;x++){
        if (this.map[y][x]==='S') start = toXY(x,y);
        if (this.map[y][x]==='G') goal  = toXY(x,y);
      }
    }
    const goalCircle = this.add.circle(goal.x, goal.y, Math.max(10, Math.floor(tile*0.35)), 0x00ff66);
    this.physics.add.existing(goalCircle, true);

    // プレイヤー
    const r = Math.floor(tile*0.35);
    this.ball = this.physics.add.image(start.x, start.y, 'ball');
    this.ball.setCircle(r);
    this.ball.setDisplaySize(r*2, r*2);
    this.ball.setCollideWorldBounds(true);
    this.ball.setDamping(true).setDrag(0.92).setBounce(0.05);
    this.physics.add.collider(this.ball, walls);

    // ゾンビ（安全巡回ポイント）
    const zr = Math.floor(tile*0.35);
    this.zombie = this.add.circle(start.x + tile*2, start.y + tile*6, zr, 0xff4d4d);
    this.physics.add.existing(this.zombie);
    this.zombie.body.setCircle(zr);
    this.zombie.body.setCollideWorldBounds(true);
    this.zombie.body.setBounce(0.05);
    this.physics.add.collider(this.zombie, walls);

    // ゴール判定 & 接触
    this.physics.add.overlap(this.ball, goalCircle, ()=> this.scene.restart());
    this.physics.add.overlap(this.ball, this.zombie, ()=> this.cameras.main.shake(120,0.005));

    // ===== iOS 許可ボタン & センサー登録 =====
    this.addIOSButtons();

    // 許可後 1.2s 以内にイベントが来なければジョイスティックを自動表示
    this.time.addEvent({
      delay: 1200, loop: true, callback: () => {
        if (this.motionGranted && this.useGyro && (performance.now() - this.lastMotionTs > 1200)){
          // ジャイロは有効化されたがイベントが来ない → フォールバック
          this.attachJoystick();
          this.useGyro = false;
        }
      }
    });

    // ===== パトロール =====
    const wp = [ toXY(3,2), toXY(13,2), toXY(13,8), toXY(3,8) ];
    let idx=0, zSpeed=90;
    const goNext = ()=>{
      const p = wp[idx % wp.length];
      this.physics.moveTo(this.zombie, p.x, p.y, zSpeed);
      idx++;
    };
    goNext();
    this.time.addEvent({
      delay: 300, loop: true, callback: ()=>{
        const p = wp[(idx-1+wp.length)%wp.length];
        const dx=p.x-this.zombie.x, dy=p.y-this.zombie.y;
        if (dx*dx+dy*dy < (tile*tile*0.3)) goNext();
      }
    });

    // HUD
    this.hud = this.add.text(8,8,'',{fontSize:'12px', color:'#0f0'}).setDepth(1000);
    this.updateHUD = ()=> {
      this.hud.setText([
        `gyro=${this.useGyro}  granted=${this.motionGranted}`,
        `dm=${this.dmCount}  do=${this.doCount}`,
        `tilt=(${this.tilt.x.toFixed(2)}, ${this.tilt.y.toFixed(2)})`
      ].join('\n'));
    };
  }

  addIOSButtons(){
    const needIOS = typeof DeviceMotionEvent !== 'undefined' &&
                    typeof DeviceMotionEvent.requestPermission === 'function';

    const btn = document.createElement('button');
    btn.textContent = 'Enable Motion (iOS)';
    Object.assign(btn.style,{position:'fixed',top:'10px',left:'10px',zIndex:10,padding:'8px 12px'});
    document.body.appendChild(btn);

    btn.onclick = async () => {
      try{
        if (needIOS) {
          const m = await DeviceMotionEvent.requestPermission();
          // orientation は任意
          if (DeviceOrientationEvent?.requestPermission) { try{ await DeviceOrientationEvent.requestPermission(); }catch{} }
          this.motionGranted = (m === 'granted');
        } else {
          this.motionGranted = true;
        }
        if (this.motionGranted){
          this.useGyro = true;
          this.setupSensors();
          btn.remove();
        } else {
          alert('設定>Safari のサイト設定から「モーションと画面の向き」を許可してください。');
        }
      }catch(e){
        console.error(e);
        alert('モーション許可に失敗しました。設定から許可してください。');
      }
    };
  }

  setupSensors(){
    // devicemotion（重力込み or 無ければ加速度）
    window.addEventListener('devicemotion', (e)=>{
      if (!this.useGyro) return;
      const g = e.accelerationIncludingGravity || e.acceleration;
      if (!g) return;
      const portrait = window.matchMedia('(orientation: portrait)').matches;
      const ax = portrait ? g.x : g.y;
      const ay = portrait ? g.y : -g.x;
      this.smooth.x += this.alpha * (ax - this.smooth.x);
      this.smooth.y += this.alpha * (ay - this.smooth.y);
      this.tilt.x = (Math.abs(this.smooth.x) < this.dead) ? 0 : this.smooth.x;
      this.tilt.y = (Math.abs(this.smooth.y) < this.dead) ? 0 : this.smooth.y;
      this.dmCount++;
      this.lastMotionTs = performance.now();
    }, {passive:true});

    // deviceorientation（フォールバック寄与）
    window.addEventListener('deviceorientation', (e)=>{
      if (!this.useGyro) return;
      const portrait = window.matchMedia('(orientation: portrait)').matches;
      // beta: 前後, gamma: 左右（角度→粗くスケール）
      const ox = portrait ? (e.gamma||0)*0.02 : (e.beta||0)*0.02;
      const oy = portrait ? (e.beta ||0)*0.02 : -(e.gamma||0)*0.02;
      this.smooth.x += this.alpha * (ox - this.smooth.x);
      this.smooth.y += this.alpha * (oy - this.smooth.y);
      this.tilt.x = (Math.abs(this.smooth.x) < this.dead) ? 0 : this.smooth.x;
      this.tilt.y = (Math.abs(this.smooth.y) < this.dead) ? 0 : this.smooth.y;
      this.doCount++;
      this.lastMotionTs = performance.now();
    }, {passive:true});
  }

  attachJoystick(){
    if (this.vjoy) return;
    // @ts-ignore
    const Joy = window.rexvirtualjoystickplugin;
    if (!Joy) return;
    // @ts-ignore
    this.joy = this.plugins.get('rexvirtualjoystickplugin') ||
               this.plugins.install('rexvirtualjoystickplugin', Joy, true);
    // @ts-ignore
    this.vjoy = this.plugins.get('rexvirtualjoystickplugin').add(this, {
      x: 90, y: this.scale.height - 90,
      radius: 55,
      base: this.add.circle(0,0,55,0x333333).setAlpha(0.8),
      thumb: this.add.circle(0,0,30,0x888888).setAlpha(0.9)
    });
  }

  update(){
    // 入力（gyro or joystick）
    let vx=0, vy=0;

    if (this.useGyro){
      const k = 220; // 反応係数（Arcade用に強め）
      vx = Phaser.Math.Clamp(this.tilt.x * k, -220, 220);
      vy = Phaser.Math.Clamp(this.tilt.y * k, -220, 220);
    } else if (this.vjoy){
      const force = 180;
      vx = this.vjoy.forceX * force;
      vy = this.vjoy.forceY * force;
    }

    this.ball.setVelocity(vx, vy);
    this.updateHUD && this.updateHUD();
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  backgroundColor: '#111',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: window.innerWidth, height: window.innerHeight },
  physics: { default: 'arcade', arcade: { gravity:{x:0,y:0}, debug:false } },
  scene: MainScene
});