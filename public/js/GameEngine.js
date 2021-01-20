function getControls(controls) {
    return {
        actions: function() {
            return {
                up: gInputEngine.actions[controls.up],
                down: gInputEngine.actions[controls.down],
                left: gInputEngine.actions[controls.left],
                right: gInputEngine.actions[controls.right],
            };
        },
        onPosition: function(listener) {
            // do nothing
        },
        onBomb: function(listener) {
            gInputEngine.addListener(controls.bomb, val => !val ? listener() : false);
        },
    };
}

function network(onGameStart) {
    console.log("Connecting");
    const socket = io();
    var connected = false;
    var myName = null;
    var allUsers = [];
    var allControls = {};

    socket.emit("join", Math.floor(Math.random() * 1000));

    // Whenever the server emits 'login', log the login message
    socket.on('joined', (data) => {
        connected = true;
        myName = data.name;
        allUsers = data.users;
        console.log("we are joined", data);
    });

    // Whenever the server emits 'user joined', log it in the chat body
    socket.on('user joined', (data) => {
        allUsers = data.users;
        console.log("other user joined", data);
    });

    // Whenever the server emits 'user left', log it in the chat body
    socket.on('user left', (data) => {
        allUsers = data.users;
        console.log("user left", data);
    });

    socket.on("update", (data) => {
        console.log("key", data);
        var c = allControls[data.name];
        if (data.name === myName) {
            return;
        }
        if (c == null) {
            console.log("no controller listenerr");
            return;
        }

        if (data.key === "bomb") {
            c._positionListeners.map(l => l(data.position));
            c._bombListeners.map(l => l());
        } else {
            c._positionListeners.map(l => l(data.position));
            c._actions[data.key] = data.value;
        }
    });

    socket.on('disconnect', () => {
        console.log('you have been disconnected');
    });

    socket.on('reconnect', () => {
        console.log('you have been reconnected');
    });

    socket.on('reconnect_error', () => {
        console.log('attempt to reconnect has failed');
    });

    socket.on('game started', data => {
        console.log("someone started a game", data);
        onGameStart(data);
    });

    return {
        sendKey: function(key, value, position) {
            console.log("sending", key, value, position);
            socket.emit("key update", {
                key,
                value,
                position,
            });
        },
        getUsers: function() {
            return allUsers;
        },
        getMyName: function() {
            return myName;
        },
        removeListeners: function() {
            allControls = {};
        },
        getPlayerControls: function(name) {
            if (allControls[name] != null) {
                return allControls[name];
            } else {
                var a = {
                    up: false,
                    down: false,
                    left: false,
                    right: false,
                };
                var p = [];
                var b = [];
                var c = {
                    _actions: a,
                    _bombListeners: b,
                    _positionListeners: p,
                    actions: function() {
                        return a;
                    },
                    onPosition: function(listener) {
                        p.push(listener);
                    },
                    onBomb: function(listener) {
                        b.push(listener);
                        // todo remove?
                    },
                };
                allControls[name] = c;
                return c;
            }
        },
        start: function(data) {
            console.log("start", data);
            socket.emit("start game", data);
        },
    };
}

GameEngine = Class.extend({
    tileSize: 32,
    tilesX: 17,
    tilesY: 13,
    size: {},
    fps: 50,
    botsCount: 2, /* 0 - 3 */
    playersCount: 2, /* 1 - 2 */
    remotePlayers: 0,
    bonusesPercent: 16,

    stage: null,
    menu: null,
    players: [],
    bots: [],
    tiles: [],
    bombs: [],
    bonuses: [],

    playerBoyImg: null,
    playerGirlImg: null,
    playerGirl2Img: null,
    tilesImgs: {},
    bombImg: null,
    fireImg: null,
    bonusesImg: null,

    playing: false,
    mute: false,
    soundtrackLoaded: false,
    soundtrackPlaying: false,
    soundtrack: null,

    init: function() {
        this.size = {
            w: this.tileSize * this.tilesX,
            h: this.tileSize * this.tilesY
        };
    },

    load: function() {
        // Init canvas
        this.stage = new createjs.Stage("canvas");
        this.stage.enableMouseOver();

        // Load assets
        var queue = new createjs.LoadQueue();
        var that = this;
        queue.addEventListener("complete", function() {
            that.playerBoyImg = queue.getResult("playerBoy");
            that.playerGirlImg = queue.getResult("playerGirl");
            that.playerGirl2Img = queue.getResult("playerGirl2");
            that.tilesImgs.grass = queue.getResult("tile_grass");
            that.tilesImgs.wall = queue.getResult("tile_wall");
            that.tilesImgs.wood = queue.getResult("tile_wood");
            that.bombImg = queue.getResult("bomb");
            that.fireImg = queue.getResult("fire");
            that.bonusesImg = queue.getResult("bonuses");
            that.setup();
        });
        queue.loadManifest([
            {id: "playerBoy", src: "img/george.png"},
            {id: "playerGirl", src: "img/betty.png"},
            {id: "playerGirl2", src: "img/betty2.png"},
            {id: "tile_grass", src: "img/tile_grass.png"},
            {id: "tile_wall", src: "img/tile_wall.png"},
            {id: "tile_wood", src: "img/tile_wood.png"},
            {id: "bomb", src: "img/bomb.png"},
            {id: "fire", src: "img/fire.png"},
            {id: "bonuses", src: "img/bonuses.png"}
        ]);

        createjs.Sound.addEventListener("fileload", this.onSoundLoaded);
        createjs.Sound.alternateExtensions = ["mp3"];
        createjs.Sound.registerSound("sound/bomb.ogg", "bomb");
        createjs.Sound.registerSound("sound/game.ogg", "game");

        // Create menu
        this.menu = new Menu();

        this.network = network(this.handleMultiplayerGameStart);
    },

    setup: function(data) {
        if (!gInputEngine.bindings.length) {
            gInputEngine.setup();
        }

        this.bombs = [];
        this.tiles = [];
        this.bonuses = [];

        // Draw tiles
        this.drawTiles(data != null ? data.tiles : null);
        this.drawBonuses(data != null ? data.bonuses : null);

        this.spawnBots();
        this.spawnPlayers(data != null ? data.positions : null);

        // add our listeners
        myControls = {
            'up': 'up',
            'left': 'left',
            'down': 'down',
            'right': 'right',
            'bomb': 'bomb'
        };
        function getPosition() {
            var g = gGameEngine.getPlayersAndBots().find(p => p.id === gGameEngine.network.getMyName());
            if (g == null) {
                console.log("no playe");
            }
            return {
                x: g.bmp.x,
                y: g.bmp.y,
            };
        }
        gInputEngine.addListener(myControls.bomb, val => gGameEngine.network.sendKey("bomb", val, getPosition()));
        gInputEngine.addListener(myControls.up, val => gGameEngine.network.sendKey("up", val, getPosition()));
        gInputEngine.addListener(myControls.down, val => gGameEngine.network.sendKey("down", val, getPosition()));
        gInputEngine.addListener(myControls.left, val => gGameEngine.network.sendKey("left", val, getPosition()));
        gInputEngine.addListener(myControls.right, val => gGameEngine.network.sendKey("right", val, getPosition()));

        // Toggle sound
        gInputEngine.addListener('mute', val => !val ? this.toggleSound() : false);

        // Restart listener
        // Timeout because when you press enter in address bar too long, it would not show menu
        // setTimeout(function() {
        //     gInputEngine.addListener('restart', function() {
        //         if (gGameEngine.playersCount == 0) {
        //             gGameEngine.menu.setMode('single');
        //         } else {
        //             gGameEngine.menu.hide();
        //             gGameEngine.restart();
        //         }
        //     });
        // }, 200);

        // Escape listener
        // gInputEngine.addListener('escape', function() {
        //     if (!gGameEngine.menu.visible) {
        //         gGameEngine.menu.show();
        //     }
        // });

        // Start loop
        if (!createjs.Ticker.hasEventListener('tick')) {
            createjs.Ticker.addEventListener('tick', gGameEngine.update);
            createjs.Ticker.framerate = this.fps;
        }

        if (gGameEngine.playersCount > 0) {
            if (this.soundtrackLoaded) {
                this.playSoundtrack();
            }
        }

        if (!this.playing) {
            this.menu.show();
        }
    },

    onSoundLoaded: function(sound) {
        if (sound.id == 'game') {
            gGameEngine.soundtrackLoaded = true;
            if (gGameEngine.playersCount > 0) {
                gGameEngine.playSoundtrack();
            }
        }
    },

    playSoundtrack: function() {
        if (!gGameEngine.soundtrackPlaying) {
            gGameEngine.soundtrack = createjs.Sound.play("game", "none", 0, 0, -1);
            gGameEngine.soundtrack.volume = 1;
            gGameEngine.soundtrackPlaying = true;
        }
    },

    update: function() {
        // Player
        for (var i = 0; i < gGameEngine.players.length; i++) {
            var player = gGameEngine.players[i];
            player.update();
        }

        // Bots
        for (var i = 0; i < gGameEngine.bots.length; i++) {
            var bot = gGameEngine.bots[i];
            bot.update();
        }

        // Bombs
        for (var i = 0; i < gGameEngine.bombs.length; i++) {
            var bomb = gGameEngine.bombs[i];
            bomb.update();
        }

        // Menu
        gGameEngine.menu.update();

        // Stage
        gGameEngine.stage.update();
    },

    drawTiles: function(init) {
        if (init != null) {
            for (var i = 0; i < init.length; i++) {
                var tile = new Tile(init[i].material, init[i].position);
                this.stage.addChild(tile.bmp);
                this.tiles.push(tile);
            }
            return;
        }
        for (var i = 0; i < this.tilesY; i++) {
            for (var j = 0; j < this.tilesX; j++) {
                if ((i == 0 || j == 0 || i == this.tilesY - 1 || j == this.tilesX - 1)
                    || (j % 2 == 0 && i % 2 == 0)) {
                    // Wall tiles
                    var tile = new Tile('wall', { x: j, y: i });
                    this.stage.addChild(tile.bmp);
                    this.tiles.push(tile);
                } else {
                    // Grass tiles
                    var tile = new Tile('grass', { x: j, y: i });
                    this.stage.addChild(tile.bmp);

                    // Wood tiles
                    if (!(i <= 2 && j <= 2)
                        && !(i >= this.tilesY - 3 && j >= this.tilesX - 3)
                        && !(i <= 2 && j >= this.tilesX - 3)
                        && !(i >= this.tilesY - 3 && j <= 2)) {

                        var wood = new Tile('wood', { x: j, y: i });
                        this.stage.addChild(wood.bmp);
                        this.tiles.push(wood);
                    }
                }
            }
        }
    },

    drawBonuses: function(init) {
        // Cache woods tiles
        var woods = [];
        for (var i = 0; i < this.tiles.length; i++) {
            var tile = this.tiles[i];
            if (tile.material == 'wood') {
                woods.push(tile);
            }
        }
        
        // Sort tiles randomly
        woods.sort(function() {
            return 0.5 - Math.random();
        });

        var allTypes = ['speed', 'bomb', 'fire'];
        if (init != null) {
            for (var i = 0; i < init.length; i++) {
                var bonus = new Bonus(init[i].position, init[i].type, allTypes.indexOf(init[i].type));
                this.bonuses.push(bonus);

                const tile = woods.find(w => w.position.x === init[i].position.x && w.position.y === init[i].position.y);
                if (tile == null) {
                    console.log("no tile");
                } else {
                    this.moveToFront(tile.bmp);
                }
            }
            return;
        }

        // Distribute bonuses to quarters of map precisely fairly
        for (var j = 0; j < 4; j++) {
            var bonusesCount = Math.round(woods.length * this.bonusesPercent * 0.01 / 4);
            var placedCount = 0;
            for (var i = 0; i < woods.length; i++) {
                if (placedCount > bonusesCount) {
                    break;
                }

                var tile = woods[i];
                if ((j == 0 && tile.position.x < this.tilesX / 2 && tile.position.y < this.tilesY / 2)
                    || (j == 1 && tile.position.x < this.tilesX / 2 && tile.position.y > this.tilesY / 2)
                    || (j == 2 && tile.position.x > this.tilesX / 2 && tile.position.y < this.tilesX / 2)
                    || (j == 3 && tile.position.x > this.tilesX / 2 && tile.position.y > this.tilesX / 2)) {

                    var typePosition = placedCount % 3;

                    var bonus = new Bonus(tile.position, allTypes[typePosition], typePosition);
                    this.bonuses.push(bonus);

                    // Move wood to front
                    this.moveToFront(tile.bmp);

                    placedCount++;
                }
            }
        }
    },

    spawnBots: function() {
        this.bots = [];

        if (this.botsCount >= 1) {
            var bot2 = new Bot({ x: 1, y: this.tilesY - 2 });
            this.bots.push(bot2);
        }

        if (this.botsCount >= 2) {
            var bot3 = new Bot({ x: this.tilesX - 2, y: 1 });
            this.bots.push(bot3);
        }

        if (this.botsCount >= 3) {
            var bot = new Bot({ x: this.tilesX - 2, y: this.tilesY - 2 });
            this.bots.push(bot);
        }

        if (this.botsCount >= 4) {
            var bot = new Bot({ x: 1, y: 1 });
            this.bots.push(bot);
        }
    },

    spawnPlayers: function(init) {
        var controls;
        if (init != null) {
            var n = gGameEngine.network.getMyName();
            this.players = init.filter(p => p.name !== n).map(pos => new Player(pos.position, gGameEngine.network.getPlayerControls(pos.name), pos.name));
            controls = {
                'up': 'up',
                'left': 'left',
                'down': 'down',
                'right': 'right',
                'bomb': 'bomb'
            };
            this.players.push(new Player(init.find(p => p.name === n).position, getControls(controls), n));
            return;
        }
        if (this.playersCount >= 1) {
            controls = {
                'up': 'up',
                'left': 'left',
                'down': 'down',
                'right': 'right',
                'bomb': 'bomb'
            };
            var player = new Player({ x: 1, y: 1 }, getControls(controls), 0);
            this.players.push(player);
        }

        if (this.playersCount >= 2) {
            controls = {
                'up': 'up2',
                'left': 'left2',
                'down': 'down2',
                'right': 'right2',
                'bomb': 'bomb2'
            };
            var player2 = new Player({ x: this.tilesX - 2, y: this.tilesY - 2 }, getControls(controls), 1);
            this.players.push(player2);
        }
    },

    /**
     * Checks whether two rectangles intersect.
     */
    intersectRect: function(a, b) {
        return (a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom);
    },

    /**
     * Returns tile at given position.
     */
    getTile: function(position) {
        for (var i = 0; i < this.tiles.length; i++) {
            var tile = this.tiles[i];
            if (tile.position.x == position.x && tile.position.y == position.y) {
                return tile;
            }
        }
    },

    /**
     * Returns tile material at given position.
     */
    getTileMaterial: function(position) {
        var tile = this.getTile(position);
        return (tile) ? tile.material : 'grass' ;
    },

    gameOver: function(status) {
        if (gGameEngine.menu.visible) { return; }

        if (status == 'win') {
            var winText = "You won!";
            if (gGameEngine.playersCount >= 1) {
                var winner = gGameEngine.getWinner();
                winText = winner == 0 ? "Player 1 won!" : "Player 2 won!";
            }
            this.menu.show([{text: winText, color: '#669900'}, {text: ' ;D', color: '#99CC00'}]);
        } else {
            this.menu.show([{text: 'Game Over', color: '#CC0000'}, {text: ' :(', color: '#FF4444'}]);
        }
    },

    getWinner: function() {
        for (var i = 0; i < gGameEngine.players.length; i++) {
            var player = gGameEngine.players[i];
            if (player.alive) {
                return i;
            }
        }
    },

    handleMultiplayerGameStart: function(data) {
        gGameEngine.playing = true;
        gGameEngine.playersCount = 1;
        gGameEngine.botsCount = 0;
        gGameEngine.remotePlayers = data.positions.length - 1;
        gGameEngine.menu.hide();
        gGameEngine.bombs = [];
        gGameEngine.tiles = [];
        gGameEngine.bonuses = [];
        gGameEngine.bots = [];
        gInputEngine.removeAllListeners();
        gGameEngine.network.removeListeners();
        gGameEngine.stage.removeAllChildren();

        gGameEngine.setup(data);
    },

    restart: function(mode) {
        gInputEngine.removeAllListeners();
        gGameEngine.network.removeListeners();
        gGameEngine.stage.removeAllChildren();

        if (mode == 'single') {
            gGameEngine.playing = true;
            gGameEngine.botsCount = 3;
            gGameEngine.playersCount = 1;
            gGameEngine.setup();
        } else {
            var allUsers = gGameEngine.network.getUsers();
            var positions = [
                { x: 1, y: this.tilesY - 2 },
                { x: this.tilesX - 2, y: 1 },
                { x: this.tilesX - 2, y: this.tilesY - 2 },
                { x: 1, y: 1 },
            ];

            gGameEngine.bombs = [];
            gGameEngine.tiles = [];
            gGameEngine.bonuses = [];
            gGameEngine.bots = [];
    
            // Draw tiles
            gGameEngine.drawTiles();
            gGameEngine.drawBonuses();
            gGameEngine.stage.removeAllChildren();

            gGameEngine.network.start({
                tiles: gGameEngine.tiles.map(t => ({ position: t.position, material: t.material })),
                bonuses: gGameEngine.bonuses.map(b => ({ position: b.position, type: b.type })),
                positions: allUsers.map((user, idx) => ({
                    name: user.name,
                    position: positions[idx],
                }))
            });
        }
    },

    /**
     * Moves specified child to the front.
     */
    moveToFront: function(child) {
        var children = gGameEngine.stage.numChildren;
        gGameEngine.stage.setChildIndex(child, children - 1);
    },

    toggleSound: function() {
        if (gGameEngine.mute) {
            gGameEngine.mute = false;
            gGameEngine.soundtrack.paused = false;
        } else {
            gGameEngine.mute = true;
            gGameEngine.soundtrack.paused = true;
        }
    },

    countPlayersAlive: function() {
        var playersAlive = 0;
        for (var i = 0; i < gGameEngine.players.length; i++) {
            if (gGameEngine.players[i].alive) {
                playersAlive++;
            }
        }
        return playersAlive;
    },

    getPlayersAndBots: function() {
        var players = [];

        for (var i = 0; i < gGameEngine.players.length; i++) {
            players.push(gGameEngine.players[i]);
        }

        for (var i = 0; i < gGameEngine.bots.length; i++) {
            players.push(gGameEngine.bots[i]);
        }

        return players;
    }
});

gGameEngine = new GameEngine();