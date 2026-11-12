/* Test bots. index.html loads this only when the page is served from localhost, so the published site never runs it.
   The host gets an "Add a bot" seat in the lobby. The host's browser plays every bot in its lobby, in all four games:
   bots show as online, act after a short pause, and pick at random. Leaving the lobby removes the bots first,
   so hosting passes to a person (bot seats have no owner, so they can never be picked as host anyway). */
(() => {
  const NAMES = ["bot_zorg", "bot_baron", "bot_xeno", "bot_wendy", "bot_klaxx", "bot_mira", "bot_tusk", "bot_vex", "bot_lulu", "bot_grim"];
  const TWISTS = [
    "Granted, but only on Tuesdays.", "Granted, but your mother gets a copy.", "Granted, but it's narrated by Morgan Freeman, loudly.",
    "Granted, but every pigeon now knows your name.", "Granted, but it comes out of your weekly sleep.", "Granted, but you have to sing to activate it.",
    "Granted, but it's in Comic Sans.", "Granted, but the IRS is notified.", "Granted, but only while you hold your breath."
  ];
  const TRAITS = ["Collects toenails", "Thinks the moon is fake", "Still lives with their ex", "Speaks only in movie quotes",
    "Has a pet tarantula named Kevin", "Cried at a car commercial today", "Owns a timeshare in Ohio", "Allergic to fun"];
  const isBot = pid => /^pbot/.test(pid);
  const bots = () => Object.keys(P).filter(isBot);
  const seat = pid => db.doc(`lobbies/${code}/players/${pid}`);
  const later = (ms, fn) => setTimeout(fn, ms + Math.random() * ms);
  const rand = n => Math.floor(Math.random() * n);
  const send = (pid, body) => seat(pid).update(body).catch(e => console.warn("bot", pid, e.code || e.message));

  /* presence: one entry per bot, written with this browser's sign-in */
  const pres = {};
  function syncPresence() {
    const me = typeof firebase !== "undefined" && firebase.auth && firebase.auth().currentUser;
    if (!me) return;
    const want = new Set(code && isHost() ? bots() : []);
    for (const pid of Object.keys(pres)) if (!want.has(pid) || pres[pid].lobby !== code) { pres[pid].ref.remove(); delete pres[pid]; }
    for (const pid of want) if (!pres[pid]) {
      const ref = firebase.database().ref("presence/" + rid(12));
      ref.onDisconnect().remove();
      ref.set({ pid, lobby: code, uid: me.uid, t: Date.now(), rev: 0 });
      pres[pid] = { ref, lobby: code };
    }
  }

  async function add() {
    if (!code || !db || !isHost()) return;
    if (Object.keys(P).length >= settings().maxPlayers) return notice("The lobby is full. Raise Max players first.", { error: true });
    const used = new Set(Object.values(P).map(p => p.name));
    const name = NAMES.find(n => !used.has(n)) || "bot_" + rid(4), pid = "pbot" + rid(9);
    try { await seat(pid).set({ name, face: seedFace(pid), lvl: 1 + rand(30), uid: null, joined: Date.now(), sub: null, pick: null }); }
    catch (e) { notice("Couldn't add a bot: " + (e.code || e.message), { error: true }); }
  }

  /* one action per bot per phase */
  const done = {};
  function once(pid, g, fn) {
    const key = `${pid}:${g.gid}:${g.round}:${g.phase}`;
    if (done[key]) return;
    done[key] = 1; fn();
  }
  const stamp = g => ({ gid: g.gid, round: g.round });
  const PLAY = {
    cah(g, pid) {
      if (g.phase === "pick" && g.czar !== pid && g.seats.includes(pid)) {
        const hand = g.hands[pid] || [], n = need(g.black);
        if (hand.length >= n) once(pid, g, () => later(1500, () => send(pid, { sub: { ...stamp(g), cards: shuffle(hand).slice(0, n) } })));
      } else if (g.phase === "judge" && g.czar === pid) once(pid, g, () => {
        const ks = g.order.map((_, k) => k);
        ks.forEach((k, i) => setTimeout(() => send(pid, { reveal: { ...stamp(g), ks: ks.slice(0, i + 1) } }), 1200 * (i + 1)));
        later(1200 * ks.length + 1500, () => send(pid, { pick: { ...stamp(g), k: rand(ks.length) } }));
      });
    },
    mp(g, pid) {
      if (g.phase === "wish" && g.wisher === pid && g.wishCards && g.wishCards.length)
        once(pid, g, () => later(2000, () => send(pid, { wish: { ...stamp(g), text: g.wishCards[rand(g.wishCards.length)] } })));
      else if (g.phase === "twist" && g.wisher !== pid && g.seats.includes(pid))
        once(pid, g, () => later(2500, () => send(pid, { twist: { ...stamp(g), text: TWISTS[rand(TWISTS.length)] } })));
      else if (g.phase === "judge" && g.wisher === pid && g.order && g.order.length)
        once(pid, g, () => later(3000, () => send(pid, { pick: { ...stamp(g), k: rand(g.order.length) } })));
    },
    sd(g, pid) {
      if (!g.seats.includes(pid) || g.speaker === pid) return;
      if (g.phase === "write") once(pid, g, () => later(2500, () => send(pid, { trait: { ...stamp(g), text: TRAITS[rand(TRAITS.length)] } })));
      else if (g.phase === "rate") once(pid, g, () => later(1500, () => send(pid, { rate: { ...stamp(g), v: 1 + rand(5) } })));
    },
    gm(g, pid) {
      if (!g.seats.includes(pid)) return;
      if (g.phase === "set" && g.setter === pid && g.sitCards && g.sitCards.length)
        once(pid, g, () => later(2000, () => send(pid, { sit: { ...stamp(g), text: g.sitCards[rand(g.sitCards.length)], photo: false } })));
      else if (g.phase === "search" && g.setter !== pid) once(pid, g, () => later(2500, async () => {
        try {
          const { items } = await gmSearchGifs("", 1 + rand(3));
          const it = items[rand(items.length)];
          if (it) send(pid, { gif: { ...stamp(g), id: it.id, url: it.url, still: it.still, w: it.w, h: it.h } });
        } catch (e) { console.warn("bot gif search", e.message); }
      }));
      else if (g.phase === "vote" && g.order) {
        const ks = g.order.map((o, k) => o.pid === pid ? -1 : k).filter(k => k >= 0);
        if (ks.length) once(pid, g, () => later(2000, () => send(pid, { vote: { ...stamp(g), k: ks[rand(ks.length)] } })));
      }
    }
  };
  function play() {
    const g = L && L.status === "playing" && L.game;
    if (!g || !isHost() || !PLAY[g.type || "cah"]) return;
    for (const pid of bots()) PLAY[g.type || "cah"](g, pid);
  }

  /* leaving removes the bots first, so hosting passes to a person */
  const leave = leaveLobby;
  leaveLobby = async () => {
    if (code && db && isHost()) await Promise.all(bots().map(pid => seat(pid).delete().catch(() => {})));
    return leave();
  };

  window.BOTS = { add, is: isBot };
  setInterval(() => { syncPresence(); play(); }, 500);
})();
