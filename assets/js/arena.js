/* Arena CTF front-end. Flags are checked by the Worker (sakoi-cyber.me/api/arena); the browser only
   stores the player's token and keeps the UI in sync. Built with textContent only — no HTML injection. */
(function () {
  var API = "https://sakoi-cyber.me/api/arena";
  var KEY = "arena_player";
  var $ = function (id) { return document.getElementById(id); };
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; } }
  function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }

  var player = load();           // {token, handle}
  var solved = [];               // challenge ids solved by this player
  var score = 0;
  var challenges = [];
  var counts = {};               // solves per challenge
  var filter = "all";

  async function api(path, opts) {
    var r = await fetch(API + path, opts || {});
    var ct = r.headers.get("content-type") || "";
    if (ct.indexOf("json") < 0) throw new Error("offline");
    var d = await r.json(); d.status = r.status; return d;
  }
  function post(path, body) {
    return api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }

  /* ---------- identity ---------- */
  function paintIdentity() {
    if (player) {
      $("id-anon").hidden = true; $("id-me").hidden = false;
      $("me-handle").textContent = player.handle;
      $("me-score").textContent = score;
      $("me-solved").textContent = solved.length;
    } else {
      $("id-anon").hidden = false; $("id-me").hidden = true;
    }
  }
  async function refreshMe() {
    if (!player) return;
    try {
      var d = await api("/me?token=" + encodeURIComponent(player.token));
      if (d.status === 200) { solved = d.solved || []; score = d.score || 0; }
      else if (d.status === 404) { clear(); player = null; }
    } catch (e) {}
    paintIdentity(); renderBoard();
  }
  $("reg-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var h = $("reg-handle").value.trim();
    var msg = $("reg-msg"); msg.className = "id-msg";
    if (h.length < 2) { msg.textContent = "Pseudo trop court (2 caractères minimum)."; return; }
    try {
      var d = await post("/register", { handle: h });
      if (d.status === 200) { player = { token: d.token, handle: d.handle }; save(player); score = 0; solved = []; paintIdentity(); renderBoard(); }
      else if (d.status === 409) { msg.textContent = "Ce pseudo est déjà pris, choisis-en un autre."; }
      else if (d.status === 400) { msg.textContent = "Pseudo invalide : 2 à 24 caractères (lettres, chiffres, espace, _ . -)."; }
      else { msg.textContent = "L'arène est injoignable pour le moment. Réessaie plus tard."; }
    } catch (err) { msg.className = "id-msg"; msg.textContent = "L'arène n'est pas encore en ligne. Réessaie bientôt."; }
  });
  $("logout").addEventListener("click", function () {
    if (!confirm("Changer de pseudo ? Ta progression reste liée à l'ancien pseudo sur le serveur.")) return;
    clear(); player = null; solved = []; score = 0; paintIdentity(); renderBoard();
  });

  /* ---------- board ---------- */
  var DIFF = { "facile": "#7ee2a8", "moyen": "#f5c451", "difficile": "#f87171", "insane": "#a78bfa" };
  var CAT = { web: "#a78bfa", crypto: "#f5c451", reverse: "#f472b6", "forensique": "#6ee7b7", osint: "#7dd3fc", misc: "#60a5fa" };

  function renderFilters() {
    var bar = $("cat-filters"); bar.textContent = "";
    var cats = ["all"].concat([...new Set(challenges.map(function (c) { return c.category; }))]);
    cats.forEach(function (cat) {
      var b = document.createElement("button");
      b.type = "button"; b.className = cat === filter ? "on" : ""; b.dataset.cat = cat;
      b.textContent = cat === "all" ? "Tous" : cat;
      b.onclick = function () { filter = cat; renderFilters(); renderBoard(); };
      bar.appendChild(b);
    });
  }
  function renderProg() {
    var total = challenges.length, done = challenges.filter(function (c) { return solved.indexOf(c.id) >= 0; }).length;
    var pts = challenges.reduce(function (a, c) { return a + c.points; }, 0);
    $("prog").textContent = done + "/" + total + " challenges · " + score + "/" + pts + " pts";
  }
  function renderBoard() {
    renderProg();
    var board = $("board"); board.textContent = "";
    var list = challenges.filter(function (c) { return filter === "all" || c.category === filter; });
    if (!list.length) { var e = document.createElement("p"); e.className = "empty"; e.textContent = "Aucun challenge dans cette catégorie."; board.appendChild(e); return; }
    list.forEach(function (c) {
      var done = solved.indexOf(c.id) >= 0;
      var card = document.createElement("button");
      card.type = "button"; card.className = "chal" + (done ? " done" : "");
      card.style.setProperty("--cat", CAT[c.category] || "#9a9aa3");
      var top = document.createElement("div"); top.className = "chal-top";
      var cat = document.createElement("span"); cat.className = "chip"; cat.textContent = c.category;
      var pts = document.createElement("span"); pts.className = "chal-pts"; pts.textContent = c.points + " pts";
      top.appendChild(cat); top.appendChild(pts);
      var h = document.createElement("h3"); h.textContent = c.name;
      var meta = document.createElement("div"); meta.className = "chal-meta";
      var d = document.createElement("span"); d.className = "diff"; d.style.color = DIFF[c.difficulty] || "#9a9aa3"; d.textContent = c.difficulty;
      var n = document.createElement("span"); n.className = "solves"; n.textContent = (counts[c.id] || 0) + " résolu(s)";
      meta.appendChild(d); meta.appendChild(n);
      var st = document.createElement("span"); st.className = "chal-st"; st.textContent = done ? "✓" : "";
      card.appendChild(top); card.appendChild(h); card.appendChild(meta); card.appendChild(st);
      card.onclick = function () { openChallenge(c); };
      board.appendChild(card);
    });
  }

  /* ---------- challenge modal ---------- */
  var current = null;
  function openChallenge(c) {
    current = c;
    $("m-cat").textContent = c.category; $("m-cat").style.color = CAT[c.category] || "#fff";
    $("m-diff").textContent = c.difficulty; $("m-diff").style.color = DIFF[c.difficulty] || "#fff";
    $("m-pts").textContent = c.points + " pts";
    $("m-name").textContent = c.name;
    $("m-author").textContent = c.author ? "par " + c.author : "";
    $("m-desc").textContent = c.description || "";
    var files = $("m-files"); files.textContent = "";
    (c.files || []).forEach(function (f) {
      var a = document.createElement("a"); a.className = "file"; a.href = f.path; a.setAttribute("download", "");
      var ic = document.createElement("span"); ic.className = "fi"; ic.textContent = "⤓";
      var nm = document.createElement("span"); nm.textContent = f.name;
      a.appendChild(ic); a.appendChild(nm); files.appendChild(a);
    });
    var done = solved.indexOf(c.id) >= 0;
    $("m-solved").hidden = !done;
    $("flag-form").hidden = done;
    $("flag-in").value = ""; $("flag-msg").textContent = ""; $("flag-msg").className = "m-msg";
    $("modal").hidden = false; document.documentElement.classList.add("modal-open");
    if (!done) setTimeout(function () { $("flag-in").focus(); }, 50);
  }
  function closeModal() { $("modal").hidden = true; document.documentElement.classList.remove("modal-open"); current = null; }
  $("modal-x").addEventListener("click", closeModal);
  $("modal").addEventListener("mousedown", function (e) { if (e.target === $("modal")) closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("modal").hidden) closeModal(); });

  $("flag-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var msg = $("flag-msg"), btn = $("flag-btn");
    if (!player) { msg.className = "m-msg ko"; msg.textContent = "Choisis d'abord un pseudo en haut de la page."; return; }
    var flag = $("flag-in").value.trim();
    if (!flag) return;
    btn.disabled = true; msg.className = "m-msg"; msg.textContent = "…";
    try {
      var d = await post("/submit", { token: player.token, challenge: current.id, flag: flag });
      if (d.status === 401) { msg.className = "m-msg ko"; msg.textContent = "Session expirée — choisis à nouveau un pseudo."; clear(); player = null; paintIdentity(); }
      else if (d.correct) {
        msg.className = "m-msg ok";
        msg.textContent = d.fresh ? "✓ Correct ! +" + d.points + " points" : "✓ Déjà validé";
        if (solved.indexOf(current.id) < 0) { solved.push(current.id); counts[current.id] = (counts[current.id] || 0) + 1; }
        score = d.total; paintIdentity(); renderBoard();
        $("flag-form").hidden = true; $("m-solved").hidden = false;
      } else {
        msg.className = "m-msg ko";
        msg.textContent = d.reason === "format" ? "Mauvais format. Un flag ressemble à SAKOI{...}" : "✗ Flag incorrect. Réessaie.";
      }
    } catch (err) { msg.className = "m-msg ko"; msg.textContent = "L'arène est injoignable. Réessaie plus tard."; }
    btn.disabled = false;
  });

  /* ---------- boot ---------- */
  async function boot() {
    try {
      var data = await (await fetch("challenges.json", { cache: "no-store" })).json();
      challenges = data.challenges || [];
    } catch (e) { $("board").textContent = "Impossible de charger les challenges."; return; }
    try {
      var sb = await api("/scoreboard"); counts = sb.solves || {};
    } catch (e) {}
    renderFilters();
    paintIdentity();
    renderBoard();
    refreshMe();
  }
  boot();
})();
