// server.js - Phase 9: Authoritative Server + Reset + Random Stage

const WebSocket = require('ws');

// --- Game Constants ---
const GAME_WIDTH = 800; const GAME_HEIGHT = 600; const GRAVITY = 0.5; const FRICTION = 0.8; const ATTACK_DAMAGE = 5; const BASE_KNOCKBACK = 3; const KNOCKBACK_SCALING = 0.08; const ATTACK_DURATION = 150; const ATTACK_COOLDOWN_TIME = 300; const ATTACK_RANGE = 50; const ATTACK_HEIGHT = 20; const ROUNDS_TO_WIN_MATCH = 2; const OFF_SCREEN_THRESHOLD = 150; const SERVER_TICK_RATE = 1000 / 60;

// --- Data Definitions ---
const characterTypes = { "RED_KNIGHT": { color: 'red', moveSpeed: 5, jumpStrength: 12, gravityMultiplier: 1.0 }, "BLUE_NINJA": { color: 'blue', moveSpeed: 6.5, jumpStrength: 14, gravityMultiplier: 0.95 } };
const stageKeys = ["stage1", "stage2"]; // Array of stage keys for randomization
const stages = {
    "stage1": { name: "Center Platform", platforms: [{ x: GAME_WIDTH * 0.2, y: GAME_HEIGHT - 50, width: GAME_WIDTH * 0.6, height: 50, color: '#228b22' }], spawnPoints: [{ x: GAME_WIDTH / 4, y: GAME_HEIGHT - 150 }, { x: GAME_WIDTH * 3 / 4, y: GAME_HEIGHT - 150 }], bgColor: '#add8e6' },
    "stage2": { name: "Dual Platforms", platforms: [{ x: GAME_WIDTH * 0.1, y: GAME_HEIGHT - 150, width: GAME_WIDTH * 0.3, height: 30, color: '#a0522d' }, { x: GAME_WIDTH * 0.6, y: GAME_HEIGHT - 150, width: GAME_WIDTH * 0.3, height: 30, color: '#a0522d' }], spawnPoints: [{ x: GAME_WIDTH * 0.25, y: GAME_HEIGHT - 250 }, { x: GAME_WIDTH * 0.75, y: GAME_HEIGHT - 250 }], bgColor: '#d3d3d3' }
};

// --- Server State ---
const clients = new Map();
let player1ClientId = null; let player2ClientId = null; let gameLoopInterval = null;
const PORT = process.env.PORT || 8080; // Use Render's port OR fallback to 8080 for local dev

// --- Authoritative Game State ---
let serverGame = {
    state: "waiting", stage: null, players: {},
    match: { scores: [0, 0], roundWinnerId: null, matchWinnerId: null },
    attackCooldowns: { player1: 0, player2: 0 }, attackActiveTimers: { player1: 0, player2: 0 },
    pendingRoundReset: false, pendingMatchReset: false, lastUpdateTime: 0, deltaTime: 0
};

// --- Helper Functions ---
function checkCollision(r1, r2) { if (!r1 || !r2) return false; return (r1.x < r2.x + r2.width && r1.x + r1.width > r2.x && r1.y < r2.y + r2.height && r1.y + r1.height > r2.y); }
function createPlayer(id, type) {
    if (!serverGame.stage) { console.error("No stage set for player creation"); return null; }
    const cT=characterTypes[type]; const sI=id==='player1'?0:1; const sP=serverGame.stage.spawnPoints[sI]; if(!sP){console.error(`Spawn ${sI} missing`);return null;}
    return { id: id, type: type, width: 50, height: 50, color: cT.color, moveSpeed: cT.moveSpeed, jumpStrength: cT.jumpStrength, gravityMultiplier: cT.gravityMultiplier, x: sP.x - 25, y: sP.y, vx: 0, vy: 0, isOnGround: false, percentage: 0, facingDirection: sI === 0 ? 1 : -1, isAttacking: false };
}

// --- Server Game Loop ---
function gameTick() {
    const now = Date.now(); serverGame.deltaTime = (now - serverGame.lastUpdateTime); serverGame.lastUpdateTime = now;
    if (serverGame.state === "playing") {
        for(const pId in serverGame.attackActiveTimers){if(serverGame.attackActiveTimers[pId]>0){serverGame.attackActiveTimers[pId]-=serverGame.deltaTime;if(serverGame.attackActiveTimers[pId]<=0){if(serverGame.players[pId])serverGame.players[pId].isAttacking=false;}}}
        for(const pId in serverGame.attackCooldowns){if(serverGame.attackCooldowns[pId]>0)serverGame.attackCooldowns[pId]-=serverGame.deltaTime;}
        updatePlayerPhysics("player1"); updatePlayerPhysics("player2");
        checkServerWinConditions();
    }
    broadcastGameState();
}

function updatePlayerPhysics(playerId) {
    const player = serverGame.players[playerId]; if (!player) return;
    const opp = serverGame.players[playerId === "player1" ? "player2" : "player1"];
    const client = Array.from(clients.values()).find(c => c.playerId === playerId);
    const input = client ? client.lastInput : { left: false, right: false, jump: false, attack: false };

    let iVx = player.vx; if (input.left) { iVx=-player.moveSpeed; player.facingDirection=-1; } else if (input.right) { iVx=player.moveSpeed; player.facingDirection=1; } else { if (player.isOnGround) iVx*=FRICTION; } player.vx = iVx;
    if (input.jump && player.isOnGround) { player.vy=-player.jumpStrength; player.isOnGround=false; }
    if (input.attack&&serverGame.attackActiveTimers[playerId]<=0&&serverGame.attackCooldowns[playerId]<=0) { serverGame.attackCooldowns[playerId]=ATTACK_COOLDOWN_TIME; serverGame.attackActiveTimers[playerId]=ATTACK_DURATION; player.isAttacking=true; const bX=player.facingDirection===1?player.x+player.width:player.x-ATTACK_RANGE; const bY=player.y+(player.height/2)-(ATTACK_HEIGHT/2); const aB={x:bX,y:bY,width:ATTACK_RANGE,height:ATTACK_HEIGHT}; if (opp && checkCollision(aB, opp)) { opp.percentage+=ATTACK_DAMAGE; const wf=opp.gravityMultiplier>0?(1/opp.gravityMultiplier):1; const kb=(BASE_KNOCKBACK+(opp.percentage*KNOCKBACK_SCALING))*wf; const ang=Math.PI/4.5; opp.vx=kb*player.facingDirection*Math.cos(ang); opp.vy=-kb*Math.sin(ang); opp.isOnGround=false; console.log(`[Svr Hit] ${player.id}>${opp.id}. ${opp.id}%:${opp.percentage}`);}}
    player.vy += GRAVITY * player.gravityMultiplier; let nX=player.x+player.vx*(serverGame.deltaTime/(1000/60)); let nY=player.y+player.vy*(serverGame.deltaTime/(1000/60)); let landed=false;
    for(const plat of serverGame.stage.platforms){const pBN=nY+player.height;const pL=player.x; const pR=player.x+player.width; if(player.vy>=0&&pBN>=plat.y&&player.y<plat.y&&pR>plat.x&&pL<plat.x+plat.width){nY=plat.y-player.height;player.vy=0;landed=true;break;}} player.x=nX; player.y=nY; player.isOnGround=landed;
}

function checkServerWinConditions() {
    if (serverGame.state !== "playing") return;
    for (const pId in serverGame.players) { const p = serverGame.players[pId]; if (!p) continue; const opp = serverGame.players[pId === "player1" ? "player2" : "player1"]; let lost = false; if(p.y>GAME_HEIGHT+OFF_SCREEN_THRESHOLD||p.x+p.width<0-OFF_SCREEN_THRESHOLD||p.x>GAME_WIDTH+OFF_SCREEN_THRESHOLD||p.y+p.height<0-OFF_SCREEN_THRESHOLD) lost = true; if (lost) { console.log(`[Svr KO] ${p.id} lost.`); if (opp) { handleServerRoundEnd(opp, p); } else { resetServerMatchAndStartNew(); serverGame.state = "waiting"; } return; } }
}

function resetServerPlayerState(player) {
     if (!player || !serverGame.stage) return; const sI=player.id==="player1"?0:1; const sP=serverGame.stage.spawnPoints[sI]; if (!sP) {console.error(`Spawn ${sI} missing`); return;}
     player.x=sP.x-player.width/2;player.y=sP.y;player.vx=0;player.vy=0;player.percentage=0;player.isOnGround=false;player.isAttacking=false;player.facingDirection=sI===0?1:-1;serverGame.attackCooldowns[player.id]=0;serverGame.attackActiveTimers[player.id]=0;
}

function resetServerRoundState() { // Resets players for new round, keeps scores
    console.log("[Server] Resetting Round State.");
    for (const pId in serverGame.players) { resetServerPlayerState(serverGame.players[pId]); }
    serverGame.match.roundWinnerId = null; serverGame.pendingRoundReset = false;
}

function handleServerRoundEnd(winner, loser) {
    if (serverGame.state !== "playing") return; console.log(`[Svr Rnd End] Win:${winner.id}`); serverGame.state="roundOver"; serverGame.match.roundWinnerId=winner.id; const wI=winner.id==="player1"?0:1; serverGame.match.scores[wI]++;
    if (serverGame.match.scores[wI]>=ROUNDS_TO_WIN_MATCH) { handleServerMatchEnd(winner); } else { serverGame.pendingRoundReset=true; } // Wait for client request
}

function handleServerMatchEnd(winner) {
    console.log(`[Svr Mch End] Win:${winner.id}`); serverGame.state="matchOver"; serverGame.match.matchWinnerId=winner.id; serverGame.pendingMatchReset=true; // Wait for client request
}

// --- NEW: Function to fully reset match state and start ---
function resetServerMatchAndStartNew() {
    console.log("[Server] Resetting Full Match and Starting New...");
    // 1. Randomly select stage
    const randomStageKey = stageKeys[Math.floor(Math.random() * stageKeys.length)];
    serverGame.stage = stages[randomStageKey];
    console.log(`[Server] Selected Stage: ${serverGame.stage.name}`);

    // 2. Reset scores and winners
    serverGame.match.scores = [0, 0];
    serverGame.match.roundWinnerId = null;
    serverGame.match.matchWinnerId = null;

    // 3. Recreate or reset player objects (using new stage spawns)
     if (clients.size === 2) { // Only if two players are connected
         const p1Client = Array.from(clients.values()).find(c => c.playerId === 'player1');
         const p2Client = Array.from(clients.values()).find(c => c.playerId === 'player2');

         // TODO: Allow character selection later
         serverGame.players.player1 = createPlayer("player1", "RED_KNIGHT");
         serverGame.players.player2 = createPlayer("player2", "BLUE_NINJA");

         resetServerRoundState(); // Position players, reset timers etc.

         serverGame.state = "playing"; // Set state to playing
         serverGame.pendingMatchReset = false;
         serverGame.lastUpdateTime = Date.now();

         if (!gameLoopInterval) { // Start loop if not running
             gameLoopInterval = setInterval(gameTick, SERVER_TICK_RATE);
             console.log("[Server] Game loop started.");
         }
     } else {
         console.log("[Server] Need 2 players to start new match.");
         serverGame.state = "waiting"; // Not enough players, go back to waiting
         if (gameLoopInterval) { // Stop loop if running
             clearInterval(gameLoopInterval);
             gameLoopInterval = null;
         }
         // Clear player objects if resetting to waiting state
         serverGame.players = {};
     }
}

// Modified to use the new reset function
function startServerGame() {
     console.log("[Server] Attempting to Start Game...");
     resetServerMatchAndStartNew(); // This now handles stage selection, player creation, state change
}

function stopServerGame() { /* (Same as before) */
     if (gameLoopInterval) { clearInterval(gameLoopInterval); gameLoopInterval = null; console.log("[Server] Game loop stopped."); } serverGame.state = "waiting"; serverGame.players = {}; /* Clear players */
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
        startServerGame(); // Start new game with defaults
    } else {
        ws.send(JSON.stringify({ type: 'game_state', payload: getSerializableGameState() })); // Send current state
    }

    // --- Handle Messages ---
    ws.on('message', (message) => {
        if (!assignedPlayerId) return;
        try {
            const messageData = JSON.parse(message.toString());
            if (messageData.type === 'input') {
                const clientData = Array.from(clients.values()).find(c => c.playerId === assignedPlayerId); if (clientData) clientData.lastInput = messageData.payload;
            } else if (messageData.type === 'request_next_round') {
                 if (serverGame.state === 'roundOver' && serverGame.pendingRoundReset) { console.log(`[Server] RX Next Round Req from ${assignedPlayerId}.`); resetServerRoundState(); serverGame.state = "playing"; }
            } else if (messageData.type === 'request_new_match') { // --- ADDED HANDLER ---
                 if (serverGame.state === 'matchOver' && serverGame.pendingMatchReset) { console.log(`[Server] RX New Match Req from ${assignedPlayerId}.`); resetServerMatchAndStartNew(); } // Reset and restart
            }
        } catch (error) { console.error(`[Server] Error processing msg from ${assignedPlayerId}:`, error); }
    });

    ws.on('close', () => { /* (Same as before) */
        console.log(`Client ${assignedPlayerId} (${clientId}) disconnected.`); const cD = Array.from(clients.values()).find(c => c.playerId === assignedPlayerId); if(cD) clients.delete(Array.from(clients.keys()).find(k => clients.get(k) === cD));
        if (assignedPlayerId === "player1") player1ClientId = null; else if (assignedPlayerId === "player2") player2ClientId = null; console.log(`Clients remaining: ${clients.size}`);
        if (clients.size < 2 && serverGame.state !== "waiting") { console.log("Player left, stopping game."); stopServerGame(); broadcast({ type: 'opponent_left', payload: {} }); }
        else { broadcast({ type: 'player_left', payload: { playerId: assignedPlayerId } }); }
    });
    ws.on('error', (error) => { console.error(`WS error for ${assignedPlayerId} (${clientId}):`, error); ws.close(); });
});

// --- State Broadcasting ---
function getSerializableGameState() { /* (Same as before - includes width/height) */
    const stateToSend={state:serverGame.state,players:{},match:serverGame.match, stageName: serverGame.stage?.name /* Send stage name */};
    for(const pId in serverGame.players){const p=serverGame.players[pId];if(p){stateToSend.players[pId]={id:p.id,x:p.x,y:p.y,vx:p.vx,vy:p.vy,percentage:p.percentage,facingDirection:p.facingDirection,isOnGround:p.isOnGround,isAttacking:p.isAttacking,type:p.type,color:p.color,width:p.width,height:p.height};}}
    return stateToSend;
}
function broadcastGameState() { const statePayload = getSerializableGameState(); statePayload.serverTime = Date.now(); broadcast({ type: 'game_state', payload: statePayload }); }
function broadcast(message) { const msgStr = JSON.stringify(message); clients.forEach((cD) => { if (cD.ws.readyState === WebSocket.OPEN) { try { cD.ws.send(msgStr); } catch (err) { console.error(`Err sending to ${cD.playerId}:`, err); } } }); }

console.log('Server setup complete. Waiting...');