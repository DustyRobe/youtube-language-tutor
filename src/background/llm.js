// LLM 调用模块（OpenAI 兼容接口 / DeepSeek 等）
// API key 与 baseURL 存 chrome.storage.local

export { generateLessonsForWindow, getSettings, saveSettings, getDefaultLevelPrompts, testModelConnection };

const DEFAULT_SETTINGS = {
  provider: 'deepseek',
  apiFormat: 'chat',
  jsonMode: true,
  apiBaseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  autoGenerate: false, // 默认手动触发生成
};

// Increment when teaching/selection policy changes so old explanations are regenerated.
const LESSON_VERSION = 2;
const LEVEL_RANK = { A1: 0, A2: 1, B1: 2, B2: 3, C1: 4, C2: 5 };
// Ordinary meanings of these core words do not need standalone entries for
// intermediate/advanced learners. Special combinations belong in phrases.
const CORE_WORDS = new Set('i you he she it we they me him her us them my your his its our their a an the be am is are was were been being have has had do does did go goes went gone come comes came get gets got want wants wanted like likes liked good bad hello hi yes no home bus'.split(' '));
const LEVEL_LIMITS = {
  A1: { words: 6, phrases: 4, grammar: 3, notes: 3 },
  A2: { words: 5, phrases: 4, grammar: 3, notes: 3 },
  B1: { words: 4, phrases: 3, grammar: 2, notes: 2 },
  B2: { words: 3, phrases: 2, grammar: 2, notes: 2 },
  C1: { words: 2, phrases: 2, grammar: 1, notes: 1 },
  C2: { words: 1, phrases: 1, grammar: 1, notes: 1 },
};

function selectForLevel(items, level, limit) {
  const rank = LEVEL_RANK[level];
  return (Array.isArray(items) ? items : []).filter(item => {
    if (!item || typeof item !== 'object') return false;
    const difficulty = LEVEL_RANK[item.difficultyLevel];
    // Unclassified content cannot be assumed useful to an advanced learner.
    if (difficulty == null || difficulty < rank) return false;
    return true;
  }).slice(0, limit);
}

async function getSettings() {
  const stored = await chrome.storage.local.get(['settings', 'levelPrompts', 'languagePreferences']);
  const settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  if (!stored.settings?.apiFormat && (/\/responses\/?(?:\?|$)/.test(settings.apiBaseUrl) || settings.provider === 'codex' || settings.provider === 'openai')) settings.apiFormat = 'responses';
  settings.levelPrompts = stored.levelPrompts || {};
  settings.targetLanguage = ['zh-CN', 'en', 'fr', 'ja', 'ko', 'ru', 'es', 'de', 'pt', 'ar'].includes(stored.languagePreferences?.targetLanguage) ? stored.languagePreferences.targetLanguage : (globalThis.VL_SYSTEM_LANGUAGE?.() || 'zh-CN');
  settings.promptLanguage = ['zh-CN', 'en', 'fr', 'ja', 'ko', 'ru', 'es', 'de', 'pt', 'ar'].includes(stored.languagePreferences?.uiLanguage) ? stored.languagePreferences.uiLanguage : (globalThis.VL_SYSTEM_LANGUAGE?.() || 'zh-CN');
  return settings;
}

async function testModelConnection(profile) {
  const settings = { ...DEFAULT_SETTINGS, ...profile };
  const started = Date.now();
  try {
    const content = await requestModel(settings,
      'This is a connection test. Reply with exactly this JSON object: {"ok":true}. Do not include markdown or other text.',
      'Return {"ok":true}.');
    if (settings.jsonMode !== false) {
      try { JSON.parse(content); }
      catch { throw new Error('接口已返回文本，但不是有效 JSON，请检查 JSON 模式设置'); }
    }
    return { elapsedMs: Date.now() - started };
  } catch (error) {
    const message = error?.name === 'TimeoutError' || error?.name === 'AbortError'
      ? '请求超时，请检查网络、接口地址或稍后重试'
      : String(error?.message || error);
    throw new Error(settings.apiKey ? message.split(settings.apiKey).join('[已隐藏]') : message);
  }
}

async function requestModel(settings, systemPrompt, userPrompt) {
  if (!settings.apiKey?.trim()) throw new Error('未配置 API Key，请点击面板顶部 ⚙ 打开设置');
  if (!settings.model?.trim()) throw new Error('请在 AI 设置页填写模型名称');
  const endpoint = new URL(settings.apiBaseUrl);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('API 地址格式错误');
  const responses = settings.apiFormat === 'responses';
  const gemini = settings.apiFormat === 'gemini';
  const anthropic = settings.apiFormat === 'anthropic';
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|responses|messages)$/, '').replace(/\/models\/[^/]+:generateContent$/, '');
  endpoint.pathname += gemini ? `/models/${encodeURIComponent(settings.model.replace(/^models\//, ''))}:generateContent` : anthropic ? '/messages' : responses ? '/responses' : '/chat/completions';
  const body = gemini ? {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    ...(settings.jsonMode !== false ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
  } : anthropic ? {
    model: settings.model,
    max_tokens: 8192,
    system: [{ type: 'text', text: systemPrompt }],
    messages: [{ role: 'user', content: userPrompt }],
    stream: false,
  } : responses ? {
    model: settings.model,
    instructions: systemPrompt,
    input: userPrompt,
    store: false,
    stream: false,
    ...(settings.jsonMode !== false ? { text: { format: { type: 'json_object' } } } : {}),
  } : {
    model: settings.model,
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    stream: false,
    ...(settings.jsonMode !== false ? { response_format: { type: 'json_object' } } : {}),
  };
  // Do not send temperature: some reasoning/Codex models reject it.
  const resp = await fetch(endpoint.href, {
    signal: AbortSignal.timeout(90000), method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(gemini ? { 'x-goog-api-key': settings.apiKey } : { Authorization: `Bearer ${settings.apiKey}` }),
      ...(anthropic ? { 'anthropic-version': '2026-10-21', ...(settings.workspaceId ? { 'anthropic-workspace-id': settings.workspaceId } : {}) } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    let message = `HTTP ${resp.status}`;
    try { const error = await resp.json(); message = error.error?.message || error.message || message; } catch {}
    // Never include the user's key even if an upstream error reflects it.
    message = String(message).split(settings.apiKey).join('[已隐藏]');
    throw new Error(`模型请求失败 (${resp.status})：${message.slice(0, 300)}`);
  }
  const data = await resp.json();
  if (data.error) throw new Error('模型返回错误，请检查模型名称、接口类型及账号权限');
  if (data.status === 'incomplete' || data.choices?.[0]?.finish_reason === 'length' || data.stop_reason === 'max_tokens' || data.candidates?.[0]?.finishReason === 'MAX_TOKENS') throw new Error('模型输出被截断，请调整模型或服务端输出长度限制后重试');
  let content;
  if (gemini) {
    const candidate = data.candidates?.[0];
    if (data.promptFeedback?.blockReason || (candidate?.finishReason && candidate.finishReason !== 'STOP')) throw new Error('模型拒绝生成本段讲解');
    content = (candidate?.content?.parts || []).filter(part => !part.thought).map(part => part.text || '').join('');
  } else if (anthropic) {
    if (data.stop_reason === 'refusal') throw new Error('模型拒绝生成本段讲解');
    content = (data.content || []).filter(part => part.type === 'text').map(part => part.text || '').join('');
  } else if (responses) {
    const parts = (data.output || []).filter(item => item.type === 'message').flatMap(item => item.content || []);
    if (parts.some(part => part.type === 'refusal')) throw new Error('模型拒绝生成本段讲解');
    content = parts.filter(part => part.type === 'output_text').map(part => part.text || '').join('') || data.output_text;
  } else {
    const message = data.choices?.[0]?.message;
    if (message?.refusal) throw new Error('模型拒绝生成本段讲解');
    content = message?.content;
  }
  if (typeof content !== 'string' || !content.trim()) throw new Error('模型未返回讲解文本，请确认所选接口类型与服务匹配');
  return content;
}

async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

/**
 * 生成讲解。输入一段 cue（按 30~60 秒窗口分组），输出结构化 JSON。
 * 返回: { [cueIndex]: { words: [...], culture: [...], grammar: [...] } }
 */
function getDefaultLevelPrompts(language = 'zh-CN') {
  const native = {
    ja: [
      '入門：日常語、代名詞、be動詞、基本語順を小さなステップで説明する。専門用語は平易に定義し、短い英語例文を示す。解説には選択された言語を使う。',
      '初級：よく使う動詞、前置詞、熟語、基本時制、簡単な節を重点的に解説する。文を分解し、間違いやすい点と実用的な短い例を示す。選択された解説言語を使う。',
      '中級：ごく基本的な単語は省き、連語、多義語、複文、時制の違い、文脈上の意味を扱う。応用しやすい自然な英語例文を示し、選択された言語で解説する。',
      '中上級：基本単語と単純な文法は省略する。慣用句、文体、連語の制約、複雑な節、含意、類義語の違いを実例で説明する。選択された解説言語を使う。',
      '上級：微妙な意味、語用論、修辞、皮肉、談話のつながり、文化的含意、高度な連語を分析する。文法選択の効果と自然な代替表現を比較し、基礎説明は繰り返さない。選択された解説言語を使う。',
      '熟達：含意、文体、語調の差、慣用句の使用制約、文化的語用を精密に分析する。母語話者に近い代替表現と制約を比較する。基本語彙・文法は空欄でもよい。選択された解説言語を使う。',
    ],
    ko: [
      '입문: 일상 어휘, 대명사, be동사와 기본 어순을 작은 단계로 설명한다. 문법 용어를 쉽게 정의하고 매우 짧은 영어 예문을 제시한다. 선택한 해설 언어를 사용한다.',
      '기초: 자주 쓰는 동사, 전치사, 표현, 기본 시제와 간단한 절을 설명한다. 문장을 나누어 흔한 실수와 짧고 실용적인 예문을 제시한다. 선택한 해설 언어를 사용한다.',
      '중급: 아주 기초적인 어휘는 생략하고 연어, 다의어, 복문, 시제 차이와 문맥상의 의미를 설명한다. 응용하기 쉬운 자연스러운 영어 예문과 선택한 해설 언어를 사용한다.',
      '중상급: 기본 어휘와 단순 문법을 생략한다. 관용구, 격식, 연어 제약, 복잡한 절, 함축된 태도와 유의어 차이에 집중한다. 선택한 해설 언어를 사용한다.',
      '고급: 미묘한 의미, 화용, 수사, 반어, 담화 연결, 문화적 함의와 고급 연어를 분석한다. 문법 선택의 효과와 자연스러운 대안을 비교하고 기초 설명은 반복하지 않는다. 선택한 해설 언어를 사용한다.',
      '숙련: 함축, 문체, 어조의 차이, 관용 표현의 경계와 문화적 화용을 정밀하게 비교한다. 원어민 수준 대안의 사용 제약을 설명한다. 기초 어휘와 문법은 비워도 된다. 선택한 해설 언어를 사용한다.',
    ],
    ru: [
      'Начальный: пошагово объясняйте повседневные слова, местоимения, be и порядок слов. Определяйте термины простым языком, давайте короткие английские примеры. Используйте выбранный язык объяснений.',
      'Базовый: объясняйте частотные глаголы, предлоги, выражения, основные времена и простые придаточные. Разбирайте предложения, типичные ошибки и короткие практические примеры на выбранном языке.',
      'Средний: пропускайте элементарные слова. Разбирайте сочетаемость, многозначность, сложные предложения, различия времён и контекст. Давайте естественные английские примеры и объяснения на выбранном языке.',
      'Выше среднего: не повторяйте основы. Объясняйте идиомы, регистр, ограничения сочетаемости, сложные придаточные, подтекст и различия синонимов на выбранном языке.',
      'Продвинутый: анализируйте оттенки значения, прагматику, риторику, иронию, связи текста и культурный подтекст. Сравнивайте эффекты грамматического выбора и естественные альтернативы, не повторяя основы. Используйте выбранный язык.',
      'Свободный: точно сравнивайте подтекст, стиль, тон, границы идиом и культурную прагматику. Объясняйте ограничения близких к носительским вариантов. Базовые лексику и грамматику можно пропустить. Используйте выбранный язык.',
    ],
    es: [
      'Inicial: explica paso a paso palabras cotidianas, pronombres, be y el orden básico. Define los términos con sencillez y da ejemplos ingleses muy breves. Usa el idioma de explicación elegido.',
      'Básico: explica verbos frecuentes, preposiciones, expresiones, tiempos básicos y cláusulas sencillas. Descompón las frases y señala errores habituales con ejemplos prácticos. Usa el idioma elegido.',
      'Intermedio: omite palabras elementales. Explica colocaciones, polisemia, oraciones complejas, contrastes temporales y significado contextual. Da ejemplos ingleses naturales y reutilizables en el idioma elegido.',
      'Intermedio alto: evita vocabulario y gramática básicos. Prioriza modismos, registro, restricciones de colocación, subordinadas complejas, actitudes implícitas y diferencias entre sinónimos. Usa el idioma elegido.',
      'Avanzado: analiza matices semánticos, pragmática, retórica, ironía, cohesión y referencias culturales. Compara el efecto de las elecciones gramaticales y alternativas naturales sin repetir lo básico. Usa el idioma elegido.',
      'Dominio: compara con precisión lo implícito, estilo, tono, límites idiomáticos y pragmática cultural. Explica restricciones de alternativas casi nativas. El vocabulario y la gramática elementales pueden quedar vacíos. Usa el idioma elegido.',
    ],
    de: [
      'Einstieg: Alltagswörter, Pronomen, be und einfache Wortstellung schrittweise erklären. Fachbegriffe einfach definieren und sehr kurze englische Beispiele geben. Die gewählte Erklärungssprache verwenden.',
      'Grundlagen: Häufige Verben, Präpositionen, Wendungen, Grundzeiten und einfache Nebensätze erklären. Sätze zerlegen, typische Fehler und kurze praktische Beispiele zeigen. Die gewählte Erklärungssprache verwenden.',
      'Mittelstufe: Elementare Wörter überspringen. Kollokationen, Mehrdeutigkeit, komplexe Sätze, Zeitunterschiede und Kontext erklären. Natürlich verwendbare englische Beispiele und die gewählte Erklärungssprache nutzen.',
      'Obere Mittelstufe: Grundwortschatz und einfache Grammatik auslassen. Redewendungen, Register, Kollokationsgrenzen, komplexe Nebensätze, implizite Haltung und Synonymunterschiede erklären. Die gewählte Sprache verwenden.',
      'Fortgeschritten: Bedeutungsnuancen, Pragmatik, Rhetorik, Ironie, Textbezüge und kulturelle Implikationen analysieren. Wirkungen grammatischer Entscheidungen und natürliche Alternativen vergleichen, ohne Grundlagen zu wiederholen. Die gewählte Sprache verwenden.',
      'Kompetent: Implizites, Stil, Tonnuancen, idiomatische Grenzen und kulturelle Pragmatik präzise vergleichen. Nahezu muttersprachliche Alternativen und Einschränkungen erklären. Grundwortschatz und Basisgrammatik dürfen leer bleiben. Die gewählte Sprache verwenden.',
    ],
    pt: [
      'Iniciante: explique palavras do cotidiano, pronomes, be e a ordem básica em pequenos passos. Defina os termos de forma simples e dê exemplos ingleses curtos. Use o idioma de explicação escolhido.',
      'Básico: explique verbos frequentes, preposições, expressões, tempos básicos e orações simples. Divida as frases e mostre erros comuns com exemplos práticos. Use o idioma escolhido.',
      'Intermediário: omita palavras elementares. Explique colocações, polissemia, frases complexas, diferenças de tempos e sentido contextual. Dê exemplos ingleses naturais e reutilizáveis no idioma escolhido.',
      'Intermediário superior: evite vocabulário e gramática básicos. Foque em expressões idiomáticas, registro, restrições de colocação, orações complexas, atitudes implícitas e diferenças entre sinônimos. Use o idioma escolhido.',
      'Avançado: analise nuances semânticas, pragmática, retórica, ironia, coesão e referências culturais. Compare os efeitos das escolhas gramaticais e alternativas naturais sem repetir o básico. Use o idioma escolhido.',
      'Proficiente: compare com precisão o implícito, estilo, tom, limites idiomáticos e pragmática cultural. Explique alternativas quase nativas e suas restrições. As seções básicas podem ficar vazias. Use o idioma escolhido.',
    ],
    ar: [
      'مبتدئ: اشرح الكلمات اليومية والضمائر وفعل be وترتيب الكلمات خطوة بخطوة. عرّف المصطلحات ببساطة وقدّم أمثلة إنجليزية قصيرة جدًا. استخدم لغة الشرح المختارة.',
      'أساسي: اشرح الأفعال الشائعة وحروف الجر والتعبيرات والأزمنة الأساسية والجمل البسيطة. قسّم الجمل ووضّح الأخطاء الشائعة بأمثلة عملية قصيرة. استخدم لغة الشرح المختارة.',
      'متوسط: تجاوز الكلمات الأولية. اشرح التراكيب وتعدد المعاني والجمل المركبة والفروق بين الأزمنة والمعنى السياقي. قدّم أمثلة إنجليزية طبيعية قابلة للاستخدام بلغة الشرح المختارة.',
      'فوق المتوسط: تجنّب المفردات والقواعد الأولية. ركّز على الاصطلاحات والسجل اللغوي وقيود التراكيب والجمل المعقدة والمواقف الضمنية والفروق بين المترادفات. استخدم لغة الشرح المختارة.',
      'متقدم: حلّل دقائق المعنى والتداولية والبلاغة والسخرية وترابط الخطاب والدلالات الثقافية. قارن أثر الخيارات النحوية والبدائل الطبيعية دون تكرار الأساسيات. استخدم لغة الشرح المختارة.',
      'متمكن: قارن بدقة المعنى الضمني والأسلوب ودرجات النبرة وحدود التعبيرات والتداولية الثقافية. اشرح قيود البدائل القريبة من استعمال الناطق الأصلي. يمكن ترك المفردات والقواعد الأولية فارغة. استخدم لغة الشرح المختارة.',
    ],
  };
  if (native[language]) return Object.fromEntries(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((level, index) => [level, native[language][index]]));
  if (language === 'en') return {
    A1: 'Beginner: explain everyday words, pronouns, be-verbs and basic word order in small steps. Define grammar terms in plain language. Use very short everyday English examples. Do not assume knowledge of basic tenses. Use the selected explanation language.',
    A2: 'Elementary: focus on common verbs, prepositions, phrases, basic tenses and simple clauses. Break down sentences step by step, explain common mistakes, and provide short practical examples in the selected explanation language.',
    B1: 'Intermediate: skip very basic vocabulary. Focus on useful collocations, multiple meanings, compound sentences, tense contrasts and contextual meaning. Give natural English examples that are easy to reuse, explained in the selected language.',
    B2: 'Upper intermediate: skip basic vocabulary and simple grammar. Focus on idioms, register, collocation restrictions, complex clauses, implied attitudes and subtle differences between near-synonyms. Use realistic examples and the selected explanation language.',
    C1: 'Advanced: focus on nuanced meaning, pragmatics, rhetoric, irony, discourse links, cultural implications and advanced collocations. Explain the effects of grammatical choices and compare natural alternatives. Avoid basic explanations. Use the selected explanation language.',
    C2: 'Proficient: focus on precise expression, implied meaning, style, shades of tone, idiom restrictions and cultural pragmatics. Compare near-native alternatives and their limitations. Basic vocabulary and grammar sections may be empty. Use the selected explanation language.',
  };
  if (language === 'fr') return {
    A1: 'Débutant : expliquer pas à pas les mots courants, les pronoms, le verbe be et l’ordre des mots. Définir simplement les termes grammaticaux. Proposer des exemples anglais très courts du quotidien, sans supposer la maîtrise des temps de base. Utiliser la langue d’explication choisie.',
    A2: 'Élémentaire : expliquer les verbes fréquents, les prépositions, les expressions, les temps de base et les propositions simples. Décomposer les phrases, distinguer les erreurs courantes et proposer des exemples courts et pratiques. Utiliser la langue d’explication choisie.',
    B1: 'Intermédiaire : ignorer le vocabulaire très élémentaire. Expliquer les collocations utiles, la polysémie, les phrases complexes, les différences entre temps et le sens en contexte. Donner des exemples anglais naturels et réutilisables, dans la langue d’explication choisie.',
    B2: 'Intermédiaire avancé : éviter le vocabulaire et la grammaire de base. Privilégier les expressions idiomatiques, le registre, les contraintes de collocation, les subordonnées complexes, les attitudes implicites et les nuances entre synonymes. Utiliser la langue d’explication choisie.',
    C1: 'Avancé : analyser les nuances sémantiques, la pragmatique, la rhétorique, l’ironie, la cohésion du discours, les implications culturelles et les collocations avancées. Comparer les effets des choix grammaticaux et les formulations naturelles alternatives, sans répéter les bases. Utiliser la langue d’explication choisie.',
    C2: 'Maîtrise : privilégier la précision, l’implicite, le style, les nuances de ton, les limites des expressions idiomatiques et la pragmatique culturelle. Comparer les formulations proches d’un usage natif et leurs contraintes. Les rubriques de vocabulaire et de grammaire de base peuvent rester vides. Utiliser la langue d’explication choisie.',
  };
  return {
    A1: '入门学习者：全程用浅显中文，解释常用基础词、代词、be 动词和基本语序；语法术语先给白话定义，长句分成小块；例句用极短的日常英语并附中文。不假设掌握基础时态。',
    A2: '基础学习者：重点解释常见动词、介词、短语、一般时态和简单从句；用浅显中文逐步拆解句子，区分常见易错点；例句短而实用并附中文。',
    B1: '中级学习者：略过极基础词，重点讲解常用搭配、多义词、复合句、时态区别及语境含义；中文解释配自然且易模仿的英文例句。',
    B2: '中高级学习者：少讲基础词和简单语法，重点解释习语、语域、搭配限制、复杂从句、隐含态度和近义表达差异；例句接近真实交流并附中文。',
    C1: '高级学习者：聚焦细微语义、语用、修辞、反讽、篇章衔接、文化暗示和高级搭配；语法说明分析表达选择的效果，对比自然的替代表达，避免重复基础知识。',
    C2: '熟练学习者：以精细表达辨析为主，讨论言外之意、文体、语气层次、习语边界、文化语用及修辞效果；对比近母语替代表达及适用限制，基础词和基础语法可为空。',
  };
}

async function generateLessonsForWindow(cues, context = '', englishLevel = 'B1', sourceLanguage = 'en') {
  const settings = await getSettings();
  const numbered = cues.map((c, i) => `[${i}] (${c.start.toFixed(1)}s) ${c.text.replace(/\n/g, ' ')}`).join('\n');
  const levelGuidance = getDefaultLevelPrompts(settings.promptLanguage);
  const selectedLevel = Object.hasOwn(levelGuidance, englishLevel) ? englishLevel : 'B1';
  const promptKey = settings.promptLanguage === 'zh-CN' ? selectedLevel : `${selectedLevel}@${settings.promptLanguage}`;
  const custom = settings.levelPrompts[promptKey];
  const teachingPrompt = typeof custom?.text === 'string' && custom.text.trim() ? custom.text.trim() : levelGuidance[selectedLevel];
  let systemPrompt = `你是一名专业英语老师，为非母语学习者讲解英语视频台词。
学习者英文水平：${selectedLevel}。
本次教学策略（用户可编辑）：${teachingPrompt}
核心规则：用户水平越高，应解释的基础词和基础语法越少。先筛选知识点，再决定讲解；不要把初级讲解换个措辞当成高级讲解。
每个 words、phrases、grammar、notes 条目都必须标注 difficultyLevel（A1/A2/B1/B2/C1/C2），这是你对本句用法教学难度的估计，并非认证等级。难度低于 ${selectedLevel} 的条目必须省略。按本句真实用法估计，禁止为了保留条目虚高标级。
上限（不是目标数量）：words ${LEVEL_LIMITS[selectedLevel].words}、phrases ${LEVEL_LIMITS[selectedLevel].phrases}、grammar ${LEVEL_LIMITS[selectedLevel].grammar}、notes ${LEVEL_LIMITS[selectedLevel].notes}。没有值得讲的内容就返回 []，绝不凑数。
所有水平都保留 translation。explanation 只补充翻译未表达的语境、歧义或言外之意；高水平遇到直白简单句时返回空字符串，不复述翻译。
对于 B2/C1/C2，禁止解释 hello、good、like、want、go、come、have 等常见词的普通含义，以及人称代词、be 动词、普通主谓宾、一般现在时等基础知识。常见词若在本句构成有难度的习语/特殊用法，应优先放在 phrases，明确为何不能按常用义理解。
例如 "I want to go home."：A1 可讲 want、go home 和 want to do；C1/C2 应仅保留中文翻译，explanation=""，words/phrases/grammar/notes/culture 均为 []。
例如 "He threw me under the bus."：高级用户也可讲 throw someone under the bus 的背叛/甩锅含义，不能讲 he、me、bus 的基础词义；不凭空编造文化典故。
请对下面给到的每一句台词，输出精讲内容，严格按 JSON 输出，不要输出任何其他文字。

JSON 格式说明：
{
  "<台词序号>": {
    "translation": "自然准确的中文翻译",
    "explanation": "结合上下文解释字面义、实际含义、说话意图和语气；必要时拆解长句",
    "words": [{"term": "句中生词", "difficultyLevel": "本句用法的难度等级", "phonetic": "确定时提供音标", "partOfSpeech": "本句词性", "meaning": "本句中文义", "usage": "搭配、词形或近义词辨析", "example": "贴近本句用法的新英文例句", "exampleTranslation": "例句中文翻译"}],
    "phrases": [{"term": "句中短语或固定搭配", "difficultyLevel": "本句用法的难度等级", "meaning": "语境义", "usage": "结构、可替换部分、适用场景及与字面义的区别", "example": "可迁移使用的英文例句", "exampleTranslation": "例句中文翻译"}],
    "culture": ["文化背景/习语典故说明，每条一段文字"],
    "grammar": [{"difficultyLevel": "知识点难度等级", "text": "引用原文说明句法或表达选择，只讲适合本水平的难点"}],
    "notes": [{"difficultyLevel": "知识点难度等级", "text": "本水平仍值得注意的易错点、语气、语域或缩略形式"}]
  }
}

要求：
- words 仅解释通过水平筛选的单词，说明本句义、搭配或易混用法，配双语例句；高级用户无需基础词性科普
- phrases 仅解释通过水平筛选的短语/习语，给出结构说明、场景和双语例句，避免与 words 重复
- explanation 初学者可分步解释句子；高水平只补充真正难懂的逻辑、歧义、语用，尽量简短；字幕片段不完整时结合相邻台词，注明不确定的理解
- culture 有相关背景时给出 1~2 条具体说明，交代背景是什么、为何影响本句理解、实际使用场景；没有证据时返回空数组，不强行编造典故或刻板印象
- grammar 只讲本水平的难点；初学者讲基础结构，高级用户讲复杂结构的语用效果或替换限制，不重复初级时态定义；无难点返回 []
- notes 只保留本水平仍容易出错的内容，无则 []；不要假装听到了音频
- 各栏目内容互补，不用空泛句子凑数；优先解释实际出现的表达，简单台词不强求条数
- 所有中文说明要具体、口语化、直接点明用法，不要泛泛而谈
- 序号必须是输入里的 [数字] 原样对应`;

  const userPrompt = `${context ? `视频背景：${context}\n\n` : ''}台词如下：\n${numbered}`;

  const targetNames = { 'zh-CN': '简体中文 (Simplified Chinese)', en: 'English', fr: 'Français (French)', ja: '日本語 (Japanese)', ko: '한국어 (Korean)', ru: 'Русский (Russian)', es: 'Español (Spanish)', de: 'Deutsch (German)', pt: 'Português (Portuguese)', ar: 'العربية (Arabic)' };
  let languagePrompt = `\n\n【输出语言规则：优先于前面默认策略及用户 Prompt 中的语言描述】\n原视频台词语言：English。讲解目标语言：${targetNames[settings.targetLanguage]}。\ntranslation、explanation、words 的 meaning/usage/partOfSpeech、phrases 的 meaning/usage、所有 exampleTranslation、culture、grammar.text、notes.text 必须使用该目标语言。不得因上文 JSON 样例或提示词含有“中文”“双语”而改用中文。JSON 字段名、difficultyLevel、引用的英文词汇/短语、英文例句保持原样。\n${settings.targetLanguage === 'en' ? '这是 English-to-English 学习：translation 用简明英语释义或改述，exampleTranslation 用更易懂的英语改述；不要输出中文或其他语言。按学习者水平调整英语解释和例句的复杂度。' : 'translation 翻译成目标语言，英文原句和例句保留英文，并用目标语言解释和翻译。'}\n`;
  if (!/^en(?:-|$)/i.test(sourceLanguage)) {
    const sourceName = targetNames[sourceLanguage] || targetNames[sourceLanguage.split('-')[0]] || sourceLanguage;
    systemPrompt = systemPrompt.replace(/英语|英文|English/g, sourceName);
    languagePrompt = `\n最高优先级语言规则：原视频台词语言为 ${sourceName} (${sourceLanguage})，讲解目标语言为 ${targetNames[settings.targetLanguage]}。学习水平 ${selectedLevel} 针对 ${sourceName}。引用词汇、短语和所有 example 必须来自或使用源语言，绝不转换成英语教学。translation、explanation、meaning、usage、partOfSpeech、exampleTranslation、culture、grammar.text、notes.text 使用目标语言；源语言与目标语言相同时用该语言释义或改述。前文教学策略中其他语言的例子只用于说明难度筛选，不能作为本次教学内容。只分析实际给出的台词，不要假装听过音频。\n`;
  }
  const content = await requestModel(settings, systemPrompt + languagePrompt, userPrompt);

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    // 宽松提取：剥掉可能包裹的 ```json 代码块
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('LLM 返回不是合法 JSON');
    parsed = JSON.parse(m[0]);
  }
  const lessons = sanitizeLessons(parsed, selectedLevel);
  for (const key of Object.keys(lessons)) if (Number(key) >= cues.length) delete lessons[key];
  if (!Object.keys(lessons).length) throw new Error('模型没有返回有效的逐句讲解，请检查模型配置后重试');
  for (const lesson of Object.values(lessons)) {
    lesson.englishLevel = selectedLevel;
    lesson.lessonVersion = LESSON_VERSION;
    lesson.promptRevision = custom?.revision || '';
    lesson.targetLanguage = settings.targetLanguage;
    lesson.sourceLanguage = sourceLanguage;
  }
  return lessons;
}

/** 只保留合法字段，数值化序号 */
function sanitizeLessons(raw, level = 'B1') {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    const idx = Number(k);
    if (!Number.isInteger(idx) || idx < 0) continue;
    if (!v || typeof v !== 'object') continue;
    out[idx] = {
      translation: typeof v.translation === 'string' ? v.translation : '',
      explanation: typeof v.explanation === 'string' ? v.explanation : '',
      notes: selectForLevel(v.notes, level, LEVEL_LIMITS[level].notes).filter(item => typeof item.text === 'string').map(item => item.text),
      phrases: selectForLevel(v.phrases, level, LEVEL_LIMITS[level].phrases).filter(p => typeof p.term === 'string'),
      words: selectForLevel(Array.isArray(v.words) ? v.words.filter(w => {
        if (typeof w?.term !== 'string') return false;
        return LEVEL_RANK[level] < LEVEL_RANK.B1 || !CORE_WORDS.has(w.term.toLowerCase().trim());
      }) : [], level, LEVEL_LIMITS[level].words),
      culture: Array.isArray(v.culture) ? v.culture.filter((s) => typeof s === 'string') : [],
      grammar: selectForLevel(v.grammar, level, LEVEL_LIMITS[level].grammar).filter(item => typeof item.text === 'string').map(item => item.text),
    };
  }
  return out;
}
