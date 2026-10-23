import React, { useId } from 'react';

/**
 * 灵动导演台 logo（纯矢量，手写路径）。
 *
 * 造型 = 导演场记板 + 播放键：
 *   顶部横条是打板条（带两道缺口表现斜纹），下方是圆角播放三角。
 * 用法：
 *   <LogoMark size={32} />           仅图形（header / favicon 同源）
 *   <LogoMark size={28} withWordmark />  图形 + 中英文名
 * 渐变 id 走 useId，避免同页多处渲染时 id 撞车（React 的 id 含 ":"，SVG url() 里会失效，先剔掉）
 */
export function LogoMark({ size = 32, withWordmark = false, name = '灵动导演台', tagline = '' }) {
  const raw = useId();
  const gid = `lxLogo${raw.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <span className="wb-logo" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={name} focusable="false">
        <defs>
          <linearGradient id={gid} x1="3" y1="1" x2="29" y2="31" gradientUnits="userSpaceOnUse">
            <stop stopColor="#9A8CFF" />
            <stop offset="0.55" stopColor="#6C6CF0" />
            <stop offset="1" stopColor="#3F8FE0" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9.5" fill={`url(#${gid})`} />
        {/* 打板条 */}
        <rect x="6.5" y="9" width="19" height="2.9" rx="1.45" fill="#fff" fillOpacity="0.95" />
        <path d="M10.6 9h2.9l-2.3 2.9H8.3z" fill={`url(#${gid})`} />
        <path d="M16.4 9h2.9l-2.3 2.9h-2.9z" fill={`url(#${gid})`} />
        {/* 播放三角 */}
        <path
          d="M13 15.7c0-1.03 1.1-1.66 1.96-1.16l6.2 3.6c.85.5.85 1.72 0 2.22l-6.2 3.6c-.86.5-1.96-.13-1.96-1.16v-7.1z"
          fill="#fff"
          fillOpacity="0.95"
        />
      </svg>
      {withWordmark && (
        <span className="wb-logo__text">
          <span className="wb-logo__name">{name}</span>
          {tagline ? <span className="wb-logo__tag">{tagline}</span> : null}
        </span>
      )}
    </span>
  );
}

export default LogoMark;
