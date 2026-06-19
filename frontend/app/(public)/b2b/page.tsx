'use client';

/**
 * app/(public)/b2b/page.tsx
 *
 * B2B teams landing page. Migrated from backend/public/b2b.html.
 * Route: /b2b
 */

import { useState } from 'react';
import { apiCall } from '@/lib/api';

interface LeadForm {
  name:    string;
  email:   string;
  org:     string;
  size:    string;
  orgType: string;
  message: string;
}

const INITIAL: LeadForm = { name: '', email: '', org: '', size: '', orgType: '', message: '' };

const ORG_TYPES = ['Company', 'College / University', 'Coaching Institute', 'NGO / Non-profit', 'Government', 'Other'];
const SIZES     = ['1-10', '11-50', '51-200', '201-500', '500+'];

export default function B2BPage() {
  const [form,     setForm]     = useState<LeadForm>(INITIAL);
  const [status,   setStatus]   = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const set = (k: keyof LeadForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.name || !form.email || !form.org || !form.size) {
      setErrorMsg('Please fill in all required fields.');
      return;
    }
    setStatus('submitting');
    setErrorMsg('');

    const res = await apiCall('/leads', 'POST', form);
    if (res.ok) {
      setStatus('success');
    } else {
      setStatus('error');
      setErrorMsg('Something went wrong. Please try again or email us.');
    }
  };

  return (
    <main className="min-h-screen bg-[#080A0F] text-white font-sans">
      {/* Nav */}
      <nav className="border-b border-white/[0.06] px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <a href="/" className="text-xl font-extrabold tracking-tight">
            Vachix
            <span className="ml-2 text-xs font-normal text-white/40 uppercase tracking-widest">for Teams</span>
          </a>
          <a href="/register" className="text-sm font-medium text-white/60 hover:text-white transition-colors">
            Individual sign up →
          </a>
        </div>
      </nav>

      <div className="mx-auto max-w-5xl px-4 py-16 space-y-20">
        {/* Hero */}
        <section className="text-center space-y-5">
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-[1.1]">
            AI Interview Coaching<br />
            <span className="text-[#4F8EF7]">for Your Entire Team</span>
          </h1>
          <p className="text-lg text-white/55 max-w-xl mx-auto">
            Help your students or employees practice interviews in English, Hindi, and Hinglish —
            with real AI feedback, scoring, and analytics.
          </p>
          <a
            href="#contact"
            className="inline-block rounded-xl bg-[#4F8EF7] px-8 py-3.5 font-semibold text-white hover:bg-[#6ba3f9] transition-colors"
          >
            Get a Demo →
          </a>
        </section>

        {/* Features */}
        <section className="grid sm:grid-cols-3 gap-6">
          {[
            { icon: '🎯', title: 'Bulk Access', desc: 'Onboard 10 to 10,000 learners under one dashboard.' },
            { icon: '📊', title: 'Team Analytics', desc: 'Track progress, identify weak areas, and export reports.' },
            { icon: '🇮🇳', title: 'India-First', desc: 'Hindi, Hinglish, UPSC, Bank PO, campus placement — all covered.' },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="rounded-2xl border border-white/[0.07] bg-[#0E1018] p-6 space-y-3">
              <span className="text-3xl">{icon}</span>
              <h3 className="font-semibold">{title}</h3>
              <p className="text-sm text-white/50">{desc}</p>
            </div>
          ))}
        </section>

        {/* Contact form */}
        <section id="contact" className="rounded-2xl border border-white/[0.07] bg-[#0E1018] p-8 max-w-xl mx-auto">
          <h2 className="text-xl font-bold mb-6">Request a Demo</h2>

          {status === 'success' ? (
            <div className="text-center py-8 space-y-3">
              <p className="text-3xl">🎉</p>
              <p className="font-semibold text-white">We received your request!</p>
              <p className="text-sm text-white/50">Our team will reach out within 24 hours.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {[
                { label: 'Your Name *',         key: 'name'  as const, type: 'text',  placeholder: 'Rahul Kumar' },
                { label: 'Work Email *',         key: 'email' as const, type: 'email', placeholder: 'rahul@company.com' },
                { label: 'Organisation Name *',  key: 'org'   as const, type: 'text',  placeholder: 'Acme Corp / IIT Delhi' },
              ].map(({ label, key, type, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs text-white/50 mb-1">{label}</label>
                  <input
                    type={type}
                    value={form[key]}
                    onChange={(e) => set(key, e.target.value)}
                    placeholder={placeholder}
                    className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-[#4F8EF7] transition-colors"
                  />
                </div>
              ))}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-white/50 mb-1">Organisation Type</label>
                  <select
                    value={form.orgType}
                    onChange={(e) => set('orgType', e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#0E1018] px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#4F8EF7]"
                  >
                    <option value="">Select…</option>
                    {ORG_TYPES.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1">Team Size *</label>
                  <select
                    value={form.size}
                    onChange={(e) => set('size', e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#0E1018] px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#4F8EF7]"
                  >
                    <option value="">Select…</option>
                    {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-white/50 mb-1">Message (optional)</label>
                <textarea
                  value={form.message}
                  onChange={(e) => set('message', e.target.value)}
                  placeholder="Tell us about your use case…"
                  rows={3}
                  className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-[#4F8EF7] resize-none"
                />
              </div>

              {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}

              <button
                onClick={handleSubmit}
                disabled={status === 'submitting'}
                className="w-full rounded-xl bg-[#4F8EF7] py-3 font-semibold text-white hover:bg-[#6ba3f9] disabled:opacity-60 transition-all"
              >
                {status === 'submitting' ? 'Sending…' : 'Request Demo →'}
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
