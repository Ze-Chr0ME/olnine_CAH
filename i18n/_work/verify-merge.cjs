const fs=require('fs'), assert=require('assert/strict'), cp=require('child_process');
const html=fs.readFileSync('index.html','utf8');
const packs=html.split('\n').filter(l=>l.trim().startsWith('{"id":')&&l.includes('"kind":"nsfw"')).map(l=>JSON.parse(l.trim().replace(/,$/,'')));
assert.equal(packs.length,11);
const md=fs.readFileSync('i18n/UNTRANSLATED.md','utf8');
const tables=md.split('\n## ').slice(1);
let total=0;
for(const lang of ['de','fr']) {
  const file=`i18n/cards.${lang}.json`, raw=fs.readFileSync(file,'utf8'), current=JSON.parse(raw);
  const before=cp.execFileSync('git',['show',`HEAD:${file}`],{encoding:'utf8'}), old=JSON.parse(before);
  assert.equal(Object.keys(old).length,71); assert.equal(Object.keys(current).length,82);
  for(const [id,value] of Object.entries(old)) assert.deepEqual(current[id],value);
  const oldLines=before.split('\n'), newLines=raw.split('\n');
  for(let i=0;i<oldLines.length-3;i++) assert.equal(newLines[i],oldLines[i]);
  assert.equal(newLines[oldLines.length-3],oldLines[oldLines.length-3]+',');
  assert.equal(raw.charCodeAt(0),123);
  assert.equal(raw.includes('\r\n'),before.includes('\r\n'));
  for(const [pi,p] of packs.entries()) {
    const en=JSON.parse(fs.readFileSync(`i18n/_work/en/${p.id}.json`,'utf8'));
    const t=current[p.id], other=JSON.parse(fs.readFileSync(`i18n/_work/${lang==='de'?'fr':'de'}/${p.id}.json`,'utf8'));
    const log=JSON.parse(fs.readFileSync(`i18n/_work/${lang}/${p.id}.untranslated.json`,'utf8'));
    assert.deepEqual(t,((s)=>({black:s.black,white:s.white}))(JSON.parse(fs.readFileSync(`i18n/_work/${lang}/${p.id}.json`,'utf8'))));
    const nulls=[];
    for(const k of ['black','white']) {
      assert.deepEqual(en[k],p[k]); assert.equal(t[k].length,p[k].length);
      t[k].forEach((c,i)=>{
        assert.equal(c===null,other[k][i]===null);
        if(c===null){nulls.push(`${k}:${i}`);return;}
        assert.equal(typeof c,'string');assert(c.trim());assert(c.length<=150);
        assert(!/\uFFFD|\u00c3|\u00e2\u20ac|\?[\p{L}]/u.test(c));
        assert.equal((c.match(/____/g)||[]).length,(p[k][i].match(/____/g)||[]).length);
        if(p[k][i].includes('[player]'))assert(c.includes('[player]'));
      });
    }
    assert.deepEqual(log.map(x=>`${x.kind}:${x.index}`),nulls);
    log.forEach(x=>{assert.equal(x.en,p[x.kind][x.index]);assert.equal(x.reason,'minors')});
    const section=tables[pi];assert(section.startsWith(p.name+'\n'));
    const rows=section.split('\n').filter(l=>/^\| (black|white) \|/.test(l));
    assert.deepEqual(rows.map(l=>{const a=l.split(' | ');return a[0].slice(2)+':'+a[1]}),nulls);
    if(lang==='de'){total+=nulls.length;console.log(p.id,nulls.length);}
  }
  console.log(lang+': 82 keys; 71 original entries and lines preserved; 11 packs, logs, encoding, lengths, blanks and tokens OK');
}
assert(md.includes(`Total: **${total} untranslated cards**`));
assert(html.includes(`and so do ${20+total} cards that were left untranslated.`));
console.log('Markdown positions and lobby total OK:',total,20+total);
const brief=fs.readFileSync('i18n/_work/NSFW_BRIEF.md','utf8');
const code=brief.match(/node -e "([^\n]+)" de nsfw-depravity/)[1];
for(const lang of ['de','fr']){
  const output=cp.execFileSync(process.execPath,['-e',code,lang,...packs.map(p=>p.id)],{encoding:'utf8'});
  fs.writeFileSync(`i18n/_work/verify-${lang}.txt`,output);
  console.log('Brief one-liner '+lang+':\n'+output);
}
