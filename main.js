import Phaser from 'phaser';
import tamakoroPng from './tamakoro.png';

class MainScene extends Phaser.Scene {
  constructor() {
    super('main');

    // センサー関連
    this.tilt   = { x: 0, y: 0 };   // 生
    this.smooth = { x: 0, y: 0 };   // ローパス
    this.alpha  = 0.10;             // ローパス係数（小さめ＝なめらか）
    this.deadZone = 0.18;           // 微小揺れはゼロ扱い

    // キャリブ（基準取り）
    this.bias = { x: 0, y: 0 };
    this.calibrating = false;
    this.calibSamples = [];

    // 動作制御
    this.motionActive = false;      // 力を加える許可
    this.motionEnabledAt = 0;

    // 静止検出（rest detect）
    this.recentApply = [];          // 直近の apply 値 N 件を保持
    this.REST_WINDOW = 30;          // 判定窓サイズ（フレーム数）
    this.REST_STD    = 0.02;        // 標準偏差しきい値（これ未満＝静止）
    this.restLock    = true;        // 静止ロック中なら力を加えない
    this.restSince   = 0;           // 静止状態になっている開始時刻
    this.REST_MIN_MS = 300;         // 最低静止時間（チャタリング防止）

    // 物理
    this.forceK   = 0.00038;
    this.maxSpeed = 6.8;

    // 迷路
    this.startPos  = { x: 0, y: 0 };
    this.innerRect = null;

    // HUD
    this.debugText = null;
  }

  preload() { this.load.image('ball', tamakoroPng); }

  create() {
    // 迷路（S=Start, G=Goal, #=Wall）
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
        this.startCalibration(1000);      // 許可直後1秒キャリブ
        this.motionActive = false;        // キャリブ中は停止
        setTimeout(() => { this.motionActive = true; }, 1200);
        permBtn.remove();
      } catch (e) { console.error(e); alert('Motion permission failed.'); }
    };

    calibBtn.onclick = () => {
      this.startCalibration(800);
      this.motionActive = false;
      this.resetPlayerToStart();
      setTimeout(() => { this.motionActive = true; }, 950);
    };

    // 迷路・物理構築
    this.build();

    // HUD（小さめフォント・複数行）
    this.debugText = this.add.text(8, 8, '', {
      fontFamily: 'system-ui,-apple-system,sans-serif',
      fontSize: '11px',
      color: '#0f0',
      align: 'left',
      wordWrap: { width: Math.max(220, window.innerWidth * 0.6) }
    }).setDepth(1000).setScrollFactor(0);

    // リサイズで軽く再起動
    let t=null;
    const onResize=()=>{ clearTimeout(t); t=setTimeout(()=>this.scene.restart(),150); };
    window.addEventListener('resize', onResize, {passive:true});
    window.visualViewport?.addEventListener('resize', onResize, {passive:true});
  }

  setupSensors() {
    // devicemotion（重力込み）をメイン
    window.addEventListener('devicemotion', (e) => {
      const g = e.accelerationIncludingGravity; if (!g) return;
      const portrait = window.matchMedia('(orientation: portrait)').matches;
      const ax = portrait ? g.x : g.y;
      const ay = portrait ? g.y : -g.x;

      if (this.calibrating) { this.calibSamples.push({x:ax,y:ay}); return; }

      this.tilt.x = ax - this.bias.x;
      this.tilt.y = ay - this.bias.y;
    }, { passive:true });

    // 補助：deviceorientation（弱め寄与）
    window.addEventListener('deviceorientation', (e) => {
      if (this.calibrating) return;
      const portrait = window.matchMedia('(orientation: portrait)').matches;
      const gamma=(e.gamma||0)*0.10, beta=(e.beta||0)*0.10;
      const ox = portrait ? gamma : beta;
      const oy = portrait ? beta  : -gamma;
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
      // ローパスと履歴をリセット
      this.smooth.x = this.smooth.y = 0;
      this.recentApply.length = 0;
      this.restLock = true;     // 静止から再開するまでロック
      this.restSince = performance.now();
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

    // ゾンビ
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
  }

  resetPlayerToStart() {
    if (!this.ball || !this.startPos) return;
    const Body = Phaser.Physics.Matter.Matter.Body;
    Body.setPosition(this.ball.body, { x: this.startPos.x, y: this.startPos.y });
    Body.setVelocity(this.ball.body, { x: 0, y: 0 });
    this.smooth.x = 0; this.smooth.y = 0;
    this.recentApply.length = 0;
    this.restLock = true;
    this.restSince = performance.now();
  }

  centerText(msg,color,stroke){
    const w=Math.floor(window.visualViewport?.width??window.innerWidth);
    const h=Math.floor(window.visualViewport?.height??window.innerHeight);
    this.add.text(w/2,h/2,msg,{fontFamily:'system-ui,-apple-system,sans-serif',fontSize:Math.floor(w*0.08)+'px',color,stroke,strokeThickness:2}).setOrigin(0.5);
  }

  // 最近のapplyの分散/標準偏差を計算
  calcStd(arr){
    if (arr.length === 0) return 0;
    const mean = arr.reduce((s,v)=>s+v,0)/arr.length;
    const v = arr.reduce((s,v)=>s+(v-mean)*(v-mean),0)/arr.length;
    return Math.sqrt(v);
  }

  update() {
    if (!this.ball?.body) return;

    // ローパス
    this.smooth.x += this.alpha * (this.tilt.x - this.smooth.x);
    this.smooth.y += this.alpha * (this.tilt.y - this.smooth.y);

    // デッドゾーン → apply 値
    let ax = (Math.abs(this.smooth.x) < this.deadZone) ? 0 : this.smooth.x;
    let ay = (Math.abs(this.smooth.y) < this.deadZone) ? 0 : this.smooth.y;

    // 静止検出のために合成量を記録
    const mag = Math.hypot(ax, ay);
    this.recentApply.push(mag);
    if (this.recentApply.length > this.REST_WINDOW) this.recentApply.shift();

    // 標準偏差が小さければ静止とみなす
    const std = this.calcStd(this.recentApply);
    const now = performance.now();
    if (std < this.REST_STD) {
      if (!this.restLock) { this.restLock = true; this.restSince = now; }
    } else {
      this.restLock = false;
    }

    // 静止ロック中は最低 REST_MIN_MS は力をゼロに保つ
    const lockActive = this.restLock && (now - this.restSince >= this.REST_MIN_MS) ? true : this.restLock;

    // デバッグHUD（複数行）
    const v = this.ball.body.velocity;
    const lines = [
      `tilt raw = (${this.tilt.x.toFixed(2)}, ${this.tilt.y.toFixed(2)})`,
      `smooth   = (${this.smooth.x.toFixed(2)}, ${this.smooth.y.toFixed(2)})`,
      `apply    = (${ax.toFixed(2)}, ${ay.toFixed(2)}) | |a|=${mag.toFixed(2)} std=${std.toFixed(3)}`,
      `speed=${Math.hypot(v.x,v.y).toFixed(2)}  active=${this.motionActive}  calib=${this.calibrating}  rest=${lockActive}`
    ];
    this.debugText?.setText(lines.join('\n'));

    const Body = Phaser.Physics.Matter.Matter.Body;

    // 力を加える：許可があり、かつ静止ロックでなければ
    if (this.motionActive && !lockActive) {
      Body.applyForce(this.ball.body, this.ball.body.position, { x: ax * this.forceK, y: ay * this.forceK });
    }

    // 最高速度制限
    const sp = Math.hypot(v.x, v.y);
    if (sp > this.maxSpeed) {
      const s = this.maxSpeed / sp;
      Body.setVelocity(this.ball.body, { x: v.x * s, y: v.y * s });
    }

    // ゾンビ描画同期（追跡は慣性で十分動く想定。必要なら適宜強化）
    if (this.zombie && this.zombieSprite) {
      this.zombieSprite.x = this.zombie.position.x;
      this.zombieSprite.y = this.zombie.position.y;
    }

    // 迷路外に出たら復帰
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