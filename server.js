// server.js - Phase 9: Authoritative Server + Reset + Random Stage
// NO MAJOR CHANGES IN PHASE 1 - ONLY ADDING SERVERTIME FOR INTERPOLATION

const WebSocket = require('ws');

// --- Game Constants ---
const GAME_WIDTH = 800; const GAME_HEIGHT = 600; const GRAVITY = 0.5; const FRICTION = 0.8; 

// Attack system constants
const BASIC_ATTACK_DAMAGE = 5; const BASE_KNOCKBACK = 3; const KNOCKBACK_SCALING = 0.08; 
const BASIC_ATTACK_DURATION = 150; const BASIC_ATTACK_COOLDOWN = 300; const BASIC_ATTACK_RANGE = 50; const BASIC_ATTACK_HEIGHT = 20;
const SPECIAL_ATTACK_DURATION = 250; const SPECIAL_ATTACK_COOLDOWN = 500; 
const GUARD_DURATION = 200; const GUARD_COOLDOWN = 400;

// Ledge grabbing constants
const LEDGE_GRAB_RANGE = 25; // How close player needs to be to platform edge
const LEDGE_GRAB_DURATION = 3000; // Max time hanging (3 seconds)
const LEDGE_RELEASE_VELOCITY = 8; // Velocity when releasing from ledge

const ROUNDS_TO_WIN_MATCH = 2; const OFF_SCREEN_THRESHOLD = 150; const SERVER_TICK_RATE = 1000 / 60;

// --- Data Definitions ---
const characterTypes = { "RED_KNIGHT": { color: 'red', moveSpeed: 5, jumpStrength: 12, gravityMultiplier: 1.0 }, "BLUE_NINJA": { color: 'blue', moveSpeed: 6.5, jumpStrength: 14, gravityMultiplier: 0.95 } };
const stageKeys = ["stage1", "stage2", "stage3", "stage4"]; // Array of stage keys for randomization
const stages = {
    "stage1": { 
        name: "Center Platform", 
        platforms: [
            { x: GAME_WIDTH * 0.2, y: GAME_HEIGHT - 50, width: GAME_WIDTH * 0.6, height: 50, color: '#228b22' }
        ], 
        spawnPoints: [
            { x: GAME_WIDTH / 4, y: GAME_HEIGHT - 150 }, 
            { x: GAME_WIDTH * 3 / 4, y: GAME_HEIGHT - 150 }
        ], 
        bgColor: '#add8e6' 
    },
    "stage2": { 
        name: "Dual Platforms", 
        platforms: [
            { x: GAME_WIDTH * 0.1, y: GAME_HEIGHT - 150, width: GAME_WIDTH * 0.3, height: 30, color: '#a0522d' }, 
            { x: GAME_WIDTH * 0.6, y: GAME_HEIGHT - 150, width: GAME_WIDTH * 0.3, height: 30, color: '#a0522d' }
        ], 
        spawnPoints: [
            { x: GAME_WIDTH * 0.25, y: GAME_HEIGHT - 250 }, 
            { x: GAME_WIDTH * 0.75, y: GAME_HEIGHT - 250 }
        ], 
        bgColor: '#d3d3d3' 
    },
    "stage3": { 
        name: "Sky Bridges", 
        platforms: [
            // Main central platform
            { x: GAME_WIDTH * 0.35, y: GAME_HEIGHT - 80, width: GAME_WIDTH * 0.3, height: 40, color: '#4682b4' },
            // Left floating platforms (darker gray)
            { x: GAME_WIDTH * 0.05, y: GAME_HEIGHT - 200, width: GAME_WIDTH * 0.2, height: 25, color: '#696969' },
            { x: GAME_WIDTH * 0.1, y: GAME_HEIGHT - 320, width: GAME_WIDTH * 0.15, height: 25, color: '#696969' },
            // Right floating platforms (darker gray)
            { x: GAME_WIDTH * 0.75, y: GAME_HEIGHT - 200, width: GAME_WIDTH * 0.2, height: 25, color: '#696969' },
            { x: GAME_WIDTH * 0.75, y: GAME_HEIGHT - 320, width: GAME_WIDTH * 0.15, height: 25, color: '#696969' },
            // Top bridge (darker gray)
            { x: GAME_WIDTH * 0.4, y: GAME_HEIGHT - 400, width: GAME_WIDTH * 0.2, height: 20, color: '#696969' }
        ], 
        spawnPoints: [
            { x: GAME_WIDTH * 0.15, y: GAME_HEIGHT - 300 }, 
            { x: GAME_WIDTH * 0.82, y: GAME_HEIGHT - 300 }
        ], 
        bgColor: '#87ceeb' 
    },
    "stage4": { 
        name: "Arena Walls", 
        platforms: [
            // Main floor platform
            { x: GAME_WIDTH * 0.15, y: GAME_HEIGHT - 50, width: GAME_WIDTH * 0.7, height: 50, color: '#8b4513' },
            // Left wall
            { x: GAME_WIDTH * 0.05, y: GAME_HEIGHT - 300, width: 30, height: 250, color: '#696969' },
            // Right wall
            { x: GAME_WIDTH * 0.915, y: GAME_HEIGHT - 300, width: 30, height: 250, color: '#696969' },
            // Small elevated platforms on walls
            { x: GAME_WIDTH * 0.08, y: GAME_HEIGHT - 180, width: 80, height: 20, color: '#a0522d' },
            { x: GAME_WIDTH * 0.84, y: GAME_HEIGHT - 180, width: 80, height: 20, color: '#a0522d' }
        ], 
        spawnPoints: [
            { x: GAME_WIDTH * 0.25, y: GAME_HEIGHT - 150 }, 
            { x: GAME_WIDTH * 0.75, y: GAME_HEIGHT - 150 }
        ], 
        bgColor: '#2f4f4f' 
    }
};

// Character-specific attack properties
const characterAttacks = {
    "RED_KNIGHT": {
        basicDamage: 7, basicRange: 60, basicKnockback: 1.2,
        specialDamage: 12, specialRange: 80, specialKnockback: 1.5,
        guardReduction: 0.5
    },
    "BLUE_NINJA": {
        basicDamage: 4, basicRange: 40, basicKnockback: 0.8,
        specialDamage: 8, specialRange: 60, specialKnockback: 1.0,
        guardReduction: 0.8
    }
};

// --- Server State ---
const clients = new Map();
let player1ClientId = null; let player2ClientId = null; let gameLoopInterval = null;
const PORT = process.env.PORT || 8080; // Use Render's port OR fallback to 8080 for local dev

// --- Authoritative Game State ---
let serverGame = {
    state: "waiting", stage: null, players: {},
    match: { scores: [0, 0], roundWinnerId: null, matchWinnerId: null },
    basicAttackCooldowns: { player1: 0, player2: 0 }, 
    basicAttackActiveTimers: { player1: 0, player2: 0 },
    specialAttackCooldowns: { player1: 0, player2: 0 },
    specialAttackActiveTimers: { player1: 0, player2: 0 },
    guardCooldowns: { player1: 0, player2: 0 },
    guardActiveTimers: { player1: 0, player2: 0 },
    ledgeHangTimers: { player1: 0, player2: 0 },
    pendingRoundReset: false, pendingMatchReset: false, lastUpdateTime: 0, deltaTime: 0
};

// --- Helper Functions ---
function checkCollision(r1, r2) { if (!r1 || !r2) return false; return (r1.x < r2.x + r2.width && r1.x + r1.width > r2.x && r1.y < r2.y + r2.height && r1.y + r1.height > r2.y); }
function createPlayer(id, type) {
    if (!serverGame.stage) { console.error("No stage set for player creation"); return null; }
    const cT=characterTypes[type]; const sI=id==='player1'?0:1; const sP=serverGame.stage.spawnPoints[sI]; if(!sP){console.error(`Spawn ${sI} missing`);return null;}
    return { 
        id: id, type: type, width: 50, height: 50, color: cT.color, 
        moveSpeed: cT.moveSpeed, jumpStrength: cT.jumpStrength, gravityMultiplier: cT.gravityMultiplier, 
        x: sP.x - 25, y: sP.y, vx: 0, vy: 0, isOnGround: false, percentage: 0, 
        facingDirection: sI === 0 ? 1 : -1, 
        isBasicAttacking: false, isSpecialAttacking: false, isGuarding: false,
        isLedgeHanging: false, ledgePlatform: null, ledgeDirection: 0 
    };
}

// Ledge grabbing helper functions
function checkLedgeGrab(player) {
    if (!serverGame.stage || player.isOnGround || player.isLedgeHanging || player.vy <= 0) return null;
    
    for(const plat of serverGame.stage.platforms) {
        const playerBottom = player.y + player.height;
        const playerCenter = player.x + player.width / 2;
        
        if (playerBottom > plat.y && playerBottom < plat.y + plat.height + LEDGE_GRAB_RANGE) {
            if (Math.abs(playerCenter - plat.x) < LEDGE_GRAB_RANGE && player.x < plat.x) {
                return { platform: plat, direction: -1, x: plat.x - player.width, y: plat.y - player.height };
            }
            if (Math.abs(playerCenter - (plat.x + plat.width)) < LEDGE_GRAB_RANGE && player.x > plat.x + plat.width) {
                return { platform: plat, direction: 1, x: plat.x + plat.width, y: plat.y - player.height };
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
    
    if (direction > 0) {
        player.vy = -LEDGE_RELEASE_VELOCITY * 1.5;
        player.vx = player.facingDirection * LEDGE_RELEASE_VELOCITY * 0.5;
    } else if (direction < 0) {
        player.vy = -LEDGE_RELEASE_VELOCITY * 0.5;
        player.vx = -player.facingDirection * LEDGE_RELEASE_VELOCITY;
    } else {
        player.vy = LEDGE_RELEASE_VELOCITY * 0.3;
        player.vx = 0;
    }
}

// --- Server Game Loop ---
function gameTick() {
    const now = Date.now(); serverGame.deltaTime = (now - serverGame.lastUpdateTime); serverGame.lastUpdateTime = now;
    if (serverGame.state === "playing") {
        for(const pId in serverGame.basicAttackActiveTimers) {
            if(serverGame.basicAttackActiveTimers[pId] > 0) {
                serverGame.basicAttackActiveTimers[pId] -= serverGame.deltaTime;
                if(serverGame.basicAttackActiveTimers[pId] <= 0) {
                    if(serverGame.players[pId]) serverGame.players[pId].isBasicAttacking = false;
                }
            }
        }
        
        for(const pId in serverGame.specialAttackActiveTimers) {
            if(serverGame.specialAttackActiveTimers[pId] > 0) {
                serverGame.specialAttackActiveTimers[pId] -= serverGame.deltaTime;
                if(serverGame.specialAttackActiveTimers[pId] <= 0) {
                    if(serverGame.players[pId]) serverGame.players[pId].isSpecialAttacking = false;
                }
            }
        }
        
        for(const pId in serverGame.guardActiveTimers) {
            if(serverGame.guardActiveTimers[pId] > 0) {
                serverGame.guardActiveTimers[pId] -= serverGame.deltaTime;
                if(serverGame.guardActiveTimers[pId] <= 0) {
                    if(serverGame.players[pId]) serverGame.players[pId].isGuarding = false;
                }
            }
        }
        
        for(const pId in serverGame.basicAttackCooldowns) {
            if(serverGame.basicAttackCooldowns[pId] > 0) serverGame.basicAttackCooldowns[pId] -= serverGame.deltaTime;
        }
        for(const pId in serverGame.specialAttackCooldowns) {
            if(serverGame.specialAttackCooldowns[pId] > 0) serverGame.specialAttackCooldowns[pId] -= serverGame.deltaTime;
        }
        for(const pId in serverGame.guardCooldowns) {
            if(serverGame.guardCooldowns[pId] > 0) serverGame.guardCooldowns[pId] -= serverGame.deltaTime;
        }
        
        for(const pId in serverGame.ledgeHangTimers) {
            if(serverGame.ledgeHangTimers[pId] > 0) {
                serverGame.ledgeHangTimers[pId] -= serverGame.deltaTime;
                if(serverGame.ledgeHangTimers[pId] <= 0) {
                    const player = serverGame.players[pId];
                    if(player && player.isLedgeHanging) {
                        releaseLedgeGrab(player, 0); 
                        console.log(`[Svr Ledge] ${player.id} auto-released from ledge`);
                    }
                }
            }
        }
        
        updatePlayerPhysics("player1"); updatePlayerPhysics("player2");
        checkServerWinConditions();
    }
    broadcastGameState();
}

function updatePlayerPhysics(playerId) {
    const player = serverGame.players[playerId]; if (!player) return;
    const opp = serverGame.players[playerId === "player1" ? "player2" : "player1"];
    const client = Array.from(clients.values()).find(c => c.playerId === playerId);
    const input = client ? client.lastInput : { left: false, right: false, jump: false, basicAttack: false, specialAttack: false, guard: false };

    if (player.isLedgeHanging) {
        player.vx = 0; player.vy = 0; 
        
        if (input.jump) {
            releaseLedgeGrab(player, 1);
            console.log(`[Svr Ledge] ${player.id} climbed up from ledge`);
        } else if (input.left && player.ledgeDirection === -1) {
            releaseLedgeGrab(player, -1);
            console.log(`[Svr Ledge] ${player.id} released backward from ledge`);
        } else if (input.right && player.ledgeDirection === 1) {
            releaseLedgeGrab(player, -1);
            console.log(`[Svr Ledge] ${player.id} released backward from ledge`);
        } else if (input.guard) {
            releaseLedgeGrab(player, 0);
            console.log(`[Svr Ledge] ${player.id} let go from ledge`);
        }
        
        return;
    }

    const moveMultiplier = player.isGuarding ? 0.3 : 1.0;
    let iVx = player.vx; 
    if (input.left) { iVx = -player.moveSpeed * moveMultiplier; player.facingDirection = -1; } 
    else if (input.right) { iVx = player.moveSpeed * moveMultiplier; player.facingDirection = 1; } 
    else { if (player.isOnGround) iVx *= FRICTION; } 
    player.vx = iVx;
    
    if (input.jump && player.isOnGround && !player.isGuarding) { 
        player.vy = -player.jumpStrength; player.isOnGround = false; 
    }
    
    if (input.guard && serverGame.guardActiveTimers[playerId] <= 0 && serverGame.guardCooldowns[playerId] <= 0) {
        serverGame.guardCooldowns[playerId] = GUARD_COOLDOWN;
        serverGame.guardActiveTimers[playerId] = GUARD_DURATION;
        player.isGuarding = true;
        console.log(`[Svr Guard] ${player.id} is guarding`);
    }
    
    if (input.basicAttack && serverGame.basicAttackActiveTimers[playerId] <= 0 && serverGame.basicAttackCooldowns[playerId] <= 0 && !player.isGuarding) { 
        serverGame.basicAttackCooldowns[playerId] = BASIC_ATTACK_COOLDOWN; 
        serverGame.basicAttackActiveTimers[playerId] = BASIC_ATTACK_DURATION; 
        player.isBasicAttacking = true; 
        
        const charStats = characterAttacks[player.type];
        const attackRange = charStats.basicRange;
        const bX = player.facingDirection === 1 ? player.x + player.width : player.x - attackRange; 
        const bY = player.y + (player.height / 2) - (BASIC_ATTACK_HEIGHT / 2); 
        const aB = { x: bX, y: bY, width: attackRange, height: BASIC_ATTACK_HEIGHT }; 
        
        if (opp && checkCollision(aB, opp)) { 
            if (opp.isGuarding) {
                console.log(`[Svr Hit Blocked] ${player.id} attack blocked by ${opp.id}`);
                const reducedKb = BASE_KNOCKBACK * 0.3;
                opp.vx = reducedKb * player.facingDirection * 0.8;
                opp.vy = -reducedKb * 0.5;
            } else {
                opp.percentage += charStats.basicDamage; 
                const wf = opp.gravityMultiplier > 0 ? (1 / opp.gravityMultiplier) : 1; 
                const kb = (BASE_KNOCKBACK * charStats.basicKnockback + (opp.percentage * KNOCKBACK_SCALING)) * wf; 
                const ang = Math.PI / 4.5; 
                opp.vx = kb * player.facingDirection * Math.cos(ang); 
                opp.vy = -kb * Math.sin(ang); 
                opp.isOnGround = false; 
                console.log(`[Svr Hit] ${player.id}>${opp.id}. ${opp.id}%:${opp.percentage}`);
            }
        }
    }
    
    if (input.specialAttack && serverGame.specialAttackActiveTimers[playerId] <= 0 && serverGame.specialAttackCooldowns[playerId] <= 0 && !player.isGuarding) {
        serverGame.specialAttackCooldowns[playerId] = SPECIAL_ATTACK_COOLDOWN;
        serverGame.specialAttackActiveTimers[playerId] = SPECIAL_ATTACK_DURATION;
        player.isSpecialAttacking = true;
        
        const charStats = characterAttacks[player.type];
        
        if (player.type === "RED_KNIGHT") {
            const groundPoundArea = { 
                x: player.x - 40, y: player.y + player.height, 
                width: player.width + 80, height: 60 
            };
            
            if (opp && checkCollision(groundPoundArea, opp)) {
                if (opp.isGuarding) {
                    console.log(`[Svr Special Blocked] ${player.id} ground pound blocked by ${opp.id}`);
                    const reducedKb = BASE_KNOCKBACK * 0.5;
                    opp.vx = reducedKb * player.facingDirection * 0.6;
                    opp.vy = -reducedKb * 0.3;
                } else {
                    opp.percentage += charStats.specialDamage;
                    const kb = (BASE_KNOCKBACK * charStats.specialKnockback + (opp.percentage * KNOCKBACK_SCALING)) * (1 / opp.gravityMultiplier);
                    opp.vx = kb * player.facingDirection * 0.5;
                    opp.vy = -kb * 0.8;
                    opp.isOnGround = false;
                    console.log(`[Svr Ground Pound] ${player.id}>${opp.id}. ${opp.id}%:${opp.percentage}`);
                }
            }
            
        } else if (player.type === "BLUE_NINJA") {
            const dashDistance = 100;
            player.vx = player.facingDirection * dashDistance / 10;
            
            const dashAttackArea = {
                x: player.facingDirection === 1 ? player.x : player.x - charStats.specialRange,
                y: player.y,
                width: charStats.specialRange,
                height: player.height
            };
            
            if (opp && checkCollision(dashAttackArea, opp)) {
                if (opp.isGuarding) {
                    console.log(`[Svr Special Blocked] ${player.id} dash attack blocked by ${opp.id}`);
                    const reducedKb = BASE_KNOCKBACK * 0.4;
                    opp.vx = reducedKb * player.facingDirection;
                    opp.vy = -reducedKb * 0.2;
                } else {
                    opp.percentage += charStats.specialDamage;
                    const kb = (BASE_KNOCKBACK * charStats.specialKnockback + (opp.percentage * KNOCKBACK_SCALING)) * (1 / opp.gravityMultiplier);
                    const ang = Math.PI / 5;
                    opp.vx = kb * player.facingDirection * Math.cos(ang);
                    opp.vy = -kb * Math.sin(ang);
                    opp.isOnGround = false;
                    console.log(`[Svr Dash Attack] ${player.id}>${opp.id}. ${opp.id}%:${opp.percentage}`);
                }
            }
        }
    }
    
    player.vy += GRAVITY * player.gravityMultiplier; 
    let nX = player.x + player.vx * (serverGame.deltaTime / (1000 / 60)); 
    let nY = player.y + player.vy * (serverGame.deltaTime / (1000 / 60)); 
    let landed = false;
    
    if (!player.isGuarding && !player.isBasicAttacking && !player.isSpecialAttacking) {
        const ledgeGrab = checkLedgeGrab(player);
        if (ledgeGrab) {
            player.isLedgeHanging = true;
            player.ledgePlatform = ledgeGrab.platform;
            player.ledgeDirection = ledgeGrab.direction;
            player.x = ledgeGrab.x;
            player.y = ledgeGrab.y;
            player.vx = 0;
            player.vy = 0;
            player.facingDirection = ledgeGrab.direction;
            serverGame.ledgeHangTimers[playerId] = LEDGE_GRAB_DURATION;
            console.log(`[Svr Ledge] ${player.id} grabbed ledge on ${ledgeGrab.direction === -1 ? 'left' : 'right'} side`);
            return;
        }
    }
    
    for(const plat of serverGame.stage.platforms) {
        const pBN = nY + player.height; const pL = player.x; const pR = player.x + player.width; 
        if(player.vy >= 0 && pBN >= plat.y && player.y < plat.y && pR > plat.x && pL < plat.x + plat.width) {
            nY = plat.y - player.height; player.vy = 0; landed = true; break;
        }
    } 
    player.x = nX; player.y = nY; player.isOnGround = landed;
}

function checkServerWinConditions() {
    if (serverGame.state !== "playing") return;
    for (const pId in serverGame.players) { const p = serverGame.players[pId]; if (!p) continue; const opp = serverGame.players[pId === "player1" ? "player2" : "player1"]; let lost = false; if(p.y>GAME_HEIGHT+OFF_SCREEN_THRESHOLD||p.x+p.width<0-OFF_SCREEN_THRESHOLD||p.x>GAME_WIDTH+OFF_SCREEN_THRESHOLD||p.y+p.height<0-OFF_SCREEN_THRESHOLD) lost = true; if (lost) { console.log(`[Svr KO] ${p.id} lost.`); if (opp) { handleServerRoundEnd(opp, p); } else { resetServerMatchAndStartNew(); serverGame.state = "waiting"; } return; } }
}

function resetServerPlayerState(player) {
     if (!player || !serverGame.stage) return; 
     const sI = player.id === "player1" ? 0 : 1; 
     const sP = serverGame.stage.spawnPoints[sI]; 
     if (!sP) {console.error(`Spawn ${sI} missing`); return;}
     
     player.x = sP.x - player.width/2;
     player.y = sP.y;
     player.vx = 0;
     player.vy = 0;
     player.percentage = 0;
     player.isOnGround = false;
     player.facingDirection = sI === 0 ? 1 : -1;
     
     player.isBasicAttacking = false;
     player.isSpecialAttacking = false;
     player.isGuarding = false;
     
     player.isLedgeHanging = false;
     player.ledgePlatform = null;
     player.ledgeDirection = 0;
     
     serverGame.basicAttackCooldowns[player.id] = 0;
     serverGame.basicAttackActiveTimers[player.id] = 0;
     serverGame.specialAttackCooldowns[player.id] = 0;
     serverGame.specialAttackActiveTimers[player.id] = 0;
     serverGame.guardCooldowns[player.id] = 0;
     serverGame.guardActiveTimers[player.id] = 0;
     serverGame.ledgeHangTimers[player.id] = 0;
}

function resetServerRoundState() {
    console.log("[Server] Resetting Round State.");
    
    const randomStageKey = stageKeys[Math.floor(Math.random() * stageKeys.length)];
    serverGame.stage = stages[randomStageKey];
    console.log(`[Server] New Round Stage: ${serverGame.stage.name}`);
    
    for (const pId in serverGame.players) { 
        resetServerPlayerState(serverGame.players[pId]); 
    }
    serverGame.match.roundWinnerId = null; 
    serverGame.pendingRoundReset = false;
}

function handleServerRoundEnd(winner, loser) {
    if (serverGame.state !== "playing") return; console.log(`[Svr Rnd End] Win:${winner.id}`); serverGame.state="roundOver"; serverGame.match.roundWinnerId=winner.id; const wI=winner.id==="player1"?0:1; serverGame.match.scores[wI]++;
    if (serverGame.match.scores[wI]>=ROUNDS_TO_WIN_MATCH) { handleServerMatchEnd(winner); } else { serverGame.pendingRoundReset=true; }
}

function handleServerMatchEnd(winner) {
    console.log(`[Svr Mch End] Win:${winner.id}`); serverGame.state="matchOver"; serverGame.match.matchWinnerId=winner.id; serverGame.pendingMatchReset=true;
}

function resetServerMatchAndStartNew() {
    console.log("[Server] Resetting Full Match and Starting New...");
    const randomStageKey = stageKeys[Math.floor(Math.random() * stageKeys.length)];
    serverGame.stage = stages[randomStageKey];
    console.log(`[Server] Selected Stage: ${serverGame.stage.name}`);

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
         if (gameLoopInterval) {
             clearInterval(gameLoopInterval);
             gameLoopInterval = null;
         }
         serverGame.players = {};
     }
}

function startServerGame() {
     console.log("[Server] Attempting to Start Game...");
     resetServerMatchAndStartNew();
}

function stopServerGame() {
     if (gameLoopInterval) { clearInterval(gameLoopInterval); gameLoopInterval = null; console.log("[Server] Game loop stopped."); } serverGame.state = "waiting"; serverGame.players = {};
}


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
        startServerGame();
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
        if (clients.size < 2 && serverGame.state !== "waiting") { console.log("Player left, stopping game."); stopServerGame(); broadcast({ type: 'opponent_left', payload: {} }); }
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
        // Platforms are needed by the client now for drawing
        platforms: serverGame.stage?.platforms || [],
        bgColor: serverGame.stage?.bgColor || '#333'
    };
    
    for(const pId in serverGame.players) {
        const p = serverGame.players[pId];
        if(p) {
            stateToSend.players[pId] = {
                id: p.id,
                x: p.x, y: p.y, vx: p.vx, vy: p.vy,
                percentage: p.percentage, facingDirection: p.facingDirection, isOnGround: p.isOnGround,
                isBasicAttacking: p.isBasicAttacking, isSpecialAttacking: p.isSpecialAttacking, isGuarding: p.isGuarding,
                isLedgeHanging: p.isLedgeHanging, type: p.type, color: p.color, width: p.width, height: p.height
            };
        }
    }
    return stateToSend;
}

function broadcastGameState() { 
    const statePayload = getSerializableGameState(); 
    // *** THE ONLY CHANGE TO SERVER.JS IS HERE ***
    statePayload.serverTime = Date.now(); // Add server timestamp for interpolation
    broadcast({ type: 'game_state', payload: statePayload }); 
}

function broadcast(message) { 
    const msgStr = JSON.stringify(message); 
    clients.forEach((cD) => { 
        if (cD.ws.readyState === WebSocket.OPEN) { 
            try { cD.ws.send(msgStr); } catch (err) { console.error(`Err sending to ${cD.playerId}:`, err); } 
        } 
    }); 
}

console.log('Server setup complete. Waiting...');