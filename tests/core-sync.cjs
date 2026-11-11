const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../shared/core.js'), 'utf8');
const part = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const c = vm.createContext({ Date: { now: () => 100000 }, L: null, ME: 'b', P: {}, LANGS: { en: 1, fr: 1, de: 1 },
  seenSelf: true, leaving: false, lastBeat: 100000, present: () => true, byJoined: (a,b) => a.localeCompare(b), isHost: () => true, commits: 0, commit: () => c.commits++ });
vm.runInContext(part('const DEFAULTS', '/* Card text languages') + part('const SETTINGS', '/* What the menu') +
  part('function settings(', 'const STALE_MS') + part('let skew = null', 'const TIMER_LBL') + part('function hostTick()', 'function backToLobby()'), c);
const run = s => vm.runInContext(s, c);
run(`GAMES.cah = { min: 3, defaults: { rounds: 0, pickTime: 90, judgeTime: 60, hand: 7, packs: [] } };
GAMES.mp = { min: 3, defaults: { mpTime: 60 }, tick: () => { throw Error('below minimum tick'); } };
GAMES.sd = { min: 2, defaults: { sdCount: 8, sdEvery: 5, sdWrite: 40 } };`);
for (const bad of [undefined, null, '999', {}, NaN, Infinity]) {
  c.bad = bad;
  assert.equal(run('settings({mpTime: bad}).mpTime'), 60);
  assert.equal(run('settings({sdCount: bad}).sdCount'), 8);
}
assert.equal(run('settings({mpTime: 0}).mpTime'), 0);
assert.equal(run('settings({mpTime: -1}).mpTime'), 10);
assert.equal(run('settings({sdCount: 9999, sdEvery: -20, sdWrite: 0, target: 1e20, maxPlayers: -2}).sdCount'), 30);
assert.equal(run('settings({sdEvery: -20}).sdEvery'), 2);
assert.equal(run('settings({sdWrite: 0}).sdWrite'), 10);
assert.equal(run('settings({target: 1e20}).target'), 99);
assert.equal(run('settings({maxPlayers: -2}).maxPlayers'), 3);
assert.equal(run('settings({game:"__proto__",lang:"constructor"}).game'), 'cah');
assert.equal(run('settings({game:"sd",mpTime:0,sdEvery:7}).mpTime'), 0);
// Observer is 10 seconds behind A; successor B is 20 seconds behind A.
run(`ME = 'c'; L = {host:'a'}; noteSkew({host:'a',clockHost:'a',updated:110000});
L = {host:'b'}; noteSkew({host:'b',clockHost:'a',updated:110000});`);
assert.equal(run('skew'), -10000); // The handoff must not seed B's min filter with A's offset.
run(`noteSkew({host:'b',clockHost:'b',updated:90000});`);
assert.equal(run('skew'), 10000);
// B preserves remaining time when accepting voluntary handoff, exactly once.
run(`ME='b'; L={host:'a'}; skew=-20000; skewHost='a';
var handoff={host:'b',clockHost:'a',game:{deadline:150000,startAt:120000}}; noteSkew(handoff); L=handoff;`);
assert.equal(run('handoff.game.deadline'), 130000);
assert.equal(run('handoff.game.startAt'), 100000);
run('noteSkew(handoff)'); assert.equal(run('handoff.game.deadline'), 130000);
// Transactional takeover has already rebased; receiving its snapshot must not do so again.
run(`L={host:'a'}; skew=-20000; noteSkew({host:'b',clockHost:'b',game:{deadline:130000,startAt:100000}});`);
assert.equal(run('skew'), 0);
run(`L={host:'b',hostName:'B',status:'playing',count:2,settings:{game:'mp'},game:{type:'mp'}}; P={b:{name:'B'},c:{name:'C'}};hostTick();`);
assert.equal(c.L.status, 'lobby'); assert.equal(c.L.game, null); assert.equal(c.commits, 1);
// Starting another game replaces stale game state and its scores, retaining all settings.
vm.runInContext(part('function startCheck()', '/* ---------- shared game table'), c);
for (const id of ['cah', 'mp', 'sd', 'cah']) {
  c.id = id;
  run(`P.d={name:'D'}; L.settings={game:id,mpTime:0,sdEvery:7}; L.game={type:'old',scores:{b:99}};
    GAMES[id].check=()=>({ok:true}); GAMES[id].start=()=>({type:id,scores:{}}); startGame();`);
  assert.equal(c.L.game.type, id); assert.equal(Object.keys(c.L.game.scores).length, 0);
  assert.equal(c.L.settings.mpTime, 0); assert.equal(c.L.settings.sdEvery, 7);
}
console.log('PASS: core settings, voluntary handoff offsets, one-time clock rebasing and minimum players.');

async function legacyClients() {
  const writes = [], errors = [];
  const h = vm.createContext({ ME:'a', P:{a:{owner:'host'},b:{name:'Legacy'}}, L:{host:'a',rev:1},
    firebaseAccountUser:'host', uid:'account', code:'TEST', roomSince:1,
    room:{peers:()=>[{presence:{pid:'b',lobby:'TEST',uid:'legacy-device'}}]},
    isHost:()=>true, byJoined:()=>0, gone:()=>false, nameOf:()=> 'Legacy',
    clone:d=>JSON.parse(JSON.stringify(d)), exitLobby:()=>{}, writeError:e=>errors.push(e),
    db:{doc:path=>({delete:async()=>writes.push({deleted:path})}), runTransaction:async fn=>fn({
      get:async()=>({exists:true,data:()=>h.L}), set:(_ref,d)=>{assert.ok(!Object.values(d).includes(undefined)); writes.push(d);}
    })} });
  vm.runInContext(part('function online(pid)', 'function trackPresence()') + part('async function leaveLobby()', 'async function closeLobby('), h);
  assert.equal(vm.runInContext("online('b')", h), true, 'legacy heartbeat counts as present');
  h.P.b.owner = 'other-device';
  assert.equal(vm.runInContext("online('b')", h), false, 'owned seats require matching heartbeat device');
  delete h.P.b.owner;
  await vm.runInContext('leaveLobby()', h);
  assert.equal(errors.length, 0);
  assert.equal(writes[0].host, 'b');
  assert.equal(Object.hasOwn(writes[0], 'hostUid'), false, 'legacy handoff must not write undefined ownership');
  writes.length = 0; h.L.hostUid = 'host';
  await vm.runInContext('leaveLobby()', h);
  assert.equal(writes.some(d=>d.host === 'b'), false, 'owned room cannot hand off to an unowned seat');
  assert.equal(writes.some(d=>d.deleted === 'lobbies/TEST'), false, 'other legacy players retain their room');
  console.log('PASS: legacy presence and handoff; owned rooms retain ownership checks.');
}

async function rules() {
  const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
  const { doc, setDoc, updateDoc, deleteDoc, getDoc, serverTimestamp, Timestamp, runTransaction } = require('firebase/firestore');
  const env = await initializeTestEnvironment({ projectId: 'demo-cah-accounts', firestore: { host:'127.0.0.1',port:8089,rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8') } });
  try {
    const host = env.authenticatedContext('host').firestore(), player = env.authenticatedContext('player').firestore(), stranger = env.authenticatedContext('stranger').firestore();
    const a='paaaaaaaaaaaa', b='pbbbbbbbbbbbb', lobby='lobbies/TEST';
    const seat = owner => ({owner,uid:owner,name:'Player',face:{s:0,k:0,e:0,a:0,b:0},lvl:1,joined:1,sub:null,pick:null});
    await assertSucceeds(setDoc(doc(host,lobby),{host:a,hostUid:'host',hostSeen:serverTimestamp(),clockHost:a,rev:1,game:null}));
    await assertSucceeds(setDoc(doc(host,`${lobby}/players/${a}`),seat('host')));
    await assertSucceeds(setDoc(doc(player,`${lobby}/players/${b}`),seat('player')));
    // Cached pages keep the old write permissions until ownership is backfilled.
    const legacy='lobbies/LEGA', oldSeat=seat('host'); delete oldSeat.owner;
    await assertSucceeds(setDoc(doc(host,legacy),{host:a,rev:1,game:null}));
    await assertSucceeds(setDoc(doc(host,`${legacy}/players/${a}`),oldSeat));
    await assertSucceeds(setDoc(doc(player,`${legacy}/players/${b}`),oldSeat));
    await assertSucceeds(updateDoc(doc(player,legacy),{rev:2}));
    await assertSucceeds(updateDoc(doc(player,`${legacy}/players/${a}`),{name:'Legacy edit'}));
    await assertSucceeds(setDoc(doc(player,`${legacy}/deck/piles`),{gid:'legacy'}));
    await assertSucceeds(setDoc(doc(player,'directory/LEGA'),{count:2}));
    await assertSucceeds(deleteDoc(doc(player,`${legacy}/players/${b}`)));
    await assertFails(updateDoc(doc(player,`${legacy}/players/${a}`),{owner:'host'}));
    await assertSucceeds(updateDoc(doc(host,`${legacy}/players/${a}`),{owner:'host'}));
    await assertFails(updateDoc(doc(player,`${legacy}/players/${a}`),{owner:'player'}));
    await assertFails(updateDoc(doc(player,`${legacy}/players/${a}`),{name:'stolen'}));
    await assertFails(updateDoc(doc(player,`${legacy}/players/${a}`),{owner:null}));
    await assertFails(updateDoc(doc(player,legacy),{hostUid:'host',hostSeen:serverTimestamp()}));
    await assertSucceeds(updateDoc(doc(host,legacy),{hostUid:'host',hostSeen:serverTimestamp()}));
    await assertFails(updateDoc(doc(player,legacy),{hostUid:'player',hostSeen:serverTimestamp()}));
    await assertFails(setDoc(doc(player,legacy),{host:b,rev:3,game:null}));
    await assertSucceeds(updateDoc(doc(host,legacy),{rev:3,hostSeen:serverTimestamp()}));
    await assertFails(setDoc(doc(player,`${legacy}/deck/piles`),{gid:'stolen'}));
    await assertFails(setDoc(doc(player,'directory/LEGA'),{count:99}));
    await assertSucceeds(setDoc(doc(host,'lobbies/OLDD'),{host:a}));
    await assertSucceeds(deleteDoc(doc(player,'lobbies/OLDD')));
    for (const key of ['wish','twist','trait']) {
      await assertSucceeds(updateDoc(doc(player,`${lobby}/players/${b}`),{[key]:{gid:'g',round:1,text:'x'.repeat(200)}}));
      await assertFails(updateDoc(doc(player,`${lobby}/players/${b}`),{[key]:{gid:'g',round:1,text:'x'.repeat(201)}}));
    }
    await assertSucceeds(updateDoc(doc(player,`${lobby}/players/${b}`),{pick:{gid:'g',round:1,k:0},rate:{gid:'g',round:1,v:5},sub:{gid:'g',round:1,cards:['a','b']},reveal:{gid:'g',round:1,ks:[0,1]}}));
    await assertFails(updateDoc(doc(player,`${lobby}/players/${b}`),{rate:{gid:'g',round:1,v:6}}));
    await assertFails(updateDoc(doc(stranger,`${lobby}/players/${b}`),{name:'stolen'}));
    await assertFails(updateDoc(doc(player,lobby),{rev:2}));
    await assertFails(setDoc(doc(stranger,`${lobby}/deck/piles`),{gid:'g'}));
    const take = () => updateDoc(doc(player,lobby),{host:b,hostUid:'player',hostSeen:serverTimestamp(),clockHost:b,updated:1,rev:2});
    await assertFails(take());
    await env.withSecurityRulesDisabled(async ctx => updateDoc(doc(ctx.firestore(),lobby),{hostSeen:Timestamp.fromMillis(Date.now()-60000)}));
    await assertSucceeds(take());
    await assertFails(updateDoc(doc(host,lobby),{rev:3,hostSeen:serverTimestamp()}));
    await assertSucceeds(updateDoc(doc(player,lobby),{host:a,hostUid:'host',rev:3}));
    await assertSucceeds(deleteDoc(doc(host,`${lobby}/players/${b}`)));
    // Conflicting candidates read the same old host; only one transaction may succeed.
    await assertSucceeds(setDoc(doc(player,`${lobby}/players/${b}`),seat('player')));
    const x='pxxxxxxxxxxxx';
    await assertSucceeds(setDoc(doc(stranger,`${lobby}/players/${x}`),seat('stranger')));
    await env.withSecurityRulesDisabled(async ctx => updateDoc(doc(ctx.firestore(),lobby),{hostSeen:Timestamp.fromMillis(Date.now()-60000)}));
    const race = (db, pid, owner) => runTransaction(db, async tx => {
      const ref=doc(db,lobby), snap=await tx.get(ref), d=snap.data();
      if (d.host !== a) return false;
      tx.update(ref,{host:pid,hostUid:owner,hostSeen:serverTimestamp(),clockHost:pid,updated:2,rev:d.rev+1}); return true;
    });
    const results=await Promise.allSettled([race(player,b,'player'),race(stranger,x,'stranger')]);
    assert.equal(results.filter(r => r.status === 'fulfilled' && r.value).length,1);
    for (const r of results) if (r.status === 'rejected') assert.equal(r.reason.code,'permission-denied');
    assert.equal((await getDoc(doc(host,lobby))).data().rev,4);
    console.log('PASS: multiplayer rules, bounded actions, seat ownership, host lease, takeover and voluntary handoff.');
  } finally { await env.cleanup(); }
}
legacyClients().then(() => process.argv.includes('--rules') ? rules() : undefined).catch(e => { console.error(e); process.exitCode=1; });
