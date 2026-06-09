const { createClient } = require('@supabase/supabase-js');
const http = require('http');

// ─── Config ───────────────────────────────────────────────────────────────────
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const SUPABASE_URL   = process.env.SUPABASE_URL  || 'https://jzgpwkehhgpvdlqlkfiq.supabase.co';
const SUPABASE_KEY   = process.env.SUPABASE_KEY  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6Z3B3a2VoaGdwdmRscWxrZmlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQxNjU4NzcsImV4cCI6MjA1OTc0MTg3N30.wv1jD5rBaDrOkghJCjTxaGa2TCPtbsj4j37Ax7czPFY';
const WEBHOOK_URL    = process.env.WEBHOOK_URL;
const SITE_URL       = 'https://flixhub.space';
const DOWNLOAD_URL   = 'https://flixhub.space/download';
const IMG_BASE       = 'https://image.tmdb.org/t/p/w500';
const TMDB_TOKEN     = process.env.TMDB_TOKEN || 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJiNjYzNDYyMGIxZDc0NjRlOGRlNDJjMDY0OGZlZjYwYyIsIm5iZiI6MTc4MTAzODk5Ni4zNTMsInN1YiI6IjZhMjg3Zjk0ZWNjNDdkNThiZTdjMjcwNCIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.icV6N_BaqsDfWIxZtjUmjvbkHVyXXmku78WSdUVsvhU';
const TMDB_BASE      = 'https://api.themoviedb.org/3';
const TMDB_LANG      = 'pt-BR';

// ─── Admin & Grupo ────────────────────────────────────────────────────────────
const GROUP_ID       = -1003550026276;
const ADMIN_USERNAME = 'pipocakk';
const ADMIN_IDS      = new Set();

// ─── Estado em memória ────────────────────────────────────────────────────────
const sessions    = new Map();
const botUsers    = new Map();
const searchStats = new Map();
const clickStats  = new Map();
let lastPostedMovie  = null;
let lastPostedSeries = null;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Registro de usuário ──────────────────────────────────────────────────────
function registerUser(from, chatId) {
  if (!from || !chatId || chatId === GROUP_ID) return;
  if (!botUsers.has(chatId)) {
    botUsers.set(chatId, {
      firstName: from.first_name || '',
      username:  from.username   || '',
      firstSeen: new Date().toISOString(),
      searches:  0,
    });
  }
  if (from.username === ADMIN_USERNAME) ADMIN_IDS.add(chatId);
}

function isAdmin(chatId) { return ADMIN_IDS.has(chatId); }

function trackSearch(query, chatId) {
  if (!query) return;
  const q = query.toLowerCase().trim();
  searchStats.set(q, (searchStats.get(q) || 0) + 1);
  const u = botUsers.get(chatId);
  if (u) u.searches++;
}

function trackClick(title) {
  if (!title) return;
  clickStats.set(title, (clickStats.get(title) || 0) + 1);
}

function getSession(chatId) {
  if (!sessions.has(chatId)) sessions.set(chatId, {});
  return sessions.get(chatId);
}

// ─── TMDB API ─────────────────────────────────────────────────────────────────
async function tmdbFetch(path) {
  try {
    const res = await fetch(`${TMDB_BASE}${path}&language=${TMDB_LANG}`, {
      headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

async function getTmdbDetails(tmdbId, type) {
  if (!tmdbId) return null;
  const endpoint = type === 'movie' ? `/movie/${tmdbId}?` : `/tv/${tmdbId}?`;
  return tmdbFetch(endpoint);
}

async function enrichWithTmdb(item, type) {
  if (!item.tmdb_id) return item;
  const tmdb = await getTmdbDetails(item.tmdb_id, type);
  if (!tmdb) return item;
  return {
    ...item,
    overview:          tmdb.overview           || item.overview,
    poster_path:       tmdb.poster_path        || item.poster_path,
    backdrop_path:     tmdb.backdrop_path      || item.backdrop_path,
    vote_average:      tmdb.vote_average       || item.vote_average,
    genres:            tmdb.genres?.map(g => g.name) || item.genres,
    number_of_seasons: tmdb.number_of_seasons  || item.number_of_seasons,
  };
}

// ─── Telegram API ─────────────────────────────────────────────────────────────
async function telegram(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return res.json();
}

async function sendMessage(chatId, text, extra = {}) {
  return telegram('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true, ...extra });
}

async function sendPhoto(chatId, photo, caption, extra = {}) {
  return telegram('sendPhoto', { chat_id: chatId, photo, caption, parse_mode: 'Markdown', ...extra });
}

async function answerCallbackQuery(id, text) {
  return telegram('answerCallbackQuery', { callback_query_id: id, text });
}

async function setWebhook() {
  if (!WEBHOOK_URL) return;
  const r = await telegram('setWebhook', { url: WEBHOOK_URL });
  console.log('[Webhook]', r.ok ? 'Registrado com sucesso' : r.description);
}

// ─── Formatadores ─────────────────────────────────────────────────────────────
function stars(vote) {
  if (!vote) return '—';
  const n = parseFloat(vote);
  if (n >= 8) return '⭐ ' + n.toFixed(1);
  if (n >= 6) return '🌟 ' + n.toFixed(1);
  return '✨ ' + n.toFixed(1);
}

function genreList(genres) {
  if (!genres || !genres.length) return '';
  return genres.slice(0, 3).join(' · ');
}

function formatItem(item, index, type) {
  const isMovie  = type === 'movie';
  const title    = item.title || item.name || 'Sem título';
  const poster   = item.poster_path ? `${IMG_BASE}${item.poster_path}` : null;
  const year     = isMovie ? item.release_date : (item.first_air_date || item.release_date || '');
  const yearStr  = year ? year.substring(0, 4) : '—';
  const rating   = stars(item.vote_average);
  const genres   = genreList(item.genres);
  const desc     = item.overview ? item.overview.substring(0, 220) + '...' : 'Sem descrição disponível.';
  const seasons  = !isMovie && item.number_of_seasons ? `  |  📺 ${item.number_of_seasons} temp.` : '';
  const emoji    = isMovie ? '🎬' : '📺';
  const prefix   = index ? `*${index}. ${title}*` : `${emoji} *${title}*`;

  const text = [
    prefix,
    `${rating}  |  📅 ${yearStr}${genres ? `  |  🎭 ${genres}` : ''}${seasons}`,
    ``,
    desc,
    ``,
    `▶️ [Assistir no FliixHub](${SITE_URL})`,
    `📲 [Baixar o app](${DOWNLOAD_URL})`,
  ].join('\n');

  return { text, poster, title };
}

async function enrichAndFormat(item, index, type) {
  const enriched = await enrichWithTmdb(item, type);
  const result   = formatItem(enriched, index, type);
  trackClick(result.title);
  return result;
}

// ─── Teclados ─────────────────────────────────────────────────────────────────
const MAIN_KEYBOARD = {
  inline_keyboard: [
    [{ text: '🔍 Buscar conteúdo', callback_data: 'ask_search' }],
    [
      { text: '🎬 Filmes populares', callback_data: 'popular_movies' },
      { text: '📺 Séries populares', callback_data: 'popular_series' },
    ],
    [
      { text: '🆕 Novos filmes',    callback_data: 'new_movies'     },
      { text: '🆕 Novas séries',    callback_data: 'new_series'     },
    ],
    [
      { text: '🏆 Top 10 filmes',   callback_data: 'top10_movies'   },
      { text: '🏆 Top 10 séries',   callback_data: 'top10_series'   },
    ],
    [
      { text: '🎲 Surpreenda-me!',  callback_data: 'random'         },
      { text: '🎭 Por gênero',      callback_data: 'genres_menu'    },
    ],
    [
      { text: '▶️ Acessar FliixHub', url: SITE_URL    },
      { text: '📲 Baixar o app',     url: DOWNLOAD_URL },
    ],
  ],
};

const GENRE_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '💥 Ação',      callback_data: 'genre_Action'          },
      { text: '😂 Comédia',   callback_data: 'genre_Comedy'          },
      { text: '😱 Terror',    callback_data: 'genre_Horror'          },
    ],
    [
      { text: '💕 Romance',   callback_data: 'genre_Romance'         },
      { text: '🚀 Ficção',    callback_data: 'genre_Science Fiction' },
      { text: '🕵️ Thriller',  callback_data: 'genre_Thriller'        },
    ],
    [
      { text: '🎭 Drama',     callback_data: 'genre_Drama'           },
      { text: '🌀 Animação',  callback_data: 'genre_Animation'       },
      { text: '👨‍👩‍👧 Família',   callback_data: 'genre_Family'          },
    ],
    [
      { text: '🔫 Crime',     callback_data: 'genre_Crime'           },
      { text: '🧩 Mistério',  callback_data: 'genre_Mystery'         },
      { text: '⚔️ Aventura',  callback_data: 'genre_Adventure'       },
    ],
    [{ text: '⬅️ Voltar ao menu', callback_data: 'menu' }],
  ],
};

const ADMIN_KEYBOARD = {
  inline_keyboard: [
    [{ text: '📊 Estatísticas',        callback_data: 'admin_stats'      }],
    [{ text: '📢 Broadcast',           callback_data: 'admin_broadcast'  }],
    [{ text: '🆕 Postar novidade agora', callback_data: 'admin_post_now' }],
    [{ text: '⬅️ Sair do painel',       callback_data: 'menu'            }],
  ],
};

// ─── Handlers de conteúdo ─────────────────────────────────────────────────────
async function handleStart(chatId, firstName) {
  const name = firstName ? `, ${firstName}` : '';
  const text = [
    `🎬 *Bem-vindo ao FliixHub${name}!*`,
    ``,
    `Seu streaming favorito agora no Telegram.`,
    `Filmes, séries e muito mais — tudo direto aqui.`,
    ``,
    `💡 *Dica:* Manda o nome de qualquer filme ou série`,
    `e eu encontro pra você na hora!`,
    ``,
    `*O que deseja fazer?* 👇`,
  ].join('\n');
  await sendMessage(chatId, text, { reply_markup: MAIN_KEYBOARD });
}

async function handleHelp(chatId) {
  const text = [
    `📖 *Comandos disponíveis*`,
    ``,
    `🔍 *Busca:*`,
    `/buscar Breaking Bad`,
    `/filme Inception`,
    `/serie Friends`,
    `_ou manda o nome direto sem comando_`,
    ``,
    `📋 *Listas:*`,
    `/populares — mais vistos`,
    `/novidades — últimos adicionados`,
    `/top10 — ranking dos melhores`,
    `/aleatorio — sugestão surpresa`,
    `/genero ação — filtra por gênero`,
    ``,
    `ℹ️ *Outros:*`,
    `/sobre — sobre o FliixHub`,
    `/site — acessar o site`,
    `/download — baixar o app`,
    `/menu — voltar ao início`,
  ].join('\n');
  await sendMessage(chatId, text, { reply_markup: MAIN_KEYBOARD });
}

async function handleSobre(chatId) {
  const text = [
    `🎬 *FliixHub — Seu streaming completo*`,
    ``,
    `Filmes, séries e TV ao vivo num só lugar.`,
    ``,
    `✅ Catálogo atualizado diariamente`,
    `✅ Múltiplos perfis por conta`,
    `✅ Modo kids`,
    `✅ TV ao vivo`,
    `✅ Favoritos e histórico`,
    ``,
    `🌐 ${SITE_URL}`,
    `📲 ${DOWNLOAD_URL}`,
  ].join('\n');
  await sendMessage(chatId, text, { reply_markup: MAIN_KEYBOARD });
}

async function handleAskSearch(chatId) {
  const session = getSession(chatId);
  session.waitingSearch = true;
  await sendMessage(chatId, '🔍 *Digite o nome do filme ou série que deseja buscar:*');
}

async function handleSearch(chatId, query, type = 'all', page = 0) {
  if (!query || query.trim().length < 2) {
    return sendMessage(chatId, '❌ Digite pelo menos 2 letras para buscar.');
  }
  const session = getSession(chatId);
  session.lastSearch = { query, type };
  trackSearch(query, chatId);

  const LIMIT = 5;
  const from  = page * LIMIT;
  const results = [];

  if (type === 'all' || type === 'movie') {
    const { data: movies } = await supabase
      .from('movies_catalog').select('*').eq('has_stream', true)
      .ilike('title', `%${query}%`).order('vote_count', { ascending: false })
      .range(from, from + LIMIT - 1);
    (movies || []).forEach(m => results.push({ ...m, _type: 'movie' }));
  }

  if (type === 'all' || type === 'series') {
    const { data: series } = await supabase
      .from('series_catalog').select('*').eq('has_stream', true)
      .ilike('title', `%${query}%`).order('vote_count', { ascending: false })
      .range(from, from + LIMIT - 1);
    (series || []).forEach(s => results.push({ ...s, _type: 'series' }));
  }

  if (!results.length && page === 0) {
    return sendMessage(chatId,
      `😕 Nenhum resultado para *"${query}"*.\n\nTente outro título ou explore o catálogo.`,
      { reply_markup: MAIN_KEYBOARD }
    );
  }

  if (page === 0) await sendMessage(chatId, `🔍 Resultados para *"${query}"*:`);

  for (const item of results.slice(0, 5)) {
    const idx = results.indexOf(item) + 1 + page * 5;
    const { text, poster } = await enrichAndFormat(item, idx, item._type);
    if (poster) {
      await sendPhoto(chatId, poster, text).catch(() => sendMessage(chatId, text));
    } else {
      await sendMessage(chatId, text);
    }
    await new Promise(r => setTimeout(r, 250));
  }

  const hasMore = results.length >= 5;
  const keyboard = {
    inline_keyboard: [
      ...(hasMore ? [[{ text: 'Ver mais resultados ➡️', callback_data: `search_more_${page + 1}` }]] : []),
      [{ text: '🏠 Menu principal', callback_data: 'menu' }],
    ],
  };
  await sendMessage(chatId, hasMore ? `📄 Página ${page + 1}` : `✅ Fim dos resultados para *"${query}"*`, { reply_markup: keyboard });
}

async function handleList(chatId, table, order, label, emoji, page = 0) {
  const LIMIT = 5;
  const from  = page * LIMIT;
  const type  = table === 'movies_catalog' ? 'movie' : 'series';

  const { data, error } = await supabase
    .from(table).select('*').eq('has_stream', true)
    .not('poster_path', 'is', null)
    .order(order, { ascending: false })
    .range(from, from + LIMIT - 1);

  if (error || !data?.length) return sendMessage(chatId, `❌ Erro ao carregar. Tente novamente.`);
  if (page === 0) await sendMessage(chatId, `${emoji} *${label}*`);

  for (let i = 0; i < data.length; i++) {
    const { text, poster } = await enrichAndFormat(data[i], from + i + 1, type);
    if (poster) {
      await sendPhoto(chatId, poster, text).catch(() => sendMessage(chatId, text));
    } else {
      await sendMessage(chatId, text);
    }
    await new Promise(r => setTimeout(r, 250));
  }

  const context = `${table}|${order}|${label}|${emoji}`;
  const ctxKey  = Buffer.from(context).toString('base64').substring(0, 40);
  getSession(chatId)[ctxKey] = context;

  const hasMore = data.length === LIMIT;
  const keyboard = {
    inline_keyboard: [
      ...(hasMore ? [[{ text: 'Ver mais ➡️', callback_data: `list_${ctxKey}_${page + 1}` }]] : []),
      [{ text: '🏠 Menu principal', callback_data: 'menu' }],
    ],
  };
  await sendMessage(chatId, `📄 Página ${page + 1}`, { reply_markup: keyboard });
}

async function handleTop10(chatId, type) {
  const table = type === 'movie' ? 'movies_catalog' : 'series_catalog';
  const label = type === 'movie' ? 'Top 10 Filmes' : 'Top 10 Séries';
  await sendMessage(chatId, `🏆 *${label}*`);

  const { data, error } = await supabase
    .from(table).select('*').eq('has_stream', true)
    .not('poster_path', 'is', null)
    .order('vote_average', { ascending: false }).limit(10);

  if (error || !data?.length) return sendMessage(chatId, '❌ Erro ao carregar.');

  for (let i = 0; i < data.length; i++) {
    const medals  = ['🥇','🥈','🥉'];
    const prefix  = i < 3 ? medals[i] : `*${i + 1}.*`;
    const item    = data[i];
    const year    = (type === 'movie' ? item.release_date : item.first_air_date || '');
    const yearStr = year ? year.substring(0, 4) : '—';
    await sendMessage(chatId, `${prefix} ${item.title || item.name}  ${stars(item.vote_average)}  📅 ${yearStr}`);
    await new Promise(r => setTimeout(r, 150));
  }
  await sendMessage(chatId, `▶️ Assista agora em ${SITE_URL}`, { reply_markup: MAIN_KEYBOARD });
}

async function handleRandom(chatId) {
  await sendMessage(chatId, '🎲 Escolhendo uma surpresa pra você...');
  const isMovie = Math.random() > 0.5;
  const table   = isMovie ? 'movies_catalog' : 'series_catalog';
  const type    = isMovie ? 'movie' : 'series';

  const { count } = await supabase.from(table).select('*', { count: 'exact', head: true }).eq('has_stream', true);
  const offset = Math.floor(Math.random() * Math.min(count || 100, 200));

  const { data, error } = await supabase
    .from(table).select('*').eq('has_stream', true)
    .not('poster_path', 'is', null).range(offset, offset).limit(1);

  if (error || !data?.length) return sendMessage(chatId, '❌ Erro ao buscar sugestão.');

  const { text, poster } = await enrichAndFormat(data[0], null, type);
  const keyboard = {
    inline_keyboard: [
      [{ text: '🎲 Outra sugestão!', callback_data: 'random' }],
      [{ text: '🏠 Menu', callback_data: 'menu' }],
    ],
  };

  if (poster) {
    await sendPhoto(chatId, poster, text, { reply_markup: keyboard }).catch(() => sendMessage(chatId, text, { reply_markup: keyboard }));
  } else {
    await sendMessage(chatId, text, { reply_markup: keyboard });
  }
}

async function handleGenre(chatId, genre, page = 0) {
  const LIMIT = 4;
  const from  = page * LIMIT;

  const [{ data: movies }, { data: series }] = await Promise.all([
    supabase.from('movies_catalog').select('*').eq('has_stream', true)
      .or(`genres.cs.{"${genre}"}`).not('poster_path', 'is', null)
      .order('vote_count', { ascending: false }).range(from, from + 1),
    supabase.from('series_catalog').select('*').eq('has_stream', true)
      .or(`genres.cs.{"${genre}"}`).not('poster_path', 'is', null)
      .order('vote_count', { ascending: false }).range(from, from + 1),
  ]);

  const all = [
    ...(movies || []).map(m => ({ ...m, _type: 'movie' })),
    ...(series || []).map(s => ({ ...s, _type: 'series' })),
  ];

  if (!all.length && page === 0) return sendMessage(chatId, `😕 Nenhum conteúdo para *${genre}*.`, { reply_markup: GENRE_KEYBOARD });
  if (page === 0) await sendMessage(chatId, `🎭 *Melhores de ${genre}*`);

  for (let i = 0; i < all.length; i++) {
    const { text, poster } = await enrichAndFormat(all[i], from + i + 1, all[i]._type);
    if (poster) {
      await sendPhoto(chatId, poster, text).catch(() => sendMessage(chatId, text));
    } else {
      await sendMessage(chatId, text);
    }
    await new Promise(r => setTimeout(r, 250));
  }

  getSession(chatId).lastGenre = genre;
  const hasMore = all.length >= 4;
  const keyboard = {
    inline_keyboard: [
      ...(hasMore ? [[{ text: 'Ver mais ➡️', callback_data: `genre_more_${page + 1}` }]] : []),
      [{ text: '🎭 Outros gêneros', callback_data: 'genres_menu' }],
      [{ text: '🏠 Menu', callback_data: 'menu' }],
    ],
  };
  await sendMessage(chatId, `📄 Página ${page + 1}`, { reply_markup: keyboard });
}

// ─── Painel Admin ─────────────────────────────────────────────────────────────
async function handleAdmin(chatId) {
  const text = [
    `🔐 *Painel Admin — FliixHub*`,
    ``,
    `Olá, @${ADMIN_USERNAME}! O que deseja fazer?`,
  ].join('\n');
  await sendMessage(chatId, text, { reply_markup: ADMIN_KEYBOARD });
}

async function handleAdminStats(chatId) {
  const totalUsers   = botUsers.size;
  const topSearches  = [...searchStats.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map((e, i) => `${i + 1}. *${e[0]}* — ${e[1]}x`).join('\n') || 'Nenhuma ainda';
  const topClicks    = [...clickStats.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map((e, i) => `${i + 1}. *${e[0]}* — ${e[1]}x`).join('\n') || 'Nenhum ainda';

  const text = [
    `📊 *Estatísticas do Bot*`,
    ``,
    `👥 *Usuários totais:* ${totalUsers}`,
    ``,
    `🔍 *Buscas mais feitas:*`,
    topSearches,
    ``,
    `🎬 *Conteúdos mais clicados:*`,
    topClicks,
  ].join('\n');

  await sendMessage(chatId, text, { reply_markup: ADMIN_KEYBOARD });
}

async function handleAdminBroadcast(chatId) {
  const session = getSession(chatId);
  session.waitingBroadcast = true;
  const text = [
    `📢 *Broadcast*`,
    ``,
    `Digite a mensagem que deseja enviar para *todos os ${botUsers.size} usuários*:`,
    ``,
    `_Digite /cancelar para cancelar._`,
  ].join('\n');
  await sendMessage(chatId, text);
}

async function sendBroadcast(chatId, message) {
  const session = getSession(chatId);
  session.waitingBroadcast = false;

  const ids    = [...botUsers.keys()];
  let sent     = 0;
  let failed   = 0;

  await sendMessage(chatId, `📢 Enviando para ${ids.length} usuários...`);

  for (const uid of ids) {
    if (uid === chatId) continue;
    try {
      await sendMessage(uid, message);
      sent++;
    } catch { failed++; }
    await new Promise(r => setTimeout(r, 50));
  }

  await sendMessage(chatId,
    `✅ *Broadcast concluído!*\n\n✔️ Enviado: ${sent}\n❌ Falhou: ${failed}`,
    { reply_markup: ADMIN_KEYBOARD }
  );
}

// ─── Novidades automáticas no grupo ──────────────────────────────────────────
async function postNewContent() {
  try {
    // Filme mais recente
    const { data: movies } = await supabase
      .from('movies_catalog').select('*').eq('has_stream', true)
      .not('poster_path', 'is', null)
      .order('created_at', { ascending: false }).limit(1);

    if (movies?.length) {
      const movie = movies[0];
      if (movie.id !== lastPostedMovie) {
        lastPostedMovie = movie.id;
        const enriched = await enrichWithTmdb(movie, 'movie');
        const { text, poster } = formatItem(enriched, null, 'movie');
        const msg = `🆕 *NOVO FILME ADICIONADO!*\n\n${text}`;
        if (poster) {
          await sendPhoto(GROUP_ID, poster, msg).catch(() => sendMessage(GROUP_ID, msg));
        } else {
          await sendMessage(GROUP_ID, msg);
        }
        console.log('[Novidades] Filme postado no grupo:', movie.title);
      }
    }

    // Aguarda 10s entre posts
    await new Promise(r => setTimeout(r, 10000));

    // Série mais recente
    const { data: series } = await supabase
      .from('series_catalog').select('*').eq('has_stream', true)
      .not('poster_path', 'is', null)
      .order('created_at', { ascending: false }).limit(1);

    if (series?.length) {
      const serie = series[0];
      if (serie.id !== lastPostedSeries) {
        lastPostedSeries = serie.id;
        const enriched = await enrichWithTmdb(serie, 'series');
        const { text, poster } = formatItem(enriched, null, 'series');
        const msg = `🆕 *NOVA SÉRIE ADICIONADA!*\n\n${text}`;
        if (poster) {
          await sendPhoto(GROUP_ID, poster, msg).catch(() => sendMessage(GROUP_ID, msg));
        } else {
          await sendMessage(GROUP_ID, msg);
        }
        console.log('[Novidades] Série postada no grupo:', serie.title || serie.name);
      }
    }
  } catch (e) {
    console.error('[Novidades] Erro:', e.message);
  }
}

async function handleAdminPostNow(chatId) {
  await sendMessage(chatId, '📤 Postando novidades no grupo agora...');
  // Força repost zerando o controle
  lastPostedMovie  = null;
  lastPostedSeries = null;
  await postNewContent();
  await sendMessage(chatId, '✅ Novidades postadas no grupo!', { reply_markup: ADMIN_KEYBOARD });
}

// ─── Boas-vindas no grupo ─────────────────────────────────────────────────────
async function handleNewGroupMember(member, chatId) {
  if (chatId !== GROUP_ID) return;
  const name = member.first_name || 'novo membro';
  const text = [
    `👋 *Bem-vindo(a) ao FliixHub, ${name}!*`,
    ``,
    `Que bom ter você aqui! 🎬`,
    ``,
    `📌 Aqui você fica por dentro de tudo:`,
    `• 🆕 Novos filmes e séries adicionados`,
    `• 🔥 Conteúdos em destaque`,
    `• 📣 Novidades do streaming`,
    ``,
    `▶️ Acesse agora: ${SITE_URL}`,
    `📲 Baixe o app: ${DOWNLOAD_URL}`,
    ``,
    `🤖 Use nosso bot para buscar conteúdo!`,
  ].join('\n');
  await sendMessage(GROUP_ID, text);
}

// ─── Processador principal ────────────────────────────────────────────────────
async function processUpdate(update) {

  // Novo membro no grupo
  if (update.message?.new_chat_members) {
    for (const member of update.message.new_chat_members) {
      if (!member.is_bot) await handleNewGroupMember(member, update.message.chat.id);
    }
    return;
  }

  // Callback de botão
  if (update.callback_query) {
    const cb      = update.callback_query;
    const chatId  = cb.message.chat.id;
    const data    = cb.data;
    const session = getSession(chatId);

    registerUser(cb.from, chatId);
    await answerCallbackQuery(cb.id);

    if (data === 'menu')            return handleStart(chatId);
    if (data === 'ask_search')      return handleAskSearch(chatId);
    if (data === 'random')          return handleRandom(chatId);
    if (data === 'genres_menu')     return sendMessage(chatId, '🎭 *Escolha um gênero:*', { reply_markup: GENRE_KEYBOARD });
    if (data === 'popular_movies')  return handleList(chatId, 'movies_catalog', 'vote_count', 'Filmes Populares', '🔥');
    if (data === 'popular_series')  return handleList(chatId, 'series_catalog', 'vote_count', 'Séries Populares', '🔥');
    if (data === 'new_movies')      return handleList(chatId, 'movies_catalog', 'created_at', 'Novos Filmes', '🆕');
    if (data === 'new_series')      return handleList(chatId, 'series_catalog', 'created_at', 'Novas Séries', '🆕');
    if (data === 'top10_movies')    return handleTop10(chatId, 'movie');
    if (data === 'top10_series')    return handleTop10(chatId, 'series');
    if (data === 'admin_stats')     return isAdmin(chatId) ? handleAdminStats(chatId)    : null;
    if (data === 'admin_broadcast') return isAdmin(chatId) ? handleAdminBroadcast(chatId): null;
    if (data === 'admin_post_now')  return isAdmin(chatId) ? handleAdminPostNow(chatId)  : null;

    if (data.startsWith('genre_more_')) {
      const page = parseInt(data.replace('genre_more_', '')) || 0;
      return handleGenre(chatId, session.lastGenre || 'Action', page);
    }
    if (data.startsWith('genre_')) return handleGenre(chatId, data.replace('genre_', ''), 0);

    if (data.startsWith('search_more_')) {
      const page = parseInt(data.replace('search_more_', '')) || 0;
      if (session.lastSearch) return handleSearch(chatId, session.lastSearch.query, session.lastSearch.type, page);
    }

    if (data.startsWith('list_')) {
      const parts  = data.split('_');
      const page   = parseInt(parts[parts.length - 1]) || 0;
      const ctxKey = parts.slice(1, parts.length - 1).join('_');
      const ctx    = session[ctxKey];
      if (ctx) {
        const [table, order, label, emoji] = ctx.split('|');
        return handleList(chatId, table, order, label, emoji, page);
      }
    }
    return;
  }

  // Mensagem de texto
  if (!update.message?.text) return;

  const msg       = update.message;
  const chatId    = msg.chat.id;
  const text      = msg.text.trim();
  const firstName = msg.from?.first_name;
  const session   = getSession(chatId);

  // Ignora mensagens do próprio grupo (exceto comandos)
  if (chatId === GROUP_ID && !text.startsWith('/')) return;

  registerUser(msg.from, chatId);

  // Aguardando broadcast
  if (session.waitingBroadcast && isAdmin(chatId)) {
    if (text === '/cancelar') {
      session.waitingBroadcast = false;
      return sendMessage(chatId, '❌ Broadcast cancelado.', { reply_markup: ADMIN_KEYBOARD });
    }
    return sendBroadcast(chatId, text);
  }

  // Aguardando busca via botão
  if (session.waitingSearch && !text.startsWith('/')) {
    session.waitingSearch = false;
    return handleSearch(chatId, text, 'all', 0);
  }

  // Comandos
  if (text.startsWith('/start'))    return handleStart(chatId, firstName);
  if (text.startsWith('/help') || text === '/ajuda') return handleHelp(chatId);
  if (text.startsWith('/menu'))     return handleStart(chatId, firstName);
  if (text.startsWith('/sobre'))    return handleSobre(chatId);
  if (text.startsWith('/admin'))    return isAdmin(chatId) ? handleAdmin(chatId) : sendMessage(chatId, '⛔ Acesso negado.');
  if (text.startsWith('/cancelar')) return sendMessage(chatId, '✅ Operação cancelada.', { reply_markup: MAIN_KEYBOARD });
  if (text.startsWith('/site'))     return sendMessage(chatId, `🌐 ${SITE_URL}`, { reply_markup: MAIN_KEYBOARD });
  if (text.startsWith('/download')) return sendMessage(chatId, `📲 ${DOWNLOAD_URL}`, { reply_markup: MAIN_KEYBOARD });
  if (text.startsWith('/aleatorio') || text.startsWith('/random')) return handleRandom(chatId);

  if (text.startsWith('/populares') || text.startsWith('/popular')) {
    await handleList(chatId, 'movies_catalog', 'vote_count', 'Filmes Populares', '🔥');
    return handleList(chatId, 'series_catalog', 'vote_count', 'Séries Populares', '🔥');
  }
  if (text.startsWith('/novidades')) {
    await handleList(chatId, 'movies_catalog', 'created_at', 'Novos Filmes', '🆕');
    return handleList(chatId, 'series_catalog', 'created_at', 'Novas Séries', '🆕');
  }
  if (text.startsWith('/top10')) {
    await handleTop10(chatId, 'movie');
    return handleTop10(chatId, 'series');
  }

  if (text.startsWith('/buscar ') || text.startsWith('/search '))  return handleSearch(chatId, text.split(' ').slice(1).join(' '), 'all');
  if (text.startsWith('/filme ')  || text.startsWith('/movie '))   return handleSearch(chatId, text.split(' ').slice(1).join(' '), 'movie');
  if (text.startsWith('/serie ')  || text.startsWith('/series '))  return handleSearch(chatId, text.split(' ').slice(1).join(' '), 'series');
  if (text.startsWith('/genero ') || text.startsWith('/genre '))   return handleGenre(chatId, text.split(' ').slice(1).join(' '));

  // Texto livre = busca automática
  if (!text.startsWith('/')) return handleSearch(chatId, text, 'all', 0);

  return sendMessage(chatId, `❓ Comando não reconhecido. Use /help para ver os comandos.`, { reply_markup: MAIN_KEYBOARD });
}

// ─── Servidor HTTP ────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      try { await processUpdate(JSON.parse(body)); } catch (e) { console.error('[Bot]', e.message); }
      res.writeHead(200); res.end('OK');
    });
  } else if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('FliixHub Bot online! 🎬');
  } else {
    res.writeHead(404); res.end();
  }
});

// ─── Polling ──────────────────────────────────────────────────────────────────
async function polling() {
  let offset = 0;
  console.log('[Bot] Polling iniciado...');
  while (true) {
    try {
      const res  = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${offset}&timeout=30`);
      const json = await res.json();
      if (json.ok && json.result.length) {
        for (const update of json.result) {
          offset = update.update_id + 1;
          processUpdate(update).catch(e => console.error('[Bot]', e.message));
        }
      }
    } catch (e) {
      console.error('[Polling]', e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ─── Verificador de novidades (a cada 30 min) ─────────────────────────────────
function startNewsChecker() {
  console.log('[Novidades] Verificador iniciado — checa a cada 30 minutos');
  postNewContent(); // roda imediatamente ao iniciar
  setInterval(postNewContent, 30 * 60 * 1000);
}

// ─── Inicialização ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

if (WEBHOOK_URL) {
  server.listen(PORT, async () => {
    console.log(`[Bot] Servidor na porta ${PORT}`);
    await setWebhook();
    startNewsChecker();
  });
} else {
  startNewsChecker();
  polling();
}
