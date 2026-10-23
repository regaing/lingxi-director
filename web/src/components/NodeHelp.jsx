import React, { useEffect, useState } from 'react';
import { helpOf } from '../help.js';
import { useI18n } from '../i18n.jsx';
import { Ic } from './Icons.jsx';

/**
 * 节点使用说明。
 *
 * 默认展开：新用户点开一个节点就该看到「怎么填、怎么连」，而不是空白面板。
 * 收起状态按**节点类型**记在 localStorage —— 一类节点学会了，以后就不占地方。
 */

const KEY = 'wb.help.collapsed';

function readCollapsed() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch { return new Set(); }
}

function writeCollapsed(set) {
  try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch { /* 存不了不影响使用 */ }
}

/**
 * 行内标记：**加粗**、{{占位符}}、`代码`。
 * {{...}} 自动高亮——这是最容易写错的地方（key 拼错不报错，只是原样输出），
 * 让它在视觉上和普通正文分开，用户才看得出那是个要替换的槽位。
 */
const TOKEN = /(\*\*[^*]+\*\*|\{\{[^}]+\}\}|`[^`]+`)/g;

function Rich({ text }) {
  const parts = String(text).split(TOKEN).filter((p) => p !== '');
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('{{') || p.startsWith('`')) {
      return <code className="wb-help__tok" key={i}>{p.replace(/^`|`$/g, '')}</code>;
    }
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

/** 按换行拆条目；bullet=true 时每行前加小圆点（适合「怎么填」「怎么连」这种并列项） */
function Lines({ text, bullet = false }) {
  return String(text).split('\n').map((line, i) => (
    <div className={`wb-help__line${bullet ? ' wb-help__line--bullet' : ''}`} key={i}>
      <Rich text={line} />
    </div>
  ));
}

export default function NodeHelp({ type }) {
  const { t, lang } = useI18n();
  const help = helpOf(type, lang);
  const [collapsed, setCollapsed] = useState(() => readCollapsed().has(type));

  // 切换节点时组件会被复用，useState 的初始化函数不会再跑一遍。
  // 不重置的话：在 A 节点收起后点到 B 节点，B 也是收起的（哪怕从没碰过）。
  useEffect(() => { setCollapsed(readCollapsed().has(type)); }, [type]);

  // 没写帮助的节点不占位，别留一个空壳子
  if (!help) return null;

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    const set = readCollapsed();
    if (next) set.add(type); else set.delete(type);
    writeCollapsed(set);
  };

  return (
    <section className={`wb-help${collapsed ? ' is-collapsed' : ''}`}>
      <button type="button" className="wb-help__head" onClick={toggle} aria-expanded={!collapsed}>
        <Ic n="notice" size={13} />
        <span className="wb-help__title">{t('help.title')}</span>
        <Ic n={collapsed ? 'chevronRight' : 'chevronDown'} size={13} />
      </button>

      {!collapsed && (
        <div className="wb-help__body">
          <div className="wb-help__sec">
            <div className="wb-help__label">{t('help.what')}</div>
            <Lines text={help.what} />
          </div>

          <div className="wb-help__sec">
            <div className="wb-help__label">{t('help.how')}</div>
            <Lines text={help.how} bullet />
          </div>

          {help.example && (
            <div className="wb-help__sec">
              <div className="wb-help__label">{t('help.example')}</div>
              <pre className="wb-help__code">{help.example}</pre>
            </div>
          )}

          <div className="wb-help__sec">
            <div className="wb-help__label">{t('help.wire')}</div>
            <Lines text={help.wire} bullet />
          </div>
        </div>
      )}
    </section>
  );
}
