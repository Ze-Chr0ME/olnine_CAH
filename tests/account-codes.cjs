const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const {initializeTestEnvironment, assertSucceeds, assertFails} = require('@firebase/rules-unit-testing');
const {doc, getDoc, getDocs, collection, setDoc, deleteDoc, runTransaction, onSnapshot} = require('firebase/firestore');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const profileSource = html.slice(html.indexOf('const XP ='), html.indexOf('/* ---------- notices & errors'));
const accountSource = html.slice(html.indexOf('const ACCOUNT_ALPHABET'), html.indexOf('/* Portrait editor:'));
const wrap = s => ({exists:s.exists(), data:()=>s.data()});
function adapter(db) {
  const ref = name => ({raw:doc(db,name), get:async()=>wrap(await getDoc(doc(db,name))), set:data=>setDoc(doc(db,name),JSON.parse(JSON.stringify(data))), onSnapshot:(next,error)=>onSnapshot(doc(db,name),s=>next(wrap(s)),error)});
  return {doc:ref, runTransaction: fn => runTransaction(db, tx => fn({get:async r=>wrap(await tx.get(r.raw)), set:(r,d)=>tx.set(r.raw,JSON.parse(JSON.stringify(d)))}))};
}
function device(id, db, cache = new Map()) {
  const nodes = new Map();
  const $ = name => { if(!nodes.has(name))nodes.set(name,{value:'',textContent:'',focus(){},select(){},classList:{toggle(){}}}); return nodes.get(name); };
  const ctx = vm.createContext({db:adapter(db), $, crypto:webcrypto, navigator:{clipboard:{writeText:async()=>{}}},
    store:{get:(k,d)=>cache.get(k)??d,set:(k,v)=>cache.set(k,v)},
    ME:'p'+id.padEnd(12,'0'),myName:id, cleanName:s=>String(s||''),cleanFace:f=>f||{s:0},validImg:i=>i||null,
    clone:o=>JSON.parse(JSON.stringify(o)),uniq:a=>[...new Set(a)],rid:n=>webcrypto.randomUUID().replaceAll('-','').slice(0,n),
    P:{},L:null,code:null,canWrite:true,draft:null,render(){},notice(){},
    levelOf:()=>({lvl:1}),dbErr:e=>{ctx.lastError=e;},console,Date,Set,Uint8Array,
  });
  vm.runInContext(profileSource+'\n'+accountSource,ctx);
  vm.runInContext('firebaseAccountUser='+JSON.stringify(id)+';uid=firebaseAccountUser',ctx);
  return {ctx,cache,$,run:code=>vm.runInContext(code,ctx)};
}
async function eventually(check) {
  const end = Date.now() + 5000;
  while (!check()) { if (Date.now() > end) throw new Error("Live profile did not update"); await new Promise(resolve => setTimeout(resolve, 20)); }
}
(async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-cah-accounts',firestore:{host:'127.0.0.1',port:8089,rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 try {
  const aDB=env.authenticatedContext('owner').firestore(),bDB=env.authenticatedContext('phone').firestore(), cDB=env.authenticatedContext('stranger').firestore();
  const a=device('owner',aDB), b=device('phone',bDB);
  // Existing progress predates personal codes and must remain attached to this account.
  await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'profiles/owner'),{name:'Wendy',xp:500,stats:{wins:3}}));
  await a.run('bindProfile(uid)');
  await a.run('copyPersonalCode()'); if(a.ctx.lastError)throw a.ctx.lastError;
  const personal=a.run('personalCode'); await a.run('copyPersonalCode()'); assert.equal(a.run('personalCode'),personal); assert.equal(personal.length,24); assert(a.run('validAccountCode(personalCode)'));
  assert.equal(a.run('normalizeAccountCode(formatAccountCode(personalCode).toLowerCase())'),personal);
  await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'profiles/phone'),{name:'Other',xp:9000,stats:{wins:99}}));
  await b.run('bindProfile(uid)');
  await b.run('profile.name="Other";saveProfile()');
  b.$('accountInput').value=personal.toLowerCase().match(/.{1,6}/g).join(' ');
  await b.run('connectAccount({preventDefault(){}})'); if(b.ctx.lastError)throw b.ctx.lastError;
  assert.equal(b.run('uid'),'owner'); assert.equal(b.run('profile.name'),'Wendy'); assert.equal(b.run('profile.xp'),500); assert.equal(b.run('profile.stats.wins'),3);
  const again=device('phone',bDB,b.cache);
  const link=await getDoc(doc(bDB,'accountLinks/phone')); again.run('personalCode='+JSON.stringify(link.data().code));
  await again.run('bindProfile("owner")'); assert.equal(again.run('profile.xp'),500);
  await b.run('profile.name="Phone Wendy";saveProfile()');
  await eventually(()=>a.run('profile.name')==='Phone Wendy');
  a.run('unsubProfile()');
  await b.run('profile.name="Latest Wendy";saveProfile()');
  // Independent rewards arriving together must both survive; replay is idempotent.
  const reward=(id,n)=>({id,xp:n,stats:{wins:1},marks:[id+':round']});
  a.run('pendingRewards=['+JSON.stringify(reward('reward-a',50))+'];profile=applyRewards(profile,pendingRewards)');
  b.run('pendingRewards=['+JSON.stringify(reward('reward-b',70))+'];profile=applyRewards(profile,pendingRewards)');
  assert.deepEqual(await Promise.all([a.run('saveProfile()'),b.run('saveProfile()')]),[true,true]);
  let saved=(await getDoc(doc(aDB,'profiles/owner'))).data(); assert.equal(saved.xp,620);assert.equal(saved.stats.wins,5);assert.equal(saved.name,'Latest Wendy','stale progress saves must preserve remote name edits');
  b.run('pendingRewards=['+JSON.stringify(reward('reward-b',70))+']'); await b.run('saveProfile()');
  saved=(await getDoc(doc(aDB,'profiles/owner'))).data(); assert.equal(saved.xp,620);
  b.run('code="TEST"');b.$('accountInput').value=personal;await b.run('connectAccount({preventDefault(){}})');assert.match(b.$('accountMsg').textContent,/Leave your lobby/);b.run('code=null');
  b.$('accountInput').value='bad';await b.run('connectAccount({preventDefault(){}})');assert.match(b.$('accountMsg').textContent,/24/);
  b.$('accountInput').value='Z'.repeat(24);await b.run('connectAccount({preventDefault(){}})');assert.match(b.$('accountMsg').textContent,/wasn't found/);
  const publicProfile=(await getDoc(doc(cDB,'profiles/owner'))).data();assert(!JSON.stringify(publicProfile).includes(personal));
  await assertFails(getDocs(collection(cDB,'accountKeys')));
  await assertFails(getDocs(collection(cDB,'accountLinks')));
  await assertFails(getDoc(doc(cDB,'accountLinks/phone')));
  await assertFails(setDoc(doc(cDB,'accountLinks/stranger'),{accountId:'owner',code:'Z'.repeat(24)}));
  await assertFails(setDoc(doc(cDB,'accountLinks/phone'),{accountId:'stranger',code:personal}));
  await assertFails(setDoc(doc(cDB,'accountKeys/'+personal),{accountId:'stranger'}));
  await assertFails(deleteDoc(doc(aDB,'accountKeys/'+personal)));
  await assertFails(setDoc(doc(cDB,'accountKeys/'+'X'.repeat(24)),{accountId:'owner'}));
  await assertFails(setDoc(doc(cDB,'profiles/owner'),{xp:999999}));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'accountKeys/'+personal)));
  await assertSucceeds(setDoc(doc(bDB,'profiles/owner'),saved));
  await assertSucceeds(getDocs(collection(cDB,'profiles')));
  console.log('PASS: code creation, existing progress, cross-device connect/reload/edit, concurrent XP, reward replay, invalid codes and access-control boundaries.');
 } finally {await env.cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1;});
