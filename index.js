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
    [{ text: '📊 Estatísticas',          callback_data: 'admin_stats'      }],
    [{ text: '📢 Broadcast',             callback_data: 'admin_broadcast'  }],
    [{ text: '🆕 Postar novidade agora', callback_data: 'admin_post_now'   }],
    [{ text: '🛡️ Moderação do grupo',    callback_data: 'admin_mod'        }],
    [{ text: '⬅️ Sair do painel',        callback_data: 'menu'             }],
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

  // Moderação de mensagens do grupo
  if (update.message?.chat?.id === GROUP_ID && update.message?.from) {
    const blocked = await moderateMessage(update.message);
    if (blocked) return;
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
    if (data === 'admin_stats')      return isAdmin(chatId) ? handleAdminStats(chatId)       : null;
    if (data === 'admin_broadcast')  return isAdmin(chatId) ? handleAdminBroadcast(chatId)  : null;
    if (data === 'admin_post_now')   return isAdmin(chatId) ? handleAdminPostNow(chatId)    : null;
    if (data === 'admin_mod' || data === 'mod_panel') return isAdmin(chatId) ? handleModPanel(chatId) : null;
    if (data === 'mod_badwords_menu')  return isAdmin(chatId) ? handleModBadwordsMenu(chatId)  : null;
    if (data === 'mod_whitelist_menu') return isAdmin(chatId) ? handleModWhitelistMenu(chatId) : null;
    if (data === 'mod_view_warns')     return isAdmin(chatId) ? handleModViewWarns(chatId)     : null;
    if (data === 'mod_user_menu')      return isAdmin(chatId) ? handleModUserMenu(chatId)      : null;
    if (data === 'mod_set_warnlimit')  return isAdmin(chatId) ? handleModSetWarnLimit(chatId)  : null;
    if (data === 'mod_set_mute')       return isAdmin(chatId) ? handleModSetMute(chatId)       : null;
    if (data.startsWith('mod_toggle_'))  { if (isAdmin(chatId)) return handleModToggle(chatId, data); return; }
    if (data.startsWith('mod_action_'))  { if (isAdmin(chatId)) return executeModAction(chatId, data.replace('mod_action_', '')); return; }
    if (data.startsWith('mod_approve_')) {
      if (isAdmin(chatId)) {
        const msgId = data.replace('mod_approve_', '');
        const pending = pendingMsgs.get(parseInt(msgId));
        if (pending) { await sendMessage(GROUP_ID, pending.text); pendingMsgs.delete(parseInt(msgId)); }
        return sendMessage(chatId, '✅ Mensagem aprovada e enviada no grupo.');
      }
    }
    if (data.startsWith('mod_reject_')) {
      if (isAdmin(chatId)) {
        const parts = data.replace('mod_reject_', '').split('_');
        pendingMsgs.delete(parseInt(parts[0]));
        return sendMessage(chatId, '❌ Mensagem rejeitada.');
      }
    }
    if (data === 'admin_menu') return isAdmin(chatId) ? handleAdmin(chatId) : null;

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

// ─── Handler webhook Supabase (novidades instantâneas) ───────────────────────
// Guarda IDs já postados pra não duplicar
const postedIds = new Set();

// ─── Gerador de Poster estilo cinema ─────────────────────────────────────────
function buildPosterHtml(data) {
  const { title, year, runtime, rating, genres, overview, posterUrl, backdropUrl, type } = data;
  const ratingDisplay = rating ? parseFloat(rating).toFixed(1) : '—';
  const genreDisplay  = (genres || []).slice(0, 3).join(' • ').toUpperCase();
  const overviewShort = overview ? overview.substring(0, 220) + (overview.length > 220 ? '...' : '') : '';
  const typeLabel     = type === 'movie' ? 'NO CATÁLOGO' : 'NOVA SÉRIE';
  const bgImg         = backdropUrl || posterUrl || '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,900&display=swap" rel="stylesheet">
<style>
* { margin:0; padding:0; box-sizing:border-box; }

body {
  width: 840px;
  height: 1260px;
  background: #000;
  font-family: 'Inter', sans-serif;
  overflow: hidden;
  position: relative;
}

/* ── IMAGEM DE FUNDO FULL ── */
.bg {
  position: absolute;
  inset: 0;
  background-image: url('${bgImg}');
  background-size: cover;
  background-position: center top;
  z-index: 0;
}

/* overlay escuro na esquerda — exatamente como no exemplo */
.bg::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(to right,
      rgba(0,0,0,0.97) 0%,
      rgba(0,0,0,0.92) 30%,
      rgba(0,0,0,0.55) 52%,
      rgba(0,0,0,0.0)  100%
    ),
    linear-gradient(to top,
      rgba(0,0,0,0.6) 0%,
      transparent 40%
    );
}

/* ── LINHA DIAGONAL ── */
.line {
  position: absolute;
  top: 0;
  left: 52%;
  width: 2.5px;
  height: 100%;
  background: linear-gradient(180deg, #6d28d9 0%, #4f46e5 30%, #3b82f6 60%, #6d28d9 100%);
  transform: skewX(-2deg);
  z-index: 10;
  box-shadow: 0 0 12px rgba(109,40,217,0.9), 0 0 30px rgba(79,70,229,0.5);
}

/* ── CONTEÚDO ── */
.wrap {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  padding: 44px 44px 36px;
  width: 56%;
}

/* Logo topo */
.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 32px;
}
.logo-icon {
  width: 38px; height: 38px;
  background: linear-gradient(135deg, #7c3aed, #3b82f6);
  border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
}
.logo-icon svg { width: 20px; height: 20px; fill: white; }
.logo-name {
  font-size: 26px; font-weight: 800;
  color: #fff; letter-spacing: -0.3px;
}
.logo-name b { color: #818cf8; font-weight: 800; }

/* NOVO */
.novo-block { margin-bottom: 16px; }
.novo-big {
  font-family: 'Bebas Neue', cursive;
  font-size: 56px;
  letter-spacing: 5px;
  color: #a78bfa;
  line-height: 1;
  font-style: italic;
}
.novo-sub {
  font-size: 12px; font-weight: 700;
  letter-spacing: 4px; color: #7c3aed;
  text-transform: uppercase;
}

/* divisor roxo */
.bar {
  width: 48px; height: 3px;
  background: linear-gradient(90deg, #7c3aed, #3b82f6);
  border-radius: 2px;
  margin: 14px 0 18px;
}

/* TÍTULO grande */
.title {
  font-family: 'Bebas Neue', cursive;
  font-size: 88px;
  line-height: 0.9;
  letter-spacing: 2px;
  color: #fff;
  text-transform: uppercase;
  margin-bottom: 24px;
  text-shadow: 3px 3px 0 #000, 0 0 40px rgba(124,58,237,0.3);
  word-break: break-word;
  flex-shrink: 0;
}

/* Meta */
.meta {
  display: flex;
  align-items: center;
  gap: 0;
  margin-bottom: 10px;
  font-size: 15px;
  font-weight: 600;
  color: #e2e8f0;
}
.meta-item { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.meta-sep { margin: 0 12px; color: #475569; }

/* Gêneros */
.genres {
  font-size: 13px; font-weight: 700;
  letter-spacing: 2px; color: #818cf8;
  text-transform: uppercase;
  margin-bottom: 18px;
}

/* Sinopse */
.overview {
  font-size: 14px;
  line-height: 1.75;
  color: #cbd5e1;
  margin-bottom: 0;
  flex: 1;
  overflow: hidden;
}

/* Botão */
.btn-wrap { margin-top: 28px; }
.btn {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 28px;
  background: linear-gradient(135deg, #7c3aed, #4f46e5, #3b82f6);
  border-radius: 50px;
  border: 2px solid rgba(167,139,250,0.5);
  font-size: 18px; font-weight: 800;
  letter-spacing: 2px; color: #fff;
  text-transform: uppercase;
  box-shadow: 0 0 30px rgba(109,40,217,0.6), 0 8px 24px rgba(0,0,0,0.5);
  width: 100%;
  justify-content: center;
}
.btn-play {
  width: 32px; height: 32px;
  background: rgba(255,255,255,0.15);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px;
  padding-left: 3px;
  flex-shrink: 0;
}

/* Footer */
.footer {
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.footer-label {
  font-size: 13px; font-weight: 700;
  letter-spacing: 2px; color: #6d28d9;
  text-transform: uppercase;
}
.footer-logo {
  display: flex; align-items: center; gap: 10px;
}
.footer-logo-icon {
  width: 32px; height: 32px;
  background: linear-gradient(135deg, #7c3aed, #3b82f6);
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
}
.footer-logo-icon svg { width: 18px; height: 18px; fill: white; }
.footer-logo-name {
  font-size: 30px; font-weight: 800;
  background: linear-gradient(135deg, #818cf8, #3b82f6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.devices {
  display: flex; align-items: center; gap: 10px; margin-top: 4px;
}
.dev-icons { display: flex; gap: 8px; align-items: center; }
.dev-icon { color: #4b5563; font-size: 16px; }
.dev-text {
  font-size: 10px; font-weight: 600;
  letter-spacing: 2px; color: #4b5563;
  text-transform: uppercase;
}
</style>
</head>
<body>

<div class="bg"></div>
<div class="line"></div>

<div class="wrap">
  <!-- Logo -->
  <div class="logo">
    <div class="logo-icon">
      <svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
    </div>
    <div class="logo-name">Fl<b>i</b>xhub</div>
  </div>

  <!-- NOVO -->
  <div class="novo-block">
    <div class="novo-big">NOVO</div>
    <div class="novo-sub">${typeLabel}</div>
  </div>

  <div class="bar"></div>

  <!-- Título -->
  <div class="title">${title}</div>

  <!-- Meta -->
  <div class="meta">
    <div class="meta-item">📅 ${year}</div>
    ${runtime ? '<span class="meta-sep">|</span><div class="meta-item">⏱ ' + runtime + '</div>' : ''}
    <span class="meta-sep">|</span>
    <div class="meta-item">⭐ ${ratingDisplay}/10</div>
  </div>

  <!-- Gêneros -->
  <div class="genres">${genreDisplay}</div>

  <!-- Sinopse -->
  <div class="overview">${overviewShort}</div>

  <!-- Botão -->
  <div class="btn-wrap">
    <div class="btn">
      <div class="btn-play">▶</div>
      ASSISTA AGORA
    </div>
  </div>

  <!-- Footer -->
  <div class="footer">
    <div class="footer-label">SÓ NO</div>
    <div class="footer-logo">
      <div class="footer-logo-icon">
        <svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
      </div>
      <div class="footer-logo-name">Flixhub</div>
    </div>
    <div class="devices">
      <div class="dev-icons">
        <span class="dev-icon">📱</span>
        <span class="dev-icon">💻</span>
        <span class="dev-icon">🖥️</span>
      </div>
      <div class="dev-text">Disponível em todos os dispositivos</div>
    </div>
  </div>
</div>

</body>
</html>`;
}


async function generatePosterUrl(data) {
  const HCTI_USER = process.env.HCTI_USER_ID;
  const HCTI_KEY  = process.env.HCTI_API_KEY;

  if (!HCTI_USER || !HCTI_KEY) {
    console.log('[Poster] HCTI não configurado — usando foto simples do TMDB');
    return null;
  }

  try {
    // Converte imagens do TMDB para base64 pra o HCTI conseguir renderizar
    async function imgToBase64(url) {
      try {
        const r = await fetch(url);
        if (!r.ok) return null;
        const buf = await r.arrayBuffer();
        const b64 = Buffer.from(buf).toString('base64');
        const mime = 'image/jpeg';
        return 'data:' + mime + ';base64,' + b64;
      } catch { return null; }
    }

    console.log('[Poster] Baixando imagens do TMDB...');
    const [posterB64, backdropB64] = await Promise.all([
      data.posterUrl   ? imgToBase64(data.posterUrl)   : Promise.resolve(null),
      data.backdropUrl ? imgToBase64(data.backdropUrl) : Promise.resolve(null),
    ]);

    // Substitui URLs por base64 no HTML
    const dataWithB64 = {
      ...data,
      posterUrl:   posterB64   || data.posterUrl,
      backdropUrl: backdropB64 || data.backdropUrl || posterB64 || data.posterUrl,
    };

    const html = buildPosterHtml(dataWithB64);
    const auth = Buffer.from(HCTI_USER + ':' + HCTI_KEY).toString('base64');

    console.log('[Poster] Enviando para HCTI...');
    const res = await fetch('https://hcti.io/v1/image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + auth,
      },
      body: JSON.stringify({
        html,
        viewport_width:  900,
        viewport_height: 1350,
        device_scale:    1,
        format:          'png',
      }),
    });

    const json = await res.json();
    if (!json.url) {
      console.error('[Poster] HCTI erro:', JSON.stringify(json));
      return null;
    }

    console.log('[Poster] ✅ URL gerada:', json.url);
    return json.url;

  } catch (e) {
    console.error('[Poster] Erro ao gerar:', e.message);
    return null;
  }
}

async function sendPosterToGroup(record, contentType) {
  const isMovie    = contentType === 'movie';
  const enriched   = await enrichWithTmdb(record, contentType);
  const title      = enriched.title || enriched.name || 'Sem título';
  const year       = (isMovie ? enriched.release_date : enriched.first_air_date || '')?.substring(0, 4) || '—';
  const runtimeRaw = isMovie ? enriched.runtime : null;
  const runtime    = runtimeRaw ? Math.floor(runtimeRaw / 60) + 'h ' + (runtimeRaw % 60) + 'min' : null;
  const rating     = enriched.vote_average;
  const genres     = enriched.genres || [];
  const overview   = enriched.overview || '';
  const posterUrl  = enriched.poster_path  ? 'https://image.tmdb.org/t/p/original' + enriched.poster_path  : null;
  const backdropUrl = enriched.backdrop_path ? 'https://image.tmdb.org/t/p/original' + enriched.backdrop_path : posterUrl;

  const label   = isMovie ? '🎬 *NOVO FILME NO CATÁLOGO!*' : '📺 *NOVA SÉRIE NO CATÁLOGO!*';
  const caption = [
    label, '',
    '*' + title + '*',
    '⭐ ' + (parseFloat(rating || 0).toFixed(1)) + '/10  |  📅 ' + year + (runtime ? '  |  ⏱ ' + runtime : ''),
    genres.length ? '🎭 ' + genres.slice(0, 3).join(' · ') : '',
    '',
    overview ? overview.substring(0, 180) + '...' : '',
    '',
    '▶️ [Assistir agora](' + SITE_URL + ')',
    '📲 [Baixar o app](' + DOWNLOAD_URL + ')',
  ].filter(Boolean).join('\n');

  // Tenta gerar poster personalizado via HCTI
  if (posterUrl) {
    const posterImgUrl = await generatePosterUrl({
      title, year, runtime, rating, genres, overview, posterUrl, backdropUrl, type: contentType,
    }).catch(e => { console.error('[Poster] Erro:', e.message); return null; });

    if (posterImgUrl) {
      // Envia a URL da imagem gerada pelo HCTI diretamente pro Telegram
      const res = await telegram('sendPhoto', {
        chat_id:    GROUP_ID,
        photo:      posterImgUrl,
        caption,
        parse_mode: 'Markdown',
      });

      if (res.ok) {
        console.log('[Supabase] ✅ Poster personalizado postado no grupo!');
        return;
      }

      // Se a URL falhou, tenta baixar como buffer e mandar como arquivo
      console.log('[Poster] URL falhou, tentando como arquivo...', res.description);
      try {
        const imgRes = await fetch(posterImgUrl);
        if (imgRes.ok) {
          const FormData = require('form-data');
          const buf  = Buffer.from(await imgRes.arrayBuffer());
          const form = new FormData();
          form.append('chat_id', GROUP_ID);
          form.append('photo', buf, { filename: 'poster.png', contentType: 'image/png' });
          form.append('caption', caption);
          form.append('parse_mode', 'Markdown');
          const res2 = await fetch(
            'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendPhoto',
            { method: 'POST', body: form }
          );
          const json2 = await res2.json();
          if (json2.ok) {
            console.log('[Supabase] ✅ Poster enviado como arquivo!');
            return;
          }
          console.log('[Poster] Falha também como arquivo:', json2.description);
        }
      } catch (e2) {
        console.error('[Poster] Erro ao baixar/enviar:', e2.message);
      }
    }
  }

  // Fallback: foto simples do TMDB
  console.log('[Poster] Usando foto simples do TMDB como fallback');
  const { text, poster } = formatItem(enriched, null, contentType);
  const msg = label + '\n\n' + text;
  if (poster) {
    await sendPhoto(GROUP_ID, poster, msg).catch(() => sendMessage(GROUP_ID, msg));
  } else {
    await sendMessage(GROUP_ID, msg);
  }
}

async function handleSupabaseWebhook(body) {
  try {
    console.log('[Supabase] Payload recebido:', body.substring(0, 400));

    const payload = JSON.parse(body);
    const { type, table, record } = payload;

    console.log('[Supabase] type:', type, '| table:', table, '| title:', record && (record.title || record.name));

    if (!['INSERT', 'UPDATE'].includes(type) || !record) {
      console.log('[Supabase] Ignorado — type invalido ou sem record');
      return;
    }

    const isMovie  = table === 'movies_catalog';
    const isSeries = table === 'series_catalog';
    if (!isMovie && !isSeries) {
      console.log('[Supabase] Ignorado — tabela nao reconhecida:', table);
      return;
    }

    const uniqueKey = table + '_' + record.id;
    if (postedIds.has(uniqueKey)) {
      console.log('[Supabase] Ignorado — ja postado:', uniqueKey);
      return;
    }
    postedIds.add(uniqueKey);

    if (postedIds.size > 200) {
      const first = postedIds.values().next().value;
      postedIds.delete(first);
    }

    const contentType = isMovie ? 'movie' : 'series';
    await sendPosterToGroup(record, contentType);

  } catch (e) {
    console.error('[Supabase Webhook] Erro:', e.message);
  }
}

// ─── Servidor HTTP ────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => (body += chunk));
  req.on('end', async () => {
    try {
      if (req.method === 'POST' && req.url === '/webhook') {
        await processUpdate(JSON.parse(body));
        res.writeHead(200); res.end('OK');
        return;
      }
      if (req.method === 'POST' && req.url === '/supabase-webhook') {
        handleSupabaseWebhook(body); // sem await — responde rápido pro Supabase
        res.writeHead(200); res.end('OK');
        return;
      }
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('FliixHub Bot online! 🎬');
        return;
      }
      res.writeHead(404); res.end();
    } catch (e) {
      console.error('[Server]', e.message);
      res.writeHead(500); res.end();
    }
  });
});

// ─── Polling (modo local) ─────────────────────────────────────────────────────
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


// ══════════════════════════════════════════════════════════════════════════════
// MODERAÇÃO AVANÇADA DO GRUPO
// ══════════════════════════════════════════════════════════════════════════════

// ─── Estado da moderação ──────────────────────────────────────────────────────
const modConfig = {
  enabled:           true,   // moderação ligada/desligada
  antiSpam:          true,   // anti-spam ativo
  antiLink:          true,   // bloqueia links externos
  antiTmdb:          false,  // permite links do tmdb
  approvalMode:      false,  // modo aprovação — mensagens precisam de ok
  antiBadWords:      true,   // bloqueia palavrões
  antiForward:       false,  // bloqueia mensagens encaminhadas
  antiCaps:          true,   // bloqueia texto em CAPS LOCK excessivo
  antiFlood:         true,   // bloqueia flood de mensagens
  welcomeEnabled:    true,   // mensagem de boas-vindas ativa
  warnLimit:         3,      // avisos antes do ban
  muteDuration:      10,     // minutos de mute padrão
  slowMode:          0,      // segundos entre mensagens (0 = desligado)
};

// Palavras proibidas (admin pode adicionar/remover)
const badWords = new Set([
  'palavrao1', 'palavrao2', // placeholder — admin adiciona pelo bot
]);

// Links permitidos (whitelist)
const allowedDomains = new Set([
  'flixhub.space',
  't.me',
  'youtube.com',
  'youtu.be',
]);

// Controle de warns e mutes
const userWarns    = new Map(); // userId → count
const userMuted    = new Map(); // userId → timestamp de unmute
const floodControl = new Map(); // userId → { count, lastMsg }
const pendingMsgs  = new Map(); // messageId → { userId, text, approved }

// ─── Utilitários de moderação ─────────────────────────────────────────────────
function getWarns(userId) { return userWarns.get(userId) || 0; }

function addWarn(userId) {
  const w = getWarns(userId) + 1;
  userWarns.set(userId, w);
  return w;
}

function resetWarns(userId) { userWarns.delete(userId); }

function isMuted(userId) {
  const until = userMuted.get(userId);
  if (!until) return false;
  if (Date.now() < until) return true;
  userMuted.delete(userId);
  return false;
}

function muteUser(userId, minutes) {
  userMuted.set(userId, Date.now() + minutes * 60 * 1000);
}

function isFlood(userId) {
  if (!modConfig.antiFlood) return false;
  const now  = Date.now();
  const data = floodControl.get(userId) || { count: 0, lastMsg: 0 };

  if (now - data.lastMsg < 3000) {
    data.count++;
  } else {
    data.count = 1;
  }
  data.lastMsg = now;
  floodControl.set(userId, data);
  return data.count >= 5; // 5 msgs em 3s = flood
}

function hasExternalLink(text) {
  if (!modConfig.antiLink) return false;
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  const matches  = text.match(urlRegex) || [];
  for (const url of matches) {
    const allowed = [...allowedDomains].some(d => url.includes(d));
    if (!allowed) return true;
  }
  return false;
}

function hasBadWord(text) {
  if (!modConfig.antiBadWords || !badWords.size) return false;
  const lower = text.toLowerCase();
  for (const word of badWords) {
    if (lower.includes(word.toLowerCase())) return true;
  }
  return false;
}

function isCapsAbuse(text) {
  if (!modConfig.antiCaps) return false;
  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 8) return false;
  const caps = letters.replace(/[^A-Z]/g, '').length;
  return caps / letters.length > 0.7; // mais de 70% maiúsculas
}

function isSlowModeViolation(userId) {
  if (!modConfig.slowMode) return false;
  const last = floodControl.get('slow_' + userId) || 0;
  if (Date.now() - last < modConfig.slowMode * 1000) return true;
  floodControl.set('slow_' + userId, Date.now());
  return false;
}

// ─── Ações de moderação ───────────────────────────────────────────────────────
async function deleteMessage(chatId, messageId) {
  return telegram('deleteMessage', { chat_id: chatId, message_id: messageId });
}

async function muteInGroup(userId, minutes) {
  muteUser(userId, minutes);
  const until = Math.floor(Date.now() / 1000) + minutes * 60;
  return telegram('restrictChatMember', {
    chat_id:     GROUP_ID,
    user_id:     userId,
    permissions: { can_send_messages: false },
    until_date:  until,
  });
}

async function unmuteInGroup(userId) {
  userMuted.delete(userId);
  return telegram('restrictChatMember', {
    chat_id:     GROUP_ID,
    user_id:     userId,
    permissions: {
      can_send_messages:       true,
      can_send_media_messages: true,
      can_send_polls:          true,
      can_send_other_messages: true,
      can_add_web_page_previews: true,
    },
  });
}

async function banFromGroup(userId) {
  resetWarns(userId);
  return telegram('banChatMember', { chat_id: GROUP_ID, user_id: userId });
}

async function unbanFromGroup(userId) {
  return telegram('unbanChatMember', { chat_id: GROUP_ID, user_id: userId });
}

async function kickFromGroup(userId) {
  await telegram('banChatMember', { chat_id: GROUP_ID, user_id: userId });
  return telegram('unbanChatMember', { chat_id: GROUP_ID, user_id: userId });
}

async function warnUser(msg, reason) {
  const userId   = msg.from.id;
  const name     = msg.from.first_name || 'Usuário';
  const warns    = addWarn(userId);
  const username = msg.from.username ? '@' + msg.from.username : name;

  await deleteMessage(GROUP_ID, msg.message_id);

  if (warns >= modConfig.warnLimit) {
    await banFromGroup(userId);
    await sendMessage(GROUP_ID,
      '🚫 *' + username + ' foi banido!*\n' +
      'Motivo: ' + reason + '\n' +
      'Avisos acumulados: ' + warns + '/' + modConfig.warnLimit
    );
    return;
  }

  await sendMessage(GROUP_ID,
    '⚠️ *Aviso para ' + username + '*\n' +
    'Motivo: ' + reason + '\n' +
    'Avisos: ' + warns + '/' + modConfig.warnLimit + '\n' +
    '_' + (modConfig.warnLimit - warns) + ' aviso(s) restante(s) antes do ban._'
  );
}

// ─── Moderação de mensagem ────────────────────────────────────────────────────
async function moderateMessage(msg) {
  if (!modConfig.enabled) return false;
  if (!msg.from || msg.from.is_bot) return false;

  const userId = msg.from.id;
  const text   = msg.text || msg.caption || '';

  // Ignora admins
  if (ADMIN_IDS.has(userId)) return false;

  // Mute ativo
  if (isMuted(userId)) {
    await deleteMessage(GROUP_ID, msg.message_id);
    return true;
  }

  // Flood
  if (isFlood(userId)) {
    await muteInGroup(userId, modConfig.muteDuration);
    await deleteMessage(GROUP_ID, msg.message_id);
    const name = msg.from.first_name || 'Usuário';
    await sendMessage(GROUP_ID,
      '🌊 *' + name + ' foi silenciado por flood!*\n' +
      'Duração: ' + modConfig.muteDuration + ' minutos.'
    );
    return true;
  }

  // Slow mode
  if (isSlowModeViolation(userId)) {
    await deleteMessage(GROUP_ID, msg.message_id);
    return true;
  }

  // Modo aprovação
  if (modConfig.approvalMode) {
    pendingMsgs.set(msg.message_id, {
      userId, text, approved: false,
      name: msg.from.first_name || 'Usuário',
    });
    await deleteMessage(GROUP_ID, msg.message_id);
    await sendMessage(ADMIN_IDS.values().next().value,
      '🔍 *Mensagem pendente de aprovação*\n\n' +
      'De: ' + (msg.from.username ? '@' + msg.from.username : msg.from.first_name) + '\n' +
      'Mensagem: ' + text.substring(0, 200),
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Aprovar', callback_data: 'mod_approve_' + msg.message_id },
            { text: '❌ Rejeitar', callback_data: 'mod_reject_' + msg.message_id + '_' + userId },
          ]],
        },
      }
    );
    return true;
  }

  // Anti-forward
  if (modConfig.antiForward && msg.forward_from) {
    await warnUser(msg, 'Mensagens encaminhadas não são permitidas');
    return true;
  }

  // Anti-link
  if (text && hasExternalLink(text)) {
    await warnUser(msg, 'Links externos não são permitidos');
    return true;
  }

  // Anti-palavrão
  if (text && hasBadWord(text)) {
    await warnUser(msg, 'Linguagem inapropriada');
    return true;
  }

  // Anti-CAPS
  if (text && isCapsAbuse(text)) {
    await warnUser(msg, 'Excesso de letras maiúsculas');
    return true;
  }

  return false;
}

// ─── Painel de moderação (admin) ──────────────────────────────────────────────
const MOD_KEYBOARD = {
  inline_keyboard: [
    [{ text: modConfig.enabled ? '🟢 Moderação: ON'  : '🔴 Moderação: OFF', callback_data: 'mod_toggle_enabled'    }],
    [
      { text: modConfig.antiSpam    ? '✅ Anti-spam'    : '❌ Anti-spam',    callback_data: 'mod_toggle_antispam'   },
      { text: modConfig.antiLink    ? '✅ Anti-link'    : '❌ Anti-link',    callback_data: 'mod_toggle_antilink'   },
    ],
    [
      { text: modConfig.antiBadWords ? '✅ Anti-palavrão' : '❌ Anti-palavrão', callback_data: 'mod_toggle_badwords' },
      { text: modConfig.antiCaps    ? '✅ Anti-CAPS'    : '❌ Anti-CAPS',    callback_data: 'mod_toggle_anticaps'   },
    ],
    [
      { text: modConfig.antiFlood   ? '✅ Anti-flood'   : '❌ Anti-flood',   callback_data: 'mod_toggle_antiflood'  },
      { text: modConfig.antiForward ? '✅ Anti-forward' : '❌ Anti-forward', callback_data: 'mod_toggle_antiforward'},
    ],
    [{ text: modConfig.approvalMode ? '🔒 Modo aprovação: ON' : '🔓 Modo aprovação: OFF', callback_data: 'mod_toggle_approval' }],
    [
      { text: '⚠️ Avisos: ' + modConfig.warnLimit,    callback_data: 'mod_set_warnlimit'  },
      { text: '🔇 Mute: ' + modConfig.muteDuration + 'min', callback_data: 'mod_set_mute'  },
    ],
    [
      { text: '🚫 Palavras proibidas',  callback_data: 'mod_badwords_menu'  },
      { text: '✅ Links permitidos',    callback_data: 'mod_whitelist_menu' },
    ],
    [
      { text: '👤 Gerenciar usuário',   callback_data: 'mod_user_menu'      },
      { text: '📋 Ver warns',           callback_data: 'mod_view_warns'     },
    ],
    [{ text: '⬅️ Voltar ao admin',      callback_data: 'admin_menu'         }],
  ],
};

function buildModKeyboard() {
  return {
    inline_keyboard: [
      [{ text: (modConfig.enabled ? '🟢' : '🔴') + ' Moderação: ' + (modConfig.enabled ? 'ON' : 'OFF'), callback_data: 'mod_toggle_enabled' }],
      [
        { text: (modConfig.antiSpam     ? '✅' : '❌') + ' Anti-spam',    callback_data: 'mod_toggle_antispam'    },
        { text: (modConfig.antiLink     ? '✅' : '❌') + ' Anti-link',    callback_data: 'mod_toggle_antilink'    },
      ],
      [
        { text: (modConfig.antiBadWords ? '✅' : '❌') + ' Anti-palavrão', callback_data: 'mod_toggle_badwords'  },
        { text: (modConfig.antiCaps     ? '✅' : '❌') + ' Anti-CAPS',    callback_data: 'mod_toggle_anticaps'    },
      ],
      [
        { text: (modConfig.antiFlood    ? '✅' : '❌') + ' Anti-flood',   callback_data: 'mod_toggle_antiflood'   },
        { text: (modConfig.antiForward  ? '✅' : '❌') + ' Anti-forward', callback_data: 'mod_toggle_antiforward' },
      ],
      [{ text: (modConfig.approvalMode  ? '🔒' : '🔓') + ' Modo aprovação: ' + (modConfig.approvalMode ? 'ON' : 'OFF'), callback_data: 'mod_toggle_approval' }],
      [
        { text: '⚠️ Limite warns: ' + modConfig.warnLimit,       callback_data: 'mod_set_warnlimit' },
        { text: '🔇 Mute padrão: ' + modConfig.muteDuration + 'min', callback_data: 'mod_set_mute'  },
      ],
      [
        { text: '🚫 Palavras proibidas (' + badWords.size + ')', callback_data: 'mod_badwords_menu'  },
        { text: '✅ Links permitidos (' + allowedDomains.size + ')', callback_data: 'mod_whitelist_menu' },
      ],
      [
        { text: '👤 Gerenciar usuário', callback_data: 'mod_user_menu'  },
        { text: '📋 Ver warns',         callback_data: 'mod_view_warns' },
      ],
      [{ text: '⬅️ Voltar ao admin', callback_data: 'admin_menu' }],
    ],
  };
}

async function handleModPanel(chatId) {
  const text = [
    '🛡️ *Painel de Moderação — FliixHub*',
    '',
    'Configure as regras do grupo abaixo.',
    'Alterações entram em vigor imediatamente.',
  ].join('\n');
  await sendMessage(chatId, text, { reply_markup: buildModKeyboard() });
}

async function handleModToggle(chatId, key) {
  const map = {
    'mod_toggle_enabled':    'enabled',
    'mod_toggle_antispam':   'antiSpam',
    'mod_toggle_antilink':   'antiLink',
    'mod_toggle_badwords':   'antiBadWords',
    'mod_toggle_anticaps':   'antiCaps',
    'mod_toggle_antiflood':  'antiFlood',
    'mod_toggle_antiforward':'antiForward',
    'mod_toggle_approval':   'approvalMode',
  };
  const field = map[key];
  if (!field) return;
  modConfig[field] = !modConfig[field];
  const state = modConfig[field] ? 'ativado ✅' : 'desativado ❌';
  await sendMessage(chatId, '✅ *' + field + '* ' + state, { reply_markup: buildModKeyboard() });
}

async function handleModBadwordsMenu(chatId) {
  const list = badWords.size ? [...badWords].map((w, i) => (i+1) + '. ' + w).join('\n') : '_Nenhuma palavra cadastrada_';
  const text = [
    '🚫 *Palavras Proibidas*',
    '',
    list,
    '',
    'Para *adicionar*: `/addword palavra`',
    'Para *remover*: `/delword palavra`',
  ].join('\n');
  await sendMessage(chatId, text, {
    reply_markup: { inline_keyboard: [[{ text: '⬅️ Voltar', callback_data: 'mod_panel' }]] },
  });
}

async function handleModWhitelistMenu(chatId) {
  const list = [...allowedDomains].map((d, i) => (i+1) + '. ' + d).join('\n');
  const text = [
    '✅ *Links Permitidos (whitelist)*',
    '',
    list,
    '',
    'Para *adicionar*: `/addlink dominio.com`',
    'Para *remover*: `/dellink dominio.com`',
  ].join('\n');
  await sendMessage(chatId, text, {
    reply_markup: { inline_keyboard: [[{ text: '⬅️ Voltar', callback_data: 'mod_panel' }]] },
  });
}

async function handleModViewWarns(chatId) {
  if (!userWarns.size) {
    return sendMessage(chatId, '✅ Nenhum usuário com avisos no momento.', {
      reply_markup: { inline_keyboard: [[{ text: '⬅️ Voltar', callback_data: 'mod_panel' }]] },
    });
  }
  const list = [...userWarns.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, w]) => 'ID `' + id + '` — ' + w + ' aviso(s)').join('\n');
  await sendMessage(chatId,
    '⚠️ *Usuários com avisos:*\n\n' + list + '\n\nUse `/clearwarn ID` para limpar.',
    { reply_markup: { inline_keyboard: [[{ text: '⬅️ Voltar', callback_data: 'mod_panel' }]] } }
  );
}

async function handleModUserMenu(chatId) {
  const session = getSession(chatId);
  session.waitingModUser = true;
  await sendMessage(chatId,
    '👤 *Gerenciar usuário*\n\nDigite o ID ou @username do usuário:',
    { reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'mod_panel' }]] } }
  );
}

async function handleModUserActions(chatId, target) {
  const session = getSession(chatId);
  session.modTarget = target;
  await sendMessage(chatId,
    '👤 *Usuário:* `' + target + '`\n\nO que deseja fazer?',
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '⚠️ Warn',   callback_data: 'mod_action_warn'   },
            { text: '🔇 Mute',   callback_data: 'mod_action_mute'   },
          ],
          [
            { text: '🔊 Unmute', callback_data: 'mod_action_unmute' },
            { text: '👢 Kick',   callback_data: 'mod_action_kick'   },
          ],
          [
            { text: '🚫 Ban',    callback_data: 'mod_action_ban'    },
            { text: '✅ Unban',  callback_data: 'mod_action_unban'  },
          ],
          [
            { text: '🗑️ Limpar warns', callback_data: 'mod_action_clearwarn' },
          ],
          [{ text: '⬅️ Voltar', callback_data: 'mod_panel' }],
        ],
      },
    }
  );
}

async function executeModAction(chatId, action) {
  const session = getSession(chatId);
  const target  = session.modTarget;
  if (!target) return sendMessage(chatId, '❌ Nenhum usuário selecionado.', { reply_markup: buildModKeyboard() });

  const userId = parseInt(target) || target;

  try {
    switch (action) {
      case 'warn':
        addWarn(userId);
        await sendMessage(chatId, '⚠️ Aviso registrado para `' + target + '`. Total: ' + getWarns(userId));
        break;
      case 'mute':
        await muteInGroup(userId, modConfig.muteDuration);
        await sendMessage(chatId, '🔇 Usuário `' + target + '` silenciado por ' + modConfig.muteDuration + ' min.');
        await sendMessage(GROUP_ID, '🔇 Usuário silenciado por ' + modConfig.muteDuration + ' minutos pelo admin.');
        break;
      case 'unmute':
        await unmuteInGroup(userId);
        await sendMessage(chatId, '🔊 Usuário `' + target + '` desmutado.');
        break;
      case 'kick':
        await kickFromGroup(userId);
        await sendMessage(chatId, '👢 Usuário `' + target + '` removido do grupo.');
        await sendMessage(GROUP_ID, '👢 Um usuário foi removido do grupo pelo admin.');
        break;
      case 'ban':
        await banFromGroup(userId);
        await sendMessage(chatId, '🚫 Usuário `' + target + '` banido permanentemente.');
        await sendMessage(GROUP_ID, '🚫 Um usuário foi banido do grupo pelo admin.');
        break;
      case 'unban':
        await unbanFromGroup(userId);
        await sendMessage(chatId, '✅ Usuário `' + target + '` desbanido.');
        break;
      case 'clearwarn':
        resetWarns(userId);
        await sendMessage(chatId, '✅ Avisos de `' + target + '` limpos.');
        break;
    }
  } catch (e) {
    await sendMessage(chatId, '❌ Erro: ' + e.message + '\n\nVerifica se o bot é admin do grupo.');
  }

  await handleModPanel(chatId);
}

async function handleModSetWarnLimit(chatId) {
  const session = getSession(chatId);
  session.waitingWarnLimit = true;
  await sendMessage(chatId, '⚠️ Digite o novo limite de avisos antes do ban (atual: ' + modConfig.warnLimit + '):');
}

async function handleModSetMute(chatId) {
  const session = getSession(chatId);
  session.waitingMuteDuration = true;
  await sendMessage(chatId, '🔇 Digite a duração padrão do mute em minutos (atual: ' + modConfig.muteDuration + '):');
}

// ─── Inicialização ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

if (WEBHOOK_URL) {
  server.listen(PORT, async () => {
    console.log('[Bot] Servidor na porta ' + PORT);
    console.log('[Bot] Webhook Supabase: ' + WEBHOOK_URL.replace('/webhook', '/supabase-webhook'));
    await setWebhook();
  });
} else {
  polling();
}
