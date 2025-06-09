// server.js - Phase 2: Integrated Matter.js for Physics

const WebSocket = require('ws');
const Matter = require('matter-js'); // --- NEW: Import Matter.js

// --- Game Constants ---
const GAME_WIDTH = 800; const GAME_HEIGHT = 600;
// --- NOTE: Physics constants are now tuned for Matter.js ---
const PLAYER_MOVE_FORCE = 0.003; // Force applied for movement
const PLAYER_JUMP_VELOCITY = 14; // Instantaneous velocity for jumps
const KNOCKBACK_SCALING = 0.04; // Multiplier for knockback force

// Attack system constants (no change)
const BASIC_ATTACK_DAMAGE = 5; const BASE_KNOCKBACK = 3; 
const BASIC_ATTACK_DURATION = 150; const BASIC_ATTACK_COOLDOWN = 300; const BASIC_ATTACK_RANGE = 50; const BASIC_ATTACK_HEIGHT = 20;
const SPECIAL_ATTACK_DURATION = 250; const SPECIAL_ATTACK_COOLDOWN = 500; 
const GUARD_DURATION = 200; const GUARD_COOLDOWN = 400;

// Ledge grabbing constants (no change)
const LEDGE_GRAB_RANGE = 25;
const LEDGE_GRAB_DURATION = 3000;
const LEDGE_RELEASE_VELOCITY = 8;

const ROUNDS_TO_WIN_MATCH = 2; const OFF_SCREEN_THRESHOLD = 150; const SERVER_TICK_RATE = 1000 / 60;

// --- Data Definitions (no change) ---
const characterTypes = { "RED_KNIGHT": { color: 'red', moveSpeed: 5, jumpStrength: 12, gravityMultiplier: 1.0 }, "BLUE_NINJA": { color: 'blue', moveSpeed: 6.5, jumpStrength: 14, gravityMultiplier: 0.95 } };
const stageKeys = ["stage1", "stage2", "stage3", "stage4"];
const stages = {
    "stage1": { name: "Center Platform", platforms: [{ x: GAME_WIDTH * 0.2, y: GAME_HEIGHT - 50, width: GAME_WIDTH * 0.6, height: 50, color: '#228b22' }], spawnPoints: [{ x: GAME_WIDTH / 4, y: GAME_HEIGHT - 150 }, { x: GAME_WIDTH * 3 / 4, y: GAME_HEIGHT - 150 }], bgColor: '#add8e6' },
    "stage2": { name: "Dual Platforms", platforms: [{ x: GAME_WIDTH * 0.1, y: GAME_HEIGHT - 150, width: GAME_WIDTH * 0.3, height: 30, color: '#a0522d' }, { x: GAME_WIDTH * 0.6, y: GAME_HEIGHT - 150, width: GAME_WIDTH * 0.3, height: 30, color: '#a0522d' }], spawnPoints: [{ x: GAME_WIDTH * 0.25, y: GAME_HEIGHT - 250 }, { x: GAME_WIDTH * 0.75, y: GAME_HEIGHT - 250 }], bgColor: '#d3d3d3' },
    "stage3": { name: "Sky Bridges", platforms: [{ x: GAME_WIDTH * 0.35, y: GAME_HEIGHT - 80, width: GAME_WIDTH * 0.3, height: 40, color: '#4682b4' },{ x: GAME_WIDTH * 0.05, y: GAME_HEIGHT - 200, width: GAME_WIDTH * 0.2, height: 25, color: '#696969' },{ x: GAME_WIDTH * 0.1, y: GAME_HEIGHT - 320, width: GAME_WIDTH * 0.15, height: 25, color: '#696969' },{ x: GAME_WIDTH * 0.75, y: GAME_HEIGHT - 200, width: GAME_WIDTH * 0.2, height: 25, color: '#696969' },{ x: GAME_WIDTH * 0.75, y: GAME_HEIGHT - 320, width: GAME_WIDTH * 0.15, height: 25, color: '#696969' },{ x: GAME_WIDTH * 0.4, y: GAME_HEIGHT - 400, width: GAME_WIDTH * 0.2, height: 20, color: '#696969' }], spawnPoints: [{ x: GAME_WIDTH * 0.15, y: GAME_HEIGHT - 300 }, { x: GAME_WIDTH * 0.82, y: GAME_HEIGHT - 300 }], bgColor: '#87ceeb' },
    "stage4": { name: "Arena Walls", platforms: [{ x: GAME_WIDTH * 0.15, y: GAME_HEIGHT - 50, width: GAME_WIDTH * 0.7, height: 50, color: '#8b4513' },{ x: GAME_WIDTH * 0.05, y: GAME_HEIGHT - 300, width: 30, height: 250, color: '#696969' },{ x: GAME_WIDTH * 0.915, y: GAME_HEIGHT - 300, width: 30, height: 250, color: '#696969' },{ x: GAME_WIDTH * 0.08, y: GAME_HEIGHT - 180, width: 80, height: 20, color: '#a0522d' },{ x: GAME_WIDTH * 0.84, y: GAME_HEIGHT - 180, width: 80, height: 20, color: '#a0522d' }], spawnPoints: [{ x: GAME_WIDTH * 0.25, y: GAME_HEIGHT - 150 }, { x: GAME_WIDTH * 0.75, y: GAME_HEIGHT - 150 }], bgColor: '#2f4f4f' }
};
const characterAttacks = { "RED_KNIGHT": { basicDamage: 7, basicRange: 60, basicKnockback: 1.2, specialDamage: 12, specialRange: 80, specialKnockback: 1.5, guardReduction: 0.5 }, "BLUE_NINJA": { basicDamage: 4, basicRange: 40, basicKnockback: 0.8, specialDamage: 8, specialRange: 60, specialKnockback: 1.0, guardReduction: 0.8 } };

// --- Server State ---
const clients = new Map();
let player1ClientId = null; let player2ClientId = null; let gameLoopInterval = null;
const PORT = process.env.PORT || 8080;

// --- NEW: Physics Engine Setup ---
let engine = Matter.Engine.create();
engine.world.gravity.y = 1.2; // Tuned for Matter.js
const physicsBodies = {}; // To store player physics bodies { 'player1': body, 'player2': body }

// --- Authoritative Game State (vx/vy are now for client-side interpolation only) ---
let serverGame = {
    state: "waiting", stage: null, players: {},
    match: { scores: [0, 0], roundWinnerId: null, matchWinnerId: null },
    // Timers are unchanged
    basicAttackCooldowns: { player1: 0, player2: 0 }, basicAttackActiveTimers: { player1: 0, player2: 0 },
    specialAttackCooldowns: { player1: 0, player2: 0 }, specialAttackActiveTimers: { player1: 0, player2: 0 },
    guardCooldowns: { player1: 0, player2: 0 }, guardActiveTimers: { player1: 0, player2: 0 },
    ledgeHangTimers: { player1: 0, player2: 0 },
    pendingRoundReset: false, pendingMatchReset: false, lastUpdateTime: 0, deltaTime: 0
};

// --- Helper Functions ---
function checkCollision(r1, r2) { if (!r1 || !r2) return false; return (r1.x < r2.x + r2.width && r1.x + r1.width > r2.x && r1.y < r2.y + r2.height && r1.y + r1.height > r2.y); }

function createPlayer(id, type) {
    if (!serverGame.stage) { console.error("No stage set for player creation"); return null; }
    const cT=characterTypes[type]; const sI=id==='player1'?0:1; const sP=serverGame.stage.spawnPoints[sI];
    if(!sP){console.error(`Spawn ${sI} missing`);return null;}

    // --- NEW: Create a Matter.js body for the player ---
    const playerBody = Matter.Bodies.rectangle(sP.x, sP.y, 50, 50, {
        label: id,
        inertia: Infinity, // Prevents rotation
        frictionAir: 0.02, // Some air resistance
        friction: 0.05, // Friction on surfaces
        restitution: 0.1, // Bounciness
        mass: cT.gravityMultiplier > 1 ? 12 : 10 // Heavier characters are less affected by knockback
    });
    physicsBodies[id] = playerBody;
    Matter.World.add(engine.world, playerBody);

    return { 
        id: id, type: type, width: 50, height: 50, color: cT.color, 
        moveSpeed: cT.moveSpeed, jumpStrength: cT.jumpStrength,
        x: sP.x - 25, y: sP.y - 25, vx: 0, vy: 0, isOnGround: false, percentage: 0, 
        facingDirection: sI === 0 ? 1 : -1, 
        isBasicAttacking: false, isSpecialAttacking: false, isGuarding: false,
        isLedgeHanging: false, ledgePlatform: null, ledgeDirection: 0 
    };
}

// Ledge grabbing functions are unchanged but will interact with the new physics
function checkLedgeGrab(player) {
    if (!serverGame.stage || player.isOnGround || player.isLedgeHanging) return null;
    const body = physicsBodies[player.id];
    if (!body || body.velocity.y <= 0) return null; // Only check when falling
    
    for(const plat of serverGame.stage.platforms) {
        const playerBottom = player.y + player.height;
        const playerCenter = player.x + player.width / 2;
        
        if (playerBottom > plat.y && playerBottom < plat.y + plat.height + LEDGE_GRAB_RANGE) {
            if (Math.abs((player.x + player.width) - plat.x) < LEDGE_GRAB_RANGE && player.x < plat.x) {
                return { platform: plat, direction: 1, x: plat.x - player.width, y: plat.y };
            }
            if (Math.abs(player.x - (plat.x + plat.width)) < LEDGE_GRAB_RANGE && player.x + player.width > plat.x + plat.width) {
                return { platform: plat, direction: -1, x: plat.x + plat.width, y: plat.y };
            }
        }
    }
    return null;
}

function releaseLedgeGrab(player, direction) {
    player.isLedgeHanging = false;
    player.ledgePlatform = null;
    player.ledgeDirection = 0;
    serverGame.ledgeHangTimers[player.id] = 0;
    
    const body = physicsBodies[player.id];
    Matter.Body.setStatic(body, false); // --- NEW: Re-enable physics

    let releaseVel = { x: 0, y: 0 };
    if (direction > 0) { // Climb up
        releaseVel = { x: player.facingDirection * 4, y: -PLAYER_JUMP_VELOCITY * 0.8 };
    } else if (direction < 0) { // Release backward
        releaseVel = { x: -player.facingDirection * 6, y: -4 };
    } else { // Let go
        releaseVel = { x: 0, y: 2 };
    }
    Matter.Body.setVelocity(body, releaseVel);
}

// --- Server Game Loop ---
function gameTick() {
    const now = Date.now();
    serverGame.deltaTime = now - (serverGame.lastUpdateTime || now);
    serverGame.lastUpdateTime = now;

    if (serverGame.state === "playing") {
        // Update timers (no change)
        for(const pId in serverGame.basicAttackActiveTimers) { if(serverGame.basicAttackActiveTimers[pId] > 0) { serverGame.basicAttackActiveTimers[pId] -= serverGame.deltaTime; if(serverGame.basicAttackActiveTimers[pId] <= 0) if(serverGame.players[pId]) serverGame.players[pId].isBasicAttacking = false; } }
        for(const pId in serverGame.specialAttackActiveTimers) { if(serverGame.specialAttackActiveTimers[pId] > 0) { serverGame.specialAttackActiveTimers[pId] -= serverGame.deltaTime; if(serverGame.specialAttackActiveTimers[pId] <= 0) if(serverGame.players[pId]) serverGame.players[pId].isSpecialAttacking = false; } }
        for(const pId in serverGame.guardActiveTimers) { if(serverGame.guardActiveTimers[pId] > 0) { serverGame.guardActiveTimers[pId] -= serverGame.deltaTime; if(serverGame.guardActiveTimers[pId] <= 0) if(serverGame.players[pId]) serverGame.players[pId].isGuarding = false; } }
        for(const pId in serverGame.basicAttackCooldowns) { if(serverGame.basicAttackCooldowns[pId] > 0) serverGame.basicAttackCooldowns[pId] -= serverGame.deltaTime; }
        for(const pId in serverGame.specialAttackCooldowns) { if(serverGame.specialAttackCooldowns[pId] > 0) serverGame.specialAttackCooldowns[pId] -= serverGame.deltaTime; }
        for(const pId in serverGame.guardCooldowns) { if(serverGame.guardCooldowns[pId] > 0) serverGame.guardCooldowns[pId] -= serverGame.deltaTime; }
        for(const pId in serverGame.ledgeHangTimers) { if(serverGame.ledgeHangTimers[pId] > 0) { serverGame.ledgeHangTimers[pId] -= serverGame.deltaTime; if(serverGame.ledgeHangTimers[pId] <= 0) { const p = serverGame.players[pId]; if(p && p.isLedgeHanging) releaseLedgeGrab(p, 0); } } }

        // --- NEW: Process inputs and apply forces ---
        processPlayerInputs();
        
        // --- NEW: Step the physics engine ---
        Matter.Engine.update(engine, serverGame.deltaTime);
        
        // --- NEW: Update game state from physics engine ---
        updateStateFromPhysics();

        checkServerWinConditions();
    }
    broadcastGameState();
}

// --- NEW: Separated input processing from physics updates ---
function processPlayerInputs() {
    for (const playerId in serverGame.players) {
        const player = serverGame.players[playerId];
        const body = physicsBodies[playerId];
        if (!player || !body) continue;

        const client = Array.from(clients.values()).find(c => c.playerId === playerId);
        const input = client ? client.lastInput : {};
        
        // --- Ledge Grab Logic ---
        if (player.isLedgeHanging) {
            if (input.jump) releaseLedgeGrab(player, 1);
            else if ((input.left && player.facingDirection === 1) || (input.right && player.facingDirection === -1)) releaseLedgeGrab(player, -1);
            else if (input.guard) releaseLedgeGrab(player, 0);
            continue; // Skip other physics if hanging
        }

        const ledgeGrab = checkLedgeGrab(player);
        if (ledgeGrab) {
            player.isLedgeHanging = true;
            player.ledgePlatform = ledgeGrab.platform;
            player.facingDirection = ledgeGrab.direction * -1;
            serverGame.ledgeHangTimers[playerId] = LEDGE_GRAB_DURATION;
            
            Matter.Body.setStatic(body, true); // Freeze body
            // Snap to ledge position
            const newPos = { x: ledgeGrab.x + player.width/2, y: ledgeGrab.y + player.height/2 };
            Matter.Body.setPosition(body, newPos);
            continue;
        }

        // --- Grounded Movement ---
        const moveMultiplier = player.isGuarding ? 0.3 : 1.0;
        if (input.left) {
            Matter.Body.applyForce(body, body.position, { x: -PLAYER_MOVE_FORCE * moveMultiplier, y: 0 });
            player.facingDirection = -1;
        } else if (input.right) {
            Matter.Body.applyForce(body, body.position, { x: PLAYER_MOVE_FORCE * moveMultiplier, y: 0 });
            player.facingDirection = 1;
        }

        // --- Jump ---
        if (input.jump && player.isOnGround && !player.isGuarding) {
            Matter.Body.setVelocity(body, { x: body.velocity.x, y: -PLAYER_JUMP_VELOCITY });
            player.isOnGround = false;
        }

        // --- Attacks and Guarding (logic is mostly the same, but applies forces) ---
        const opp = serverGame.players[playerId === "player1" ? "player2" : "player1"];
        const oppBody = opp ? physicsBodies[opp.id] : null;

        // Guard
        if (input.guard && serverGame.guardActiveTimers[playerId] <= 0 && serverGame.guardCooldowns[playerId] <= 0) {
            serverGame.guardCooldowns[playerId] = GUARD_COOLDOWN; serverGame.guardActiveTimers[playerId] = GUARD_DURATION; player.isGuarding = true;
        }

        // Basic Attack
        if (input.basicAttack && serverGame.basicAttackActiveTimers[playerId] <= 0 && serverGame.basicAttackCooldowns[playerId] <= 0 && !player.isGuarding) { 
            serverGame.basicAttackCooldowns[playerId] = BASIC_ATTACK_COOLDOWN; serverGame.basicAttackActiveTimers[playerId] = BASIC_ATTACK_DURATION; player.isBasicAttacking = true; 
            const charStats = characterAttacks[player.type];
            const attackBox = { x: player.facingDirection === 1 ? player.x + player.width : player.x - charStats.basicRange, y: player.y, width: charStats.basicRange, height: player.height };
            if (opp && oppBody && checkCollision(attackBox, opp)) {
                if (opp.isGuarding) {
                    Matter.Body.applyForce(oppBody, oppBody.position, { x: player.facingDirection * 0.01, y: -0.01 });
                } else {
                    opp.percentage += charStats.basicDamage;
                    const kbForce = (BASE_KNOCKBACK + (opp.percentage * KNOCKBACK_SCALING)) * charStats.basicKnockback;
                    const angle = -Math.PI / 4; // 45 degrees up
                    const force = { x: player.facingDirection * kbForce * Math.cos(angle), y: kbForce * Math.sin(angle) };
                    Matter.Body.applyForce(oppBody, oppBody.position, force);
                    opp.isOnGround = false;
                }
            }
        }
        // Special attacks would follow the same pattern of applying forces...
    }
}

// --- NEW: Reads data from Matter.js bodies back into our game state ---
function updateStateFromPhysics() {
    for (const playerId in serverGame.players) {
        const player = serverGame.players[playerId];
        const body = physicsBodies[playerId];
        if (!player || !body) continue;

        // Don't update from physics if hanging on a ledge
        if (player.isLedgeHanging) {
            player.vx = 0;
            player.vy = 0;
            continue;
        }

        // Update position from the center of the physics body
        player.x = body.position.x - player.width / 2;
        player.y = body.position.y - player.height / 2;
        
        // Update velocity for client-side interpolation
        player.vx = body.velocity.x;
        player.vy = body.velocity.y;
    }
}

// --- NEW: Ground check using collision events ---
Matter.Events.on(engine, 'collisionStart', (event) => {
    const pairs = event.pairs;
    for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        let playerBody, platformBody;

        if (pair.bodyA.label.startsWith('player') && pair.bodyB.label.startsWith('platform')) {
            playerBody = pair.bodyA;
            platformBody = pair.bodyB;
        } else if (pair.bodyB.label.startsWith('player') && pair.bodyA.label.startsWith('platform')) {
            playerBody = pair.bodyB;
            platformBody = pair.bodyA;
        }

        if (playerBody) {
            const player = serverGame.players[playerBody.label];
            // Check if collision is from the top
            if (player && pair.collision.normal.y < -0.5) {
                player.isOnGround = true;
            }
        }
    }
});
Matter.Events.on(engine, 'collisionEnd', (event) => {
    // This is simpler; if a player stops touching anything, they might not be on the ground.
    // A more robust solution would check ALL active collisions.
    const pairs = event.pairs;
    for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
         if (pair.bodyA.label.startsWith('player')) {
            const player = serverGame.players[pair.bodyA.label];
            if(player) player.isOnGround = false; // Assume not on ground, will be re-set to true if touching
        }
         if (pair.bodyB.label.startsWith('player')) {
            const player = serverGame.players[pair.bodyB.label];
            if(player) player.isOnGround = false;
        }
    }
});


// --- Functions for managing game state, rounds, matches ---
// (These are mostly unchanged, but reset functions now also handle the physics world)

function checkServerWinConditions() {
    if (serverGame.state !== "playing") return;
    for (const pId in serverGame.players) {
        const p = serverGame.players[pId]; if (!p) continue;
        const opp = serverGame.players[pId === "player1" ? "player2" : "player1"];
        if(p.y > GAME_HEIGHT + OFF_SCREEN_THRESHOLD || p.x + p.width < 0 - OFF_SCREEN_THRESHOLD || p.x > GAME_WIDTH + OFF_SCREEN_THRESHOLD) {
            if (opp) handleServerRoundEnd(opp, p);
            else { resetServerMatchAndStartNew(); serverGame.state = "waiting"; }
            return;
        }
    }
}

function resetServerPlayerState(player) {
    if (!player || !serverGame.stage) return;
    const sI = player.id === "player1" ? 0 : 1;
    const sP = serverGame.stage.spawnPoints[sI];
    if (!sP) {console.error(`Spawn ${sI} missing`); return;}
    
    // --- NEW: Reset physics body position and velocity ---
    const body = physicsBodies[player.id];
    if (body) {
        Matter.Body.setStatic(body, false);
        Matter.Body.setPosition(body, { x: sP.x, y: sP.y });
        Matter.Body.setVelocity(body, { x: 0, y: 0 });
    }

    player.x = sP.x - player.width/2; player.y = sP.y;
    player.vx = 0; player.vy = 0;
    player.percentage = 0; player.isOnGround = false;
    player.facingDirection = sI === 0 ? 1 : -1;
    player.isBasicAttacking = false; player.isSpecialAttacking = false; player.isGuarding = false;
    player.isLedgeHanging = false; player.ledgePlatform = null; player.ledgeDirection = 0;
    
    // Reset timers
    for (const key in serverGame) {
        if (key.endsWith('s') && serverGame[key][player.id] !== undefined) {
            serverGame[key][player.id] = 0;
        }
    }
}

function resetServerRoundState() {
    console.log("[Server] Resetting Round State.");
    
    // --- NEW: Clear old physics bodies for the stage ---
    Matter.World.clear(engine.world, false); // false keeps the engine, just clears bodies
    engine.world.gravity.y = 1.2; // Re-assert gravity

    const randomStageKey = stageKeys[Math.floor(Math.random() * stageKeys.length)];
    serverGame.stage = stages[randomStageKey];
    console.log(`[Server] New Round Stage: ${serverGame.stage.name}`);

    // --- NEW: Create physics bodies for the new stage platforms ---
    const platformBodies = serverGame.stage.platforms.map((p, i) =>
        Matter.Bodies.rectangle(p.x + p.width / 2, p.y + p.height / 2, p.width, p.height, {
            isStatic: true,
            label: `platform-${i}`
        })
    );
    Matter.World.add(engine.world, platformBodies);
    
    for (const pId in serverGame.players) { 
        const player = serverGame.players[pId];
        // Re-add player bodies to the new world
        if (physicsBodies[pId]) Matter.World.add(engine.world, physicsBodies[pId]);
        resetServerPlayerState(player); 
    }
    serverGame.match.roundWinnerId = null; 
    serverGame.pendingRoundReset = false;
}

function handleServerRoundEnd(winner, loser) {
    if (serverGame.state !== "playing") return;
    console.log(`[Svr Rnd End] Win:${winner.id}`);
    serverGame.state="roundOver";
    serverGame.match.roundWinnerId=winner.id;
    const wI=winner.id==="player1"?0:1;
    serverGame.match.scores[wI]++;
    if (serverGame.match.scores[wI]>=ROUNDS_TO_WIN_MATCH) {
        handleServerMatchEnd(winner);
    } else {
        serverGame.pendingRoundReset=true;
    }
}

function handleServerMatchEnd(winner) {
    console.log(`[Svr Mch End] Win:${winner.id}`);
    serverGame.state="matchOver";
    serverGame.match.matchWinnerId=winner.id;
    serverGame.pendingMatchReset=true;
}

function resetServerMatchAndStartNew() {
    console.log("[Server] Resetting Full Match and Starting New...");
    
    // Clear player objects and physics bodies map
    serverGame.players = {};
    for (const key in physicsBodies) {
        delete physicsBodies[key];
    }
    
    serverGame.match.scores = [0, 0];
    serverGame.match.roundWinnerId = null;
    serverGame.match.matchWinnerId = null;

    if (clients.size === 2) {
        serverGame.players.player1 = createPlayer("player1", "RED_KNIGHT");
        serverGame.players.player2 = createPlayer("player2", "BLUE_NINJA");
        
        resetServerRoundState();

        serverGame.state = "playing";
        serverGame.pendingMatchReset = false;
        serverGame.lastUpdateTime = Date.now();

        if (!gameLoopInterval) {
            gameLoopInterval = setInterval(gameTick, SERVER_TICK_RATE);
            console.log("[Server] Game loop started.");
        }
    } else {
        console.log("[Server] Need 2 players to start new match.");
        serverGame.state = "waiting";
        if (gameLoopInterval) { clearInterval(gameLoopInterval); gameLoopInterval = null; }
    }
}

// WebSocket and broadcasting logic remains the same as it's decoupled from the physics implementation.
// ... (The rest of your WebSocket server code from ws.on('connection') onwards is unchanged)
// --- WebSocket Server Setup ---
const wss = new WebSocket.Server({ port: PORT });
console.log(`WebSocket server started on port ${PORT}...`);

wss.on('connection', (ws) => {
    let assignedPlayerId = null; let clientId = null;
    if (player1ClientId === null) { clientId=1; player1ClientId=clientId; assignedPlayerId="player1"; clients.set(clientId,{ws:ws,playerId:assignedPlayerId,lastInput:{}}); console.log(`Client ${clientId} connected as ${assignedPlayerId}`); }
    else if (player2ClientId === null) { clientId=2; player2ClientId=clientId; assignedPlayerId="player2"; clients.set(clientId,{ws:ws,playerId:assignedPlayerId,lastInput:{}}); console.log(`Client ${clientId} connected as ${assignedPlayerId}`); }
    else { console.log("Game full. Rejecting."); ws.send(JSON.stringify({type:'error',payload:'Game is full'})); ws.close(); return; }

    ws.send(JSON.stringify({type:'your_player_id',payload:assignedPlayerId}));

    if (player1ClientId !== null && player2ClientId !== null && serverGame.state === "waiting") {
        resetServerMatchAndStartNew();
    } else {
        ws.send(JSON.stringify({ type: 'game_state', payload: getSerializableGameState() }));
    }

    ws.on('message', (message) => {
        if (!assignedPlayerId) return;
        try {
            const messageData = JSON.parse(message.toString());
            if (messageData.type === 'input') {
                const clientData = Array.from(clients.values()).find(c => c.playerId === assignedPlayerId); if (clientData) clientData.lastInput = messageData.payload;
            } else if (messageData.type === 'request_next_round') {
                 if (serverGame.state === 'roundOver' && serverGame.pendingRoundReset) { console.log(`[Server] RX Next Round Req from ${assignedPlayerId}.`); resetServerRoundState(); serverGame.state = "playing"; }
            } else if (messageData.type === 'request_new_match') {
                 if (serverGame.state === 'matchOver' && serverGame.pendingMatchReset) { console.log(`[Server] RX New Match Req from ${assignedPlayerId}.`); resetServerMatchAndStartNew(); }
            }
        } catch (error) { console.error(`[Server] Error processing msg from ${assignedPlayerId}:`, error); }
    });

    ws.on('close', () => {
        console.log(`Client ${assignedPlayerId} (${clientId}) disconnected.`); const cD = Array.from(clients.values()).find(c => c.playerId === assignedPlayerId); if(cD) clients.delete(Array.from(clients.keys()).find(k => clients.get(k) === cD));
        if (assignedPlayerId === "player1") player1ClientId = null; else if (assignedPlayerId === "player2") player2ClientId = null; console.log(`Clients remaining: ${clients.size}`);
        if (clients.size < 2 && serverGame.state !== "waiting") { console.log("Player left, stopping game."); if (gameLoopInterval) { clearInterval(gameLoopInterval); gameLoopInterval = null; } serverGame.state = "waiting"; serverGame.players = {}; broadcast({ type: 'opponent_left', payload: {} }); }
        else { broadcast({ type: 'player_left', payload: { playerId: assignedPlayerId } }); }
    });
    ws.on('error', (error) => { console.error(`WS error for ${assignedPlayerId} (${clientId}):`, error); ws.close(); });
});

// --- State Broadcasting ---
function getSerializableGameState() {
    const stateToSend = {
        state: serverGame.state,
        players: {},
        match: serverGame.match, 
        stageName: serverGame.stage?.name,
        platforms: serverGame.stage?.platforms || [],
        bgColor: serverGame.stage?.bgColor || '#333'
    };
    
    for(const pId in serverGame.players) {
        const p = serverGame.players[pId];
        if(p) {
            stateToSend.players[pId] = {
                id: p.id, x: p.x, y: p.y, vx: p.vx, vy: p.vy,
                percentage: p.percentage, facingDirection: p.facingDirection, isOnGround: p.isOnGround,
                isBasicAttacking: p.isBasicAttacking, isSpecialAttacking: p.isSpecialAttacking, isGuarding: p.isGuarding,
                isLedgeHanging: p.isLedgeHanging, type: p.type, color: p.color, width: p.width, height: p.height
            };
        }
    }
    return stateToSend;
}
function broadcastGameState() { const statePayload = getSerializableGameState(); statePayload.serverTime = Date.now(); broadcast({ type: 'game_state', payload: statePayload }); }
function broadcast(message) { const msgStr = JSON.stringify(message); clients.forEach((cD) => { if (cD.ws.readyState === WebSocket.OPEN) { try { cD.ws.send(msgStr); } catch (err) { console.error(`Err sending to ${cD.playerId}:`, err); } } }); }

console.log('Server setup complete. Waiting...');