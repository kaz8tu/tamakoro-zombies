import Phaser from 'phaser';
import tamakoroPng from './tamakoro.png';

class MainScene extends Phaser.Scene {
  constructor(){
    super('main');
    // 入力
    this.tilt   = { x:0, y:0 };
    this.smooth = { x:0, y:0 };
    this.alpha  = 0.18;  // ローパス
    this.dead   = 0.04;  // デッドゾーン（少し緩め）
    this.motionGranted = false;
    this.useGyro = false;

    // 監視
    this.dmCount = 0;
    this.doCount = 0;
    this.lastMotionTs = 0;

    // フォールバック
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
    const rows=this.map.length, cols=this.map[0].length;
    const vw=Math.floor(window.visualViewport?.width ?? innerWidth);
    const vh=Math.floor(window.visualViewport?.height ?? innerHeight);
    const margin = 16;
    const tile = Math.max(18, Math.floor(Math.min((vw-margin*2)/cols, (vh-margin*2)/rows)));
    const mapW=cols*tile, mapH=rows*tile;
    const offX=Math.floor(vw/2-mapW/2), offY=Math.floor(vh/2-mapH/2);
    const toXY=(cx,cy)=>({x:offX+cx*tile+tile/2, y:offY+cy*tile+tile/2});

    this.add.rectangle(offX+mapW/2, offY+mapH/2, mapW, mapH, 0x111111);
    this.physics.world.setBounds(offX, offY, mapW, mapH);

    // 壁
    const walls = this.physics.add.staticGroup();
    for (let y=0;y<rows;y++){
      for (let x=0;x<cols;x++){
        if (this.map[y][x]==='#'){
          const p=toXY(x,y);
          const r=this.add.rectangle(p.x, p.y, tile, tile, 0x555555);
          this.physics.add.existing(r, true);
          walls.add(r);
        }
      }
    }

    // Start / Goal
    let start=toXY(1,1), goal=toXY(cols-2,1);
    for (let y=0;y<rows;y++) for (let x=0;x<cols;x++){
      if (this.map[y][x]==='S') start=toXY(x,y);
      if (this.map[y][x]==='G') goal =toXY(x,y);
    }
    const goalR = Math.max(10, Math.floor(tile*0.35));
    const goalObj = this.add.circle(goal.x, goal.y, goalR, 0x00ff66);
    this.physics.add.existing(goalObj, true);

    // ===== プレイヤー（当たり判定を画像と厳密に一致）=====
    const pr = Math.floor(tile*0.35);
    this.ball = this.physics.add.image(start.x, start.y, 'ball');
    // 1) 見た目サイズを先に確定
    this.ball.setDisplaySize(pr*2, pr*2);
    // 2) 物理ボディを円で作り直し（中心補正込み）
    this.ball.body.setCircle(pr);
    this.ball.body.setOffset(this.ball.width/2 - pr, this.ball.height/2 - pr);
    // 3) 物理パラメータ
    this.ball.setCollideWorldBounds(true);
    this.ball.setDamping(true).setDrag(0.90).setBounce(0.08);
    this.physics.add.collider(this.ball, walls);

    // ===== ゾンビ（パトロール）=====
    const zr = Math.floor(tile*0.35);
    this.zombie = this.add.circle(start.x + tile*2, start.y + tile*6, zr, 0xff4d4d);
    this.physics.add.existing(this.zombie);
    this.zombie.body.setCircle(zr);
    this.zombie.body.setOffset(this.zombie.width/2 - zr, this.zombie.height/2 - zr);
    this.zombie.body.setCollideWorldBounds(true);
    this.zombie.body.setBounce(0.05);
    this.physics.add.collider(this.zombie, walls);

    // 当たり
    this.physics.add.overlap(this.ball, goalObj, ()=> this.scene.restart());
    this.physics.add.overlap(this.ball, this.zombie, ()=> this.cameras.main.shake(120, 0.006));

    // ===== iOS 許可ボタン & ジョイスティック強制表示ボタン =====
    this.addIOSButtons();
    this.addStickButton();

    // 許可後にイベント無しなら自動でスティック出す
    this.time.addEvent({
      delay: 1200, loop: true, callback: ()=>{
        if (this.motionGranted && this.useGyro && (performance.now() - this.lastMotionTs > 1200)) {
          this.useGyro = false;
          this.attachJoystick();
        }
      }
    });

    // パトロール
    const wp=[toXY(3,2), toXY(13,2), toXY(13,8), toXY(3,8)];
    let idx=0, zSpeed=90;
    const goNext=()=>{ const p=wp[idx%wp.length]; this.physics.moveTo(this.zombie, p.x, p.y, zSpeed); idx++; };
    goNext();
    this.time.addEvent({
      delay:300, loop:true, callback:()=>{
        const p=wp[(idx-1+wp.length)%wp.length];
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
          if (DeviceOrientationEvent?.requestPermission){ try{ await DeviceOrientationEvent.requestPermission(); }catch{} }
          this.motionGranted = (m === 'granted');
        } else {
          this.motionGranted = true;
        }
        if (this.motionGranted){
          this.useGyro = true;
          this.setupSensors();
          btn.remove();
        } else {
          alert('設定のWebサイトの設定で「モーションと画面の向き」を許可してください。');
        }
      }catch(e){ console.error(e); alert('モーション許可に失敗しました'); }
    };
  }

  addStickButton(){
    const sbtn = document.createElement('button');
    sbtn.textContent = 'Stick';
    Object.assign(sbtn.style,{position:'fixed',top:'10px',left:'180px',zIndex:10,padding:'8px 12px'});
    document.body.appendChild(sbtn);
    sbtn.onclick = ()=>{
      this.useGyro = false;
      this.attachJoystick();
    };
  }

  setupSensors(){
    // devicemotion
    window.addEventListener('devicemotion', (e)=>{
      if (!this.useGyro) return;
      const g = e.accelerationIncludingGravity || e.acceleration; if (!g) return;
      const portrait = window.matchMedia('(orientation: portrait)').matches;
      const ax = portrait ? g.x : g.y;
      const ay = portrait ? g.y : -g.x;
      this.smooth.x += this.alpha * (ax - this.smooth.x);
      this.smooth.y += this.alpha * (ay - this.smooth.y);
      this.tilt.x = (Math.abs(this.smooth.x) < this.dead) ? 0 : this.smooth.x;
      this.tilt.y = (Math.abs(this.smooth.y) < this.dead) ? 0 : this.smooth.y;
      this.dmCount++; this.lastMotionTs = performance.now();
    }, {passive:true});

    // deviceorientation（補助）
    window.addEventListener('deviceorientation', (e)=>{
      if (!this.useGyro) return;
      const portrait = window.matchMedia('(orientation: portrait)').matches;
      const ox = portrait ? (e.gamma||0)*0.02 : (e.beta||0)*0.02;
      const oy = portrait ? (e.beta ||0)*0.02 : -(e.gamma||0)*0.02;
      this.smooth.x += this.alpha * (ox - this.smooth.x);
      this.smooth.y += this.alpha * (oy - this.smooth.y);
      this.tilt.x = (Math.abs(this.smooth.x) < this.dead) ? 0 : this.smooth.x;
      this.tilt.y = (Math.abs(this.smooth.y) < this.dead) ? 0 : this.smooth.y;
      this.doCount++; this.lastMotionTs = performance.now();
    }, {passive:true});
  }

  attachJoystick(){
    if (this.vjoy) return;
    // CDN で読み込んだ rex-virtual-joystick を使用
    // @ts-ignore
    const Joy = window.rexvirtualjoystickplugin;
    if (!Joy) { console.warn('rex-virtual-joystick not found'); return; }
    // @ts-ignore
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
    let vx=0, vy=0;

    if (this.useGyro){
      // Arcade は速度指定なので係数を大きめに
      const k = 260;
      vx = Phaser.Math.Clamp(this.tilt.x * k, -260, 260);
      vy = Phaser.Math.Clamp(this.tilt.y * k, -260, 260);
    } else if (this.vjoy){
      const force = 200;
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