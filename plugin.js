// src/plugin.js
var IMG_W500 = "https://image.tmdb.org/t/p/w500";
var IMG_W1280 = "https://image.tmdb.org/t/p/w1280";
var IMG_W300 = "https://image.tmdb.org/t/p/w300";
var VL_BASE = "https://vidlink.pro/api/b";
var ENC_API = "https://enc-dec.app/api";
var VL_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Referer": "https://vidlink.pro/",
  "Origin": "https://vidlink.pro",
  "Accept": "*/*"
};
// Cabeceras del reproductor: los CDN de los videos rechazan los User-Agent de navegador de escritorio
// (error 428) en las peticiones por rango, así que se manda el de un reproductor de Android.
var STREAM_HEADERS = { "User-Agent": "okhttp/4.12.0", "Referer": "https://moviebox.ph/" };
// La llave de TMDB ya no se pide en este plugin: se usa la de Kino (Ajustes ▸ «Tu llave de TMDB»)
// o la de un addon de TMDB de Stremio, ambas por kino.tmdb.
var hasKinoTmdb = () => typeof kino.tmdb === "function";
var NO_KEY_MESSAGE = "Necesitas una llave de TMDB: ponla en Ajustes \u25B8 \xABTu llave de TMDB\xBB (Kino 0.9.53 o m\xE1s nueva), o instala un addon de TMDB de Stremio con tu llave.";
function noKey() {
  return kino.error("unavailable", "no TMDB key", { userMessage: NO_KEY_MESSAGE });
}
function splitQuery(path) {
  const i = path.indexOf("?");
  if (i < 0) return { path, params: {} };
  const params = {};
  for (const pair of path.slice(i + 1).split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const k = decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq));
    params[k] = eq < 0 ? "" : decodeURIComponent(pair.slice(eq + 1));
  }
  return { path: path.slice(0, i), params };
}
var isSpanish = () => String(kino.lang || "").toLowerCase().startsWith("es");
var T = (es, en) => isSpanish() ? es : en;
var withLanguage = (path) => /[?&]language=/.test(path) ? path : path + (path.includes("?") ? "&" : "?") + "language=" + (isSpanish() ? "es-MX" : "en-US");
async function tmdb(rawPath) {
  const path = withLanguage(rawPath);
  if (!hasKinoTmdb()) throw noKey();
  const q = splitQuery(path);
  try {
    return await kino.tmdb(q.path, q.params);
  } catch (e) {
    if (e && e.code === "no_tmdb_key") throw noKey();
    throw e;
  }
}
var canTmdb = () => hasKinoTmdb();
function toItem(m) {
  const isTv = m.media_type === "tv" || !m.media_type && !!m.first_air_date;
  const kind = isTv ? "series" : "movie";
  return {
    id: String(m.id),
    ref: `${kind}:${m.id}`,
    title: m.title || m.name || "",
    kind,
    year: (m.release_date || m.first_air_date || "").slice(0, 4) || void 0,
    poster: m.poster_path ? IMG_W500 + m.poster_path : void 0,
    backdrop: m.backdrop_path ? IMG_W1280 + m.backdrop_path : void 0,
    overview: m.overview || void 0,
    rating: m.vote_average ? Math.round(m.vote_average * 10) / 10 : void 0,
    ids: { tmdb: m.id }
  };
}
function qualRank(q) {
  const s = String(q || "").toUpperCase().replace(/\s/g, "");
  if (s === "4K" || s === "2160P" || s === "2160") return 5;
  if (s === "1440P" || s === "1440") return 4;
  if (s === "1080P" || s === "1080" || s === "FHD") return 3;
  if (s === "720P" || s === "720" || s === "HD") return 2;
  if (s === "480P" || s === "480") return 1;
  return 0;
}
async function search({ q, type, cursor }) {
  if (!q || !canTmdb()) return { items: [] };
  const page = cursor ? Number(cursor) : 1;
  const mt = type === "movie" ? "movie" : type === "series" ? "tv" : "multi";
  const data = await tmdb(`/search/${mt}?query=${encodeURIComponent(q)}&page=${page}&include_adult=false`);
  const items = (data.results || []).filter((m) => m.media_type !== "person").map(toItem);
  return {
    items,
    next: data.page < data.total_pages ? String(page + 1) : void 0
  };
}
async function home() {
  if (!canTmdb()) throw noKey();
  const lists = await Promise.all([
    "/trending/movie/week",
    "/trending/tv/week",
    "/movie/popular",
    "/tv/popular",
    "/movie/top_rated",
    "/tv/top_rated"
  ].map((path) => tmdb(path).then((value) => ({ value }), (error) => ({ error }))));
  const failed = lists.filter((l) => l.error);
  if (failed.length === lists.length) throw failed[0].error;
  if (failed.length) kino.log("home: " + failed.length + " of " + lists.length + " lists failed: " + (failed[0].error && failed[0].error.code));
  const [trendM, trendS, popM, popS, topM, topS] = lists.map((l) => l.value || { results: [] });
  return [
    {
      id: "trend-m",
      title: T("Tendencias \xB7 Pel\xEDculas", "Trending \xB7 Movies"),
      ref: "trend-m",
      genre: "peliculas",
      items: (trendM.results || []).map(toItem)
    },
    {
      id: "trend-s",
      title: T("Tendencias \xB7 Series", "Trending \xB7 Series"),
      ref: "trend-s",
      items: (trendS.results || []).map(toItem)
    },
    {
      id: "pop-m",
      title: T("Populares \xB7 Pel\xEDculas", "Popular \xB7 Movies"),
      ref: "pop-m",
      genre: "peliculas",
      items: (popM.results || []).map(toItem)
    },
    {
      id: "pop-s",
      title: T("Populares \xB7 Series", "Popular \xB7 Series"),
      ref: "pop-s",
      items: (popS.results || []).map(toItem)
    },
    {
      id: "top-m",
      title: T("Mejor valoradas \xB7 Pel\xEDculas", "Top rated \xB7 Movies"),
      ref: "top-m",
      genre: "peliculas",
      items: (topM.results || []).map(toItem)
    },
    {
      id: "top-s",
      title: T("Mejor valoradas \xB7 Series", "Top rated \xB7 Series"),
      ref: "top-s",
      items: (topS.results || []).map(toItem)
    }
  ].filter((r) => r.items.length > 0);
}
var BROWSE_ENDPOINT = {
  "trend-m": "/trending/movie/week",
  "trend-s": "/trending/tv/week",
  "pop-m": "/movie/popular",
  "pop-s": "/tv/popular",
  "top-m": "/movie/top_rated",
  "top-s": "/tv/top_rated",
  "now-m": "/movie/now_playing",
  "air-s": "/tv/on_the_air"
};
async function browse(ref, cursor) {
  if (!canTmdb()) return { items: [] };
  const page = cursor ? Number(cursor) : 2;
  const ep = BROWSE_ENDPOINT[ref];
  if (!ep) return { items: [] };
  const data = await tmdb(`${ep}?page=${page}`);
  return {
    items: (data.results || []).map(toItem),
    next: data.page < data.total_pages ? String(page + 1) : void 0
  };
}
async function tabPage(tab) {
  const shelf = (id, title, path, genre) => tmdb(path).then((d) => ({ id, title, ref: id, genre, items: (d.results || []).map(toItem) })).catch((e) => {
    if (e && e.code === "unavailable") throw e;
    kino.log("shelf " + id + " failed: " + (e && e.message));
    return null;
  });
  if (tab === "inicio") return { rows: await home() };
  const movies = tab === "peliculas";
  const jobs = movies ? [
    shelf("trend-m", T("Tendencias", "Trending"), "/trending/movie/week", "peliculas"),
    shelf("now-m", T("En cartelera", "Now playing"), "/movie/now_playing", "peliculas"),
    shelf("pop-m", T("Populares", "Popular"), "/movie/popular", "peliculas"),
    shelf("top-m", T("Mejor valoradas", "Top rated"), "/movie/top_rated", "peliculas")
  ] : [
    shelf("trend-s", T("Tendencias", "Trending"), "/trending/tv/week"),
    shelf("air-s", T("En emisi\xF3n", "On the air"), "/tv/on_the_air"),
    shelf("pop-s", T("Populares", "Popular"), "/tv/popular"),
    shelf("top-s", T("Mejor valoradas", "Top rated"), "/tv/top_rated")
  ];
  return { rows: (await Promise.all(jobs)).filter((r) => r && r.items.length > 0) };
}
async function section({ tab }) {
  const tabs = [{ id: "inicio", label: T("Inicio", "Home") }, { id: "peliculas", label: T("Pel\xEDculas", "Movies") }, { id: "series", label: "Series" }];
  const chosen = tabs.some((x) => x.id === tab) ? tab : tabs[0].id;
  if (!canTmdb()) throw noKey();
  const { rows } = await tabPage(chosen);
  const answer = { tabs, tab: chosen, rows };
  const pick = rows.length ? rows[0].items.filter((x) => x.backdrop) : [];
  if (pick.length) {
    const it = pick[Math.floor(Date.now() / 864e5) % pick.length];
    answer.hero = { title: it.title, text: it.overview ? it.overview.slice(0, 160) : T("Lo que est\xE1 de moda.", "What is trending."), image: it.backdrop };
  }
  return answer;
}
async function episodes(ref) {
  if (!canTmdb()) return { episodes: [] };
  const parts = ref.split(":");
  const tmdbId = parts[1];
  const wantSeason = parts[2] ? Number(parts[2]) : null;
  const show = await tmdb(`/tv/${tmdbId}`);
  const allSeasons = (show.seasons || []).filter((s) => s.season_number > 0);
  const target = wantSeason ?? allSeasons[0]?.season_number ?? 1;
  const sd = await tmdb(`/tv/${tmdbId}/season/${target}`);
  const eps = (sd.episodes || []).map((ep) => ({
    season: ep.season_number,
    number: ep.episode_number,
    ref: `ep:${tmdbId}:${ep.season_number}:${ep.episode_number}`,
    title: ep.name || void 0,
    overview: ep.overview || void 0,
    still: ep.still_path ? IMG_W300 + ep.still_path : void 0,
    airDate: ep.air_date || void 0,
    runtimeMinutes: ep.runtime || void 0
  }));
  if (allSeasons.length <= 1) return { episodes: eps };
  return {
    episodes: eps,
    seasons: allSeasons.map((s) => ({
      id: `s:${tmdbId}:${s.season_number}`,
      ref: `series:${tmdbId}:${s.season_number}`,
      title: s.name || `${T("Temporada", "Season")} ${s.season_number}`,
      number: s.season_number,
      current: s.season_number === target
    }))
  };
}

// ---- Reproducción: cada paso avisa con su propio mensaje si falla ---------------------------------

var HLS = "application/x-mpegurl";
function stepError(host, e) {
  const why = String(e && e.message || e).slice(0, 80);
  kino.log("fetch falló host=" + host + " motivo=" + why);
  return kino.error("unavailable", "fetch falló en " + host, {
    userMessage: T("No se pudo abrir " + host + ": " + why, "Could not open " + host + ": " + why)
  });
}
function statusError(host, status) {
  return kino.error("unavailable", host + " " + status, {
    userMessage: T(host + " respondió con el error " + status + ".", host + " answered with error " + status + ".")
  });
}

// Pide a enc-dec.app el código que vidlink espera en lugar del id de TMDB.
async function encryptId(tmdbId) {
  let r;
  try {
    r = await kino.fetch(`${ENC_API}/enc-vidlink?text=${encodeURIComponent(tmdbId)}`, { timeoutMs: 8e3 });
  } catch (e) {
    throw stepError("enc-dec.app", e);
  }
  if (!r.ok) throw statusError("enc-dec.app", r.status);
  let data = null;
  try {
    data = await r.json();
  } catch (e) {
    kino.log("enc-dec.app: respuesta que no es JSON");
  }
  const enc = data && typeof data.result === "string" && data.result ? data.result : null;
  if (!enc) {
    throw kino.error("unavailable", "enc-dec sin resultado", {
      userMessage: T("enc-dec.app no devolvi\xF3 el c\xF3digo para este t\xEDtulo.", "enc-dec.app did not return the code for this title.")
    });
  }
  return enc;
}
function mimeOf(url, type) {
  if (/m3u8|hls/i.test(String(type || "")) || /\.m3u8(\?|$)/i.test(url)) return HLS;
  return "video/mp4";
}
// Solo el nombre del servidor (nunca la dirección completa: puede llevar claves).
function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return "?";
  }
}
async function vidlinkStreams(tmdbId, mediaType, season, episode) {
  const enc = await encryptId(tmdbId);
  const path = mediaType === "tv" ? `/tv/${enc}/${season}/${episode}` : `/movie/${enc}`;
  const referer = mediaType === "tv" ? `https://vidlink.pro/tv/${tmdbId}/${season}/${episode}` : `https://vidlink.pro/movie/${tmdbId}`;
  let r;
  try {
    r = await kino.fetch(`${VL_BASE}${path}?multiLang=0`, { headers: { ...VL_HEADERS, "Referer": referer }, timeoutMs: 12e3 });
  } catch (e) {
    throw stepError("vidlink.pro", e);
  }
  if (!r.ok) throw statusError("vidlink.pro", r.status);
  let data = null;
  try {
    data = await r.json();
  } catch (e) {
    kino.log("vidlink: respuesta que no es JSON");
  }
  if (!data || typeof data !== "object") return [];
  const out = [];
  const stream = data.stream && typeof data.stream === "object" ? data.stream : null;
  if (stream && stream.qualities && typeof stream.qualities === "object") {
    for (const [qKey, val] of Object.entries(stream.qualities)) {
      if (val && typeof val.url === "string" && /^https?:/.test(val.url)) {
        out.push({ url: val.url, quality: qKey, mime: mimeOf(val.url, val.type) });
      }
    }
  }
  if (!out.length && stream && typeof stream.playlist === "string" && /^https?:/.test(stream.playlist)) {
    out.push({ url: stream.playlist, quality: "auto", mime: HLS });
  }
  if (!out.length && typeof data.url === "string" && /^https?:/.test(data.url)) {
    out.push({ url: data.url, quality: data.quality || "auto", mime: mimeOf(data.url, data.type) });
  }
  kino.log("vidlink: " + out.length + " fuente(s) para " + mediaType + " " + tmdbId);
  const sorted = out.sort((a, b) => qualRank(b.quality) - qualRank(a.quality));
  // Para saber qué servidor del video rechaza al reproductor (error 429): calidad, tipo y servidor.
  kino.log("vidlink fuentes: " + sorted.map((s) => s.quality + "/" + (s.mime === HLS ? "hls" : "mp4") + "@" + hostOf(s.url)).join(", "));
  return sorted;
}
var labelOf = (q) => q === "auto" ? void 0 : /^\d{3,4}$/.test(String(q)) ? q + "p" : String(q);
async function resolveRef(ref) {
  const parts = ref.split(":");
  let streams;
  if (parts[0] === "movie") {
    streams = await vidlinkStreams(parts[1], "movie");
  } else if (parts[0] === "ep") {
    const [, tmdbId, season, episode] = parts;
    streams = await vidlinkStreams(tmdbId, "tv", season, episode);
  } else {
    throw kino.error("not_found");
  }
  if (!streams.length) {
    throw kino.error("not_found", "sin fuentes", {
      userMessage: T("Este t\xEDtulo no tiene video disponible por ahora. Prueba con otro.", "This title has no video available right now. Try another one.")
    });
  }
  const [best, ...rest] = streams;
  const one = (s) => ({ url: s.url, mime: s.mime, ...labelOf(s.quality) ? { label: labelOf(s.quality) } : {}, headers: STREAM_HEADERS });
  return {
    ...one(best),
    alternatives: rest.slice(0, 8).map(one)
  };
}
async function resolve(ref) {
  return resolveRef(ref);
}
export {
  browse,
  episodes,
  home,
  resolve,
  search,
  section
};
