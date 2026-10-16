/* Arena API for ctf.sakoi-cyber.me — Cloudflare Worker + D1, served on sakoi-cyber.me/api/arena/*.
   The server holds the flag hashes and the points, validates every submission and keeps the scoreboard:
   the browser never sees a flag hash and cannot award itself points. No IP, no cookie — a random token per player. */

/* ------- challenges: the ONLY source of truth for flags and points -------
   For each challenge: sha256 of the exact flag, and its point value.
   Add a challenge here AND in the public challenges.json (metadata). To set a flag:
   echo -n 'SAKOI{...}' | sha256sum   then paste the hash below. */
const CHALLENGES = {
  "warmup":     { hash: "4c4c77ff036a0e52e2a479d21d2496257ec10bd181bc40fb6d9b4a6da43c8661", points: 50 },
  "base-soup":  { hash: "00ad8d66a7ccc7748c345ee2f5819484aedaabd236f55e449d1c166ba20a3943", points: 100 },
  "robots-redux": { hash: "0435a6d565f61f0334646fcb7bb2cb9af9164a4ab19e06c45a2057f701c7293e", points: 100 },
};

const ALLOWED_ORIGINS = ["https://ctf.sakoi-cyber.me", "https://sakoi-cyber.me"];
const HANDLE = /^[\p{L}\p{N}_.\- ]{2,24}$/u;
const MAX_ATTEMPTS = 500;
const FLAG_RE = /^SAKOI\{[\x20-\x7e]{1,120}\}$/;

function cors(origin) {
  const o = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return { "access-control-allow-origin": o, "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type", "access-control-max-age": "86400", "vary": "Origin" };
}
const json = (body, status, origin) => new Response(JSON.stringify(body), {
  status: status || 200,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...cors(origin) },
});
const now = () => Math.floor(Date.now() / 1000);

async function sha256(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function readBody(req) {
  if (+(req.headers.get("content-length") || 0) > 2048) throw new Error("too large");
  const t = await req.text();
  if (t.length > 2048) throw new Error("too large");
  return JSON.parse(t || "{}");
}
async function scoreboard(env, limit = 100) {
  const { results } = await env.DB.prepare(
    "SELECT p.handle, COALESCE(SUM(s.points),0) AS score, COUNT(s.challenge_id) AS solves, MAX(s.ts) AS last " +
    "FROM players p LEFT JOIN solves s ON s.player_id = p.id GROUP BY p.id " +
    "ORDER BY score DESC, last ASC, p.created ASC LIMIT ?").bind(limit).all();
  return results.map(r => ({ handle: r.handle, score: r.score, solves: r.solves }));
}
async function solveCounts(env) {
  const { results } = await env.DB.prepare("SELECT challenge_id, COUNT(*) AS n FROM solves GROUP BY challenge_id").all();
  const m = {}; results.forEach(r => m[r.challenge_id] = r.n); return m;
}

async function register(req, env, origin) {
  const { handle } = await readBody(req);
  const name = String(handle || "").trim().replace(/\s+/g, " ");
  if (!HANDLE.test(name)) return json({ error: "bad_handle" }, 400, origin);
  const token = crypto.randomUUID();
  try {
    await env.DB.prepare("INSERT INTO players (id, handle, created) VALUES (?, ?, ?)").bind(token, name, now()).run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) return json({ error: "handle_taken" }, 409, origin);
    throw e;
  }
  return json({ token, handle: name }, 200, origin);
}

async function me(env, token, origin) {
  const p = token ? await env.DB.prepare("SELECT handle FROM players WHERE id = ?").bind(token).first() : null;
  if (!p) return json({ error: "unknown_token" }, 404, origin);
  const { results } = await env.DB.prepare("SELECT challenge_id, points FROM solves WHERE player_id = ?").bind(token).all();
  const score = results.reduce((a, r) => a + r.points, 0);
  return json({ handle: p.handle, score, solved: results.map(r => r.challenge_id) }, 200, origin);
}

async function submit(req, env, origin) {
  const { token, challenge, flag } = await readBody(req);
  const p = token ? await env.DB.prepare("SELECT id FROM players WHERE id = ?").bind(token).first() : null;
  if (!p) return json({ error: "unknown_token" }, 401, origin);
  const c = CHALLENGES[challenge];
  if (!c) return json({ error: "unknown_challenge" }, 404, origin);
  const att = await env.DB.prepare("SELECT COUNT(*) AS n FROM attempts WHERE player_id = ?").bind(token).first();
  if (att.n >= MAX_ATTEMPTS) return json({ error: "too_many_attempts" }, 429, origin);
  const f = String(flag || "").trim();
  await env.DB.prepare("INSERT INTO attempts (player_id, ts) VALUES (?, ?)").bind(token, now()).run();
  if (!FLAG_RE.test(f)) return json({ correct: false, reason: "format" }, 200, origin);
  const ok = (await sha256(f)) === c.hash;
  if (!ok) return json({ correct: false }, 200, origin);
  const already = await env.DB.prepare("SELECT 1 FROM solves WHERE player_id = ? AND challenge_id = ?").bind(token, challenge).first();
  if (!already) await env.DB.prepare("INSERT INTO solves (player_id, challenge_id, points, ts) VALUES (?, ?, ?, ?)")
    .bind(token, challenge, c.points, now()).run();
  const { results } = await env.DB.prepare("SELECT points FROM solves WHERE player_id = ?").bind(token).all();
  return json({ correct: true, fresh: !already, points: c.points, total: results.reduce((a, r) => a + r.points, 0) }, 200, origin);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname.replace(/\/+$/, ""), origin = req.headers.get("origin") || "";
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    try {
      if (req.method === "GET" && path === "/api/arena/scoreboard")
        return json({ board: await scoreboard(env), solves: await solveCounts(env) }, 200, origin);
      if (req.method === "GET" && path === "/api/arena/me")
        return await me(env, url.searchParams.get("token"), origin);
      if (req.method === "POST") {
        if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: "forbidden" }, 403, origin);
        if (path === "/api/arena/register") return await register(req, env, origin);
        if (path === "/api/arena/submit") return await submit(req, env, origin);
      }
      return json({ error: "not_found" }, 404, origin);
    } catch (e) {
      const bad = e.message === "too large";
      return json({ error: bad ? "too_large" : "server_error" }, bad ? 413 : 500, origin);
    }
  },
};
