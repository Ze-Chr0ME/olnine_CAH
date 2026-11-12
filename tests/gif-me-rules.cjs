const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {initializeTestEnvironment, assertSucceeds, assertFails} = require('@firebase/rules-unit-testing');
const {doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, runTransaction, serverTimestamp, Timestamp} = require('firebase/firestore');

(async()=>{
 const env = await initializeTestEnvironment({projectId:'demo-cah-accounts',firestore:{host:'127.0.0.1',port:8089,rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 try {
  const host = env.authenticatedContext('host').firestore();
  const setter = env.authenticatedContext('setter').firestore();
  const player = env.authenticatedContext('player').firestore();
  const outsider = env.authenticatedContext('outsider').firestore();
  const setterPid = 'pssssssssssss', playerPid = 'ppppppppppppp';
  const room = db => doc(db,'lobbies/TEST');
  const seat = (db,pid) => doc(db,`lobbies/TEST/players/${pid}`);
  const media = db => doc(db,'lobbies/TEST/media/sit');
  const baseGame = {type:'gm',gid:'game-one',round:1,phase:'set',setter:setterPid};
  const stamp = {gid:baseGame.gid,round:baseGame.round};
  const situation = {...stamp,text:'A situation',photo:false};
  const gif = {...stamp,id:'one',url:'https://static.klipy.com/a.gif',still:'https://static1.klipy.com/a.jpg',w:100,h:100};
  const vote = {...stamp,k:0};
  const photo = {...stamp,pid:setterPid,uid:'setter',data:'data:image/jpeg;base64,/9j/AA=='};
  const seatData = owner => ({owner,uid:owner,name:owner,face:{s:0,k:0,e:0,a:0,b:0},lvl:1,joined:1});
  const seed = async (ref,data) => env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),ref.path),data));
  const game = async (changes={}) => seed(room(host),{host:playerPid,hostUid:'host',hostSeen:Timestamp.fromMillis(1),rev:1,game:{...baseGame,...changes}});
  await game();
  await seed(seat(setter,setterPid),seatData('setter'));
  await seed(seat(player,playerPid),seatData('player'));
  await assertSucceeds(setDoc(seat(player,'pnnnnnnnnnnnn'),seatData('player')));

  // Fresh seats, including legacy ownerless seats, cannot carry GM actions.
  const fresh = seat(player,'pcccccccccccc');
  for (const owner of ['player',null]) {
   const data = seatData('player');
   if (owner == null) delete data.owner;
   for (const [key,value] of Object.entries({sit:situation,gif,vote})) {
    await assertFails(setDoc(fresh,{...data,[key]:value}));
   }
   await assertSucceeds(setDoc(fresh,data));
   await assertSucceeds(deleteDoc(fresh));
   await assertSucceeds(setDoc(fresh,{...data,sit:null,gif:null,vote:null}));
   await assertSucceeds(deleteDoc(fresh));
  }

  // Media writes bind caller, setter, game, phase and payload; no room membership read model.
  await assertFails(setDoc(media(player),{...photo,pid:playerPid,uid:'player'}));
  await assertFails(setDoc(media(outsider),{...photo,uid:'outsider'}));
  for (const change of [{round:2},{gid:'other-game'},{uid:'player'},{data:'data:image/png;base64,AAAA'},{data:'data:image/jpeg;base64,'+'A'.repeat(200000)}]) {
   await assertFails(setDoc(media(setter),{...photo,...change}));
  }
  for (const phase of ['search','vote','result','over']) {
   await game({phase}); await assertFails(setDoc(media(setter),photo));
  }
  await game({type:'cah'}); await assertFails(setDoc(media(setter),photo));
  await game();
  await assertSucceeds(setDoc(media(setter),photo));
  await assertSucceeds(getDoc(media(outsider)));
  await assertFails(getDoc(media(env.unauthenticatedContext().firestore())));
  await assertFails(deleteDoc(media(player)));
  await assertSucceeds(deleteDoc(media(host)));
  await assertSucceeds(setDoc(media(setter),photo));
  await assertSucceeds(deleteDoc(media(setter)));

  // Situation submissions are setter-only, phase-bound and locked once submitted.
  await assertFails(updateDoc(seat(player,playerPid),{sit:situation}));
  await assertSucceeds(updateDoc(seat(setter,setterPid),{sit:situation}));
  await assertFails(updateDoc(seat(setter,setterPid),{sit:null}));
  await assertFails(updateDoc(seat(setter,setterPid),{sit:deleteField()}));
  await assertFails(updateDoc(seat(setter,setterPid),{sit:{...situation,text:'Replacement'}}));
  await game({phase:'search'});
  await assertFails(updateDoc(seat(setter,setterPid),{sit:null}));
  await assertSucceeds(updateDoc(seat(setter,setterPid),{sit:situation})); // Still locked, unchanged refresh allowed.

  // Search submissions cannot be pre-votes, stale actions or untrusted GIF hosts.
  await assertFails(updateDoc(seat(player,playerPid),{vote}));
  await assertFails(updateDoc(seat(setter,setterPid),{gif}));
  for (const change of [{round:2},{gid:'other-game'},{url:'https://evil.example/a.gif'},{still:'https://static.klipy.com.evil.example/a.jpg'}]) {
   await assertFails(updateDoc(seat(player,playerPid),{gif:{...gif,...change}}));
  }
  await game({type:'cah',phase:'search'});
  await assertFails(updateDoc(seat(player,playerPid),{gif}));
  await game({phase:'set'}); await assertFails(updateDoc(seat(player,playerPid),{gif}));
  await game({phase:'search'});
  await assertSucceeds(updateDoc(seat(player,playerPid),{gif}));
  await assertFails(updateDoc(seat(player,playerPid),{gif:null}));
  await assertFails(updateDoc(seat(player,playerPid),{gif:deleteField()}));
  await assertFails(updateDoc(seat(player,playerPid),{gif:{...gif,id:'two'}}));
  // Deleting and recreating an owned seat cannot replace a locked GIF or pre-vote.
  const lockedSeat = (await getDoc(seat(player,playerPid))).data();
  await assertSucceeds(deleteDoc(seat(player,playerPid)));
  await assertFails(setDoc(seat(player,playerPid),{...lockedSeat,gif:{...gif,id:'two'}}));
  await assertFails(setDoc(seat(player,playerPid),{...seatData('player'),vote}));
  await seed(seat(player,playerPid),lockedSeat);
  await game({phase:'vote'});
  await assertFails(updateDoc(seat(player,playerPid),{gif:{...gif,id:'two'}}));
  await assertSucceeds(updateDoc(seat(player,playerPid),{vote}));
  await assertSucceeds(updateDoc(seat(setter,setterPid),{vote}));
  await assertFails(updateDoc(seat(player,playerPid),{vote:null}));
  await assertFails(updateDoc(seat(player,playerPid),{vote:deleteField()}));
  await assertFails(updateDoc(seat(player,playerPid),{vote:{...vote,k:1}}));
  await game({phase:'result'});
  await assertSucceeds(updateDoc(seat(player,playerPid),{vote})); // Idempotent refresh.
  await assertFails(updateDoc(seat(player,playerPid),{vote:{...vote,k:1}}));
  await assertFails(updateDoc(seat(player,playerPid),{gif:null,vote:deleteField()}));
  await assertFails(updateDoc(seat(setter,setterPid),{vote:null,sit:deleteField()}));
  await game({phase:'vote',round:2});
  await assertSucceeds(updateDoc(seat(player,playerPid),{gif:null,vote:deleteField()}));
  await assertSucceeds(updateDoc(seat(setter,setterPid),{vote:null,sit:deleteField()}));
  await assertSucceeds(updateDoc(seat(setter,setterPid),{gif:null})); // Absent/null clears are harmless.
  await assertFails(updateDoc(seat(player,playerPid),{vote}));
  await assertFails(updateDoc(seat(player,playerPid),{vote:{...vote,round:2,gid:'other-game'}}));
  await assertSucceeds(updateDoc(seat(player,playerPid),{vote:{...vote,round:2}}));
  await game({phase:'vote',round:3});
  await assertSucceeds(updateDoc(seat(player,playerPid),{vote:{...vote,round:3,k:1}}));

  // A different gid, non-GM game, or empty game also makes old actions clearable.
  await game({gid:'game-two',phase:'vote',round:3});
  await assertSucceeds(updateDoc(seat(player,playerPid),{vote:null}));
  await seed(seat(player,playerPid),{...seatData('player'),sit:situation,gif,vote});
  await game({type:'cah'});
  await assertSucceeds(updateDoc(seat(player,playerPid),{sit:null,gif:deleteField(),vote:null}));
  await seed(seat(player,playerPid),{...seatData('player'),sit:situation,gif,vote});
  await seed(room(host),{game:null});
  await assertSucceeds(updateDoc(seat(player,playerPid),{sit:deleteField(),gif:null,vote:deleteField()}));

  // Full-seat copies/claim and profile refresh must preserve unchanged stale GM actions.
  await game({type:'cah',phase:'submit'});
  const oldSeat = (await getDoc(seat(player,playerPid))).data();
  await assertSucceeds(setDoc(seat(player,playerPid),{...oldSeat,name:'Refreshed'}));
  await assertSucceeds(updateDoc(seat(player,playerPid),{name:'Player',lvl:2,uid:'linked-account'}));
  await assertSucceeds(updateDoc(seat(player,playerPid),{sub:{gid:'cah',round:0,cards:['card']}}));
  await game({type:'mp',phase:'wish'});
  await assertSucceeds(updateDoc(seat(player,playerPid),{wish:{gid:'mp',round:0,text:'A wish'}}));
  await assertFails(updateDoc(seat(player,playerPid),{wish:{gid:'mp',round:0,text:'x'.repeat(201)}}));
  await assertFails(updateDoc(seat(player,playerPid),{sub:{gid:'cah',round:0,cards:['a','b','c','d']}}));
  // Seats retain actions when switching games; validate the fully populated case too.
  await seed(seat(player,playerPid),{...seatData('player'),sit:situation,gif,vote,
   sub:{...stamp,cards:['card']},wish:{...stamp,text:'wish'},twist:{...stamp,text:'twist'},
   trait:{...stamp,text:'trait'},pick:{...stamp,k:0},rate:{...stamp,v:3},reveal:{...stamp,ks:[0,1]}});
  await assertSucceeds(updateDoc(seat(player,playerPid),{name:'All actions'}));
  await game({phase:'vote',round:4});
  await assertSucceeds(updateDoc(seat(player,playerPid),{vote:{...vote,round:4}}));
  await game({phase:'search',round:5});
  await assertSucceeds(updateDoc(seat(player,playerPid),{gif:{...gif,round:5}}));
  const legacyPid = 'pllllllllllll';
  const legacy = seatData('player'); delete legacy.owner;
  legacy.gif = gif;
  await seed(seat(player,legacyPid),legacy);
  await assertSucceeds(updateDoc(seat(player,legacyPid),{owner:'player',name:'Claimed'}));
  await assertFails(updateDoc(seat(player,legacyPid),{gif:{...gif,id:'changed'}}));

  // Real host commit pattern: read room, update it and delete media atomically.
  await game();
  await assertSucceeds(setDoc(media(setter),photo));
  await assertSucceeds(runTransaction(host,async tx=>{
   const snapshot = await tx.get(room(host));
   tx.set(room(host),{...snapshot.data(),game:{...snapshot.data().game,phase:'search'},hostSeen:serverTimestamp()});
   tx.delete(media(host));
  }));
  assert.equal((await getDoc(media(host))).exists(),false);
  await assertFails(setDoc(media(setter),photo)); // A delayed upload cannot recreate it.
  console.log('PASS: GIF Me media, phase/role/stamp guards, action locks/clears, seat refresh, other games and host commit.');
 } finally { await env.cleanup(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
