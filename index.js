const { createClient } = require('@supabase/supabase-js');

// ─── Config ───────────────────────────────────────────────────────────────────
const TELEGRAM_TOKEN  = process.env.TELEGRAM_TOKEN;
const SUPABASE_URL    = process.env.SUPABASE_URL    || 'https://jzgpwkehhgpvdlqlkfiq.supabase.co';
const SUPABASE_KEY    = process.env.SUPABASE_KEY    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6Z3B3a2VoaGdwdmRscWxrZmlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQxNjU4NzcsImV4cCI6MjA1OTc0MTg3N30.wv1jD5rBaDrOkghJCjTxaGa2TCPtbsj4j37Ax7czPFY';
const WEBHOOK_URL     = process.env.WEBHOOK_URL;     // ex: https://seu-projeto.vercel.app/api/bot
const SITE_URL        = 'https://flixhub.space';
const DOWNLOAD_URL    = 'https://flixhub.space/download';
const IMG_BASE        = 'https://image.tmdb.org/t/p/w500';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Telegram API helper ──────────────────────────────────────────────────────
async function telegram(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return res.json();
}

async function sendMessage(chatId, text, extra = {}) {
  return telegram('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown', ...extra });
}

async function sendPhoto(chatId, photo, caption, extra = {}) {
  return telegram('sendPhoto', { chat_id: chatId, photo, caption, parse_mode: 'Markdown', ...extra });
}

async function answerCallbackQuery(id, text) {
  return telegram('answerCallbackQuery', { callback_query_id: id, text });
}

// ─── Registrar webhook ────────────────────────────────────────────────────────
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

function formatMovie(m, index) {
  const poster = m.poster_path ? `${IMG_BASE}${m.poster_path}` : null;
  const year   = m.release_date ? m.release_date.substring(0, 4) : '—';
  const rating = stars(m.vote_average);
  const genres = genreList(m.genres);
  const desc   = m.overview ? m.overview.substring(0, 180) + '...' : 'Sem descrição.';

  const text = [
    index ? `*${index}. ${m.title}*` : `🎬 *${m.title}*`,
    `${rating}  |  📅 ${year}${genres ? `  |  🎭 ${genres}` : ''}`,
    ``,
    desc,
    ``,
    `▶️ [Assistir agora](${SITE_URL})`,
    `📲 [Baixar o app](${DOWNLOAD_URL})`,
  ].join('\n');

  return { text, poster };
}

function formatSeries(s, index) {
  const poster  = s.poster_path ? `${IMG_BASE}${s.poster_path}` : null;
  const year    = s.first_air_date ? s.first_air_date.substring(0, 4) : '—';
  const rating  = stars(s.vote_average);
  const genres  = genreList(s.genres);
  const seasons = s.number_of_seasons ? `📺 ${s.number_of_seasons} temporada(s)` : '';
  const desc    = s.overview ? s.overview.substring(0, 180) + '...' : 'Sem descrição.';

  const text = [
    index ? `*${index}. ${s.title || s.name}*` : `📺 *${s.title || s.name}*`,
    `${rating}  |  📅 ${year}${genres ? `  |  🎭 ${genres}` : ''}${seasons ? `  |  ${seasons}` : ''}`,
    ``,
    desc,
    ``,
    `▶️ [Assistir agora](${SITE_URL})`,
    `📲 [Baixar o app](${DOWNLOAD_URL})`,
  ].join('\n');

  return { text, poster };
}

// ─── Teclado principal ────────────────────────────────────────────────────────
const MAIN_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '🎬 Filmes populares',  callback_data: 'popular_movies'  },
      { text: '📺 Séries populares',  callback_data: 'popular_series'  },
    ],
    [
      { text: '🆕 Novidades filmes',  callback_data: 'new_movies'      },
      { text: '🆕 Novidades séries',  callback_data: 'new_series'      },
    ],
    [
      { text: '🎭 Buscar por gênero', callback_data: 'genres_menu'     },
    ],
    [
      { text: '▶️ Acessar FliixHub',  url: SITE_URL                    },
      { text: '📲 Baixar o app',      url: DOWNLOAD_URL                },
    ],
  ],
};

const GENRE_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '💥 Ação',        callback_data: 'genre_Ação'        },
      { text: '😂 Comédia',     callback_data: 'genre_Comédia'     },
      { text: '😱 Terror',      callback_data: 'genre_Terror'      },
    ],
    [
      { text: '💕 Romance',     callback_data: 'genre_Romance'     },
      { text: '🚀 Ficção',      callback_data: 'genre_Ficção Científica' },
      { text: '🕵️ Suspense',    callback_data: 'genre_Suspense'    },
    ],
    [
      { text: '🎭 Drama',       callback_data: 'genre_Drama'       },
      { text: '🌀 Animação',    callback_data: 'genre_Animation'   },
      { text: '👨‍👩‍👧 Família',     callback_data: 'genre_Family'      },
    ],
    [
      { text: '⬅️ Voltar',      callback_data: 'menu'              },
    ],
  ],
};

// ─── Handlers ─────────────────────────────────────────────────────────────────
async function handleStart(chatId, firstName) {
  const name = firstName ? `, ${firstName}` : '';
  const text = [
    `🎬 *Bem-vindo ao FliixHub${name}!*`,
    ``,
    `Seu streaming favorito direto no Telegram.`,
    `Pesquise filmes, séries e muito mais.`,
    ``,
    `*O que deseja fazer?*`,
  ].join('\n');

  await sendMessage(chatId, text, { reply_markup: MAIN_KEYBOARD });
}

async function handleHelp(chatId) {
  const text = [
    `📖 *Como usar o bot FliixHub*`,
    ``,
    `🔍 *Buscar conteúdo:*`,
    `\`/buscar Breaking Bad\``,
    `\`/filme Inception\``,
    `\`/serie Game of Thrones\``,
    ``,
    `📋 *Ver listas:*`,
    `\`/novidades\` — últimos adicionados`,
    `\`/populares\` — mais assistidos`,
    `\`/genero ação\` — por gênero`,
    ``,
    `📲 *Links:*`,
    `\`/site\` — acessar FliixHub`,
    `\`/download\` — baixar o app`,
    ``,
    `Ou use os botões abaixo 👇`,
  ].join('\n');

  await sendMessage(chatId, text, { reply_markup: MAIN_KEYBOARD });
}

async function handleSearch(chatId, query, type = 'all') {
  if (!query || query.trim().length < 2) {
    return sendMessage(chatId, '❌ Digite pelo menos 2 letras para buscar.');
  }

  await sendMessage(chatId, `🔍 Buscando *"${query}"*...`);

  const results = [];

  if (type === 'all' || type === 'movie') {
    const { data: movies } = await supabase
      .from('movies_catalog')
      .select('*')
      .eq('has_stream', true)
      .ilike('title', `%${query}%`)
      .order('vote_count', { ascending: false })
      .limit(type === 'movie' ? 5 : 3);

    (movies || []).forEach(m => results.push({ ...m, _type: 'movie' }));
  }

  if (type === 'all' || type === 'series') {
    const { data: series } = await supabase
      .from('series_catalog')
      .select('*')
      .eq('has_stream', true)
      .ilike('title', `%${query}%`)
      .order('vote_count', { ascending: false })
      .limit(type === 'series' ? 5 : 3);

    (series || []).forEach(s => results.push({ ...s, _type: 'series' }));
  }

  if (!results.length) {
    return sendMessage(chatId,
      `😕 Nenhum resultado para *"${query}"*.\n\nTente outro título ou use /novidades para ver o catálogo.`,
      { reply_markup: MAIN_KEYBOARD }
    );
  }

  // Envia cada resultado com poster
  for (let i = 0; i < Math.min(results.length, 5); i++) {
    const item = results[i];
    const { text, poster } = item._type === 'movie'
      ? formatMovie(item, i + 1)
      : formatSeries(item, i + 1);

    if (poster) {
      await sendPhoto(chatId, poster, text).catch(() => sendMessage(chatId, text));
    } else {
      await sendMessage(chatId, text);
    }

    // Pequeno delay pra não travar
    await new Promise(r => setTimeout(r, 300));
  }

  await sendMessage(chatId, `✅ *${results.length} resultado(s) encontrado(s)*\n\nUse os botões abaixo para explorar mais 👇`, {
    reply_markup: MAIN_KEYBOARD,
  });
}

async function handlePopularMovies(chatId) {
  await sendMessage(chatId, '🎬 Carregando filmes populares...');

  const { data, error } = await supabase
    .from('movies_catalog')
    .select('*')
    .eq('has_stream', true)
    .not('poster_path', 'is', null)
    .order('vote_count', { ascending: false })
    .limit(5);

  if (error || !data?.length) {
    return sendMessage(chatId, '❌ Erro ao carregar filmes. Tente novamente.');
  }

  for (let i = 0; i < data.length; i++) {
    const { text, poster } = formatMovie(data[i], i + 1);
    if (poster) {
      await sendPhoto(chatId, poster, text).catch(() => sendMessage(chatId, text));
    } else {
      await sendMessage(chatId, text);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  await sendMessage(chatId, `🔥 *Top 5 Filmes mais populares*\n\n▶️ Veja todos em ${SITE_URL}`, {
    reply_markup: MAIN_KEYBOARD,
  });
}

async function handlePopularSeries(chatId) {
  await sendMessage(chatId, '📺 Carregando séries populares...');

  const { data, error } = await supabase
    .from('series_catalog')
    .select('*')
    .eq('has_stream', true)
    .not('poster_path', 'is', null)
    .order('vote_count', { ascending: false })
    .limit(5);

  if (error || !data?.length) {
    return sendMessage(chatId, '❌ Erro ao carregar séries. Tente novamente.');
  }

  for (let i = 0; i < data.length; i++) {
    const { text, poster } = formatSeries(data[i], i + 1);
    if (poster) {
      await sendPhoto(chatId, poster, text).catch(() => sendMessage(chatId, text));
    } else {
      await sendMessage(chatId, text);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  await sendMessage(chatId, `🔥 *Top 5 Séries mais populares*\n\n▶️ Veja todas em ${SITE_URL}`, {
    reply_markup: MAIN_KEYBOARD,
  });
}

async function handleNewMovies(chatId) {
  await sendMessage(chatId, '🆕 Carregando novidades...');

  const { data, error } = await supabase
    .from('movies_catalog')
    .select('*')
    .eq('has_stream', true)
    .not('poster_path', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error || !data?.length) {
    return sendMessage(chatId, '❌ Erro ao carregar novidades. Tente novamente.');
  }

  for (let i = 0; i < data.length; i++) {
    const { text, poster } = formatMovie(data[i], i + 1);
    if (poster) {
      await sendPhoto(chatId, poster, text).catch(() => sendMessage(chatId, text));
    } else {
      await sendMessage(chatId, text);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  await sendMessage(chatId, `✨ *Últimos filmes adicionados*\n\n▶️ Veja todos em ${SITE_URL}`, {
    reply_markup: MAIN_KEYBOARD,
  });
}

async function handleNewSeries(chatId) {
  await sendMessage(chatId, '🆕 Carregando novidades...');

  const { data, error } = await supabase
    .from('series_catalog')
    .select('*')
    .eq('has_stream', true)
    .not('poster_path', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error || !data?.length) {
    return sendMessage(chatId, '❌ Erro ao carregar novidades. Tente novamente.');
  }

  for (let i = 0; i < data.length; i++) {
    const { text, poster } = formatSeries(data[i], i + 1);
    if (poster) {
      await sendPhoto(chatId, poster, text).catch(() => sendMessage(chatId, text));
    } else {
      await sendMessage(chatId, text);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  await sendMessage(chatId, `✨ *Últimas séries adicionadas*\n\n▶️ Veja todas em ${SITE_URL}`, {
    reply_markup: MAIN_KEYBOARD,
  });
}

async function handleGenre(chatId, genre) {
  await sendMessage(chatId, `🎭 Buscando conteúdo de *${genre}*...`);

  const [{ data: movies }, { data: series }] = await Promise.all([
    supabase
      .from('movies_catalog')
      .select('*')
      .eq('has_stream', true)
      .contains('genres', [genre])
      .not('poster_path', 'is', null)
      .order('vote_count', { ascending: false })
      .limit(3),
    supabase
      .from('series_catalog')
      .select('*')
      .eq('has_stream', true)
      .contains('genres', [genre])
      .not('poster_path', 'is', null)
      .order('vote_count', { ascending: false })
      .limit(3),
  ]);

  const all = [
    ...(movies || []).map(m => ({ ...m, _type: 'movie' })),
    ...(series || []).map(s => ({ ...s, _type: 'series' })),
  ];

  if (!all.length) {
    return sendMessage(chatId, `😕 Nenhum conteúdo encontrado para o gênero *${genre}*.`, {
      reply_markup: GENRE_KEYBOARD,
    });
  }

  for (let i = 0; i < all.length; i++) {
    const item = all[i];
    const { text, poster } = item._type === 'movie'
      ? formatMovie(item, i + 1)
      : formatSeries(item, i + 1);

    if (poster) {
      await sendPhoto(chatId, poster, text).catch(() => sendMessage(chatId, text));
    } else {
      await sendMessage(chatId, text);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  await sendMessage(chatId, `🎭 *Melhores de ${genre}*\n\n▶️ Veja mais em ${SITE_URL}`, {
    reply_markup: MAIN_KEYBOARD,
  });
}

// ─── Processador principal ────────────────────────────────────────────────────
async function processUpdate(update) {
  // Callback de botão
  if (update.callback_query) {
    const cb     = update.callback_query;
    const chatId = cb.message.chat.id;
    const data   = cb.data;

    await answerCallbackQuery(cb.id);

    if (data === 'menu')            return handleStart(chatId);
    if (data === 'popular_movies')  return handlePopularMovies(chatId);
    if (data === 'popular_series')  return handlePopularSeries(chatId);
    if (data === 'new_movies')      return handleNewMovies(chatId);
    if (data === 'new_series')      return handleNewSeries(chatId);
    if (data === 'genres_menu')     return sendMessage(chatId, '🎭 *Escolha um gênero:*', { reply_markup: GENRE_KEYBOARD });
    if (data.startsWith('genre_'))  return handleGenre(chatId, data.replace('genre_', ''));
    return;
  }

  // Mensagem de texto
  if (!update.message?.text) return;

  const msg      = update.message;
  const chatId   = msg.chat.id;
  const text     = msg.text.trim();
  const firstName = msg.from?.first_name;

  // Comandos
  if (text.startsWith('/start'))    return handleStart(chatId, firstName);
  if (text.startsWith('/help') || text === '/ajuda') return handleHelp(chatId);
  if (text.startsWith('/menu'))     return handleStart(chatId, firstName);

  if (text.startsWith('/site'))     return sendMessage(chatId, `🌐 Acesse o FliixHub:\n${SITE_URL}`);
  if (text.startsWith('/download')) return sendMessage(chatId, `📲 Baixe o app FliixHub:\n${DOWNLOAD_URL}`);

  if (text.startsWith('/populares') || text.startsWith('/popular')) {
    await handlePopularMovies(chatId);
    return handlePopularSeries(chatId);
  }

  if (text.startsWith('/novidades') || text.startsWith('/novo')) {
    await handleNewMovies(chatId);
    return handleNewSeries(chatId);
  }

  if (text.startsWith('/buscar ') || text.startsWith('/search ')) {
    const query = text.split(' ').slice(1).join(' ');
    return handleSearch(chatId, query, 'all');
  }

  if (text.startsWith('/filme ') || text.startsWith('/movie ')) {
    const query = text.split(' ').slice(1).join(' ');
    return handleSearch(chatId, query, 'movie');
  }

  if (text.startsWith('/serie ') || text.startsWith('/series ')) {
    const query = text.split(' ').slice(1).join(' ');
    return handleSearch(chatId, query, 'series');
  }

  if (text.startsWith('/genero ') || text.startsWith('/genre ')) {
    const genre = text.split(' ').slice(1).join(' ');
    return handleGenre(chatId, genre);
  }

  // Texto livre — trata como busca
  if (!text.startsWith('/')) {
    return handleSearch(chatId, text, 'all');
  }

  // Comando desconhecido
  return sendMessage(chatId,
    `❓ Comando não reconhecido.\n\nDigite /help para ver os comandos disponíveis.`,
    { reply_markup: MAIN_KEYBOARD }
  );
}

// ─── Servidor HTTP (para webhook) ─────────────────────────────────────────────
const http = require('http');

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      try {
        const update = JSON.parse(body);
        await processUpdate(update);
      } catch (e) {
        console.error('[Bot] Erro ao processar update:', e.message);
      }
      res.writeHead(200);
      res.end('OK');
    });
  } else if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('FliixHub Bot está no ar! 🎬');
  } else {
    res.writeHead(404);
    res.end();
  }
});

// ─── Polling (alternativa sem webhook) ───────────────────────────────────────
async function polling() {
  let offset = 0;
  console.log('[Bot] Iniciado em modo polling...');

  while (true) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${offset}&timeout=30`
      );
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
  // Modo webhook (Vercel, Fly.io, etc.)
  server.listen(PORT, async () => {
    console.log(`[Bot] Servidor rodando na porta ${PORT}`);
    await setWebhook();
  });
} else {
  // Modo polling (local / VPS simples)
  polling();
}
