'use client';

import { useState, useRef, useEffect } from 'react';
import { Button, Card, CardHeader, CardBody, Badge, ChipGroup, Spinner } from '@/components/ui';
import { aiApi } from '@/features/ai/api';
import { getElaraSystemPrompt, parseElaraResponse, getLiveFeedback, type ElaraMode } from '@/lib/interview-prompts';
import { Send, RotateCcw } from 'lucide-react';

const MODE_OPTIONS: { label: string; value: ElaraMode }[] = [
  { label: '💬 Conversation', value: 'conversation' },
  { label: '📚 Topics', value: 'topics' },
  { label: '📝 Correction', value: 'correction' },
  { label: '🔤 Vocabulary', value: 'vocabulary' },
];

const TOPICS = [
  'Daily life', 'Work & career', 'Technology', 'Current affairs',
  'Travel', 'Health & fitness', 'Family', 'Education',
];

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  analysis?: ReturnType<typeof parseElaraResponse>['analysis'];
}

export default function EnglishPage() {
  const [mode, setMode] = useState<ElaraMode>('conversation');
  const [topic, setTopic] = useState('Daily life');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [avgGrammar, setAvgGrammar] = useState<number | null>(null);
  const [avgFluency, setAvgFluency] = useState<number | null>(null);
  const [avgVocab, setAvgVocab] = useState<number | null>(null);
  const [msgCount, setMsgCount] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Recalculate rolling averages whenever messages change
  useEffect(() => {
    const analyzed = messages.filter((m) => m.role === 'assistant' && m.analysis);
    if (!analyzed.length) return;
    const avg = (key: 'grammar_score' | 'fluency_score' | 'vocab_score') =>
      Math.round(analyzed.reduce((a, m) => a + (m.analysis?.[key] ?? 0), 0) / analyzed.length * 10) / 10;
    setAvgGrammar(avg('grammar_score'));
    setAvgFluency(avg('fluency_score'));
    setAvgVocab(avg('vocab_score'));
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || loading) return;
    const userMsg: ChatMsg = { role: 'user', content: input.trim() };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput('');
    setLoading(true);
    setMsgCount((c) => c + 1);

    const systemPrompt = getElaraSystemPrompt(mode, topic);

    const res = await aiApi.call({
      messages: [
        // System context injected as the first user message
        { role: 'user', content: `[SYSTEM: ${systemPrompt}]` },
        // Prior conversation history (excludes the current message)
        ...messages.slice(-8).map((m) => ({ role: m.role, content: m.content })),
        // Current user message as its own turn
        { role: 'user', content: input.trim() },
      ],
      topic: 'English coaching',
    });

    if (res.ok) {
      const { reply, analysis } = parseElaraResponse(res.data.text);
      setMessages((prev) => [...prev, { role: 'assistant', content: reply, analysis }]);
    } else {
      setMessages((prev) => [...prev, { role: 'assistant', content: '⚠ Could not get response. Try again.' }]);
    }
    setLoading(false);
  }

  function resetChat() {
    setMessages([]);
    setMsgCount(0);
    setAvgGrammar(null);
    setAvgFluency(null);
    setAvgVocab(null);
  }

  const liveChips = getLiveFeedback(input);

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-bold text-base">
          E
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">Elara — English Coach</h1>
          <p className="text-xs text-[#8B90A0]">Grammar corrections, vocabulary & fluency coaching</p>
        </div>
      </div>

      {/* Scores strip */}
      {avgGrammar != null && (
        <div className="flex gap-4 bg-[#16181F] border border-white/[0.07] rounded-2xl px-5 py-3 overflow-x-auto">
          {[
            { label: 'Grammar', val: avgGrammar, color: 'text-emerald-400' },
            { label: 'Fluency', val: avgFluency, color: 'text-blue-400' },
            { label: 'Vocabulary', val: avgVocab, color: 'text-amber-400' },
          ].map((s) => (
            <div key={s.label} className="text-center min-w-[60px]">
              <div className={`text-xl font-bold ${s.color}`}>{s.val ?? '—'}</div>
              <div className="text-[10px] text-[#555A6A]">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Mode selector */}
      <Card className="p-4">
        <div className="text-xs font-semibold text-[#8B90A0] uppercase tracking-widest mb-3">Mode</div>
        <ChipGroup options={MODE_OPTIONS} value={mode} onChange={(v) => { setMode(v); resetChat(); }} />

        {mode === 'topics' && (
          <div className="mt-3">
            <div className="text-xs font-semibold text-[#8B90A0] uppercase tracking-widest mb-2">Topic</div>
            <div className="flex flex-wrap gap-2">
              {TOPICS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTopic(t)}
                  className={`px-3 py-1 rounded-full text-xs border transition-all ${
                    topic === t
                      ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                      : 'bg-white/5 border-white/10 text-[#8B90A0] hover:text-white'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Chat area */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <span className="text-sm font-semibold text-white">Practice</span>
          <button onClick={resetChat} className="text-xs text-[#555A6A] hover:text-[#8B90A0] flex items-center gap-1">
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
        </CardHeader>
        <CardBody>
          {/* Messages */}
          <div className="space-y-4 min-h-[200px] mb-4">
            {messages.length === 0 && (
              <p className="text-sm text-[#555A6A] text-center py-8">
                {mode === 'conversation' && 'Start talking — Elara will correct your English naturally.'}
                {mode === 'topics' && `Let's talk about: ${topic}. Start whenever you're ready!`}
                {mode === 'vocabulary' && 'Type a word or phrase to explore its meaning and usage.'}
                {mode === 'correction' && 'Type a sentence and Elara will correct it.'}
              </p>
            )}

            {messages.map((msg, i) => (
              <div key={i}>
                {/* Bubble */}
                <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mr-2 mt-0.5">
                      E
                    </div>
                  )}
                  <div className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-blue-500/20 border border-blue-500/30 text-white'
                      : 'bg-[#1D2029] border border-white/[0.07] text-white'
                  }`}>
                    {msg.content}
                  </div>
                </div>

                {/* Analysis panel */}
                {msg.analysis && (
                  <div className="ml-9 mt-2 space-y-2">
                    {/* Scores */}
                    <div className="flex gap-3">
                      {msg.analysis.grammar_score != null && (
                        <Badge variant="success" size="sm">Grammar {msg.analysis.grammar_score}/10</Badge>
                      )}
                      {msg.analysis.fluency_score != null && (
                        <Badge variant="accent" size="sm">Fluency {msg.analysis.fluency_score}/10</Badge>
                      )}
                      {msg.analysis.vocab_score != null && (
                        <Badge variant="warn" size="sm">Vocab {msg.analysis.vocab_score}/10</Badge>
                      )}
                    </div>

                    {/* Errors */}
                    {msg.analysis.errors && msg.analysis.errors.length > 0 && (
                      <div className="space-y-1">
                        {msg.analysis.errors.map((e, j) => (
                          <div key={j} className="text-xs bg-red-500/5 border border-red-500/20 rounded-xl px-3 py-2">
                            <span className="text-red-400 line-through">{e.wrong}</span>
                            <span className="text-[#555A6A] mx-2">→</span>
                            <span className="text-emerald-400">{e.correct}</span>
                            {e.rule && <div className="text-[#555A6A] mt-0.5">{e.rule}</div>}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Vocab upgrade */}
                    {msg.analysis.vocab_upgrade && (
                      <div className="text-xs bg-amber-400/10 border border-amber-400/20 rounded-xl px-3 py-2">
                        <span className="text-[#555A6A]">Basic:</span>{' '}
                        <span className="text-amber-400">{msg.analysis.vocab_upgrade.basic}</span>
                        <span className="text-[#555A6A] mx-2">→</span>
                        <span className="text-[#555A6A]">Better:</span>{' '}
                        <span className="text-emerald-400">{msg.analysis.vocab_upgrade.better}</span>
                      </div>
                    )}

                    {/* Tip */}
                    {msg.analysis.tip && (
                      <p className="text-xs text-[#8B90A0] italic">{msg.analysis.tip}</p>
                    )}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold mr-2">E</div>
                <div className="bg-[#1D2029] border border-white/[0.07] px-4 py-3 rounded-2xl">
                  <Spinner className="w-4 h-4 text-blue-400" />
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Live chips */}
          {liveChips.length > 0 && input.length > 5 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {liveChips.map((chip, i) => (
                <span
                  key={i}
                  className={`text-xs px-2.5 py-1 rounded-full border ${
                    chip.type === 'ok' ? 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20'
                    : chip.type === 'filler' ? 'bg-amber-400/10 text-amber-400 border-amber-400/20'
                    : 'bg-red-400/10 text-red-400 border-red-400/20'
                  }`}
                >
                  {chip.msg}
                </span>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="flex gap-2">
            <input
              className="flex-1 px-4 py-3 rounded-xl bg-[#1D2029] border border-white/[0.07] text-white placeholder:text-[#555A6A] text-sm focus:outline-none focus:border-blue-500/50"
              placeholder="Type in English…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            />
            <Button disabled={!input.trim() || loading} onClick={handleSend} size="icon">
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
