import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Moon,
  Sparkles,
  Send,
  Loader2,
  Clock,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Lightbulb,
  MessageSquare,
  RefreshCw,
  Zap,
  ChevronDown,
  Info,
  Camera,
} from 'lucide-react';
import { SleepRecord, SleepAnalysisResult, ChatMessage, UserProfile } from '../types/sleep';
import { generateLocalClinicalAnalysis, generateLocalChatReply, classifyIntent, generatePersonalInsights, PersonalInsight } from '../utils/clinicalSleepEngine';
import {
  getActiveModelLabel,
  generateLocalLlmReply,
  getLocalLlmSupport,
  getLocalLlmCacheState,
} from '../utils/localLlmEngine';
import { ThemeConfig } from '../utils/themeStyles';
import { attachHScroll } from '../utils/hscroll';
import { MomentsOverlay } from './MomentsOverlay';

interface AIAdvicePanelProps {
  records: SleepRecord[];
  userProfile: UserProfile;
  theme: ThemeConfig;
}

export const AIAdvicePanel: React.FC<AIAdvicePanelProps> = ({ records, userProfile, theme }) => {
  const [analysis, setAnalysis] = useState<SleepAnalysisResult | null>(null);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);
  const [showMoments, setShowMoments] = useState(false);
  const [activeProviderName, setActiveProviderName] = useState<string>(() => {
    // 初始标签反映用户已保存的档位，而非写死的默认值
    switch (userProfile.aiConfig?.provider) {
      case 'local_llm':
        return getActiveModelLabel();
      case 'local_rules':
        return '本地临床规则引擎';
      case 'custom_openai':
        return '自建 API';
      default:
        return 'DeepSeek';
    }
  });

  // Chat consultation state
  // 会话持久化：分区是条件渲染，切 Tab 即卸载——此前整段对话随组件销毁。
  // 存 localStorage（上限 120 条），切 Tab 与重启都不丢
  const CHAT_KEY = 'somnacare_chat_history';
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem(CHAT_KEY);
      if (saved) {
        const list = JSON.parse(saved);
        if (Array.isArray(list)) {
          return list
            .filter((m) => m && typeof m.content === 'string' &&
              m.content.trim() !== '' && m.content.trim() !== '……' &&
              (m.role === 'user' || m.role === 'assistant'))
            .slice(-120);
        }
      }
    } catch { /* 损坏则回到欢迎语 */ }
    return [
      {
        id: 'welcome',
        role: 'assistant',
        content: '您好，我是您的睡眠顾问。今晚有什么睡眠困扰？',
        timestamp: '刚刚',
      },
    ];
  });
  useEffect(() => {
    // 300ms 防抖：流式生成时每个 token 都会改 chatMessages，
    // 逐次同步 stringify+setItem 约 220 次/生成，全压在打字机路径上
    const t = setTimeout(() => {
      try {
        localStorage.setItem(CHAT_KEY, JSON.stringify(chatMessages.slice(-120)));
      } catch { /* 配额满时保内存即可 */ }
    }, 300);
    return () => clearTimeout(t);
  }, [chatMessages]);
  const [inputText, setInputText] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [showAssessment, setShowAssessment] = useState(false);

  // 数据驱动的个性化洞察（本地推导，随记录更新）+ 动态快捷问题
  const insights = useMemo(() => generatePersonalInsights(records), [records]);
  const quickPrompts = useMemo(() => {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const p of [...insights.map((i) => i.quickPrompt), '怎么提升深睡占比？', '半夜易醒怎么办？']) {
      if (!seen.has(p)) {
        seen.add(p);
        merged.push(p);
      }
    }
    return merged.slice(0, 4);
  }, [insights]);

  // 快捷提示词行：挂 JS 横滑（祖先 pane 的 touch-action: pan-y 会禁掉原生横滑）
  const promptRowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = promptRowRef.current;
    if (!el) return;
    return attachHScroll(el);
  }, []);

  const severityIcon = (sev: PersonalInsight['severity']) =>
    sev === 'good' ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
    : sev === 'warn' ? <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
    : <Info className="w-4 h-4 text-indigo-300 shrink-0" />;
  const severityBorder = (sev: PersonalInsight['severity']) =>
    sev === 'good' ? 'border-emerald-500/40' : sev === 'warn' ? 'border-amber-500/40' : 'border-indigo-500/40';

  // /api 请求超时熔断：网络挂起时 12s 后走本地兜底（此前 fetch 无超时，
  // 环境异常时聊天会永远没有回复）
  const fetchWithTimeout = async (url: string, options: RequestInit, ms = 12000) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { ...options, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  // 云端引擎注入的个人数据上下文（让云端回答引用真实数字）
  const personalCtx = useMemo(() => {
    if (records.length === 0) return '';
    const recent = records.slice(0, 7);
    const avg = (f: (r: SleepRecord) => number) => Math.round(recent.reduce((a, r) => a + f(r), 0) / recent.length);
    const parts = [
      `用户近${recent.length}晚平均评分${avg((r) => r.sleepScore)}分、平均时长${(avg((r) => r.durationMinutes) / 60).toFixed(1)}小时、深睡占比${Math.round(
        (avg((r) => r.deepSleepMinutes) / Math.max(1, avg((r) => r.durationMinutes))) * 100
      )}%`,
      `最近一晚：就寝${records[0].bedtime}、醒来${records[0].wakeTime}、评分${records[0].sleepScore}分`,
    ];
    if (insights.length > 0 && insights[0].id !== 'start') {
      parts.push(`关键洞察：${insights[0].title}——${insights[0].body}`);
    }
    return `【用户真实数据】${parts.join('；')}。回答时请引用这些真实数字，给出针对该用户的具体建议。`;
  }, [records, insights]);
  const [localStage, setLocalStage] = useState<'loading' | 'generating' | null>(null);
  const localGenAbortRef = useRef<AbortController | null>(null);

  const fetchAIAnalysis = async () => {
    setIsLoadingAnalysis(true);

    try {
      const response = await fetchWithTimeout('/api/sleep/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recentLogs: records.slice(0, 7),
          userProfile,
          aiConfig: userProfile.aiConfig,
        }),
      });

      if (!response.ok) {
        throw new Error('API unavailable');
      }

      const data = await response.json();
      setAnalysis(data);
    } catch (_err: any) {
      const localResult = generateLocalClinicalAnalysis(records, userProfile);
      setAnalysis(localResult);
      setActiveProviderName('端侧离线引擎');
    } finally {
      setIsLoadingAnalysis(false);
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend || inputText;
    if (!text.trim() || isSendingChat) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const newHistory = [...chatMessages, userMsg];
    setChatMessages(newHistory);
    setInputText('');
    setIsSendingChat(true);

    try {
      const latestRecord = records[0];
      const cfg = userProfile.aiConfig;
      const customPersona =
        cfg?.systemPersona ||
        '你是一位资深临床睡眠医学顾问。结合用户的睡眠打分与周期推演数据（模型估算值，非传感器实测），以关怀、科学、富有实操性的语气为用户答疑解惑，并如实说明估算边界。';

      // 0. 危机/用药安全护栏：对所有档位（含云端 DeepSeek）统一短路——
      // 此前只挂在端侧档内，默认的云端档请求成功时热线保证不生效，
      // 设置页"安全护栏优先于模型"的承诺落空
      {
        const intent = classifyIntent(text);
        if (intent.category === 'crisis' || intent.category === 'drug_inquiry') {
          setActiveProviderName('安全护栏接管');
          const guardReply = generateLocalChatReply(text, latestRecord, records);
          setChatMessages((prev) => [
            ...prev,
            {
              id: `ai-${Date.now()}`,
              role: 'assistant',
              content: guardReply,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);
          return;
        }
      }

      // 1. 端侧小模型（Qwen3-0.6B, llama.cpp WASM）
      if (cfg?.provider === 'local_llm') {
        const [support, cache] = await Promise.all([getLocalLlmSupport(), getLocalLlmCacheState()]);
        if (!support.supported || !cache.cached) {
          setActiveProviderName('本地引擎（端侧模型未就绪）');
          const hint = support.supported
            ? '\n\n（提示：可在 设置 → AI 顾问模型设置 中下载启用端侧小模型）'
            : `\n\n（端侧模型在当前设备不可用：${support.reason}）`;
          const fallbackReply = generateLocalChatReply(text, latestRecord, records) + hint;
          setChatMessages((prev) => [
            ...prev,
            {
              id: `ai-${Date.now()}`,
              role: 'assistant',
              content: fallbackReply,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);
          return;
        }

        setActiveProviderName(getActiveModelLabel());
        const aiId = `ai-${Date.now()}`;
        setChatMessages((prev) => [
          ...prev,
          {
            id: aiId,
            role: 'assistant' as const,
            content: '……',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
        localGenAbortRef.current = new AbortController();
        // 首个 token 60s 超时兜底：模型加载卡死时自动降级到规则引擎
        let gotFirstToken = false;
        const firstTokenTimer = window.setTimeout(() => {
          if (!gotFirstToken) localGenAbortRef.current?.abort();
        }, 60000);
        try {
          const systemContent = `${customPersona}\n${personalCtx}\n回答保持简短（200字内），语气温和。`;
          const history = newHistory.slice(-4).map((m) => ({
            role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
            content: m.content,
          }));
          await generateLocalLlmReply(
            [{ role: 'system', content: systemContent }, ...history],
            {
              onToken: (token) => {
                if (!gotFirstToken) {
                  gotFirstToken = true;
                  window.clearTimeout(firstTokenTimer);
                }
                setChatMessages((prev) =>
                  prev.map((m) => (m.id === aiId ? { ...m, content: m.content === '……' ? token : m.content + token } : m))
                );
              },
              onStage: (stage) => setLocalStage(stage),
            },
            localGenAbortRef.current.signal
          );
          // 极端情况下模型无输出时兜底到规则引擎
          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === aiId && (m.content.trim() === '' || m.content.trim() === '……') ? { ...m, content: generateLocalChatReply(text, latestRecord, records) } : m
            )
          );
        } catch (err: any) {
          const aborted =
            localGenAbortRef.current?.signal.aborted || err?.name === 'AbortError' || /abort/i.test(String(err?.message));
          if (aborted) {
            // 超时/手动停止：不给死胡同提示，用规则引擎即时回复兜底
            const fallbackReply = generateLocalChatReply(text, latestRecord, records);
            setChatMessages((prev) =>
              prev.map((m) => (m.id === aiId ? { ...m, content: fallbackReply } : m))
            );
          } else {
            setActiveProviderName('本地引擎（端侧模型异常，规则兜底）');
            const fallbackReply = generateLocalChatReply(text, latestRecord, records);
            setChatMessages((prev) => prev.map((m) => (m.id === aiId ? { ...m, content: fallbackReply } : m)));
          }
        } finally {
          window.clearTimeout(firstTokenTimer);
          localGenAbortRef.current = null;
          setLocalStage(null);
        }
        return;
      }

      // 1b. Local Clinical Offline Rule Engine
      if (cfg?.provider === 'local_rules' || (cfg?.provider as string) === 'local_gemma') {
        setActiveProviderName('本地临床规则引擎');
        // Fast local clinical response without external network dependence
        await new Promise((resolve) => setTimeout(resolve, 260));
        const localReply = generateLocalChatReply(text, latestRecord, records);
        const aiReply: ChatMessage = {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: localReply,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setChatMessages((prev) => [...prev, aiReply]);
        return;
      }

      // 2. 云端直连：DeepSeek 官方档或自建 OpenAI 兼容档（自建档此前落到不存在的
      //    /api 代理 → 实际回的是本地规则引擎，而界面仍宣称"自建 API"）
      if ((cfg?.provider === 'deepseek' && cfg.deepseekApiKey) ||
          (cfg?.provider === 'custom_openai' && cfg.customApiKey && cfg.customBaseUrl)) {
        const isCustom = cfg.provider === 'custom_openai';
        const endpoint = isCustom
          ? `${String(cfg.customBaseUrl).replace(/\/+$/, '')}/chat/completions`
          : 'https://api.deepseek.com/chat/completions';
        const modelToUse = isCustom
          ? (cfg.customModelName || 'deepseek-chat')
          : (cfg.deepseekModel || 'deepseek-flash');
        setActiveProviderName(isCustom ? `自建 API (${modelToUse})` : `DeepSeek (${modelToUse})`);

        // 直连也走超时熔断：此前裸 fetch 挂起时 isSendingChat 永远为 true 且无停止入口
        const dsRes = await fetchWithTimeout(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${isCustom ? cfg.customApiKey : cfg.deepseekApiKey}`,
          },
          body: JSON.stringify({
            model: isCustom ? modelToUse : modelToUse === 'deepseek-flash' ? 'deepseek-chat' : modelToUse === 'deepseek-pro' ? 'deepseek-reasoner' : modelToUse,
            messages: [
              {
                role: 'system',
                content: `${customPersona}\n${personalCtx}`,
              },
              ...newHistory.map((m) => ({ role: m.role, content: m.content })),
            ],
            temperature: 0.7,
          }),
        });

        if (dsRes.ok) {
          const dsData = await dsRes.json();
          // 空内容不再伪装成模型回答：落空则继续走本地兜底（那条路径是诚实的）
          const replyText = dsData.choices?.[0]?.message?.content;
          const aiReply: ChatMessage = {
            id: `ai-${Date.now()}`,
            role: 'assistant',
            content: replyText,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          };
          if (replyText && replyText.trim()) {
            setChatMessages((prev) => [...prev, aiReply]);
            return;
          }
          console.warn('[chat] DeepSeek 返回空内容，转本地兜底');
        }
      }

      // 3. Fallback to app server proxy
      const response = await fetchWithTimeout('/api/sleep/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: newHistory.slice(-6),
          recentLogs: records.slice(0, 3),
          userProfile,
          aiConfig: userProfile.aiConfig,
        }),
      });

      if (!response.ok) {
        throw new Error('Chat API network error');
      }

      const data = await response.json();
      if (data.provider) {
        setActiveProviderName(data.provider);
      }
      if (!data || typeof data !== 'object' || !data.result) {
        throw new Error('服务端响应结构异常');
      }
      const aiReply: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: data.reply || '（服务端返回了空回复，请重试）',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatMessages((prev) => [...prev, aiReply]);
    } catch (_err) {
      const localReplyText = generateLocalChatReply(text, records[0], records);
      const aiReply: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: localReplyText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatMessages((prev) => [...prev, aiReply]);
    } finally {
      setIsSendingChat(false);
    }
  };

  return (
    <div className={`space-y-3 pb-28 ${theme.textPrimary}`}>
      {/* 0. 大肥鱼的朋友圈（真实睡眠数据 · LLM 只写文案不编数据） */}
      <button
        type="button"
        onClick={() => setShowMoments(true)}
        className={`w-full ${theme.cardBg} rounded-3xl p-4 border ${theme.cardBorder} text-left cursor-pointer active:scale-[0.99] transition-transform shadow-lg flex items-center gap-3`}
      >
        <div className="w-10 h-10 shrink-0 rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center text-xl">
          🐋
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-xs font-black text-white flex items-center gap-1.5">
            大肥鱼的朋友圈
            <Camera className="w-3.5 h-3.5 text-sky-400" />
          </h3>
          <p className="text-[10px] text-slate-400 leading-relaxed mt-0.5">
            她每天根据你的真实睡眠数据发动态，AI 好友来毒舌，你可以评论——她会傲娇地回
          </p>
        </div>
        <span className="text-[10px] font-black text-sky-300 shrink-0">进入 ›</span>
      </button>

      {/* 1. 个性化洞察（数据驱动，点按即提问） */}
      {insights.map((ins) => (
        <button
          key={ins.id}
          type="button"
          onClick={() => handleSendMessage(ins.quickPrompt)}
          className={`w-full ${theme.cardBg} rounded-3xl p-4 border ${severityBorder(ins.severity)} text-left cursor-pointer active:scale-[0.99] transition-transform shadow-lg space-y-1.5`}
        >
          <div className="flex items-center gap-2">
            {severityIcon(ins.severity)}
            <h3 className="text-xs font-black text-white">{ins.title}</h3>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">{ins.body}</p>
          <span className={`text-[10px] font-bold ${theme.accentText} inline-flex items-center gap-1`}>
            问顾问：{ins.quickPrompt} →
          </span>
        </button>
      ))}

      {/* 2. 完整评估（默认折叠） */}
      <div className={`${theme.cardBg} rounded-3xl border ${theme.cardBorder} shadow-lg overflow-hidden`}>
        <button
          type="button"
          onClick={() => setShowAssessment(!showAssessment)}
          className="w-full p-4 flex items-center justify-between cursor-pointer"
        >
          <div className="text-left">
            <h3 className="text-xs font-bold text-white">睡眠医学完整评估</h3>
            <p className="text-[10px] text-slate-400 mt-0.5">时型推断 · 五维临床指标 · 习惯阻碍分析</p>
          </div>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showAssessment ? 'rotate-180' : ''}`} />
        </button>

        {showAssessment && (
          <div className="px-4 pb-4 space-y-3 animate-tab-fade-in">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-slate-400">模型：{activeProviderName} · 估算非诊断</p>
              <button
                type="button"
                onClick={fetchAIAnalysis}
                disabled={isLoadingAnalysis}
                className={`px-3 py-1.5 rounded-xl ${theme.accentBg} ${theme.accentFg} text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow active:scale-95`}
              >
                {isLoadingAnalysis ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>评估中</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3 h-3" />
                    <span>{analysis ? '刷新评估' : '生成评估'}</span>
                  </>
                )}
              </button>
            </div>

            {analysis && (
          <div className={`${theme.cardInnerBg} rounded-2xl p-4 border ${theme.cardInnerBorder} space-y-3`}>
          <div className={`text-xs text-white ${theme.cardInnerBg} p-3 rounded-2xl border-l-3 ${theme.accentBorder} leading-relaxed font-medium`}>
            “{analysis.scoreSummary}”
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className={`p-3 rounded-2xl bg-black/20 border ${theme.cardInnerBorder}`}>
              <span className={`text-[11px] font-bold ${theme.accentText} block mb-1`}>深睡机能恢复</span>
              <p className="text-slate-300 text-[11px] leading-relaxed">
                {analysis.clinicalMetricsAnalysis.deepSleepAssessment}
              </p>
            </div>
            <div className={`p-3 rounded-2xl bg-black/20 border ${theme.cardInnerBorder}`}>
              <span className="text-[11px] font-bold text-emerald-300 block mb-1">入睡与睡眠效率</span>
              <p className="text-slate-300 text-[11px] leading-relaxed">
                {analysis.clinicalMetricsAnalysis.efficiencyAssessment}
              </p>
            </div>
          </div>
          </div>
        )}
          </div>
        )}
      </div>

      {/* 2. Interactive AI Consultation Chat */}
      <div className={`${theme.cardBg} rounded-3xl p-4 border ${theme.cardBorder} flex flex-col h-[460px]`}>
        {/* 消息流：嵌套纵向滚动容器。
            swipe-nested 让浏览器不再为它单独做滚动方向判定，横滑立刻透给分区轨道
            （否则内层容器的滚动仲裁会延迟 pointer 事件，真机上表现为"框内滑不动"）。*/}
        <div className="flex-1 overflow-y-auto py-2 space-y-3 pr-1 text-xs no-scrollbar swipe-nested">
          {chatMessages.length <= 1 && (
            <div className="flex flex-col items-center justify-center py-7 gap-3 select-none" aria-hidden>
              <div className="relative">
                <div
                  className="absolute -inset-5 rounded-full blur-xl opacity-40"
                  style={{ background: `radial-gradient(circle, ${theme.accentHex}55, transparent 70%)` }}
                />
                <Moon className={`w-10 h-10 ${theme.accentText} relative`} />
              </div>
              <span className={`text-[11px] ${theme.accentText} font-bold tracking-[0.3em]`}>懂睡眠 · 更懂你</span>
            </div>
          )}
          {chatMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 leading-relaxed text-xs whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? `${theme.accentBg.split(' ')[0]} ${theme.accentFg} font-medium rounded-br-none`
                    : `${theme.cardInnerBg} text-white border ${theme.cardInnerBorder} rounded-bl-none`
                }`}
              >
                {msg.content}
              </div>
              <span className="text-[9px] text-slate-500 mt-1 px-1 font-mono">{msg.timestamp}</span>
            </div>
          ))}

          {isSendingChat && (
            <div className={`flex items-center gap-1.5 ${theme.accentText} text-xs py-1`}>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>
                {localStage === 'loading'
                  ? '正在加载端侧模型（首次约需数秒）...'
                  : localStage === 'generating'
                  ? '端侧模型生成中（CPU 推理较慢，请稍候）...'
                  : '顾问正在组织回复...'}
              </span>
              {localStage && (
                <button
                  type="button"
                  onClick={() => localGenAbortRef.current?.abort()}
                  className="ml-1 text-slate-400 hover:text-white border border-slate-700 rounded-lg px-2 py-0.5 text-[10px] cursor-pointer"
                >
                  停止
                </button>
              )}
            </div>
          )}
        </div>

        {/* 快捷提问：横向可滑动的胶囊行。
            data-native-hscroll 告知分区轨道"这块自己处理手势"，轨道不会抢走横滑；
            横滑本身由 hscroll.ts 直接驱动 scrollLeft（见该文件顶部说明）。 */}
        <div
          ref={promptRowRef}
          data-native-hscroll
          className="py-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0 -mx-1 px-1"
        >
          {quickPrompts.map((prompt: string, i: number) => (
            <button
              key={i}
              type="button"
              onClick={() => handleSendMessage(prompt)}
              disabled={isSendingChat}
              className={`text-xs whitespace-nowrap px-3 py-1 rounded-full ${theme.cardInnerBg} hover:opacity-80 text-slate-300 border ${theme.cardInnerBorder} transition-all shrink-0 cursor-pointer`}
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Chat input box */}
        <div className="pt-2.5 border-t border-slate-700/50 flex items-center gap-2 shrink-0">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSendMessage();
            }}
            placeholder="输入睡眠疑问..."
            className={`flex-1 ${theme.cardInnerBg} border ${theme.cardInnerBorder} rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none ${theme.focusRing} font-medium`}
          />
          <button
            type="button"
            aria-label="发送睡眠疑问"
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim() || isSendingChat}
            className={`p-2.5 rounded-xl ${theme.accentBg} disabled:opacity-40 ${theme.accentFg} transition-all cursor-pointer`}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 大肥鱼的朋友圈：portal 到 body——外层滑动容器带 translate3d，
          fixed 定位会退化成相对它定位，弹窗就会"横跨几个区" */}
      {showMoments &&
        createPortal(
          <MomentsOverlay
            records={records}
            userProfile={userProfile}
            onClose={() => setShowMoments(false)}
          />,
          document.body,
        )}
    </div>
  );
};
