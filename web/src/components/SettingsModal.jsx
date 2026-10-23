import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { Ic } from './Icons.jsx';

const SHORTCUTS = [
  ['Ctrl / ⌘ + S', 'sc.save'],
  ['Ctrl / ⌘ + Enter', 'sc.run'],
  ['Ctrl / ⌘ + Shift + Enter', 'sc.estimate'],
  ['Ctrl / ⌘ + Z', 'sc.undo'],
  ['Ctrl / ⌘ + Shift + Z', 'sc.redo'],
  ['Ctrl / ⌘ + A', 'sc.selectAll'],
  ['Delete / Backspace', 'sc.delete'],
  ['F', 'sc.fit'],
  ['Esc', 'sc.esc'],
];

/** 65536 → 64K：数字输入框旁边给个能读懂的量级 */
function human(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v >= 1048576) return `${+(v / 1048576).toFixed(v % 1048576 ? 1 : 0)}M`;
  if (v >= 1024) return `${+(v / 1024).toFixed(v % 1024 ? 1 : 0)}K`;
  return String(v);
}

export default function SettingsModal({ onClose }) {
  const { t, toggle } = useI18n();
  const [tab, setTab] = useState('api');
  const [form, setForm] = useState(null);
  const [masked, setMasked] = useState({ token: '', llmKey: '' });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.settings()
      .then((s) => {
        setForm({
          token: '', baseUrl: s.baseUrl || '',
          llmBaseUrl: s.llm?.baseUrl || '', llmModel: s.llm?.model || '', llmKey: '',
          llmMaxTokens: String(s.llm?.maxTokens ?? 65536),
          llmContext: String(s.llm?.contextWindow ?? 1048576),
        });
        setMasked({ token: s.token || '', llmKey: s.llm?.apiKey || '' });
      })
      .catch((e) => setNote(e.message));
  }, []);

  async function save() {
    setBusy(true);
    setNote('');
    try {
      await api.saveSettings({
        token: form.token,
        baseUrl: form.baseUrl,
        llm: {
          baseUrl: form.llmBaseUrl,
          model: form.llmModel,
          apiKey: form.llmKey,
          maxTokens: form.llmMaxTokens,
          contextWindow: form.llmContext,
        },
      });
      const s = await api.settings();
      setMasked({ token: s.token || '', llmKey: s.llm?.apiKey || '' });
      setForm((f) => ({
        ...f,
        token: '', llmKey: '',
        llmMaxTokens: String(s.llm?.maxTokens ?? 65536),
        llmContext: String(s.llm?.contextWindow ?? 1048576),
      }));
      setNote(t('settings.saved'));
    } catch (e) {
      setNote(e.message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="wb-modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wb-modal" role="dialog" aria-modal="true">
        <div className="wb-modal__head">
          <strong>{t('settings.title')}</strong>
          <button type="button" className="wb-icon-btn" onClick={onClose}>×</button>
        </div>

        <div className="wb-tabs">
          <button type="button" className={tab === 'api' ? 'is-on' : ''} onClick={() => setTab('api')}>{t('settings.tab.api')}</button>
          <button type="button" className={tab === 'llm' ? 'is-on' : ''} onClick={() => setTab('llm')}>{t('settings.tab.llm')}</button>
          <button type="button" className={tab === 'shortcuts' ? 'is-on' : ''} onClick={() => setTab('shortcuts')}>{t('settings.tab.shortcuts')}</button>
        </div>

        <div className="wb-modal__body">
          {!form && <div className="wb-empty">{t('common.loading')}</div>}

          {form && tab === 'api' && (
            <>
              <fieldset className="wb-setcard">
                <legend className="wb-setcard__title">{t('settings.card.auth')}</legend>
                <label className="wb-field">
                  <span className="wb-field__label">{t('settings.token')}</span>
                  <input
                    className="wb-input"
                    type="password"
                    value={form.token}
                    onChange={set('token')}
                    placeholder={masked.token || 'mk-...'}
                  />
                  <span className="wb-field__hint">
                    {masked.token ? `${masked.token} · ` : ''}{t('settings.token.hint')}
                  </span>
                </label>
              </fieldset>

              <fieldset className="wb-setcard">
                <legend className="wb-setcard__title">{t('settings.card.endpoint')}</legend>
                <label className="wb-field">
                  <span className="wb-field__label">{t('settings.baseUrl')}</span>
                  <input className="wb-input" value={form.baseUrl} onChange={set('baseUrl')} placeholder="https://metaso.cn/api/minimax" />
                  <span className="wb-field__hint">{t('settings.baseUrl.hint')}</span>
                </label>
                <div className="wb-field">
                  <span className="wb-field__label">{t('settings.model')}</span>
                  <div className="wb-readonly">MiniMax-H3</div>
                  <span className="wb-field__hint">{t('settings.model.hint')}</span>
                </div>
              </fieldset>
            </>
          )}

          {form && tab === 'llm' && (
            <>
              <fieldset className="wb-setcard">
                <legend className="wb-setcard__title">{t('settings.card.connection')}</legend>
                <label className="wb-field">
                  <span className="wb-field__label">{t('settings.llm.baseUrl')}</span>
                  <input className="wb-input" value={form.llmBaseUrl} onChange={set('llmBaseUrl')} placeholder="https://api.deepseek.com" />
                </label>
                <label className="wb-field">
                  <span className="wb-field__label">{t('settings.llm.model')}</span>
                  <input className="wb-input" value={form.llmModel} onChange={set('llmModel')} placeholder="deepseek-flash" />
                  <span className="wb-field__hint">{t('settings.llm.hint')}</span>
                </label>
                <label className="wb-field">
                  <span className="wb-field__label">{t('settings.llm.key')}</span>
                  <input className="wb-input" type="password" value={form.llmKey} onChange={set('llmKey')} placeholder={masked.llmKey || 'sk-...'} />
                  <span className="wb-field__hint">{masked.llmKey ? `${masked.llmKey} · ` : ''}{t('settings.llm.key.hint')}</span>
                </label>
              </fieldset>

              <fieldset className="wb-setcard">
                <legend className="wb-setcard__title">{t('settings.card.capacity')}</legend>
                <label className="wb-field">
                  <span className="wb-field__label">{t('settings.llm.maxTokens')}</span>
                  <div className="wb-field__row">
                    <input className="wb-input" type="number" min="256" step="1024" value={form.llmMaxTokens} onChange={set('llmMaxTokens')} />
                    <em className="wb-field__unit">{human(form.llmMaxTokens) || '—'}</em>
                  </div>
                  <span className="wb-field__hint">{t('settings.llm.maxTokens.hint')}</span>
                </label>
                <label className="wb-field">
                  <span className="wb-field__label">{t('settings.llm.context')}</span>
                  <div className="wb-field__row">
                    <input className="wb-input" type="number" min="1024" step="1024" value={form.llmContext} onChange={set('llmContext')} />
                    <em className="wb-field__unit">{human(form.llmContext) || '—'}</em>
                  </div>
                  <span className="wb-field__hint">{t('settings.llm.context.hint')}</span>
                </label>
              </fieldset>
            </>
          )}

          {tab === 'shortcuts' && (
            <table className="wb-keys">
              <tbody>
                {SHORTCUTS.map(([k, key]) => (
                  <tr key={k}><td><kbd>{k}</kbd></td><td>{t(key)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="wb-modal__foot">
          <button
            type="button"
            className="wb-icon-btn"
            title={t('nav.lang')}
            aria-label={t('nav.lang')}
            onClick={toggle}
          >
            <Ic n="lang" size={16} />
          </button>
          <span className="wb-modal__note">{note}</span>
          {tab !== 'shortcuts' && (
            <button type="button" className="wb-btn wb-btn--primary" onClick={save} disabled={busy || !form}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
          )}
          <button type="button" className="wb-btn" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  );
}
