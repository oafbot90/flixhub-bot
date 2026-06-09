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

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Sessão de paginação por usuário ─────────────────────────────────────────
const sessions = new Map();

function getSession(chatId) {
  if (!sessions.has(chatId)) sessions.set(chatId, {});
  return sessions.get(chatId);
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

async function editMessage(chatId, messageId, text, extra = {}) {
  return telegram('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'Markdown', disable_web_page_preview: true, ...extra });
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
  const year     = (isMovie ? item.release_date : item.first_air_date || item.release_date || '');
  const yearStr  = year ? year.substring(0, 4) : '—';
  const rating   = stars(item.vote_average);
  const genres   = genreList(item.genres);
  const desc     = item.overview ? item.overview.substring(0, 200) + '...' : 'Sem descrição disponível.';
  const seasons  = !isMovie && item.number_of_seasons ? `  |  📺 ${item.number_of_seasons} temp.` : '';
  const emoji    = isMovie ? '🎬' : '📺';
  const typeLabel = isMovie ? 'filme' : 'série';

  const prefix = index ? `*${index}. ${title}*` : `${emoji} *${title}*`;

  const text = [
    prefix,
    `${rating}  |  📅 ${yearStr}${genres ? `  |  🎭 ${genres}` : ''}${seasons}`,
    ``,
    desc,
    ``,
    `▶️ [Assistir no FliixHub](${SITE_URL})`,
    `📲 [Baixar o app](${DOWNLOAD_URL})`,
  ].join('\n');

  return { text, poster, title, typeLabel };
}

// ─── Teclados ─────────────────────────────────────────────────────────────────
const MAIN_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '🔍 Buscar conteúdo',    callback_data: 'ask_search'      },
    ],
    [
      { text: '🎬 Filmes populares',   callback_data: 'popular_movies'  },
      { text: '📺 Séries populares',   callback_data: 'popular_series'  },
    ],
    [
      { text: '🆕 Novos filmes',       callback_data: 'new_movies'      },
      { text: '🆕 Novas séries',       callback_data: 'new_series'      },
    ],
    [
      { text: '🏆 Top 10 filmes',      callback_data: 'top10_movies'    },
      { text: '🏆 Top 10 séries',      callback_data: 'top10_series'    },
    ],
    [
      { text: '🎲 Surpreenda-me!',     callback_data: 'random'          },
      { text: '🎭 Por gênero',         callback_data: 'genres_menu'     },
    ],
    [
      { text: '▶️ Acessar FliixHub',   url: SITE_URL                    },
      { text: '📲 Baixar o app',       url: DOWNLOAD_URL                },
    ],
  ],
};

const GENRE_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '💥 Ação',          callback_data: 'genre_Action'              },
      { text: '😂 Comédia',       callback_data: 'genre_Comedy'              },
      { text: '😱 Terror',        callback_data: 'genre_Horror'              },
    ],
    [
      { text: '💕 Romance',       callback_data: 'genre_Romance'             },
      { text: '🚀 Ficção',        callback_data: 'genre_Science Fiction'     },
      { text: '🕵️ Thriller',      callback_data: 'genre_Thriller'            },
    ],
    [
      { text: '🎭 Drama',         callback_data: 'genre_Drama'               },
      { text: '🌀 Animação',      callback_data: 'genre_Animation'           },
      { text: '👨‍👩‍👧 Família',       callback_data: 'genre_Family'              },
    ],
    [
      { text: '🔫 Crime',         callback_data: 'genre_Crime'               },
      { text: '🧩 Mistério',      callback_data: 'genre_Mystery'             },
      { text: '📜 História',      callback_data: 'genre_History'             },
    ],
    [
      { text: '🎵 Musical',       callback_data: 'genre_Music'               },
      { text: '⚔️ Aventura',      callback_data: 'genre_Adventure'           },
      { text: '🧙 Fantasia',      callback_data: 'genre_Fantasy'             },
    ],
    [
      { text: '⬅️ Voltar ao menu', callback_data: 'menu'                     },
    ],
  ],
};

function paginationKeyboard(page, total, context) {
  const totalPages = Math.ceil(total / 5);
  const buttons = [];
  if (page > 0)              buttons.push({ text: '⬅️ Anterior', callback_data: `page_${context}_${page - 1}` });
  if (page < totalPages - 1) buttons.push({ text: 'Próximos ➡️', callback_data: `page_${context}_${page + 1}` });
  return buttons.length ? { inline_keyboard: [buttons, [{ text: '🏠 Menu', callback_data: 'menu' }]] }
                        : { inline_keyboard: [[{ text: '🏠 Menu', callback_data: 'menu' }]] };
}

// ─── Handlers ─────────────────────────────────────────────────────────────────
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
    `/populares — filmes e séries mais vistos`,
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
    `Disponível no celular e na web.`,
    ``,
    `✅ Catálogo atualizado diariamente`,
    `✅ Múltiplos perfis por conta`,
    `✅ Modo kids`,
    `✅ TV ao vivo`,
    `✅ Favoritos e histórico`,
    ``,
    `🌐 Site: ${SITE_URL}`,
    `📲 App: ${DOWNLOAD_URL}`,
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

  const LIMIT = 5;
  const from  = page * LIMIT;
  const to    = from + LIMIT - 1;

  const results = [];

  if (type === 'all' || type === 'movie') {
    const { data: movies } = await supabase
      .from('movies_catalog')
      .select('*')
      .eq('has_stream', true)
      .ilike('title', `%${query}%`)
      .order('vote_count', { ascending: false })
      .range(from, to);
    (movies || []).forEach(m => results.push({ ...m, _type: 'movie' }));
  }

  if (type === 'all' || type === 'series') {
    const { data: series } = await supabase
      .from('series_catalog')
      .select('*')
      .eq('has_stream', true)
      .ilike('title', `%${query}%`)
      .order('vote_count', { ascending: false })
      .range(from, to);
    (series || []).forEach(s => results.push({ ...s, _type: 'series' }));
  }

  if (!results.length && page === 0) {
    return sendMessage(chatId,
      `😕 Nenhum resultado para *"${query}"*.\n\nTente outro título ou explore o catálogo abaixo.`,
      { reply_markup: MAIN_KEYBOARD }
    );
  }

  if (page === 0) await sendMessage(chatId, `🔍 Resultados para *"${query}"*:`);

  for (const item of results.slice(0, 5)) {
    const idx = results.indexOf(item) + 1 + page * 5;
    const { text, poster } = formatItem(item, idx, item._type);
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

  await sendMessage(chatId, hasMore
    ? `📄 Página ${page + 1} — deseja ver mais?`
    : `✅ *Fim dos resultados para "${query}"*`,
    { reply_markup: keyboard }
  );
}

async function handleList(chatId, table, order, label, emoji, page = 0) {
  const LIMIT = 5;
  const from  = page * LIMIT;
  const type  = table === 'movies_catalog' ? 'movie' : 'series';

  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('has_stream', true)
    .not('poster_path', 'is', null)
    .order(order, { ascending: false })
    .range(from, from + LIMIT - 1);

  if (error || !data?.length) {
    return sendMessage(chatId, `❌ Erro ao carregar. Tente novamente.`);
  }

  if (page === 0) await sendMessage(chatId, `${emoji} *${label}*`);

  for (let i = 0; i < data.length; i++) {
    const { text, poster } = formatItem(data[i], from + i + 1, type);
    if (poster) {
      await sendPhoto(chatId, poster, text).catch(() => sendMessage(chatId, text));
    } else {
      await sendMessage(chatId, text);
    }
    await new Promise(r => setTimeout(r, 250));
  }

  const context  = `${table}|${order}|${label}|${emoji}`;
  const ctxKey   = Buffer.from(context).toString('base64').substring(0, 40);
  const session  = getSession(chatId);
  session[ctxKey] = context;

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
  const table  = type === 'movie' ? 'movies_catalog' : 'series_catalog';
  const emoji  = type === 'movie' ? '🎬' : '📺';
  const label  = type === 'movie' ? 'Top 10 Filmes' : 'Top 10 Séries';

  await sendMessage(chatId, `🏆 *${label}*`);

  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('has_stream', true)
    .not('poster_path', 'is', null)
    .order('vote_average', { ascending: false })
    .limit(10);

  if (error || !data?.length) {
    return sendMessage(chatId, '❌ Erro ao carregar. Tente novamente.');
  }

  for (let i = 0; i < data.length; i++) {
    const medals = ['🥇','🥈','🥉'];
    const prefix = i < 3 ? medals[i] : `*${i + 1}.*`;
    const item   = data[i];
    const year   = (type === 'movie' ? item.release_date : item.first_air_date || '');
    const yearStr = year ? year.substring(0, 4) : '—';

    const line = `${prefix} ${item.title || item.name}  ${stars(item.vote_average)}  📅 ${yearStr}`;
    await sendMessage(chatId, line);
    await new Promise(r => setTimeout(r, 150));
  }

  await sendMessage(chatId, `▶️ Assista agora em ${SITE_URL}`, { reply_markup: MAIN_KEYBOARD });
}

async function handleRandom(chatId) {
  await sendMessage(chatId, '🎲 Escolhendo uma surpresa pra você...');

  const isMovie = Math.random() > 0.5;
  const table   = isMovie ? 'movies_catalog' : 'series_catalog';
  const type    = isMovie ? 'movie' : 'series';

  // Pega um offset aleatório
  const { count } = await supabase.from(table).select('*', { count: 'exact', head: true }).eq('has_stream', true);
  const offset = Math.floor(Math.random() * Math.min(count || 100, 200));

  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('has_stream', true)
    .not('poster_path', 'is', null)
    .range(offset, offset)
    .limit(1);

  if (error || !data?.length) {
    return sendMessage(chatId, '❌ Erro ao buscar sugestão. Tente novamente.');
  }

  const { text, poster } = formatItem(data[0], null, type);
  const keyboard = {
    inline_keyboard: [
      [{ text: '🎲 Outra sugestão!', callback_data: 'random' }],
      [{ text: '🏠 Menu', callback_data: 'menu' }],
    ],
  };

  if (poster) {
    await sendPhoto(chatId, poster, text, { reply_markup: keyboard }).catch(() =>
      sendMessage(chatId, text, { reply_markup: keyboard })
    );
  } else {
    await sendMessage(chatId, text, { reply_markup: keyboard });
  }
}

async function handleGenre(chatId, genre, page = 0) {
  const LIMIT = 4;
  const from  = page * LIMIT;

  const [{ data: movies }, { data: series }] = await Promise.all([
    supabase.from('movies_catalog').select('*').eq('has_stream', true)
      .or(`genres.cs.{"${genre}"}`)
      .not('poster_path', 'is', null)
      .order('vote_count', { ascending: false })
      .range(from, from + 1),
    supabase.from('series_catalog').select('*').eq('has_stream', true)
      .or(`genres.cs.{"${genre}"}`)
      .not('poster_path', 'is', null)
      .order('vote_count', { ascending: false })
      .range(from, from + 1),
  ]);

  const all = [
    ...(movies || []).map(m => ({ ...m, _type: 'movie' })),
    ...(series || []).map(s => ({ ...s, _type: 'series' })),
  ];

  if (!all.length && page === 0) {
    return sendMessage(chatId, `😕 Nenhum conteúdo encontrado para *${genre}*.`, { reply_markup: GENRE_KEYBOARD });
  }

  if (page === 0) await sendMessage(chatId, `🎭 *Melhores de ${genre}*`);

  for (let i = 0; i < all.length; i++) {
    const { text, poster } = formatItem(all[i], from + i + 1, all[i]._type);
    if (poster) {
      await sendPhoto(chatId, poster, text).catch(() => sendMessage(chatId, text));
    } else {
      await sendMessage(chatId, text);
    }
    await new Promise(r => setTimeout(r, 250));
  }

  const session = getSession(chatId);
  session.lastGenre = genre;

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

// ─── Processador principal ────────────────────────────────────────────────────
async function processUpdate(update) {
  if (update.callback_query) {
    const cb     = update.callback_query;
    const chatId = cb.message.chat.id;
    const data   = cb.data;
    const session = getSession(chatId);

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

    if (data.startsWith('genre_more_')) {
      const page = parseInt(data.replace('genre_more_', '')) || 0;
      return handleGenre(chatId, session.lastGenre || 'Action', page);
    }

    if (data.startsWith('genre_')) {
      const genre = data.replace('genre_', '');
      return handleGenre(chatId, genre, 0);
    }

    if (data.startsWith('search_more_')) {
      const page = parseInt(data.replace('search_more_', '')) || 0;
      if (session.lastSearch) {
        return handleSearch(chatId, session.lastSearch.query, session.lastSearch.type, page);
      }
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

  if (!update.message?.text) return;

  const msg       = update.message;
  const chatId    = msg.chat.id;
  const text      = msg.text.trim();
  const firstName = msg.from?.first_name;
  const session   = getSession(chatId);

  // Aguardando busca via botão
  if (session.waitingSearch && !text.startsWith('/')) {
    session.waitingSearch = false;
    return handleSearch(chatId, text, 'all', 0);
  }

  // Comandos
  if (text.startsWith('/start'))     return handleStart(chatId, firstName);
  if (text.startsWith('/help') || text === '/ajuda') return handleHelp(chatId);
  if (text.startsWith('/menu'))      return handleStart(chatId, firstName);
  if (text.startsWith('/sobre'))     return handleSobre(chatId);
  if (text.startsWith('/site'))      return sendMessage(chatId, `🌐 Acesse o FliixHub:\n${SITE_URL}`, { reply_markup: MAIN_KEYBOARD });
  if (text.startsWith('/download'))  return sendMessage(chatId, `📲 Baixe o app FliixHub:\n${DOWNLOAD_URL}`, { reply_markup: MAIN_KEYBOARD });

  if (text.startsWith('/aleatorio') || text.startsWith('/random')) return handleRandom(chatId);

  if (text.startsWith('/populares') || text.startsWith('/popular')) {
    await handleList(chatId, 'movies_catalog', 'vote_count', 'Filmes Populares', '🔥');
    return handleList(chatId, 'series_catalog', 'vote_count', 'Séries Populares', '🔥');
  }

  if (text.startsWith('/novidades') || text.startsWith('/novo')) {
    await handleList(chatId, 'movies_catalog', 'created_at', 'Novos Filmes', '🆕');
    return handleList(chatId, 'series_catalog', 'created_at', 'Novas Séries', '🆕');
  }

  if (text.startsWith('/top10')) {
    await handleTop10(chatId, 'movie');
    return handleTop10(chatId, 'series');
  }

  if (text.startsWith('/buscar ')  || text.startsWith('/search '))  return handleSearch(chatId, text.split(' ').slice(1).join(' '), 'all');
  if (text.startsWith('/filme ')   || text.startsWith('/movie '))   return handleSearch(chatId, text.split(' ').slice(1).join(' '), 'movie');
  if (text.startsWith('/serie ')   || text.startsWith('/series '))  return handleSearch(chatId, text.split(' ').slice(1).join(' '), 'series');
  if (text.startsWith('/genero ')  || text.startsWith('/genre '))   return handleGenre(chatId, text.split(' ').slice(1).join(' '));

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
      try { await processUpdate(JSON.parse(body)); } catch (e) { console.error('[Bot] Erro:', e.message); }
      res.writeHead(200); res.end('OK');
    });
  } else if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('FliixHub Bot está no ar! 🎬');
  } else {
    res.writeHead(404); res.end();
  }
});

// ─── Polling ──────────────────────────────────────────────────────────────────
async function polling() {
  let offset = 0;
  console.log('[Bot] Iniciado em modo polling...');
  while (true) {
    try {
      const res  = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${offset}&timeout=30`);
      const json = await res.json();
      if (json.ok && json.result.length) {
        for (const update of json.result) {
          offset = update.update_id + 1;
          processUpdate(update).catch(e => console.error('[Bot] Erro:', e.message));
        }
      }
    } catch (e) {
      console.error('[Polling] Erro:', e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ─── Inicialização ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

if (WEBHOOK_URL) {
  server.listen(PORT, async () => {
    console.log(`[Bot] Servidor rodando na porta ${PORT}`);
    await setWebhook();
  });
} else {
  polling();
}
