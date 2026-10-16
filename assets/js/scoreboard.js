/* Scoreboard: top players from the Worker, rendered with textContent only. */
(function () {
  var API = "https://sakoi-cyber.me/api/arena";
  var me = null;
  try { me = (JSON.parse(localStorage.getItem("arena_player")) || {}).handle || null; } catch (e) {}

  async function load() {
    var sb = document.getElementById("sb"), count = document.getElementById("sb-count");
    sb.textContent = "";
    var li = document.createElement("li"); li.className = "empty"; li.textContent = "Chargement…"; sb.appendChild(li);
    try {
      var r = await fetch(API + "/scoreboard", { cache: "no-store" });
      if ((r.headers.get("content-type") || "").indexOf("json") < 0) throw new Error("offline");
      var d = await r.json();
      var board = (d.board || []).filter(function (p) { return p.solves > 0; });
      count.textContent = board.length + " joueur(s) classé(s)";
      sb.textContent = "";
      if (!board.length) { var e = document.createElement("li"); e.className = "empty"; e.textContent = "Personne au classement pour l'instant. Sois le premier !"; sb.appendChild(e); return; }
      board.forEach(function (p, i) {
        var row = document.createElement("li"); if (p.handle === me) row.className = "me";
        var rank = document.createElement("span"); rank.className = "r"; rank.textContent = i < 3 ? ["🥇", "🥈", "🥉"][i] : String(i + 1);
        var name = document.createElement("span"); name.className = "h"; name.textContent = p.handle;
        var solv = document.createElement("span"); solv.className = "n"; solv.textContent = p.solves + " résolu(s)";
        var pts = document.createElement("span"); pts.className = "p"; pts.textContent = p.score + " pts";
        row.appendChild(rank); row.appendChild(name); row.appendChild(solv); row.appendChild(pts);
        sb.appendChild(row);
      });
    } catch (e) {
      count.textContent = "";
      sb.textContent = "";
      var m = document.createElement("li"); m.className = "empty"; m.textContent = "Le classement n'est pas disponible pour le moment.";
      sb.appendChild(m);
    }
  }
  document.getElementById("refresh").addEventListener("click", load);
  load();
})();
