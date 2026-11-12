# NSFW pack translation brief (shared by all translators)

Repo: E:\Dev\Cards Agains't Humanity  (static browser party game, adult card game for consenting adults)
Source (English, read-only): i18n/_work/en/<pack-id>.json  -> {"id","black":[...],"white":[...]}
Output: i18n/_work/<lang>/<pack-id>.json  -> {"id","black":[...],"white":[...]}  (lang = de or fr)
Untranslated log: i18n/_work/<lang>/<pack-id>.untranslated.json -> [{"kind":"black"|"white","index":N,"en":"...","reason":"..."}]  ([] if none)

Do NOT touch: index.html, README.md, i18n/cards.de.json, i18n/cards.fr.json, any cah-*.json work file, any pack not assigned to you. No git commit/push.

## Rules
1. Arrays must line up 1:1 with English: same length, element i translates English element i.
2. A card you leave untranslated is `null` in the output AND has an entry in the untranslated log with a short reason.
   Only null a card when:
   - it sexualises minors (reason "minors"), or
   - the joke depends entirely on English wordplay/spelling/rhyme and no German/French adaptation keeps it funny (reason "wordplay: <what>"), or
   - it is otherwise untranslatable (state why).
   Prefer adapting over nulling. Expected null rate: a few percent, not more.
3. Translate faithfully. These packs are explicit, crude, offensive on purpose: keep every swear word, sexual term, slur-level edge and dark joke at the same strength. Never soften ("fucking" stays "Fick-/ficken" / "putain/baiser", not "Sex"/"faire l'amour"). Do not add disclaimers.
4. Keep jokes, not words: adapt puns, catchphrases, titles, idioms to a natural German/French equivalent. Proper names, brands, celebrities stay as-is (use the established DE/FR title for films/shows if one exists).
5. Black cards: keep exactly the same number of `____` blanks (4 underscores). Make grammar work around the blank (articles/case/gender: prefer constructions that fit any noun phrase, e.g. "____ ?" / "C'est ____ qui..." / "Schuld ist ____."). Keep `[player]` tokens unchanged.
6. White cards: noun phrases as in English, end with a period if the English does. Capitalise per target language.
7. Max 150 characters per card. Valid UTF-8, real accents/umlauts/ß, typographic style of the existing translations (French: space before ? ! : ; e.g. "quoi ?"; German: „…" or "…" quotes fine).
8. Write each pack file when done with it (don't hold everything to the end).

## Verify (run with node from the repo root; adjust LANG and IDS)
node -e "const fs=require('fs');const L=process.argv[1];for(const id of process.argv.slice(2)){const e=JSON.parse(fs.readFileSync('i18n/_work/en/'+id+'.json','utf8')),t=JSON.parse(fs.readFileSync('i18n/_work/'+L+'/'+id+'.json','utf8')),u=JSON.parse(fs.readFileSync('i18n/_work/'+L+'/'+id+'.untranslated.json','utf8'));let bad=[];for(const k of ['black','white']){if(e[k].length!==t[k].length)bad.push(k+' length');t[k].forEach((c,i)=>{if(c===null){if(!u.some(x=>x.kind===k&&x.index===i))bad.push(k+i+' null not logged');return}if(typeof c!=='string'||!c.trim())bad.push(k+i+' empty');if(c.length>150)bad.push(k+i+' >150');const n=s=>(s.match(/____/g)||[]).length;if(n(c)!==n(e[k][i]))bad.push(k+i+' blanks');if(e[k][i].includes('[player]')&&!c.includes('[player]'))bad.push(k+i+' [player]');if(c===e[k][i]&&/[a-z]{4}/i.test(c))bad.push(k+i+' identical to EN?')})}u.forEach(x=>{if(t[x.kind][x.index]!==null)bad.push('logged but not null '+x.kind+x.index)});console.log(id,t.black.filter(x=>x===null).length+t.white.filter(x=>x===null).length,'null',bad.length?bad.slice(0,20):'OK')}" de nsfw-depravity
("identical to EN?" is a warning: fine for names/brands, otherwise translate.)
