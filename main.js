import Phaser from 'phaser';
import tamakoroPng from './tamakoro.png';

class MainScene extends Phaser.Scene {
  constructor() {
    super('main');

    // センサー/フィルタ
    this.tilt   = { x: 0, y: 0 };   // 生
    this.smooth = { x: 0, y: 0 };   // ローパス
    this.alpha  = 0.14;             // 応答（少し速め）
    this.deadZone = 0.08;           // 微小ノイズを殺す

    // キャリブ用
    this.bias = { x: 0, y: 0 };
    this.calibrating = false;
    this.calibSamples = [];

    // 動作制御
    this.motionActive = false;      // 力を加えるフラグ
    this.motionEnabledAt = 0;

    // 物理パラメータ（控えめ）
    this.forceK   = 0.00042;
    this.maxSpeed = 7.2;

    // 迷路情報
    this.startPos  = { x: 0, y: 0 };
    this.innerRect = null;

    // デバッグHUD
    this.debugText = null;
  }

  preload() { this.load.image('ball', tamakoroPng); }

  create() {
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

    // ===== UI（許可 & 再キャリブ）=====
    const needIOSPermission =
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function';

    const permBtn = document.createElement('button');
    permBtn.innerText = 'Enable Motion (iOS)';
    Object.assign(permBtn.style, { position:'fixed', top:'10px', left:'10px', zIndex:10, padding:'8px 12px' });
    document.body.appendChild(permBtn);

    const calibBtn = document.createElement('button');
    calibBtn.innerText = 'Calibrate';
    Object.assign(calibBtn.style, { position:'fixed', top:'10px', left:'160px', zIndex:10, padding:'8px 12px' });
    document.body.appendChild(calibBtn);

    permBtn.onclick = async () => {
      try {
        if (needIOSPermission) {
          if (DeviceMotionEvent.requestPermission) await DeviceMotionEvent.requestPermission();
          if (DeviceOrientationEvent?.requestPermission) await DeviceOrientationEvent.requestPermission();
        }
        this.setupSensors();
        this.resetPlayerToStart();
        this.startCalibration(1000);          // 許可直後1秒キャリブ
        this.motionActive = false;            // キャリブ中はオフ
        setTimeout(() => { this.motionActive = true; }, 1200);
        permBtn.remove();
      } catch (e) { console.error(e); alert('Motion permission failed.'); }
    };

    calibBtn.onclick = () => {
      this.startCalibration(700);
      this.motionActive = false;
      this.resetPlayerToStart();
      setTimeout(() => { this.motionActive = true; }, 900);
    };

    // 迷路・物理構築
    this.build();

    // デバッグHUD
    this.debugText = this.add.text(8, 8, 'debug', {
      fontFamily: 'system-ui,-apple-system,sans-serif',
      fontSize: '12px',
      color: '#0f0'
    }).setDepth(1000).setScrollFactor(0);

    // リサイズは軽くリスタート
    let t=null;
    const onResize=()=>{ clearTimeout(t); t=setTimeout(()=>this.scene.restart(),150); };
    window.addEventListener('resize', onResize, {passive:true});
    window.visualViewport?.addEventListener('resize', onResize, {passive:true});
  }

  setupSensors() {
    // devicemotion 優先（重力込み）
    window.addEventListener('devicemotion', (e) => {
      const g = e.accelerationIncludingGravity; if (!g) return;
      const portrait = window.matchMedia('(orientation: portrait)').matches;
      const ax = portrait ? g.x : g.y;
      const ay = portrait ? g.y : -g.x;

      if (this.calibrating) { this.calibSamples.push({x:ax,y:ay}); return; }

      this.tilt.x = ax - this.bias.x;
      this.tilt.y = ay - this.bias.y;
    }, { passive:true });

    // フォールバック（弱めに寄与）
    window.addEventListener('deviceorientation', (e) => {
      if (this.calibrating) return;
      const portrait = window.matchMedia('(orientation: portrait)').matches;
      const gamma=(e.gamma||0)*0.10, beta=(e.beta||0)*0.10;
      const ox = portrait ? gamma : beta;
      const oy = portrait ? beta  : -gamma;
      // 加算寄与（メインはdevicemotion）
      this.tilt.x += ox * 0.15;
      this.tilt.y += oy * 0.15;
    }, { passive:true });
  }

  startCalibration(ms) {
    this.calibrating = true;
    this.calibSamples = [];
    setTimeout(() => {
      if (this.calibSamples.length) {
        const sx = this.calibSamples.reduce((s,v)=>s+v.x,0)/this.calibSamples.length;
        const sy = this.calibSamples.reduce((s,v)=>s+v.y,0)/this.calibSamples.length;
        this.bias.x = sx;
        this.bias.y = sy;
      }
      this.calibrating = false;
      this.smooth.x = 0;
      this.smooth.y = 0;
    }, ms);
  }

  build() {
    const rows = this.map.length, cols = this.map[0].length;
    const viewW = Math.floor(window.visualViewport?.width  ?? window.innerWidth);
    const viewH = Math.floor(window.visualViewport?.height ?? window.innerHeight);

    const margin = 16;
    const tile = Math.max(18, Math.floor(Math.min(
      (viewW - margin*2)/cols, (viewH - margin*2)/rows
    )));
    const mapW = cols*tile, mapH = rows*tile;
    const offsetX = Math.floor(viewW/2 - mapW/2);
    const offsetY = Math.floor(viewH/2 - mapH/2);
    const toWorld = (cx,cy)=>({ x: offsetX + cx*tile + tile/2, y: offsetY + cy*tile + tile/2 });

    this.innerRect = new Phaser.Geom.Rectangle(offsetX, offsetY, mapW, mapH);

    // Matter強化
    this.matter.world.engine.positionIterations = 10;
    this.matter.world.engine.velocityIterations = 10;
    this.matter.world.engine.world.gravity.x = 0;
    this.matter.world.engine.world.gravity.y = 0;

    // 迷路矩形＝世界境界（厚み=タイル幅）
    this.matter.world.setBounds(offsetX, offsetY, mapW, mapH, tile, true, true, true, true);

    // 背景
    this.add.rectangle(offsetX + mapW/2, offsetY + mapH/2, mapW, mapH, 0x111111);

    // 壁
    this.map.forEach((row,y)=>{ [...row].forEach((c,x)=>{
      const {x:wx,y:wy}=toWorld(x,y);
      if(c==='#'){
        this.matter.add.rectangle(wx, wy, tile, tile, {
          isStatic:true, label:'wall', friction:0, frictionStatic:0, restitution:0
        });
        this.add.rectangle(wx, wy, tile, tile, 0x555555);
      }
    });});

    // S/G
    let start=toWorld(1,1), goal=toWorld(cols-2,1);
    this.map.forEach((row,y)=>{ [...row].forEach((c,x)=>{
      if(c==='S') start=toWorld(x,y);
      if(c==='G') goal =toWorld(x,y);
    });});
    this.startPos = { ...start };

    const goalR = Math.max(10, Math.floor(tile*0.35));
    this.goalBody = this.matter.add.circle(goal.x, goal.y, goalR, {isStatic:true, label:'goal'});
    this.add.circle(goal.x, goal.y, goalR, 0x00ff66);

    // プレイヤー
    const r = Math.floor(tile*0.38);
    this.ball = this.matter.add.image(start.x, start.y, 'ball', null, {
      shape:{ type:'circle', radius:r },
      restitution: 0.06,
      frictionAir: 0.14,
      friction: 0.002,
      label:'ball'
    });
    this.ball.setDisplaySize(r*2, r*2);
    Phaser.Physics.Matter.Matter.Body.setInertia(this.ball.body, Infinity);

    // ゾンビ（安全スポーン）
    const zR = Math.floor(tile*0.40);
    const zSpawn = toWorld(cols - 2, rows - 2);
    this.zombie = this.matter.add.circle(zSpawn.x, zSpawn.y, zR, {
      restitution: 0.02, frictionAir: 0.08, label: 'zombie'
    });
    this.zombieSprite = this.add.circle(zSpawn.x, zSpawn.y, zR, 0xff4d4d);

    // 衝突
    this.matter.world.on('collisionstart', (evt)=>{
      for (const p of evt.pairs){
        const A=p.bodyA.label, B=p.bodyB.label;
        const hitGoal   = (A==='ball'&&B==='goal')||(A==='goal'&&B==='ball');
        const hitZombie = (A==='ball'&&B==='zombie')||(A==='zombie'&&B==='ball');
        if(hitGoal){ this.centerText('GOAL! 🎉','#0f6','#030'); this.time.delayedCall(900,()=>this.scene.restart()); return; }
        if(hitZombie){ this.centerText('GAME OVER 💀','#f55','#300'); this.time.delayedCall(900,()=>this.scene.restart()); return; }
      }
    });

    // ゾンビの「確実な追跡」保険：0.2秒毎に目的地に向けて微力を加える
    this.time.addEvent({
      delay: 200,
      loop: true,
      callback: () => {
        if (!this.zombie || !this.ball) return;
        const Body = Phaser.Physics.Matter.Matter.Body;
        const dx = this.ball.body.position.x - this.zombie.position.x;
        const dy = this.ball.body.position.y - this.zombie.position.y;
        const d = Math.hypot(dx, dy) || 1;
        const force = 0.0004; // 小さめ
        Body.applyForce(this.zombie, this.zombie.position, { x: (dx/d)*force, y: (dy/d)*force });
      }
    });
  }

  resetPlayerToStart() {
    if (!this.ball || !this.startPos) return;
    const Body = Phaser.Physics.Matter.Matter.Body;
    Body.setPosition(this.ball.body, { x: this.startPos.x, y: this.startPos.y });
    Body.setVelocity(this.ball.body, { x: 0, y: 0 });
    this.smooth.x = 0; this.smooth.y = 0;
  }

  centerText(msg,color,stroke){
    const w=Math.floor(window.visualViewport?.width??window.innerWidth);
    const h=Math.floor(window.visualViewport?.height??window.innerHeight);
    this.add.text(w/2,h/2,msg,{fontFamily:'system-ui,-apple-system,sans-serif',fontSize:Math.floor(w*0.08)+'px',color,stroke,strokeThickness:2}).setOrigin(0.5);
  }

  update() {
    if (!this.ball?.body) return;

    // センサー → ローパス
    this.smooth.x += this.alpha * (this.tilt.x - this.smooth.x);
    this.smooth.y += this.alpha * (this.tilt.y - this.smooth.y);

    // デッドゾーン
    const ax = (Math.abs(this.smooth.x) < this.deadZone) ? 0 : this.smooth.x;
    const ay = (Math.abs(this.smooth.y) < this.deadZone) ? 0 : this.smooth.y;

    // デバッグHUD
    const v = this.ball.body.velocity;
    this.debugText?.setText(
      `tilt raw=(${this.tilt.x.toFixed(2)}, ${this.tilt.y.toFixed(2)})  ` +
      `smooth=(${this.smooth.x.toFixed(2)}, ${this.smooth.y.toFixed(2)})  ` +
      `apply=(${ax.toFixed(2)}, ${ay.toFixed(2)})  ` +
      `speed=${Math.hypot(v.x,v.y).toFixed(2)}  ` +
      `active=${this.motionActive}  calib=${this.calibrating}`
    );

    const Body = Phaser.Physics.Matter.Matter.Body;

    // 力を加える（motionActiveのときだけ）
    if (this.motionActive) {
      Body.applyForce(this.ball.body, this.ball.body.position, { x: ax * this.forceK, y: ay * this.forceK });
    }

    // 最高速度制限
    const sp = Math.hypot(v.x, v.y);
    if (sp > this.maxSpeed) {
      const s = this.maxSpeed / sp;
      Body.setVelocity(this.ball.body, { x: v.x * s, y: v.y * s });
    }

    // ゾンビの描画同期
    if (this.zombie && this.zombieSprite) {
      this.zombieSprite.x = this.zombie.position.x;
      this.zombieSprite.y = this.zombie.position.y;
    }

    // 迷路外に出たら安全リセット（万一のスパイク対策）
    if (this.innerRect && !Phaser.Geom.Rectangle.Contains(this.innerRect, this.ball.x, this.ball.y)) {
      this.resetPlayerToStart();
      this.motionActive = false;
      setTimeout(() => { this.motionActive = true; }, 400);
    }
  }
}

// 起動
new Phaser.Game({
  type: Phaser.AUTO,
  backgroundColor: '#111',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: window.innerWidth, height: window.innerHeight },
  physics: { default: 'matter', matter: { gravity:{x:0,y:0}, enableSleep:true } },
  scene: MainScene,
});