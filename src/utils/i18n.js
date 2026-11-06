// Shared UI translations. User prompts, subtitles and generated lessons stay intact.
(() => {
  const strings = {
    '没有所选语言的字幕，请选择其他字幕语言或导入 SRT/VTT。': ['No captions in the selected language. Choose another language or import SRT/VTT.', 'Aucun sous-titre dans cette langue. Choisissez une autre langue ou importez un SRT/VTT.'],
    '播放器未提供字幕轨道。画面内嵌字幕需转写或 OCR，也可导入 SRT/VTT。': ['The player provides no caption tracks. Burned-in subtitles require transcription or OCR; you can also import SRT/VTT.', 'Le lecteur ne fournit aucune piste. Les sous-titres incrustés nécessitent une transcription ou un OCR ; vous pouvez importer un SRT/VTT.'],
    '测试连接': ['Test connection', 'Tester la connexion'],
    '正在测试连接…': ['Testing connection…', 'Test de connexion…'],
    '连接成功，模型已正常返回数据。': ['Connection successful. The model returned valid data.', 'Connexion réussie. Le modèle a renvoyé des données valides.'],
    '使用当前填写的配置发送简短测试请求，不会保存配置，可能产生少量 API 费用。': ['Sends a short request using the current fields without saving. Small API charges may apply.', 'Envoie une courte requête avec les champs actuels sans les enregistrer. De légers frais API peuvent s’appliquer.'],
    '请求超时，请检查网络、接口地址或稍后重试': ['Request timed out. Check your network and endpoint, or try again later.', 'Délai dépassé. Vérifiez le réseau et l’adresse API, ou réessayez plus tard.'],
    '接口已返回文本，但不是有效 JSON，请检查 JSON 模式设置': ['The API returned text, but not valid JSON. Check the JSON mode setting.', 'L’API a renvoyé du texte, mais pas de JSON valide. Vérifiez le mode JSON.'],
    '自动（跟随系统）': ['Auto (system language)', 'Auto (langue du système)'],
    '自动识别语言': ['Auto-detect language', 'Détecter la langue'],
    '视频原声语言': ['Video audio language', 'Langue audio de la vidéo'],
    '无法自动识别语言，请手动选择视频原声语言。': ['Could not detect the language. Select the video audio language manually.', 'Impossible de détecter la langue. Sélectionnez la langue audio de la vidéo.'],
    '语言精讲': ['Language study', 'Étude des langues'],
    '视频语言精讲助手': ['Video language tutor', 'Tuteur linguistique vidéo'],
    'AI 与讲解设置 · 视频语言精讲助手': ['AI & lesson settings', 'Paramètres IA et leçons'],
    '视频语言精讲助手 / 设置': ['Video language tutor / Settings', 'Tuteur vidéo / Paramètres'],
    '让讲解适合你的学习方式': ['Make every lesson your own', 'Des leçons adaptées à votre apprentissage'],
    '配置模型服务，再为每个学习水平定制教学重点。保存后会同步到已打开的视频面板。': ['Configure your model and teaching prompts for each proficiency level. Saved changes sync to open video panels.', 'Configurez le modèle et les consignes par niveau. Les modifications sont synchronisées avec les panneaux ouverts.'],
    '语言设置': ['Language preferences', 'Préférences linguistiques'],
    '讲解目标语言': ['Explanation language', 'Langue des explications'],
    '界面语言': ['Interface language', 'Langue de l’interface'],
    '保存语言设置': ['Save language preferences', 'Enregistrer les langues'],
    '目标语言用于翻译和讲解；界面语言仅控制按钮、标签和提示。原视频台词保持不变。': ['The explanation language controls translations and lessons. The interface language controls buttons and labels. Original dialogue stays unchanged.', 'La langue des explications détermine les traductions et les leçons. La langue de l’interface concerne les boutons et libellés. Le dialogue original reste inchangé.'],
    '模型服务': ['Model service', 'Service de modèle'],
    '各服务分别保存配置；切换服务后点击保存才会生效。': ['Each service keeps its own configuration. Save to activate your selection.', 'Chaque service conserve sa configuration. Enregistrez pour activer votre choix.'],
    '服务提供方': ['Provider', 'Fournisseur'], '模型 ID': ['Model ID', 'Identifiant du modèle'],
    'API 地址': ['API URL', 'URL de l’API'], '接口类型': ['API type', 'Type d’API'],
    '启用 JSON 模式': ['Enable JSON mode', 'Activer le mode JSON'],
    '服务不支持 JSON 模式时可取消，插件仍会要求模型返回结构化讲解。': ['Disable if your service does not support JSON mode. Structured lesson output is still requested.', 'Désactivez si le service ne prend pas en charge le mode JSON. Les leçons structurées restent requises.'],
    '保存模型配置': ['Save model configuration', 'Enregistrer le modèle'],
    '分级讲解 Prompt': ['Prompts by proficiency level', 'Consignes par niveau de langue'],
    '默认策略': ['Default prompt', 'Consigne par défaut'], '自定义策略': ['Custom prompt', 'Consigne personnalisée'],
    '未保存': ['Unsaved', 'Non enregistré'], '有未保存的修改。': ['You have unsaved changes.', 'Des modifications ne sont pas enregistrées.'],
    '保存所有提示词修改': ['Save all prompt changes', 'Enregistrer les consignes'],
    '恢复当前水平默认': ['Reset this level', 'Réinitialiser ce niveau'],
    '切换水平会保留未保存的编辑': ['Switch levels without losing edits', 'Changez de niveau sans perdre vos modifications'],
    'A1–C2 各有一份独立提示词。可修改讲解语言、教学重点、例句风格和希望跳过的知识。字幕内容、JSON 输出结构与水平筛选规则由插件自动补充，不需要在这里编写。': ['Each level A1–C2 has its own prompt. Customize teaching focus, example style and topics to skip. Subtitles, JSON structure and level filtering are added automatically. The selected explanation language takes priority.', 'Chaque niveau A1–C2 possède sa consigne. Personnalisez les priorités, les exemples et les notions à ignorer. Les sous-titres, le JSON et le filtrage sont ajoutés automatiquement. La langue choisie pour les explications est prioritaire.'],
    '修改并保存某个水平的 Prompt 后，视频面板会按新提示词自动重新生成该水平的讲解，每批仍为 5 句。其他水平的提示词不会被改变。': ['Saving a level prompt automatically refreshes that level’s lessons in batches of five. Other level prompts stay unchanged.', 'L’enregistrement d’une consigne actualise les leçons du niveau par lots de cinq. Les autres niveaux restent inchangés.'],
    '已恢复当前水平默认策略，点击保存后生效。': ['Default prompt restored. Save to apply.', 'Consigne par défaut rétablie. Enregistrez pour appliquer.'],
    '已保存，视频面板会自动按新提示词加载讲解。': ['Saved. Video panels will load lessons using the new prompt.', 'Enregistré. Les panneaux chargeront les leçons avec la nouvelle consigne.'],
    '已保存；仍有新修改未保存。': ['Saved. More recent edits remain unsaved.', 'Enregistré. Des modifications plus récentes restent à enregistrer.'],
    '提示词不能为空；需要默认策略时请点击恢复默认。': ['Prompts cannot be empty. Use Reset for the default prompt.', 'La consigne ne peut pas être vide. Utilisez Réinitialiser pour la consigne par défaut.'],
    '描述你希望这个水平的用户如何学习……': ['Describe how learners at this level should study…', 'Décrivez comment les apprenants de ce niveau doivent étudier…'],
    '填写 API Key': ['Enter your API key', 'Saisissez votre clé API'],
    '自定义兼容服务': ['Custom compatible service', 'Service compatible personnalisé'],
    'OpenAI / Codex 模型': ['OpenAI / Codex models', 'Modèles OpenAI / Codex'],
    '切换后请保存设置，视频页将使用保存的配置。': ['Save after switching. Video panels use the saved configuration.', 'Enregistrez après le changement. Les panneaux utilisent la configuration enregistrée.'],
    '填写此账号或服务可用的模型 ID': ['Enter a model ID available to this account', 'Saisissez un modèle accessible à ce compte'],
    '使用 API Key 和账号支持的 Codex 模型 ID，通过 Responses 调用；此处不读取 Codex 应用登录态。': ['Use an API key and an available Codex model ID via Responses. Codex app credentials are not used.', 'Utilisez une clé API et un modèle Codex accessible via Responses. La connexion de l’application Codex n’est pas utilisée.'],
    '填写服务地址、模型 ID 与该服务要求的接口类型。支持填写 Base URL 或完整接口地址。': ['Enter the service URL, model ID and API type. Base URLs and full endpoint URLs are supported.', 'Saisissez l’URL du service, le modèle et le type d’API. Les URL de base et les points d’accès complets sont acceptés.'],
    '填写 OpenAI API Key 和可用模型 ID。默认使用 Responses，也可选择 Chat Completions。': ['Enter an OpenAI API key and an available model ID. Responses is the default; Chat Completions is also supported.', 'Saisissez une clé OpenAI et un modèle accessible. Responses est utilisé par défaut ; Chat Completions est aussi pris en charge.'],
    'DeepSeek 默认使用 Chat Completions，其他兼容服务可选择自定义。': ['DeepSeek uses Chat Completions by default. Choose Custom for other compatible services.', 'DeepSeek utilise Chat Completions par défaut. Choisissez Personnalisé pour les autres services.'],
    'API 地址须以 http:// 或 https:// 开头': ['The API URL must start with http:// or https://', 'L’URL doit commencer par http:// ou https://'],
    '请填写 API Key 和模型名称': ['Enter an API key and model name', 'Saisissez une clé API et un modèle'],
    '逐句暂停': ['Pause per sentence', 'Pause par phrase'], '自动跟随': ['Auto-follow', 'Suivi automatique'], '原文': ['Dialogue', 'Dialogue'],
    '我的语言水平': ['My language level', 'Mon niveau de langue'], '初始化…': ['Initializing…', 'Initialisation…'],
    'AI 与讲解提示词设置（新页面）': ['AI and prompt settings (new page)', 'Paramètres IA et consignes (nouvelle page)'],
    '打开 AI 设置': ['Open AI settings', 'Ouvrir les paramètres IA'],
    '切换面板宽度': ['Change panel width', 'Modifier la largeur'], '隐藏面板': ['Hide panel', 'Masquer le panneau'],
    '上一句': ['Previous sentence', 'Phrase précédente'], '下一句': ['Next sentence', 'Phrase suivante'], '暂停/继续': ['Pause / Resume', 'Pause / Reprendre'], '倍速': ['Playback speed', 'Vitesse de lecture'],
    '调整讲解面板宽度': ['Resize lesson panel', 'Redimensionner le panneau'],
    '左右拖动调整宽度；方向键微调；双击恢复默认': ['Drag to resize; use arrow keys to adjust; double-click to reset', 'Faites glisser ; utilisez les flèches ; double-cliquez pour réinitialiser'],
    '重新生成 / 重试当前 5 句': ['Regenerate / Retry these 5 sentences', 'Régénérer / Réessayer ces 5 phrases'],
    '生成中…（约 5~20 秒）': ['Generating lessons…', 'Génération des leçons…'],
    '暂无字幕数据': ['No subtitles available', 'Aucun sous-titre disponible'], '（原文已隐藏）': ['(Dialogue hidden)', '(Dialogue masqué)'],
    '台词释义': ['Meaning', 'Sens du dialogue'], '生词': ['Vocabulary', 'Vocabulaire'], '短语 / 固定搭配': ['Phrases / Collocations', 'Expressions / Collocations'], '文化背景': ['Cultural context', 'Contexte culturel'], '语法 / 时态': ['Grammar / Tense', 'Grammaire / Temps'], '注意事项': ['Usage notes', 'Points à retenir'],
    '词性：': ['Part of speech: ', 'Catégorie : '], '用法：': ['Usage: ', 'Usage : '],
    '（此句暂无讲解，可点击下方按钮生成）': ['No lesson yet. It will load automatically.', 'La leçon sera chargée automatiquement.'],
    '打开语言精讲面板': ['Open language tutor', 'Ouvrir le tuteur linguistique'],
    '加载字幕…': ['Loading subtitles…', 'Chargement des sous-titres…'], '检测到广告播放，联动已暂停…': ['Ad playing. Synchronization paused…', 'Publicité en cours. Synchronisation suspendue…'], '联动已恢复': ['Synchronization resumed', 'Synchronisation rétablie'],
    '本批讲解返回不完整，点击下方重试。': ['This batch is incomplete. Retry below.', 'Ce lot est incomplet. Réessayez ci-dessous.'],
    '请点击顶部 ⚙ 在设置页保存 API 配置，保存后将自动加载讲解': ['Open ⚙ and save your API configuration to load lessons automatically', 'Ouvrez ⚙ et enregistrez l’API pour charger les leçons automatiquement'],
    '已保存': ['Saved', 'Enregistré'], '保存中…': ['Saving…', 'Enregistrement…'],
    'LLM API 配置': ['Model API configuration', 'Configuration API du modèle'], '模型': ['Model', 'Modèle'], 'API Base URL（OpenAI 兼容）': ['API Base URL (OpenAI compatible)', 'URL de base (compatible OpenAI)'],
    'Responses（OpenAI / Codex）': ['Responses (OpenAI / Codex)', 'Responses (OpenAI / Codex)'],
    'Claude Workspace ID（可选）': ['Claude Workspace ID (optional)', 'ID d’espace de travail Claude (facultatif)'],
    'Qwen / 通义千问': ['Qwen / Alibaba Cloud', 'Qwen / Alibaba Cloud'], 'GLM / 智谱': ['GLM / Zhipu', 'GLM / Zhipu'], 'Doubao / 豆包（火山方舟）': ['Doubao / Volcengine Ark', 'Doubao / Volcengine Ark'], 'SiliconFlow / 硅基流动': ['SiliconFlow', 'SiliconFlow'],
    '已预填服务地址和接口类型；请填写该平台的 API Key 及账号可用的模型 ID，地址也可修改。': ['The URL and API type are prefilled. Enter this service’s API key and an available model ID. The URL is editable.', 'L’URL et le type d’API sont préremplis. Saisissez la clé du service et un modèle accessible. L’URL est modifiable.'],
    'Claude 使用 Messages 原生接口。填写账号可用的模型 ID；非工作区专属 Key 可补充 Workspace ID。JSON 由教学提示词约束。': ['Claude uses its native Messages API. Enter an available model ID and, if needed, a Workspace ID. JSON is requested through the teaching prompt.', 'Claude utilise son API Messages native. Saisissez un modèle accessible et, si nécessaire, un ID d’espace de travail. Le JSON est demandé par la consigne.'],
    'Gemini 使用 generateContent 原生接口和 Google AI Studio API Key，模型 ID 可手动填写。': ['Gemini uses generateContent and a Google AI Studio API key. Enter your model ID.', 'Gemini utilise generateContent et une clé Google AI Studio. Saisissez le modèle.'],
    '默认使用阿里云北京地域。国际地域需填写对应 Base URL 和该地域的 API Key。': ['Defaults to Alibaba Cloud Beijing. For other regions, change the Base URL and use a matching regional key.', 'La région Pékin est utilisée par défaut. Pour les autres régions, adaptez l’URL et la clé API.'],
    '填写火山方舟支持的模型 ID 或推理接入点 ID；地址可按所在地域修改。': ['Enter an Ark model ID or inference endpoint ID. Adjust the URL for your region.', 'Saisissez un modèle Ark ou un ID de point d’inférence. Adaptez l’URL à votre région.'],
    '未配置 API Key，请点击面板顶部 ⚙ 打开设置': ['No API key. Open settings using ⚙.', 'Clé API manquante. Ouvrez les paramètres avec ⚙.'],
    '请在 AI 设置页填写模型名称': ['Enter a model name in AI settings', 'Saisissez le modèle dans les paramètres IA'],
    '模型没有返回有效的逐句讲解，请检查模型配置后重试': ['No valid lessons returned. Check your model configuration and retry.', 'Aucune leçon valide. Vérifiez le modèle et réessayez.'],
    '模型输出被截断，请调整模型或服务端输出长度限制后重试': ['Model output was truncated. Adjust the model or output limit and retry.', 'La réponse a été tronquée. Ajustez le modèle ou la limite de sortie.'],
    '模型拒绝生成本段讲解': ['The model declined to explain this passage', 'Le modèle a refusé d’expliquer cet extrait'],
    '模型未返回讲解文本，请确认所选接口类型与服务匹配': ['No lesson text returned. Check the API type.', 'Aucun texte retourné. Vérifiez le type d’API.'],
    '未获取到字幕。请确认视频提供同语言字幕，或在弹窗导入 SRT/VTT。': ['No subtitles found. Enable matching subtitles in YouTube, or import SRT/VTT from the extension popup.', 'Aucun sous-titre. Activez les sous-titres correspondants sur YouTube ou importez un SRT/VTT depuis l’extension.'],
    '无法识别当前页面（请在视频播放页操作）': ['Open a video playback page first', 'Ouvrez d’abord une page de lecture vidéo'],
    '已发送导入请求（若面板未更新请刷新页面后重试）': ['Import requested. Refresh the video page if needed.', 'Import demandé. Actualisez la page vidéo si nécessaire.'],
    '将应用到当前标签页正在播放的视频（按页面地址匹配）。适用于无字幕视频或需要替换字幕的场景。': ['Applies to the video in the active tab. Use when subtitles are missing or need replacing.', 'S’applique à la vidéo de l’onglet actif, si les sous-titres sont absents ou à remplacer.'],
    '1. 打开 YouTube 视频页，自动出现精讲面板并加载与当前音轨同语言的字幕。': ['1. Open a YouTube video to load the lesson panel and matching subtitles.', '1. Ouvrez une vidéo YouTube pour charger le panneau et les sous-titres correspondants.'],
    '2. 保存 API 配置后，按所选学习水平自动精讲，每批 5 句；播放到本批第 3 句时预加载下一批。包含台词释义、生词、短语、语法、文化背景及注意事项，仅展开定位句的详情。生成失败可点击下方重试。': ['2. After saving API settings, lessons load in batches of five at your proficiency level. The next batch preloads from the third sentence. Only the selected sentence expands.', '2. Après configuration de l’API, les leçons sont chargées par lots de cinq selon votre niveau. Le lot suivant se prépare à la troisième phrase. Seule la phrase sélectionnée est développée.'],
    '3. 通用网页（含 <video> 标签）也支持，需导入 SRT 字幕。': ['3. Other pages with a video element are supported by importing subtitles.', '3. Les autres pages avec un lecteur vidéo sont prises en charge via l’import de sous-titres.'],
    '保存设置': ['Save settings', 'Enregistrer'], '⚙ 打开独立设置页 · 模型与分级 Prompt': ['⚙ Settings · Models and level prompts', '⚙ Paramètres · Modèles et consignes'],
    '导入字幕（SRT / VTT）': ['Import subtitles (SRT / VTT)', 'Importer des sous-titres (SRT / VTT)'], '导入到当前页面': ['Import to current video', 'Importer dans la vidéo actuelle'], '说明': ['Instructions', 'Instructions'],
    '未能获取字幕，流程结束': ['No subtitles found', 'Aucun sous-titre trouvé'],
  };
  const levels = { A1: ['入门', 'Beginner', 'Débutant'], A2: ['基础', 'Elementary', 'Élémentaire'], B1: ['中级', 'Intermediate', 'Intermédiaire'], B2: ['中高级', 'Upper intermediate', 'Intermédiaire avancé'], C1: ['高级', 'Advanced', 'Avancé'], C2: ['熟练', 'Proficient', 'Maîtrise'] };
  for (const [level, labels] of Object.entries(levels)) strings[`${level} ${labels[0]}`] = [`${level} ${labels[1]}`, `${level} ${labels[2]}`];
  const templates = [
    [/^(A[12]|B[12]|C[12]) (.+) · 教学提示词$/, (m, i) => `${m[1]} ${levels[m[1]][i + 1]} · ${i ? 'Consigne pédagogique' : 'Teaching prompt'}`],
    [/^(\d+) \/ 16000 字符$/, (m, i) => `${m[1]} / 16000 ${i ? 'caractères' : 'characters'}`],
    [/^词性：(.+)$/, (m, i) => `${i ? 'Catégorie' : 'Part of speech'}: ${m[1]}`],
    [/^用法：(.+)$/, (m, i) => `${i ? 'Usage' : 'Usage'}: ${m[1]}`],
    [/^已切换至 (\w+)，将自动按此水平加载讲解。$/, (m, i) => i ? `Niveau ${m[1]} : chargement automatique des leçons.` : `Level ${m[1]} selected. Lessons load automatically.`],
    [/^此句的 (\w+) 讲解将自动加载；.*$/, (m, i) => i ? `La leçon ${m[1]} sera chargée automatiquement. Configurez l’API dans ⚙.` : `The ${m[1]} lesson will load automatically. Configure the API in ⚙.`],
    [/^已加载本地数据（(\d+) 句，(\d+) 句有讲解）$/, (m, i) => i ? `Cache : ${m[1]} phrases, ${m[2]} leçons.` : `Cached: ${m[1]} sentences, ${m[2]} lessons.`],
    [/^已加载 (YouTube|Bilibili) 字幕（(\d+) 句），正在准备自动精讲…$/, (m, i) => i ? `${m[1]} : ${m[2]} phrases. Préparation des leçons…` : `${m[1]}: ${m[2]} sentences. Preparing lessons…`],
    [/^已生成 (\d+) 句 (\w+) 讲解(.*)$/, (m, i) => i ? `${m[1]} leçons ${m[2]} générées.` : `Generated ${m[1]} ${m[2]} lessons.`],
    [/^已导入字幕（(\d+) 句）$/, (m, i) => i ? `${m[1]} phrases importées.` : `Imported ${m[1]} sentences.`],
    [/^(保存失败|读取配置失败|读取提示词失败|生成失败|字幕加载失败|学习水平保存失败|无法打开设置)：(.+)$/, (m, i) => `${i ? 'Erreur' : 'Error'}: ${t(m[2], i ? 'fr' : 'en')}`],
    [/^模型请求失败 \((\d+)\)：(.+)$/, (m, i) => `${i ? 'Erreur du modèle' : 'Model request failed'} (${m[1]}): ${m[2]}`],
  ];
  let language = globalThis.VL_SYSTEM_LANGUAGE?.() || 'zh-CN';
  function t(value, locale = language) {
    if (typeof value !== 'string' || locale === 'zh-CN') return value;
    const index = locale === 'fr' ? 1 : 0;
    const clean = value.trim();
    const native = globalThis.VL_LOCALES?.[locale];
    if (native?.ui) {
      let local = native.ui[clean];
      const level = clean.match(/^(A[12]|B[12]|C[12]) (入门|基础|中级|中高级|高级|熟练)( · 教学提示词)?$/);
      if (level) {
        const position = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].indexOf(level[1]);
        local = `${level[1]} ${native.levels[position]}${level[3] ? ' · ' + native.ui['分级讲解 Prompt'] : ''}`;
      }
      const count = clean.match(/^(\d+) \/ 16000 字符$/);
      if (count) local = `${count[1]} / 16000`;
      const error = clean.match(/^(保存失败|读取配置失败|读取提示词失败|生成失败|字幕加载失败|学习水平保存失败|无法打开设置)：(.+)$/);
      if (error) local = `${native.status.error}: ${t(error[2], locale)}`;
      const wait = clean.match(/^此句的 (\w+) 讲解将自动加载；.*$/);
      if (wait) local = `${wait[1]} · ${native.status.wait}`;
      const selected = clean.match(/^已切换至 (\w+)，将自动按此水平加载讲解。$/);
      if (selected) local = `${selected[1]} · ${native.status.wait}`;
      const loaded = clean.match(/^已加载 (YouTube|Bilibili) 字幕（(\d+) 句），正在准备自动精讲…$/);
      if (loaded) local = `${loaded[1]} · ${loaded[2]} · ${native.ui['加载字幕…']}`;
      const cached = clean.match(/^已加载本地数据（(\d+) 句，(\d+) 句有讲解）$/);
      if (cached) local = `${native.status.cached}: ${cached[1]} / ${cached[2]}`;
      const generated = clean.match(/^已生成 (\d+) 句 (\w+) 讲解(.*)$/);
      if (generated) local = `${native.status.generated}: ${generated[1]} · ${generated[2]}`;
      const imported = clean.match(/^已导入字幕（(\d+) 句）$/);
      if (imported) local = `${native.ui['导入字幕（SRT / VTT）']}: ${imported[1]}`;
      if (local) return value.replace(clean, local);
    }
    let translated = strings[clean]?.[index];
    if (!translated) for (const [pattern, render] of templates) { const match = clean.match(pattern); if (match) { translated = render(match, index); break; } }
    return translated ? value.replace(clean, translated) : value;
  }
  const originals = new WeakMap();
  function translateNode(node) {
    if (node.nodeType === 3) {
      if (node.parentElement?.closest('script,style,textarea,.vl-cue-text,.vl-lesson-text,.vl-word-term,.vl-word-meaning,.vl-word-example')) return;
      const previous = originals.get(node);
      const source = previous && node.nodeValue === previous.translated ? previous.source : node.nodeValue;
      const translated = t(source);
      originals.set(node, { source, translated });
      if (node.nodeValue !== translated) node.nodeValue = translated;
    } else if (node.nodeType === 1 || node.nodeType === 9) {
      if (node.nodeType === 1) {
        if (node.matches('script,style,textarea')) return;
        let saved = originals.get(node) || {};
        for (const attr of ['title', 'aria-label', 'placeholder']) {
          const current = node.getAttribute(attr);
          if (current == null) continue;
          const source = saved[attr]?.translated === current ? saved[attr].source : current;
          const translated = t(source); saved[attr] = { source, translated };
          if (translated !== current) node.setAttribute(attr, translated);
        }
        originals.set(node, saved);
      }
      for (const child of node.childNodes) translateNode(child);
    }
  }
  function apply() {
    if (!globalThis.document) return;
    // Translate extension pages, or only our panel on a third-party site.
    if (location.protocol === 'chrome-extension:') { document.documentElement.lang = language; document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'; translateNode(document.documentElement); }
    else { const panel = document.getElementById('vl-lesson-panel'); if (panel) { panel.lang = language; panel.dir = language === 'ar' ? 'rtl' : 'ltr'; translateNode(panel); } const fab = document.getElementById('vl-fab'); if (fab) translateNode(fab); }
  }
  globalThis.VL_I18N = { t, setLanguage(value) { language = ['zh-CN', 'en', 'fr', 'ja', 'ko', 'ru', 'es', 'de', 'pt', 'ar'].includes(value) ? value : globalThis.VL_SYSTEM_LANGUAGE?.() || 'zh-CN'; apply(); }, apply, applyTo: translateNode };
  if (globalThis.chrome?.storage && globalThis.document) {
    chrome.storage.local.get('languagePreferences').then(stored => VL_I18N.setLanguage(stored.languagePreferences?.uiLanguage)).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.languagePreferences) VL_I18N.setLanguage(changes.languagePreferences.newValue?.uiLanguage); });
    let queued = false;
    const observer = new MutationObserver(() => { if (!queued) { queued = true; queueMicrotask(() => { queued = false; apply(); }); } });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder'] });
  }
})();
