// Pelis TV - películas, series y anime en español desde varias fuentes (PelisJuanita, HackStore, FuegoCine, PelisFlix).
// Se ve desde los servidores de cada sitio. No salta captchas ni verificaciones.

const PJ = "https://pelisjuanita.org";
const PJ_API = PJ + "/api/rest/v1";
const HS = "https://hackstore3.net";
const HS_API = HS + "/wp-api/v1";
const FC = "https://www.fuegocine.com";
const PF = "https://pelisflix200.store";
const REF = PJ + "/";
const HOME_ROW = 20;
const PAGE_VIEW = 40;
const MAX_RESULTS = 100;

function log(...args) {
  try { kino.log(...args); } catch { /* el registro no debe romper nada */ }
}

// Textos que lee la persona: español por defecto, inglés si kino.lang es "en-US".
function tr(es, en) {
  return (typeof kino !== "undefined" && kino.lang === "en-US") ? en : es;
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

function stripTags(s) {
  return decodeEntities(String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
}


function attr(tag, name) {
  const a = new RegExp(name + "=([\"'])([^\"']*)\\1", "i").exec(tag);
  return a ? a[2] : "";
}

// ---- Episodios --------------------------------------------------------------------------------

// ---- DoramasYT: episodios y reproducción ------------------------------------------------------


function hostOf(u) {
  const m = /^https?:\/\/([^\/?#]+)/i.exec(String(u || ""));
  return m ? m[1] : "";
}

// Forma de la ruta sin el código: /e/xxxx -> "/e/". Sirve para el registro sin filtrar enlaces.
function pathShape(u) {
  const m = /^https?:\/\/[^\/?#]+(\/[^?#]*)?/i.exec(String(u || ""));
  const p = m && m[1] ? m[1] : "";
  return p.replace(/[A-Za-z0-9_-]{8,}/g, "~").slice(0, 40);
}

function absUrl(u) {
  let x = String(u || "").trim();
  if (x.startsWith("//")) x = "https:" + x;
  return /^https:\/\//i.test(x) ? x : "";
}

// -- Lectura de reproductores embebidos ---------------------------------------------------------
// Muchos reproductores esconden el video: dentro de un script "empaquetado" (eval(function(p,a,c,k,e,d)...)
// o en un texto en base64 (atob). Aquí se desarman, sin ejecutar nada, para buscar el .m3u8 / .mp4.

const MEDIA_RE = /["'`]((?:https?:)?\/\/[^"'`\s<>\\]+?\.(?:m3u8|mp4)(?:\?[^"'`\s<>\\]*)?)["'`]/i;

// Videos de prueba que traen los reproductores y sus librerías (Big Buck Bunny y compañía).
// Nunca son el capítulo: se descartan para no mostrarlos por error.
const DEMO_MEDIA = /big[_-]?buck[_-]?bunny|\bbbb[_-]|sintel|elephants?[_-]?dream|tears[_-]?of[_-]?steel|gtv-videos-bucket|commondatastorage|test-?streams|bitdash|bitmovin|mux\.dev|zencdn|oceans\.mp4|flowplayer\.com|jwplatform|\/samples?\/|(?:googleapis|gstatic|jsdelivr|cdnjs|unpkg)\./i;
// Los enlaces de streamtape.com/e/... son la página del reproductor (no el video) y el sitio responde 403: se descartan.
const isDemo = (u) => DEMO_MEDIA.test(String(u || "")) || /streamtape\.[a-z]+\/e\//i.test(String(u || ""));

function normText(s) {
  return String(s || "").replace(/\\\//g, "/").replace(/\\u0026/gi, "&").replace(/&amp;/g, "&");
}

// Desarma un script empaquetado con el método clásico "p,a,c,k,e,d".
function unpackPacked(src) {
  const re = /\}\s*\(\s*(['"])((?:\\[\s\S]|(?!\1)[^\\])*)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])((?:\\[\s\S]|(?!\5)[^\\])*)\5\s*\.split\(\s*['"]\|['"]\s*\)/;
  const m = re.exec(src);
  if (!m) return null;
  const payload = m[2].replace(/\\(['"\\])/g, "$1").replace(/\\n/g, "\n");
  const radix = Number(m[3]);
  let count = Number(m[4]);
  if (!(radix >= 2 && radix <= 62) || !(count > 0 && count < 100000)) return null;
  const dict = m[6].split("|");
  const enc = (c) => (c < radix ? "" : enc(Math.floor(c / radix))) + ((c = c % radix) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
  const map = {};
  while (count--) map[enc(count)] = dict[count] || enc(count);
  return payload.replace(/\b\w+\b/g, (w) => (map[w] != null ? map[w] : w));
}

function unpackAll(html) {
  const out = [];
  let i = 0;
  while (out.length < 4) {
    const k = html.indexOf("eval(function(p,a,c,k,e", i);
    if (k < 0) break;
    const u = unpackPacked(html.slice(k, k + 80000));
    if (u) out.push(u);
    i = k + 20;
  }
  return out;
}

function base64Texts(html) {
  const out = [];
  const re = /atob\(\s*["']([A-Za-z0-9+\/=_-]{16,})["']\s*\)/g;
  let m;
  while ((m = re.exec(html)) && out.length < 6) {
    try { out.push(atob(m[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch (e) { /* no era base64 */ }
  }
  return out;
}

function findMedia(text) {
  const re = new RegExp(MEDIA_RE.source, "gi");
  const t = normText(text);
  let m;
  while ((m = re.exec(t))) {
    const u = absUrl(m[1]);
    if (u && !isDemo(u)) return u;
    if (u) log("video de muestra descartado: " + hostOf(u) + pathShape(u));
  }
  return "";
}

// Igual, pero sin exigir comillas: el texto que sale de un base64 suele ser el enlace "pelado".
function findMediaLoose(text) {
  const re = /((?:https?:)?\/\/[^\s"'`<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'`<>\\]*)?)/gi;
  const t = normText(text);
  let m;
  while ((m = re.exec(t))) {
    const u = absUrl(m[1]);
    if (u && !isDemo(u)) return u;
    if (u) log("video de muestra descartado: " + hostOf(u) + pathShape(u));
  }
  return "";
}

// Busca el video escrito en la página, en sus scripts empaquetados o en sus textos base64.
function deepMedia(html) {
  let u = findMedia(html);
  if (u) return u;
  for (const t of unpackAll(html)) { u = findMedia(t); if (u) return u; }
  for (const t of base64Texts(html)) { u = findMediaLoose(t); if (u) return u; }
  return "";
}

const SKIP_HOST = /(google|gstatic|facebook|doubleclick|googletagmanager|cloudflare|jsdelivr|cdnjs|jquery|bootstrap|fontawesome|histats|yandex)/i;

// Enlaces a otras páginas de reproductor que esta página abre o inserta (iframes y textos de script).
function embedLinks(html, base) {
  const texts = [html].concat(unpackAll(html), base64Texts(html));
  const out = [];
  const add = (u) => {
    const a = absUrl(u);
    if (!a || a === base || out.indexOf(a) >= 0) return;
    if (SKIP_HOST.test(hostOf(a))) return;
    if (/\.(?:js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf)(\?|$)/i.test(a)) return;
    out.push(a);
  };
  const decoded = base64Texts(html);
  for (const raw of texts) {
    const t = normText(raw);
    const fr = /<iframe[^>]*src=["']([^"']+)["']/gi;
    let f;
    while ((f = fr.exec(t))) add(f[1]);
    const ur = /["'`]((?:https?:)?\/\/[^"'`\s<>\\]+)["'`]/g;
    let u;
    while ((u = ur.exec(t))) {
      if (/\/(?:e|embed|v|f|play|player|stream|d)\/[A-Za-z0-9_-]{6,}/i.test(u[1])) add(u[1]);
    }
  }
  // Lo que sale de un base64 suele ser el enlace "pelado", sin comillas.
  for (const raw of decoded) {
    const bare = /(?:https?:)?\/\/[^\s"'`<>\\]+/g;
    let b;
    while ((b = bare.exec(normText(raw)))) add(b[0]);
  }
  return out.slice(0, 4);
}

function redact(s) {
  return String(s || "")
    .replace(/https?:\/\/[^\s"'<>]+/g, (u) => hostOf(u) + pathShape(u))
    .replace(/[A-Za-z0-9+\/=_-]{16,}/g, "~")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

// Radiografía de una página de reproductor para el registro (sin códigos ni enlaces completos).
function diag(html, depth, found) {
  const title = /<title[^>]*>([^<]*)/i.exec(html);
  const scripts = [];
  const sre = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let s;
  while ((s = sre.exec(html))) scripts.push({ attrs: s[1], body: s[2] });
  const ext = scripts.map((x) => attr("<s " + x.attrs + ">", "src")).filter(Boolean).map((x) => hostOf(absUrl(x))).filter(Boolean);
  const inline = scripts.filter((x) => x.body.trim()).sort((a, b) => b.body.length - a.body.length);
  const links = embedLinks(html, "").map((u) => hostOf(u) + pathShape(u));
  log("embed[" + depth + "] bytes=" + html.length + " titulo=" + (title ? title[1].trim().slice(0, 40) : "-") +
    " video=" + (found ? "si" : "no") + " packed=" + unpackAll(html).length + " atob=" + base64Texts(html).length +
    " tagVideo=" + /<video[\s>]/i.test(html) + " iframes=" + (html.split("<iframe").length - 1) +
    " scriptsExt=" + ext.slice(0, 4).join(",") + " scriptsInline=" + inline.length + " enlaces=" + links.join(","));
  if (!found && inline.length) log("embed[" + depth + "] script mayor: " + redact(inline[0].body));
}

// Lee la página de un reproductor y busca el video; si no está, sigue los reproductores que esa
// página abre (hasta 2 niveles), porque el de TuDorama suele ser solo una envoltura.
const innerHosts = new Map(); // envoltura -> a qué reproductores apunta

// ok.ru guarda el video en un bloque de datos de su página ("hlsManifestUrl" o la lista de calidades).
function okruMedia(html) {
  const t = String(html || "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const clean = (u) => String(u).replace(/\\+u0026/gi, "&").replace(/\\+\//g, "/");
  for (const key of ["hlsManifestUrl", "ondemandHls", "hlsMasterPlaylistUrl"]) {
    const m = new RegExp('\\\\*"' + key + '\\\\*"\\s*:\\s*\\\\*"(https?:[^"]*?)\\\\*"').exec(t);
    if (m) return clean(m[1]);
  }
  const order = ["ultra", "quad", "full", "hd", "sd", "low", "lowest", "mobile"];
  let best = "", bestRank = 99;
  const re = /\\*"name\\*"\s*:\s*\\*"([a-z]+)\\*"\s*,\s*\\*"url\\*"\s*:\s*\\*"(https?:[^"]*?)\\*"/g;
  let m;
  while ((m = re.exec(t))) { const i = order.indexOf(m[1]); const rk = i < 0 ? 50 : i; if (rk < bestRank) { bestRank = rk; best = clean(m[2]); } }
  return best;
}

async function embedFromHtml(embedUrl, depth, referer) {
  const d = depth || 0;
  const r = await kino.fetch(embedUrl, { headers: { Referer: referer || REF } });
  log("embed[" + d + "] " + hostOf(embedUrl) + pathShape(embedUrl) + " status=" + r.status);
  if (!r.ok) return null;
  let html = await r.text();
  let u = deepMedia(html);
  if (!u && /(^|\.)ok\.ru$/i.test(hostOf(embedUrl))) { u = okruMedia(html); if (u) log("ok.ru: video encontrado"); }
  if (d === 0) innerHosts.set(embedUrl, embedLinks(html, embedUrl).map(hostOf));
  // Una página diminuta, sin video ni enlaces, suele ser una pantalla de comprobación del servidor:
  // con la cookie que acaba de dejar, el segundo intento trae la página real. Un solo reintento.
  if (!u && d >= 1 && html.length < 3000 && !/byse/i.test(hostOf(embedUrl)) && !embedLinks(html, embedUrl).length) {
    log("embed[" + d + "] página diminuta (" + html.length + " bytes): reintento");
    if (typeof kino.sleep === "function") await kino.sleep(900);
    const r2 = await kino.fetch(embedUrl, { headers: { Referer: referer || REF } });
    if (r2.ok) {
      const h2 = await r2.text();
      if (h2.length > html.length) { html = h2; u = deepMedia(html); }
    }
  }
  diag(html, d, !!u);
  if (u) {
    log("embed[" + d + "] video elegido: " + hostOf(u) + pathShape(u));
    return { url: u, mime: /\.m3u8/i.test(u) ? "application/x-mpegurl" : "video/mp4", headers: { Referer: embedUrl } };
  }
  if (d >= 2) return null;
  const links = embedLinks(html, embedUrl).filter((l) => !/byse/i.test(hostOf(l))).slice(0, d === 0 ? 3 : 2);
  for (const l of links) {
    try {
      const got = await embedFromHtml(l, d + 1, embedUrl);
      if (got) return got;
    } catch (e) {
      log("embed[" + (d + 1) + "] falló: " + String((e && e.message) || e).slice(0, 60));
    }
  }
  return null;
}

async function captureEmbed(embedUrl, ms) {
  if (typeof kino === "undefined" || !kino.browser || typeof kino.browser.capture !== "function") return null;
  const page = await kino.browser.capture(embedUrl, { timeoutMs: ms, headers: { Referer: REF } });
  const media = page && Array.isArray(page.media) ? page.media : [];
  const first = media.find((x) => x && typeof x.url === "string" && /^https?:\/\//.test(x.url) && !isDemo(x.url));
  if (!first) return null;
  const out = { url: first.url, mime: first.mime || first.mimeType || (/\.m3u8(\?|$)/i.test(first.url) ? "application/x-mpegurl" : "video/mp4") };
  if (first.headers && typeof first.headers === "object") out.headers = first.headers;
  return out;
}

// Devuelve el primer resultado que llegue (no el último): { v, i } o null si ninguno entrega nada.
function firstSuccess(tasks) {
  return new Promise((resolveAll) => {
    let pending = tasks.length;
    if (!pending) { resolveAll(null); return; }
    tasks.forEach((t, i) => {
      Promise.resolve(t).then((v) => { if (v) resolveAll({ v, i }); }, () => {}).then(() => {
        pending--;
        if (pending === 0) resolveAll(null);
      });
    });
  });
}

// ---- Lectura de los sitios ----------------------------------------------------------------------

async function getText(url, headers) {
  let r;
  try {
    r = await kino.fetch(url, headers ? { headers } : undefined);
  } catch (e) {
    log("fetch falló " + hostOf(url) + ": " + String((e && e.message) || e).slice(0, 80));
    throw kino.error("unavailable", "fetch falló", {
      userMessage: tr("No se pudo abrir el sitio. Prueba de nuevo en un momento.", "Could not open the site. Try again in a moment."),
    });
  }
  if (!r.ok) {
    log("fetch " + hostOf(url) + pathShape(url) + " status=" + r.status);
    const um = { userMessage: tr("El sitio respondió con el error " + r.status + ".", "The site answered with error " + r.status + ".") };
    if (r.status === 404) throw kino.error("not_found", "el sitio respondió 404", um);
    if (r.status === 429) throw kino.error("rate_limited", "el sitio respondió 429", um);
    throw kino.error("unavailable", "el sitio respondió " + r.status, um);
  }
  return r.text();
}

async function getJson(url, referer) {
  const t = await getText(url, { Accept: "application/json, text/plain, */*", Referer: referer || REF });
  try { return JSON.parse(t); } catch (e) {
    log("json inválido " + hostOf(url) + pathShape(url) + " inicio=" + redact(t.slice(0, 120)));
    throw kino.error("unavailable", "respuesta no válida", { userMessage: tr("El sitio respondió algo inesperado.", "The site answered something unexpected.") });
  }
}

const enc = encodeURIComponent;
const dec = (s) => { try { return decodeURIComponent(s); } catch (e) { return String(s || ""); } };

function tmdbPoster(p) {
  if (!p) return undefined;
  p = String(p);
  if (p.charAt(0) === "/") return "https://image.tmdb.org/t/p/w342" + p;
  return /^https?:\/\//i.test(p) ? p : undefined;
}

function mkItem(src, kind, key, title, poster, year) {
  const t = stripTags(title);
  if (!t) return null;
  return {
    id: src + "-" + String(key).replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 80),
    ref: src + "|" + (kind === "movie" ? "m" : kind === "anime" ? "a" : "s") + "|" + key,
    title: t.slice(0, 200),
    kind: kind === "movie" ? "movie" : "series",
    genres: [kind === "movie" ? "peliculas" : "series"],
    poster: poster || undefined,
    year: /^\d{4}$/.test(String(year || "")) ? Number(year) : undefined,
  };
}

// ---- PelisJuanita (pj) ----
// ref: pj|<m|s|a>|<id>|<slug>
function pjItem(o, kind) {
  if (!o) return null;
  const id = o.catalog_item_id || o.id || o.tmdb_id;
  if (!id) return null;
  const raw = o.kind || kind;
  const k = raw === "movie" ? "movie" : raw === "anime" ? "anime" : "series";
  const year = o.year || String(o.release_date || "").slice(0, 4);
  return mkItem("pj", k, id + "|" + enc(o.slug || ""), o.title || o.name || o.original_title, tmdbPoster(o.poster_path), year);
}

async function pjPage(kind, n) {
  const apiKind = kind === "movie" ? "movie" : kind === "anime" ? "anime" : "serie";
  const d = await getJson(PJ_API + "/listing?kind=" + apiKind + "&order=recent&page=" + n, PJ + "/");
  const raw = d.items || [];
  const items = raw.map((x) => pjItem(x, kind)).filter(Boolean);
  const p = d.pagination || {};
  return { items, hasNext: p.has_next !== undefined ? !!p.has_next : raw.length >= 24 };
}

async function pjSearch(q) {
  const d = await getJson(PJ_API + "/search?q=" + enc(q), PJ + "/");
  return (d.items || []).map((x) => pjItem(x)).filter(Boolean);
}

async function pjEpisodes(kind, id, slug) {
  const apiKind = kind === "a" ? "anime" : "serie";
  const det = slug ? await getJson(PJ_API + "/content/" + apiKind + "/" + enc(slug), PJ + "/") : {};
  const info = det.item || {};
  const title = stripTags(info.title || info.name || slug.replace(/-/g, " "));
  let seasons = (det.episode_seasons || []).map((s) => s && s.season).filter((x) => typeof x === "number");
  if (!seasons.length) seasons = [1];
  const out = [];
  const one = async (s) => {
    for (let page = 1; page <= 4; page++) {
      const d = await getJson(PJ_API + "/episodes?item_id=" + id + "&season=" + s + "&limit=50&page=" + page, PJ + "/");
      const eps = d.episodes || [];
      for (const e of eps) {
        const num = Number(e.episode) || out.length + 1;
        out.push({ season: s, number: num, ref: "pj|e|" + enc(e.player_url || "") + "|" + enc(slug) + "|" + (kind === "a" ? "anime" : "serie") + "|" + id, title: stripTags(e.title) || tr("Episodio ", "Episode ") + num, poster: tmdbPoster(e.still_path) });
      }
      if (eps.length < 50) break;
    }
  };
  await Promise.allSettled(seasons.slice(0, 8).map(one));
  log("pj episodios: " + out.length);
  return { series: { title }, episodes: out };
}

async function pjCandidates(spec) {
  const p = spec.split("|");
  let player = "";
  let label = "PelisJuanita";
  if (p[0] === "e") player = dec(p[1]);
  else {
    // película: pj|m|id|slug
    const slug = dec(p[2] || "");
    const det = await getJson(PJ_API + "/content/movie/" + enc(slug), PJ + "/");
    player = (det.item && det.item.player_url) || "";
  }
  if (!player) throw kino.error("unavailable", "sin player_url", { userMessage: tr("Este título no trae servidores disponibles.", "This title has no servers available.") });
  const html = await getText(absUrl(player), { Referer: PJ + "/" });
  const out = [];
  const re = /<iframe[^>]*src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) { const u = absUrl(decodeEntities(m[1])); if (u) out.push({ url: u, label, referer: player }); }
  log("pj servidores: " + out.map((x) => hostOf(x.url)).join(","));
  return out;
}

// ---- HackStore (hs) ----
// ref: hs|<m|s|a>|<id>|<slug>   episodio: hs|e|<epId>
function hsItem(o, hint) {
  if (!o) return null;
  const id = o._id || o.id || o.tmdb_id;
  if (typeof id !== "number") return null;
  const raw = String(o.type || o.postType || hint || "movies");
  const k = raw.indexOf("movie") >= 0 ? "movie" : raw.indexOf("anime") >= 0 ? "anime" : "series";
  const img = o.images || {};
  let poster = img.poster || o.poster || "";
  poster = poster && poster.charAt(0) === "/" ? HS + "/wp-content/uploads" + poster : /^https?:/i.test(poster) ? poster : "";
  const year = o.release_date ? String(o.release_date).split("-")[0] : Array.isArray(o.years) ? o.years[0] : "";
  return mkItem("hs", k, id + "|" + enc(o.slug || ""), o.title || o.original_title, poster, year);
}

async function hsPage(kind, n) {
  const type = kind === "movie" ? "movies" : kind === "anime" ? "animes" : "tvshows";
  const d = await getJson(HS_API + "/listing/" + type + "?page=" + n + "&orderBy=latest&order=desc&postType=" + type + "&postsPerPage=24", HS + "/");
  const data = d.data || {};
  const raw = data.posts || [];
  const pg = data.pagination || {};
  return { items: raw.map((x) => hsItem(x, kind)).filter(Boolean), hasNext: pg.totalPages !== undefined ? n < pg.totalPages : raw.length >= 24 };
}

async function hsSearch(q) {
  const d = await getJson(HS_API + "/search?q=" + enc(q) + "&postType=any&postsPerPage=24", HS + "/");
  return ((d.data || {}).posts || []).map((x) => hsItem(x)).filter(Boolean);
}

async function hsEpisodes(id, slug) {
  const title = stripTags(String(slug || "").replace(/-/g, " "));
  const first = await getJson(HS_API + "/single/episodes/list?_id=" + id + "&season=1&page=1&postsPerPage=50", HS + "/");
  let seasons = (((first.data || {}).seasons) || ["1"]).map((s) => String(s)).filter((s) => /^\d+$/.test(s));
  if (seasons.indexOf("1") < 0) seasons.unshift("1");
  const out = [];
  const one = async (s) => {
    const d = s === "1" ? first : await getJson(HS_API + "/single/episodes/list?_id=" + id + "&season=" + s + "&page=1&postsPerPage=50", HS + "/");
    for (const e of (d.data || {}).posts || []) {
      const eid = e._id || e.id;
      if (!eid) continue;
      const num = Number(e.episode_number) || out.length + 1;
      out.push({ season: Number(s), number: num, ref: "hs|e|" + eid, title: stripTags(e.title) || tr("Episodio ", "Episode ") + num, poster: tmdbPoster(e.still_path) });
    }
  };
  await Promise.allSettled(seasons.slice(0, 8).map(one));
  log("hs episodios: " + out.length);
  return { series: { title }, episodes: out };
}

async function hsCandidates(spec) {
  const p = spec.split("|");
  const postId = p[0] === "e" ? p[1] : p[1];
  const d = await getJson(HS_API + "/player?postId=" + postId + "&demo=0", HS + "/");
  const out = [];
  for (const e of (d.data || {}).embeds || []) {
    const u = absUrl(e.url);
    if (!u || /la\.movie/i.test(u)) continue;
    const lang = String(e.lang || "");
    out.push({ url: u, label: (e.serverName || e.server || "Servidor") + (lang ? " · " + lang : ""), referer: HS + "/" });
  }
  log("hs servidores: " + out.map((x) => hostOf(x.url)).join(","));
  return out;
}

// ---- FuegoCine (fc) ----
// ref: fc|<m|s|a>|<ruta>
async function fcFeed(label, q, start, limit) {
  const path = label ? "/feeds/posts/default/-/" + enc(label) : "/feeds/posts/default";
  let url = FC + path + "?alt=json&start-index=" + start + "&max-results=" + limit;
  if (q) url += "&q=" + enc(q);
  const d = await getJson(url, FC + "/");
  return d.feed || {};
}

function fcAttr(src, name) {
  const m = new RegExp("\\b" + name + "=['\"]([^'\"]*)['\"]", "i").exec(src);
  return m ? decodeEntities(m[1]) : "";
}

function fcItem(e) {
  const labels = (e.category || []).map((x) => x.term || "");
  if (labels.indexOf("Episode") >= 0) return null;
  const link = (e.link || []).find((x) => x.rel === "alternate");
  const url = link ? link.href : "";
  if (!url || hostOf(url) !== "www.fuegocine.com") return null;
  const content = (e.content && e.content.$t) || "";
  const cov = /<div\b[^>]*data-post-type=['"][^'"]+['"][^>]*>\s*<img\b[^>]*>/i.exec(content);
  const poster = cov ? fcAttr(cov[0], "src") : (e["media$thumbnail"] && e["media$thumbnail"].url) || "";
  const title = decodeEntities((e.title && e.title.$t) || "");
  const year = fcAttr(content, "data-year") || ((/\((\d{4})\)/.exec(title) || [])[1] || "");
  const pt = (/data-post-type=['"]([^'"]+)['"]/i.exec(content) || [])[1] || "";
  let kind = "movie";
  const ptl = pt.toLowerCase();
  if (ptl === "serie") kind = "series";
  else if (ptl === "movie") kind = "movie";
  else if (labels.indexOf("Serie") >= 0 || /temporadas/i.test(title)) kind = "series";
  if (labels.indexOf("Anime") >= 0 && kind === "series") kind = "anime";
  return mkItem("fc", kind, enc(url.slice(FC.length)), title.replace(/\s*\(\d{4}\)\s*$/, ""), poster, year);
}

async function fcPage(label, n) {
  const feed = await fcFeed(label, "", (n - 1) * 20 + 1, 20);
  const entries = feed.entry || [];
  return { items: entries.map(fcItem).filter(Boolean), hasNext: entries.length >= 20 };
}

async function fcSearch(q) {
  const feed = await fcFeed("", q, 1, 30);
  return (feed.entry || []).map(fcItem).filter(Boolean);
}

async function fcEpisodes(path) {
  const url = FC + path;
  const html = await getText(url, { Referer: FC + "/" });
  const pid = (/<article\b[^>]*data-post-id=['"](\d+)['"]/i.exec(html) || [])[1];
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const title = h1 ? stripTags(h1[1]) : "";
  if (!pid) throw kino.error("not_found", "sin id de la serie", { userMessage: tr("No se encontró la lista de capítulos.", "No episode list found.") });
  const out = [];
  let start = 1;
  while (start <= 450) {
    const entries = (await fcFeed("id-" + pid, "", start, 150)).entry || [];
    if (!entries.length) break;
    for (const e of entries) {
      const body = (e.content && e.content.$t) || "";
      let season = fcAttr(body, "data-season-number");
      let ep = fcAttr(body, "data-episode-count");
      if (!season || !ep) {
        const nm = /(\d+)\s*x\s*(\d+)/i.exec((e.title && e.title.$t) || "");
        if (nm) { season = nm[1]; ep = nm[2]; }
      }
      const link = (e.link || []).find((x) => x.rel === "alternate");
      if (!season || !ep || !link) continue;
      out.push({ season: Number(season), number: Number(ep), ref: "fc|e|" + enc(link.href.slice(FC.length)), title: stripTags((e.title && e.title.$t) || "") || tr("Episodio ", "Episode ") + ep, poster: fcAttr(body, "data-backdrop") || undefined });
    }
    start += entries.length;
    if (entries.length < 150) break;
  }
  log("fc episodios: " + out.length);
  return { series: { title }, episodes: out };
}

async function fcCandidates(path) {
  const html = await getText(FC + path, { Referer: FC + "/" });
  const m = /\bconst\s+_SV_LINKS\s*=\s*\[([\s\S]*?)\]\s*;?/i.exec(html);
  if (!m) throw kino.error("unavailable", "sin _SV_LINKS", { userMessage: tr("Este título no trae servidores disponibles.", "This title has no servers available.") });
  const out = [];
  const bre = /\{([^{}]*)\}/g;
  let b;
  while ((b = bre.exec(m[1]))) {
    const v = {};
    const kre = /\b(lang|name|quality|url)\s*:\s*['"]([^'"]*)['"]/gi;
    let k;
    while ((k = kre.exec(b[1]))) v[k[1].toLowerCase()] = decodeEntities(k[2]);
    let u = absUrl(v.url);
    if (!u || /drive\.google|drive\.usercontent/i.test(u)) continue;
    const inner = /[?&]link=([^&]+)/i.exec(u);
    if (/repfuegocinefree/i.test(u) && inner) u = absUrl(dec(inner[1])) || u;
    out.push({ url: u, label: ((v.name || hostOf(u)) + (v.lang ? " · " + v.lang : "")).trim(), referer: FC + "/" });
  }
  log("fc servidores: " + out.map((x) => hostOf(x.url)).join(","));
  return out;
}

// ---- PelisFlix (pf) ----
// ref: pf|<m|s>|<ruta>
function pfCards(html) {
  const out = [];
  const re = /<article[^>]*>([\s\S]*?)<\/article>/gi;
  let a;
  while ((a = re.exec(html))) {
    const art = a[1];
    const u = /<a\s+[^>]*href="([^"]+)"/i.exec(art);
    const t = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/i.exec(art) || /alt="([^"]+)"/i.exec(art);
    const im = /<img\s+[^>]*data-src="([^"]+)"/i.exec(art) || /<img\s+[^>]*src="([^"]+)"/i.exec(art);
    if (!u || !t) continue;
    let url = u[1];
    if (url.charAt(0) === "/") url = PF + url;
    if (hostOf(url) !== hostOf(PF)) continue;
    const serie = /\/(serie|episodio|temporada)\//.test(url);
    let poster = im ? im[1] : "";
    if (poster.charAt(0) === "/") poster = PF + poster;
    const it = mkItem("pf", serie ? "series" : "movie", enc(url.slice(PF.length)), t[1], /^https?:/i.test(poster) ? poster : "", "");
    if (it) out.push(it);
  }
  return out;
}

async function pfPage(kind, n) {
  const base = kind === "movie" ? "/peliculas" : "/series";
  const html = await getText(PF + base + (n > 1 ? "/page/" + n + "/" : ""), { Referer: PF + "/" });
  return { items: pfCards(html).filter((x) => (kind === "movie") === (x.kind === "movie")), hasNext: html.indexOf("/page/" + (n + 1) + "/") >= 0 };
}

async function pfSearch(q) {
  return pfCards(await getText(PF + "/?s=" + enc(q), { Referer: PF + "/" }));
}

async function pfEpisodes(path) {
  const html = await getText(PF + path, { Referer: PF + "/" });
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const title = h1 ? stripTags(h1[1]) : "";
  const seasonUrls = [];
  const sre = /<a\s+[^>]*href="([^"]+\/temporada\/[^"]+)"/gi;
  let s;
  while ((s = sre.exec(html))) { const u = s[1].charAt(0) === "/" ? PF + s[1] : s[1]; if (seasonUrls.indexOf(u) < 0) seasonUrls.push(u); }
  const pages = seasonUrls.length ? seasonUrls.slice(0, 8) : [PF + path];
  const out = [];
  const seen = new Set();
  await Promise.allSettled(pages.map(async (u) => {
    const h = u === PF + path ? html : await getText(u, { Referer: PF + "/" });
    const re = /<a\s+[^>]*href="([^"]+\/episodio\/[^"]+-(\d+)x(\d+)\/?)"/gi;
    let m;
    while ((m = re.exec(h))) {
      const url = m[1].charAt(0) === "/" ? PF + m[1] : m[1];
      if (hostOf(url) !== hostOf(PF) || seen.has(url)) continue;
      seen.add(url);
      out.push({ season: Number(m[2]), number: Number(m[3]), ref: "pf|e|" + enc(url.slice(PF.length)), title: m[2] + "x" + m[3] });
    }
  }));
  log("pf episodios: " + out.length);
  return { series: { title }, episodes: out };
}

async function pfCandidates(path) {
  const html = await getText(PF + path, { Referer: PF + "/" });
  const out = [];
  const seen = new Set();
  const add = (u, label) => { u = absUrl(u); if (u && !seen.has(u) && hostOf(u).indexOf("pelisflix") < 0) { seen.add(u); out.push({ url: u, label: label || hostOf(u), referer: PF + "/" }); } };
  const dre = /data-url="([^"]+)"/gi;
  let d;
  while ((d = dre.exec(html))) {
    try {
      const raw = d[1].replace(/-/g, "+").replace(/_/g, "/");
      const txt = atob(raw + "=".repeat((4 - (raw.length % 4)) % 4));
      const q = /[?&]url=([^&]+)/i.exec(txt);
      if (/nupload\.my/i.test(txt) && q) add(dec(q[1]));
    } catch (e) { /* no era base64 */ }
  }
  const fre = /<iframe[^>]*src="([^"]+)"/gi;
  let f;
  while ((f = fre.exec(html))) add(decodeEntities(f[1]));
  log("pf servidores: " + out.map((x) => hostOf(x.url)).join(","));
  return out;
}

// ---- PoseidonHD (po) y Cuevana (cu): mismo motor (datos __NEXT_DATA__) ----
// ref: po|<m|s>|<ruta>   episodio: po|e|<ruta>      (igual para cu)
const PO = "https://www.poseidonhd2.co";
const CU = "https://wv3.cuevana3.eu";
const PP = "https://www.pelisplushd.la";
const NX = { po: { base: PO, mv: "/pelicula/", sr: "/serie/", name: "Poseidon" }, cu: { base: CU, mv: "/ver-pelicula/", sr: "/ver-serie/", name: "Cuevana" } };

function nextProps(html) {
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html || "");
  if (!m) return null;
  try { const d = JSON.parse(m[1]); return (d && d.props && d.props.pageProps) || null; } catch (e) { return null; }
}

function humanSlug(slug) {
  return String(slug || "").replace(/-[A-Za-z0-9]{5,8}$/, (x) => (/\d/.test(x) ? "" : x)).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function nxItem(src, o, kind) {
  const slug = o && o.url && o.url.slug;
  if (!slug) return null;
  const last = String(slug).replace(/^\/+|\/+$/g, "").split("/").pop();
  const t = (o.titles && (o.titles.name || o.titles.original)) || o.title || o.name || humanSlug(last);
  const img = o.images || {};
  const year = String(o.releaseDate || o.release_date || "").slice(0, 4);
  return mkItem(src, kind, enc(NX[src][kind === "movie" ? "mv" : "sr"] + last), t, tmdbPoster(img.poster || img.backdrop || o.poster), year);
}

async function nxSearch(src, q) {
  const cfg = NX[src];
  const html = await getText(cfg.base + "/search?q=" + enc(q), { Referer: cfg.base + "/" });
  const pp = nextProps(html);
  const out = [];
  if (pp) {
    for (const [arr, kind] of [[pp.movies, "movie"], [pp.series, "series"]]) {
      for (const o of Array.isArray(arr) ? arr : []) { const it = nxItem(src, o, kind); if (it) out.push(it); }
    }
  }
  if (!out.length) {
    const seen = new Set();
    for (const [pref, kind] of [[cfg.mv, "movie"], [cfg.sr, "series"]]) {
      const re = new RegExp("href=[\"'](" + pref.replace(/\//g, "\\/") + "[^\"'?#]+)", "gi");
      let m;
      while ((m = re.exec(html))) {
        const path = m[1].replace(/\/+$/, "");
        if (seen.has(path)) continue;
        seen.add(path);
        const it = mkItem(src, kind, enc(path), humanSlug(path.split("/").pop()), "", "");
        if (it) out.push(it);
      }
    }
  }
  log(cfg.name + " búsqueda: " + out.length + (pp ? " (datos)" : " (html)"));
  return out;
}

function findSeasons(o, depth) {
  if (!o || typeof o !== "object" || depth > 5) return null;
  if (Array.isArray(o.seasons) && o.seasons.length) return o.seasons;
  for (const k of Object.keys(o)) { const r = findSeasons(o[k], depth + 1); if (r) return r; }
  return null;
}

async function nxEpisodes(src, path) {
  const cfg = NX[src];
  const html = await getText(cfg.base + path, { Referer: cfg.base + "/" });
  const pp = nextProps(html);
  const slug = path.split("/").pop();
  const meta = (pp && (pp.thisSerie || pp.serie)) || {};
  const title = stripTags((meta.titles && meta.titles.name) || meta.title || humanSlug(slug));
  const seasons = findSeasons(pp, 0) || [];
  const out = [];
  for (const s of seasons) {
    const sn = Number(s.number || s.season);
    if (!sn) continue;
    for (const e of s.episodes || []) {
      const en = Number(e.number || e.episode);
      if (!en) continue;
      const ep = src === "po" ? path + "/temporada/" + sn + "/episodio/" + en : "/episodio/" + slug + "-temporada-" + sn + "-episodio-" + en;
      out.push({ season: sn, number: en, ref: src + "|e|" + enc(ep), title: stripTags(e.title || e.name) || tr("Episodio ", "Episode ") + en, poster: tmdbPoster(e.image || e.still_path) });
    }
  }
  log(cfg.name + " episodios: " + out.length + (pp ? "" : " (sin datos)"));
  return { series: { title }, episodes: out };
}

async function nxCandidates(src, path, isEp) {
  const cfg = NX[src];
  const html = await getText(cfg.base + path, { Referer: cfg.base + "/" });
  const pp = nextProps(html) || {};
  const obj = isEp ? pp.episode : pp.thisMovie;
  const videos = (obj && obj.videos) || {};
  const out = [];
  for (const lang of Object.keys(videos)) {
    const lr = lang === "latino" ? 0 : lang === "spanish" ? 1 : 2;
    const nice = lang === "latino" ? "Latino" : lang === "spanish" ? "Castellano" : tr("Subtitulado", "Subbed");
    for (const s of Array.isArray(videos[lang]) ? videos[lang] : []) {
      const u = absUrl(s && s.result);
      if (u) out.push({ url: u, label: nice + " · " + String(s.cyberlocker || hostOf(u)), referer: cfg.base + "/", lang: lr });
    }
  }
  log(cfg.name + " servidores: " + out.map((x) => hostOf(x.url)).join(","));
  return out;
}

// ---- PelisPlusHD (pp): solo películas ----
// ref: pp|m|<ruta>
async function ppSearch(q) {
  const html = await getText(PP + "/search?s=" + enc(q), { Referer: PP + "/" });
  const out = [];
  const seen = new Set();
  const re = /<a[^>]+href=["'](\/pelicula\/[^"'?#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const path = m[1].replace(/\/+$/, "");
    const inner = m[2];
    const im = /<img[^>]*(?:data-src|src)=["']([^"']+)["']/i.exec(inner);
    const t = /<img[^>]*alt=["']([^"']+)["']/i.exec(inner) || /<h\d[^>]*>([\s\S]*?)<\/h\d>/i.exec(inner);
    if (seen.has(path)) continue;
    seen.add(path);
    let poster = im ? absUrl(im[1].charAt(0) === "/" && im[1].charAt(1) !== "/" ? PP + im[1] : im[1]) : "";
    const it = mkItem("pp", "movie", enc(path), t ? t[1] : humanSlug(path.split("/").pop()), poster, "");
    if (it) out.push(it);
  }
  return out;
}

async function ppCandidates(path) {
  const html = await getText(PP + path, { Referer: PP + "/" });
  const out = [];
  const re = /<li[^>]+data-url=["']([^"']+)["'][^>]*data-name=["']([^"']*)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const u = absUrl(decodeEntities(m[1]));
    if (!u) continue;
    const ln = m[2].toLowerCase();
    out.push({ url: u, label: "PelisPlus · " + (/lat/.test(ln) ? "Latino" : /esp|cast/.test(ln) ? "Castellano" : tr("Subtitulado", "Subbed")), referer: PP + "/", lang: /lat/.test(ln) ? 0 : /esp|cast/.test(ln) ? 1 : 2 });
  }
  if (!out.length) {
    const re2 = /data-url=["']([^"']+)["']/gi;
    while ((m = re2.exec(html))) { const u = absUrl(decodeEntities(m[1])); if (u) out.push({ url: u, label: "PelisPlus", referer: PP + "/", lang: 0 }); }
  }
  log("pp servidores: " + out.map((x) => hostOf(x.url)).join(","));
  return out;
}

// ---- TioPlus (tp), CineCalidad (cc, solo películas) y SeriesMetro (sm, series subtituladas) ----
// ref: <fuente>|<m|s>|<ruta>   episodio: <fuente>|e|<ruta>
const TP = "https://tioplus.app";
const CC = "https://www.cinecalidad.am";
const SM = "https://www3.seriesmetro.net";

// Tarjetas: enlaces cuya ruta empieza por [pref]; título e imagen salen de lo que haya dentro del enlace.
function linkCards(html, base, pref, src, kind) {
  const out = [];
  const seen = new Set();
  const esc = pref.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
  const re = new RegExp("<a[^>]+href=[\"'](?:" + base.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&") + ")?(" + esc + "[^\"'?#]+)[\"'][^>]*>([\\s\\S]*?)<\\/a>", "gi");
  let m;
  while ((m = re.exec(html))) {
    const path = m[1].replace(/\/+$/, "");
    if (seen.has(path)) continue;
    const inner = m[2];
    const im = /<img[^>]*(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i.exec(inner);
    const t = /<img[^>]*alt=["']([^"']+)["']/i.exec(inner) || /<h\d[^>]*>([\s\S]*?)<\/h\d>/i.exec(inner) || /title=["']([^"']+)["']/i.exec(m[0]);
    seen.add(path);
    let poster = im ? im[1] : "";
    if (poster.charAt(0) === "/" && poster.charAt(1) !== "/") poster = base + poster;
    const it = mkItem(src, kind, enc(path), t ? t[1] : humanSlug(path.split("/").pop()), absUrl(poster), "");
    if (it) out.push(it);
  }
  return out;
}

async function tpSearch(q) {
  const html = await getText(TP + "/search/" + enc(q), { Referer: TP + "/" });
  if (/No hay resultados/i.test(html)) return [];
  return linkCards(html, TP, "/pelicula/", "tp", "movie").concat(linkCards(html, TP, "/serie/", "tp", "series")).filter((x) => x.ref.split("|").length === 3 && x.ref.split("|")[2].split("%2F").length <= 3);
}

async function tpEpisodes(path) {
  const html = await getText(TP + path, { Referer: TP + "/" });
  const slug = path.split("/").pop();
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const out = [];
  const seen = new Set();
  const re = new RegExp("/serie/" + slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/season/(\\d+)/episode/(\\d+)", "gi");
  let m;
  while ((m = re.exec(html))) {
    const k = m[1] + "x" + m[2];
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ season: Number(m[1]), number: Number(m[2]), ref: "tp|e|" + enc(path + "/season/" + m[1] + "/episode/" + m[2]), title: m[1] + "x" + m[2] });
  }
  log("TioPlus episodios: " + out.length);
  return { series: { title: h1 ? stripTags(h1[1]) : humanSlug(slug) }, episodes: out };
}

async function tpCandidates(path) {
  const url = TP + path;
  const html = await getText(url, { Referer: TP + "/" });
  const items = [];
  const re = /<li[^>]*data-server=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = re.exec(html)) && items.length < 6) items.push({ tok: m[1], label: stripTags(m[2]).replace(/Reproducir/gi, "").trim() });
  const res = await Promise.allSettled(items.map(async (it) => {
    const t = await getText(TP + "/player/" + btoa(it.tok), { Referer: url });
    const d = /window\.location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i.exec(t) || /<iframe[^>]+src=['"]([^'"]+)['"]/i.exec(t);
    const u = d ? absUrl(decodeEntities(d[1])) : "";
    return u ? { url: u, label: "TioPlus · " + (it.label || hostOf(u)), referer: TP + "/", lang: 0 } : null;
  }));
  const out = res.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value);
  log("TioPlus servidores: " + out.map((x) => hostOf(x.url)).join(","));
  return out;
}

async function ccSearch(q) {
  const html = await getText(CC + "/?s=" + enc(q), { Referer: CC + "/" });
  return linkCards(html, CC, "/ver-pelicula/", "cc", "movie");
}

async function ccCandidates(path) {
  const html = await getText(CC + path, { Referer: CC + "/" });
  const out = [];
  const re = /<li[^>]+class=["'][^"']*dooplay_player_option[^"']*["'][^>]*data-option=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const u = absUrl(decodeEntities(m[1]));
    if (u && !/youtube|trailer/i.test(u)) out.push({ url: u, label: "CineCalidad · Latino", referer: CC + "/", lang: 0 });
  }
  log("CineCalidad servidores: " + out.map((x) => hostOf(x.url)).join(","));
  return out;
}

async function smSearch(q) {
  const html = await getText(SM + "/?s=" + enc(q), { Referer: SM + "/" });
  return linkCards(html, SM, "/serie/", "sm", "series");
}

async function smEpisodes(path) {
  const html = await getText(SM + path, { Referer: SM + "/" });
  const slug = path.split("/").pop();
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const out = [];
  const seen = new Set();
  const re = /href=["'](?:https?:\/\/www3\.seriesmetro\.net)?(\/capitulo\/[^"']*?-temporada-(\d+)-capitulo-(\d+))\/?["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const k = m[2] + "x" + m[3];
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ season: Number(m[2]), number: Number(m[3]), ref: "sm|e|" + enc(m[1] + "/"), title: k });
  }
  log("SeriesMetro episodios: " + out.length);
  return { series: { title: h1 ? stripTags(h1[1]) : humanSlug(slug) }, episodes: out };
}

async function smCandidates(path) {
  const html = await getText(SM + path, { Referer: SM + "/" });
  const urls = [];
  const re = /src=["'](https?:\/\/www3\.seriesmetro\.net\/\?trembed=\d+[^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) && urls.length < 5) { const u = decodeEntities(m[1]); if (urls.indexOf(u) < 0) urls.push(u); }
  const res = await Promise.allSettled(urls.map(async (u) => {
    const t = await getText(u, { Referer: SM + "/" });
    const out = [];
    const fr = /<iframe[^>]+src=["']([^"']+)["']/gi;
    let f;
    while ((f = fr.exec(t))) { const x = absUrl(decodeEntities(f[1])); if (x && !/cloudflare|google|facebook/i.test(x)) out.push({ url: x, label: tr("Subtitulado", "Subbed") + " · " + hostOf(x), referer: SM + "/", lang: 2 }); }
    return out;
  }));
  const out = [];
  res.forEach((r) => { if (r.status === "fulfilled") out.push.apply(out, r.value); });
  log("SeriesMetro servidores: " + out.map((x) => hostOf(x.url)).join(","));
  return out;
}

// ---- LaCartoons (lc), SeriesTurcas (st) y SeriesFlix (sf) ----
const LC = "https://www.lacartoons.com";
const ST = "https://tbg.seriesturcastv.to";
const SF = "https://seriesflixhd.lol";

const absTo = (base, u) => { u = decodeEntities(u); return u.charAt(0) === "/" && u.charAt(1) !== "/" ? base + u : absUrl(u) || u; };

// LaCartoons: caricaturas en Latino. ref: lc|s|/serie/<id>   episodio: lc|e|<ruta con ?t=temporada>
function lcCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<a\s+href="(\/serie\/\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const nm = /<p\s+class="nombre-serie"[^>]*>([\s\S]*?)<\/p>/i.exec(m[2]);
    if (!nm || seen.has(m[1])) continue;
    seen.add(m[1]);
    const im = /<img[^>]+src="([^"]+)/i.exec(m[2]);
    const it = mkItem("lc", "series", enc(m[1]), nm[1], im ? absUrl(absTo(LC, im[1])) : "", "");
    if (it) out.push(it);
  }
  return out;
}

async function lcPage(n) {
  const html = await getText(LC + (n > 1 ? "/?page=" + n : "/"), { Referer: LC + "/" });
  return { items: lcCards(html), hasNext: html.indexOf("/?page=" + (n + 1)) >= 0 };
}

async function lcSearch(q) {
  return lcCards(await getText(LC + "/?Titulo=" + enc(q), { Referer: LC + "/" }));
}

async function lcEpisodes(path) {
  const html = await getText(LC + path, { Referer: LC + "/" });
  const h1 = /<h2[^>]*>([\s\S]*?)<\/h2>|<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const out = [];
  const seen = new Set();
  const re = /<a[^>]+href="([^"]*serie\/capitulo\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = decodeEntities(m[1]);
    const label = stripTags(m[2]);
    const num = /(?:cap[ií]tulo|eps?)\s*(\d+)/i.exec(label);
    const t = /[?&]t=(\d+)/.exec(href);
    if (!num) continue;
    const season = t ? Number(t[1]) : 1;
    const k = season + "x" + num[1];
    if (seen.has(k)) continue;
    seen.add(k);
    const p = href.replace(/^https?:\/\/[^\/]+/, "");
    out.push({ season, number: Number(num[1]), ref: "lc|e|" + enc(p), title: label.replace(/^cap[ií]tulo\s*\d+\s*[-–]?\s*/i, "") || tr("Capítulo ", "Episode ") + num[1] });
  }
  log("LaCartoons episodios: " + out.length);
  return { series: { title: h1 ? stripTags(h1[1] || h1[2]) : "" }, episodes: out };
}

async function lcCandidates(path) {
  const html = await getText(LC + path, { Referer: LC + "/" });
  const out = [];
  const re = /<iframe[^>]+src="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html))) {
    const u = absUrl(decodeEntities(m[1]));
    if (u && /ok\.ru|vk\.com|vkvideo|rpmvid|video_ext\.php/i.test(u)) out.push({ url: u, label: "LaCartoons · Latino", referer: LC + "/", lang: 0 });
  }
  log("LaCartoons servidores: " + out.map((x) => hostOf(x.url)).join(","));
  return out;
}

// SeriesTurcas: ref st|s|<url de la serie>   episodio st|e|<url>
let stList = null;
function stCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<a\s+href="([^"]+)"\s+title="([^"]+)"\s+class="poster"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!/seriesturcastv\.to/i.test(hostOf(m[1])) || seen.has(m[1])) continue;
    seen.add(m[1]);
    const im = /<img\s+src="([^"]+)/i.exec(m[3]);
    const it = mkItem("st", "series", enc(m[1].replace(/^https?:\/\/[^\/]+/, "")), m[2], im ? absUrl(absTo(ST, im[1])) : "", "");
    if (it) out.push(it);
  }
  return out;
}

async function stPage(n) {
  if (!stList) stList = stCards(await getText(ST + "/series/", { Referer: ST + "/" }));
  const start = (n - 1) * 30;
  return { items: stList.slice(start, start + 30), hasNext: start + 30 < stList.length };
}

async function stSearch(q) {
  return stCards(await getText(ST + "/?s=" + enc(q), { Referer: ST + "/" }));
}

async function stEpisodes(path) {
  const html = await getText(ST + path, { Referer: ST + "/" });
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const out = [];
  const seen = new Set();
  const re = /<a\s+class=["']episod["']\s+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!/seriesturcastv\.to/i.test(hostOf(m[1]))) continue;
    const label = stripTags(m[2]);
    const num = /cap[ií]tulo\s*(\d+)/i.exec(label);
    if (!num || seen.has(num[1])) continue;
    seen.add(num[1]);
    out.push({ season: 1, number: Number(num[1]), ref: "st|e|" + enc(m[1].replace(/^https?:\/\/[^\/]+/, "")), title: label });
  }
  log("SeriesTurcas episodios: " + out.length);
  return { series: { title: h1 ? stripTags(h1[1]) : "" }, episodes: out };
}

// Los enlaces de las pestañas vienen escondidos: base64 -> al revés -> -5 -> XOR con una clave fija.
function stDecode(ds) {
  try {
    const raw = atob(ds.replace(/\|/g, ""));
    const rev = raw.split("").reverse().join("");
    const key = [86, 110, 51, 72, 106, 87, 56, 102];
    let out = "";
    for (let i = 0; i < rev.length; i++) out += String.fromCharCode(((rev.charCodeAt(i) - 5 + 256) % 256) ^ key[i % key.length]);
    const m = /src=["']([^"']+)["']/i.exec(out);
    if (m) return m[1];
    return /^https?:/i.test(out) ? out : "";
  } catch (e) { return ""; }
}

async function stCandidates(path) {
  const html = await getText(ST + path, { Referer: ST + "/" });
  const urls = [];
  const add = (u) => { u = absUrl(decodeEntities(u || "")); if (u && urls.indexOf(u) < 0 && !/netusia/i.test(u)) urls.push(u); };
  const fr = /<div[^>]+id=["']tab\d+["'][^>]*>[\s\S]*?<iframe[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = fr.exec(html))) add(m[1]);
  const dr = /data-s\d*=["']([^"']+)["']/gi;
  while ((m = dr.exec(html))) add(stDecode(m[1]));
  const out = urls.map((u) => ({ url: u, label: "SeriesTurcas · " + tr("Subtitulado", "Subbed"), referer: ST + "/", lang: 2 }));
  log("SeriesTurcas servidores: " + out.map((x) => hostOf(x.url)).join(","));
  return out;
}

// SeriesFlix: series. ref sf|s|/serie/<slug>   episodio sf|e|/episodio/<slug>-SxE/
async function sfSearch(q) {
  const html = await getText(SF + "/?s=" + enc(q), { Referer: SF + "/" });
  const out = [];
  const seen = new Set();
  const re = /<article[^>]*class=["'][^"']*TPost[^"']*["'][\s\S]*?<\/article>/gi;
  let m;
  while ((m = re.exec(html))) {
    const h = /href=["'](?:https?:\/\/[^\/]+)?(\/serie\/[^\/"']+)\/?["']/i.exec(m[0]);
    if (!h || seen.has(h[1])) continue;
    seen.add(h[1]);
    const t = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(m[0]) || /alt=["']([^"']+)["']/i.exec(m[0]);
    const im = /<img[^>]*(?:data-src|src)=["']([^"']+)["']/i.exec(m[0]);
    const it = mkItem("sf", "series", enc(h[1]), t ? t[1] : humanSlug(h[1].split("/").pop()), im ? absUrl(absTo("https:", im[1])) : "", "");
    if (it) out.push(it);
  }
  return out;
}

async function sfEpisodes(path) {
  const html = await getText(SF + path, { Referer: SF + "/" });
  const slug = path.split("/").pop();
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const out = [];
  const seen = new Set();
  const re = new RegExp("/episodio/(" + slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")-(\\d+)x(\\d+)/?", "gi");
  let m;
  while ((m = re.exec(html))) {
    const k = m[2] + "x" + m[3];
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ season: Number(m[2]), number: Number(m[3]), ref: "sf|e|" + enc("/episodio/" + m[1] + "-" + k + "/"), title: k });
  }
  log("SeriesFlix episodios: " + out.length);
  return { series: { title: h1 ? stripTags(h1[1]) : humanSlug(slug) }, episodes: out };
}

async function sfCandidates(path) {
  const html = await getText(SF + path, { Referer: SF + "/" });
  const out = [];
  const re = /<div[^>]*data-url=["']([^"']+)["'][^>]*class=["'][^"']*Button\s+sgty[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      let d = atob(m[1]);
      if (/iframe\/\?url=|watch\//.test(d)) { const q = /[?&]url=([^&]+)/i.exec(d); if (q) d = dec(q[1]); }
      const u = absUrl(d);
      if (!u) continue;
      const lab = stripTags(m[2]).toUpperCase();
      const lang = /CASTELLANO|ESP/.test(lab) ? 1 : /SUB/.test(lab) ? 2 : 0;
      out.push({ url: u, label: "SeriesFlix · " + (lang === 0 ? "Latino" : lang === 1 ? "Castellano" : tr("Subtitulado", "Subbed")), referer: SF + "/", lang });
    } catch (e) { /* no era base64 */ }
  }
  log("SeriesFlix servidores: " + out.map((x) => hostOf(x.url)).join(","));
  return out;
}

// ---- Secciones ----------------------------------------------------------------------------------

const SECTIONS = {
  peliculas: { genre: "peliculas", parts: [() => (n) => pjPage("movie", n), () => (n) => hsPage("movie", n), () => (n) => fcPage("Movie", n), () => (n) => pfPage("movie", n)] },
  series: { genre: "series", parts: [() => (n) => pjPage("series", n), () => (n) => hsPage("series", n), () => (n) => fcPage("Serie", n), () => (n) => pfPage("series", n)] },
  turcas: { genre: "series", parts: [() => (n) => stPage(n)] },
  toons: { genre: "series", parts: [() => (n) => lcPage(n)] },
  anime: { genre: "series", parts: [() => (n) => pjPage("anime", n), () => (n) => hsPage("anime", n), () => (n) => fcPage("Anime", n)] },
};

const SRC_PRIO = { pj: 0, hs: 1, po: 2, cu: 3, tp: 4, cc: 5, fc: 6, pp: 7, sf: 8, sm: 9, pf: 10, lc: 11, st: 12 };

function normTitle(t) {
  return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\(\d{4}\)/g, "").replace(/[^a-z0-9]+/g, "");
}

// Une el mismo título de fuentes distintas en una sola tarjeta (ref "mx|a||b||c").
function mergeDupes(items) {
  const byKey = new Map();
  const out = [];
  for (const it of items) {
    const k = normTitle(it.title) + (it.kind === "movie" ? "m" : "s");
    const prev = byKey.get(k);
    if (!k.replace(/[ms]$/, "")) { out.push(it); continue; }
    if (!prev) { byKey.set(k, it); out.push(it); continue; }
    const refs = prev.ref.startsWith("mx|") ? prev.ref.slice(3).split("||") : [prev.ref];
    if (refs.length < 4 && refs.indexOf(it.ref) < 0) refs.push(it.ref);
    refs.sort((a, b) => (SRC_PRIO[a.slice(0, 2)] || 0) - (SRC_PRIO[b.slice(0, 2)] || 0));
    prev.ref = refs.length > 1 ? "mx|" + refs.join("||") : refs[0];
    if (!prev.poster && it.poster) prev.poster = it.poster;
    if (!prev.year && it.year) prev.year = it.year;
  }
  return out;
}

async function sectionPage(sec, n) {
  const def = SECTIONS[sec];
  if (!def) throw kino.error("not_found", "catálogo desconocido");
  const res = await Promise.allSettled(def.parts.map((p) => p()(n)));
  const lists = [];
  let hasNext = false;
  let ok = 0;
  res.forEach((r, i) => {
    if (r.status === "fulfilled") { ok++; lists.push(r.value.items); if (r.value.hasNext) hasNext = true; }
    else log("sección " + sec + " p" + n + ": falló la fuente " + i + " " + String((r.reason && r.reason.message) || r.reason).slice(0, 60));
  });
  if (!ok) throw (res[0].reason || kino.error("unavailable", "ninguna fuente respondió"));
  // Se intercalan para que se vean las novedades de todas las fuentes.
  const mixed = [];
  const max = Math.max(...lists.map((l) => l.length), 0);
  for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) mixed.push(l[i]);
  return { items: mergeDupes(mixed), hasNext };
}

export async function home() {
  await null;
  const defs = [
    { id: "row-peliculas", ref: "peliculas", title: tr("Películas", "Movies") },
    { id: "row-series", ref: "series", title: tr("Series", "Series") },
    { id: "row-anime", ref: "anime", title: tr("Anime", "Anime") },
    { id: "row-turcas", ref: "turcas", title: tr("Series turcas", "Turkish series") },
    { id: "row-toons", ref: "toons", title: tr("Caricaturas", "Cartoons") },
  ];
  const res = await Promise.allSettled(defs.map((d) => sectionPage(d.ref, 1)));
  const rows = [];
  res.forEach((r, i) => {
    if (r.status !== "fulfilled") { log("home: falló " + defs[i].id); return; }
    const items = r.value.items.slice(0, HOME_ROW);
    if (items.length) rows.push({ id: defs[i].id, title: defs[i].title, genre: SECTIONS[defs[i].ref].genre, ref: defs[i].ref, items });
  });
  log("home filas=" + rows.length);
  if (!rows.length) throw kino.error("unavailable", "inicio sin resultados");
  return rows;
}

export async function browse(ref, cursor) {
  await null;
  const r = String(ref || "");
  if (!SECTIONS[r]) throw kino.error("not_found", "catálogo desconocido");
  const n = Math.max(1, parseInt(cursor, 10) || 1);
  const items = [];
  const seen = new Set();
  let p = n;
  let hasNext = true;
  let tries = 0;
  while (hasNext && items.length < PAGE_VIEW && tries < 3) {
    tries++;
    let page;
    try { page = await sectionPage(r, p); } catch (e) { if (p === n) throw e; break; }
    for (const x of page.items) if (!seen.has(x.id)) { seen.add(x.id); items.push(x); }
    hasNext = page.hasNext;
    p++;
  }
  const out = { items: items.slice(0, MAX_RESULTS) };
  if (hasNext && items.length) out.next = String(p);
  return out;
}

export async function categories() {
  await null;
  const defs = [
    { id: "peliculas", title: tr("Películas", "Movies") },
    { id: "series", title: tr("Series", "Series") },
    { id: "anime", title: tr("Anime", "Anime") },
    { id: "turcas", title: tr("Series turcas", "Turkish series") },
    { id: "toons", title: tr("Caricaturas", "Cartoons") },
  ];
  const first = await Promise.allSettled(defs.map((d) => sectionPage(d.id, 1)));
  return defs.map((d, i) => {
    const r = first[i];
    const art = r.status === "fulfilled" && r.value.items[0] ? r.value.items[0].poster : undefined;
    return art ? { id: d.id, title: d.title, ref: d.id, art } : { id: d.id, title: d.title, ref: d.id };
  });
}

export async function search(query) {
  await null;
  const q = stripTags(query && query.q).slice(0, 100);
  if (!q) return [];
  const qa = q.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[¡!¿?:,.]/g, " ").replace(/\s+/g, " ").trim() || q;
  const tasks = [pjSearch(qa), hsSearch(qa), nxSearch("po", qa), nxSearch("cu", qa), tpSearch(qa), ccSearch(qa), smSearch(qa), sfSearch(qa), lcSearch(qa), stSearch(qa), ppSearch(qa), fcSearch(qa), pfSearch(qa)];
  const res = await Promise.allSettled(tasks);
  const all = [];
  res.forEach((r, i) => {
    if (r.status === "fulfilled") all.push.apply(all, r.value);
    else log("búsqueda: falló la fuente " + i + " " + String((r.reason && r.reason.message) || r.reason).slice(0, 60));
  });
  const out = mergeDupes(all).slice(0, MAX_RESULTS);
  log("búsqueda: " + out.length + " resultados");
  return out;
}

// ---- Capítulos ----------------------------------------------------------------------------------

async function episodesOne(raw) {
  const p = raw.split("|");
  const src = p[0];
  const kind = p[1]; // m | s | a | e
  if (kind === "m") return { series: { title: "" }, episodes: [{ season: 1, number: 1, ref: raw, title: tr("Película", "Movie") }] };
  if (src === "pj") return pjEpisodes(kind, p[2], dec(p[3] || ""));
  if (src === "hs") return hsEpisodes(p[2], dec(p[3] || ""));
  if (src === "fc") return fcEpisodes(dec(p[2]));
  if (src === "pf") return pfEpisodes(dec(p[2]));
  if (src === "po" || src === "cu") return nxEpisodes(src, dec(p[2]));
  if (src === "tp") return tpEpisodes(dec(p[2]));
  if (src === "sm") return smEpisodes(dec(p[2]));
  if (src === "sf") return sfEpisodes(dec(p[2]));
  if (src === "lc") return lcEpisodes(dec(p[2]));
  if (src === "st") return stEpisodes(dec(p[2]));
  throw kino.error("not_found", "referencia desconocida");
}

export async function episodes(ref) {
  await null;
  const raw = String(ref || "");
  if (raw.startsWith("mx|")) {
    const refs = raw.slice(3).split("||").filter(Boolean).slice(0, 4);
    // Película combinada: un solo capítulo que recuerda todas las fuentes.
    if (refs.every((r) => r.split("|")[1] === "m")) return { series: { title: "" }, episodes: [{ season: 1, number: 1, ref: raw, title: tr("Película", "Movie") }] };
    const res = await Promise.allSettled(refs.map((r) => episodesOne(r)));
    let best = null;
    let bestI = -1;
    res.forEach((r, i) => {
      if (r.status !== "fulfilled" || !r.value || !r.value.episodes.length) { log("episodios: falló " + refs[i].slice(0, 2)); return; }
      log("episodios: " + refs[i].slice(0, 2) + "=" + r.value.episodes.length);
      if (!best || r.value.episodes.length > best.episodes.length) { best = r.value; bestI = i; }
    });
    if (!best) throw (res[0].reason || kino.error("not_found", "sin lista de capítulos"));
    const byKey = res.map((r) => {
      const m = new Map();
      if (r.status === "fulfilled" && r.value) for (const e of r.value.episodes) m.set(e.season + "x" + e.number, e.ref);
      return m;
    });
    const eps = best.episodes.map((e) => {
      const alts = [e.ref];
      byKey.forEach((m, i) => { if (i !== bestI) { const o = m.get(e.season + "x" + e.number); if (o && alts.indexOf(o) < 0) alts.push(o); } });
      alts.sort((x, y) => (SRC_PRIO[x.slice(0, 2)] || 0) - (SRC_PRIO[y.slice(0, 2)] || 0));
      return alts.length > 1 ? Object.assign({}, e, { ref: "mx|" + alts.join("||") }) : e;
    });
    return Object.assign({}, best, { episodes: eps });
  }
  const r = await episodesOne(raw);
  if (!r.episodes.length) throw kino.error("not_found", "sin capítulos", { userMessage: tr("No se encontró la lista de capítulos de este título.", "No episode list found for this title.") });
  r.episodes.sort((a, b) => (a.season - b.season) || (a.number - b.number));
  return r;
}

// ---- Reproducción -------------------------------------------------------------------------------

// Orden de los servidores: los que dan un enlace directo o HLS primero; los que piden verificación, al final.
const HOST_RANK = [/goodstream/i, /vimeos|unlimplay/i, /ok\.ru/i, /mp4upload/i, /streamwish|wish|hgcloud|vidhide|dhcplay/i, /rumble|eintim|1a-1791|vids\.st/i, /voe|uqload|streamtape|upns/i, /filemoon|byse|dood|mixdrop|mdy|netu|waaw|mega/i];
const rank = (u) => { const h = hostOf(u); const i = HOST_RANK.findIndex((r) => r.test(h)); return i < 0 ? 5 : i; };

async function candidatesOf(src, spec) {
  if (src === "pj") return pjCandidates(spec);
  if (src === "hs") return hsCandidates(spec);
  if (src === "fc") return fcCandidates(dec(spec.split("|")[1] === undefined ? spec : spec.split("|")[1]));
  if (src === "pf") return pfCandidates(dec(spec.split("|")[1] === undefined ? spec : spec.split("|")[1]));
  if (src === "po" || src === "cu") return nxCandidates(src, dec(spec.split("|")[1]), spec.charAt(0) === "e");
  if (src === "pp") return ppCandidates(dec(spec.split("|")[1]));
  if (src === "tp") return tpCandidates(dec(spec.split("|")[1]));
  if (src === "cc") return ccCandidates(dec(spec.split("|")[1]));
  if (src === "sm") return smCandidates(dec(spec.split("|")[1]));
  if (src === "sf") return sfCandidates(dec(spec.split("|")[1]));
  if (src === "lc") return lcCandidates(dec(spec.split("|")[1]));
  if (src === "st") return stCandidates(dec(spec.split("|")[1]));
  throw kino.error("not_found", "referencia desconocida");
}

async function resolveOne(raw, t0) {
  const src = raw.slice(0, 2);
  const spec = raw.slice(3);
  let cands = await candidatesOf(src, spec);
  cands = cands.filter((c, i) => cands.findIndex((x) => x.url === c.url) === i);
  cands.sort((a, b) => ((a.lang || 0) * 10 + rank(a.url)) - ((b.lang || 0) * 10 + rank(b.url)));
  if (!cands.length) throw kino.error("unavailable", "sin servidores", { userMessage: tr("Este título no trae servidores disponibles.", "This title has no servers available.") });

  // Enlace directo: se entrega tal cual (primero los del mejor idioma; los demás, si los reproductores fallan).
  const isDirect = (c) => /\.(m3u8|mp4)(\?|$)/i.test(c.url) && !isDemo(c.url);
  const direct = (c) => ({ url: c.url, mime: /\.m3u8/i.test(c.url) ? "application/x-mpegurl" : "video/mp4", label: c.label, headers: { Referer: c.referer || REF } });
  const minLang = Math.min(...cands.map((c) => c.lang || 0));
  const bestDirect = cands.find((c) => isDirect(c) && (c.lang || 0) === minLang);
  if (bestDirect) return direct(bestDirect);
  const embeds = cands.filter((c) => !isDirect(c));
  for (let i = 0; i < embeds.length; i += 4) {
    const left = 18000 - (Date.now() - t0);
    if (left < 3000) break;
    const group = embeds.slice(i, i + 4);
    const task = firstSuccess(group.map((c) => embedFromHtml(c.url, 0, c.referer || REF).then((v) => (v ? Object.assign(v, { label: c.label }) : null))));
    const got = typeof kino.sleep === "function" ? await Promise.race([task, sleepUpTo(Math.min(left - 1500, 9000))]) : await task;
    if (got && got.v) return got.v;
  }
  const lateDirect = cands.find(isDirect);
  if (lateDirect) return direct(lateDirect);
  // Último recurso: el navegador oculto con el mejor servidor.
  const left = 18000 - (Date.now() - t0);
  if (left > 5000 && embeds.length) {
    try {
      const s = await captureEmbed(embeds[0].url, Math.min(12000, left - 1500));
      if (s) { s.label = embeds[0].label; return s; }
      log("resolve: el navegador no vio video");
    } catch (e) { log("resolve: captura falló " + String((e && e.message) || e).slice(0, 60)); }
  }
  throw kino.error("unavailable", "ningún servidor entregó el video", {
    userMessage: tr("Ningún servidor de este título se pudo abrir desde aquí. Prueba otro título.", "No server for this title could be opened from here. Try another title."),
  });
}

async function sleepUpTo(ms) {
  let left = ms;
  while (left > 0) { const t = Math.min(left, 4500); await kino.sleep(t); left -= t; }
  return null;
}

export async function resolve(ref) {
  await null;
  const t0 = Date.now();
  const raw = String(ref || "");
  if (raw.startsWith("mx|")) {
    const refs = raw.slice(3).split("||").filter(Boolean).slice(0, 4);
    let lastErr = null;
    for (let i = 0; i < refs.length; i++) {
      const left = 19000 - (Date.now() - t0);
      if (left < 3500) break;
      const cap = i === refs.length - 1 ? left : Math.min(left, 9000);
      log("resolve: fuente " + (i + 1) + "/" + refs.length + " (" + refs[i].slice(0, 2) + ")");
      const attempt = resolveOne(refs[i], t0).catch((e) => { lastErr = e; log("resolve: " + refs[i].slice(0, 2) + " falló"); return null; });
      const got = typeof kino.sleep === "function" ? await Promise.race([attempt, sleepUpTo(cap)]) : await attempt;
      if (got) return got;
    }
    throw lastErr || kino.error("unavailable", "ninguna fuente entregó el video", {
      userMessage: tr("Ningún servidor se pudo abrir desde aquí. Prueba otro título.", "No server could be opened from here. Try another title."),
    });
  }
  return resolveOne(raw, t0);
}
