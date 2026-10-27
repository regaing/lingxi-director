import React from 'react';

/**
 * 画布节点里的内嵌视频播放器（素材节点直接点播放，不用先选中节点开面板）。
 *
 * 三条硬约定：
 * 1) `nodrag nowheel`：不加的话，在播放器上拖进度条会被 React Flow 当成拖节点，
 *    滚轮也会缩放画布 —— 看着视频手一滑画布就飞了。
 * 2) 同一时间只播一个：所有播放器共用一个模块级 currentEl，谁开播谁把上一个暂停。
 *    预览层（AssetLightbox 自动播放）也走 claimPlayback，保证全局只有一个在出声。
 * 3) `preload="metadata"` + `src` 带 `#t=0.1` 媒体片段：只拉元数据不拉整片，
 *    但能渲染出首帧画面（否则节点上是一块纯黑，比缩略图还难认）。
 */
let currentEl = null;

/** 申请播放权：把上一个正在播的暂停。别在 pause 事件里回调用，会互相打架 */
export function claimPlayback(el) {
  if (currentEl && currentEl !== el && currentEl.isConnected) currentEl.pause();
  currentEl = el;
}

export default function NodeVideo({ src, title }) {
  if (!src) return null;
  return (
    <video
      className="wb-node__video nodrag nowheel"
      src={`${src}#t=0.1`}
      controls
      playsInline
      preload="metadata"
      title={title || ''}
      onPlay={(e) => claimPlayback(e.currentTarget)}
    />
  );
}
