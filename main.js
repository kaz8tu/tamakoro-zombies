import Phaser from 'phaser';
import tamakoroPng from './tamakoro.png';

class MainScene extends Phaser.Scene {
  constructor() {
    super('main');
    this.tilt   = { x: 0, y: 0 };
    this.smooth = { x: 0, y: 0 };
    this.alpha  = 0.18;      // センサー応答
    this.forceK = 0.0005;    // 力の係数
    this.maxSpeed = 8.0;     // 最高速度
    this.startPos = { x: 0, y: 0 };
    this.motionActive = false;     // 力を加えるかどうか
    this.motionEnabledAt = 0;      // 許可時刻
    this.innerRect = null;         // 迷路矩形（境界判定用）
  }

  preload() {
    this.load.image('ball', tamakoroPng);
  }

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

    // iOS センサー許可ボタン
    const needIOSPermission =
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function';

    const btn = document.createElement('button');
    btn.innerText = 'Enable Motion (iOS)';
    Object.assign(btn.style, { position:'fixed', top:'10px', left:'10px', zIndex:10, padding:'8px 12px' });
    document.body.appendChild(btn);

    btn.onclick = async () => {
      try {
        if (needIOSPermission) {
          if (DeviceMotionEvent.requestPermission) await DeviceMotionEvent.requestPermission();
          if (DeviceOrientationEvent?.requestPermission) await DeviceOrientationEvent.requestPermission();
        }
        this.setupSensors();
        this.resetPlayerToStart();              // 許可直後に安全初期化
        this.motionActive = false;
        this.motionEnabledAt = performance.now();
        setTimeout(() => { this.motionActive = true; }, 800); // 800msは力を加えない
        btn.remove();
      } catch (e) { console.error(e); alert('Motion permission failed.'); }
    };

    this.build();

    // リサイズ時は軽くリスタート
    let t=null;
    const onResize=()=>{ clearTimeout(t); t=setTimeout(()=>this.scene.restart(),150); };
    window.addEventListener('resize', onResize, {passive:true});
    window.visualViewport?.addEventListener('resize', onResize, {passive:true});
  }

  setupSensors() {
    // devicemotion 優先
    window.addEventListener('devicemotion', (e) => {
      const g = e.accelerationIncludingGravity; if (!g) return;
      const portrait = window.matchMedia('(orientation: portrait)').matches;
      const ax = portrait ? g.x : g.y;
      const ay = portrait ? g.y : -g.x;
      const clamp=(v,m)=>Math.max(-m,Math.min(m,v));
      this.tilt.x = clamp(ax, 9.8);
      this.tilt.y = clamp(ay, 9.8);
    }, { passive:true });

    // フォールバック
    window.addEventListener('deviceorientation', (e)=>{
      const portrait = window.matchMedia('(orientation: portrait)').matches;
      const gamma=(e.gamma||0)*0.12, beta=(e.beta||0)*0.12;
      this.tilt.x = portrait ? gamma : beta;
      this.tilt.y = portrait ? beta  : -gamma;
    }, { passive:true });
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

    // 迷路矩形を記録（境界外検知用）
    this.innerRect = new Phaser.Geom.Rectangle(offsetX, offsetY, mapW, mapH);

    // Matter 安定化
    this.matter.world.engine.positionIterations = 10;
    this.matter.world.engine.velocityIterations = 10;
    this.matter.world.engine.world.gravity.x = 0;
    this.matter.world.engine.world.gravity.y = 0;

    // ★ 迷路矩形＝世界境界（厚み＝タイル幅）
    this.matter.world.setBounds(offsetX, offsetY, mapW, mapH, tile, true, true, true, true);

    // 背景
    this.add.rectangle(offsetX + mapW/2, offsetY + mapH/2, mapW, mapH, 0x111111);

    // 壁（静的）
    this.map.forEach((row,y)=>{ [...row].forEach((c,x)=>{
      const {x:wx,y:wy}=toWorld(x,y);
      if(c==='#'){
        this.matter.add.rectangle(wx, wy, tile, tile, {
          isStatic:true, label:'wall', friction:0, frictionStatic:0, restitution:0
        });
        this.add.rectangle(wx, wy, tile, tile, 0x555555);
      }
    });});

    // スタート／ゴール
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
      restitution: 0.08,
      frictionAir: 0.10,
      friction: 0.002,
      label:'ball'
    });
    this.ball.setDisplaySize(r*2, r*2);
    Phaser.Physics.Matter.Matter.Body.setInertia(this.ball.body, Infinity);

    // ★ ゾンビは内側の安全セルからスポーン（外縁から離す）
    const zR = Math.floor(tile*0.40);
    const zSpawn = toWorld(cols - 2, rows - 2); // 右下の一つ内側
    this.zombie = this.matter.add.circle(zSpawn.x, zSpawn.y, zR, {
      restitution:0.03, frictionAir:0.06, label:'zombie'
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
    this.smooth.x = this.smooth.y = 0;
  }

  centerText(msg,color,stroke){
    const w=Math.floor(window.visualViewport?.width??window.innerWidth);
    const h=Math.floor(window.visualViewport?.height??window.innerHeight);
    this.add.text(w/2,h/2,msg,{fontFamily:'system-ui,-apple-system,sans-serif',fontSize:Math.floor(w*0.08)+'px',color,stroke,strokeThickness:2}).setOrigin(0.5);
  }

  update() {
    if(!this.ball?.body) return;

    // 許可前／クールダウン中は操作しない
    if (!this.motionActive) return;

    // ローパス
    this.smooth.x += this.alpha * (this.tilt.x - this.smooth.x);
    this.smooth.y += this.alpha * (this.tilt.y - this.smooth.y);

    const Body = Phaser.Physics.Matter.Matter.Body;

    // 力を加える
    Body.applyForce(this.ball.body, this.ball.body.position, {
      x: this.smooth.x * this.forceK,
      y: this.smooth.y * this.forceK
    });

    // 最高速度制限
    const v=this.ball.body.velocity, sp=Math.hypot(v.x,v.y);
    if(sp>this.maxSpeed) Body.setVelocity(this.ball.body,{x:v.x*(this.maxSpeed/sp), y:v.y*(this.maxSpeed/sp)});

    // ★ 安全策：境界の外に出たら即スタートに戻す
    if (this.innerRect && !Phaser.Geom.Rectangle.Contains(this.innerRect, this.ball.x, this.ball.y)) {
      this.resetPlayerToStart();
      this.motionActive = false;
      setTimeout(()=>{ this.motionActive = true; }, 300); // 軽い猶予
      return;
    }

    // ゾンビ追従 & 同期
    if(this.zombie && this.zombieSprite){
      const dx=this.ball.body.position.x - this.zombie.position.x;
      const dy=this.ball.body.position.y - this.zombie.position.y;
      const d=Math.hypot(dx,dy)||1, speedZ=5.8;
      Phaser.Physics.Matter.Matter.Body.setVelocity(this.zombie,{x:(dx/d)*speedZ,y:(dy/d)*speedZ});
      this.zombieSprite.x = this.zombie.position.x;
      this.zombieSprite.y = this.zombie.position.y;
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