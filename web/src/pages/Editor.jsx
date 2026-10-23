import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge, MarkerType, useReactFlow,
} from '@xyflow/react';
import nodeTypes from '../nodes/index.jsx';
import DeletableEdge from '../nodes/DeletableEdge.jsx';
import TaskPanel from '../TaskPanel.jsx';
import SettingsModal from '../components/SettingsModal.jsx';
import NotificationCenter, { pingNotifications } from '../components/NotificationCenter.jsx';
import RunPanel from '../components/RunPanel.jsx';
import { LogoMark } from '../components/Logo.jsx';
import { Ic } from '../components/Icons.jsx';
import { Palette, AiPanel, Inspector } from '../panels.jsx';
import { NODE_DEFS, newNode, validateGraph, schemaForLLM, PROVIDER, PAD_COLORS } from '../graph/model.js';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { go } from '../router.js';

/** 老图里没有新增字段的值，加载时用节点默认值补齐（只在内存，保存才落盘） */
const hydrate = (nodes) => (nodes || []).map((n) => {
  const defaults = NODE_DEFS[n.type]?.defaults || {};
  const data = { ...defaults, ...(n.data || {}) };
  // 早期版本把 ratio 默认成 adaptive，而网关不认这个值：老图加载时就地纠正，
  // 否则用户一运行就吃「ratio 参数无效」，还看不出是哪个节点的问题
  if (n.type === 'param.video' && !PROVIDER.ratios.includes(data.ratio)) data.ratio = defaults.ratio;
  // 补边颜色已改成下拉枚举，老图里存的自定义值（比如 #ff0000）在下拉里没有对应项，回退到默认
  if (n.type === 'image.fit' && !PAD_COLORS.includes(data.color)) data.color = defaults.color;
  return { ...n, data };
});

const edgeTypes = { wb: DeletableEdge };
const MARKER = { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#5b5b6e' };
const asEdge = (e) => ({ ...e, type: 'wb', markerEnd: e.markerEnd || MARKER });
const cleanNodes = (ns) => ns.map((n) => ({
  id: n.id,
  type: n.type,
  position: n.position,
  data: Object.fromEntries(Object.entries(n.data || {}).filter(([k]) => !k.startsWith('__'))),
}));
const cleanEdges = (es) => es.map((e) => ({
  id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? null,
  target: e.target, targetHandle: e.targetHandle ?? null,
}));

/** 秒 → mm:ss（运行计时器用） */
const fmtDuration = (sec) => {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/* 侧栏宽度：夹在区间里 + 记住上次拖到哪 */
const CLAMP = (v, min, max) => Math.min(max, Math.max(min, Math.round(v)));
const LEFT = [232, 460];
const RIGHT = [308, 620];
/** 窄窗口（分屏 / 小屏）主动收一点，否则两栏会把画布挤到只剩一百来像素 */
const fitViewport = (w, min) => (typeof window === 'undefined' ? w : Math.max(min, Math.min(w, Math.round(window.innerWidth * 0.34))));
const readW = (key, dflt, min, max) => {
  let saved = dflt;
  try { saved = Number(localStorage.getItem(key)) || dflt; } catch { /* 隐私模式 */ }
  return CLAMP(fitViewport(saved, min), min, max);
};
const writeW = (key, v) => { try { localStorage.setItem(key, String(v)); } catch { /* ignore */ } };

/** 可拖拽分隔条：拖动改宽，双击复位 */
function Resizer({ side, width, setWidth, min, max, title }) {
  const moveRef = useRef(null);
  const down = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    document.body.classList.add('wb-resizing');
    moveRef.current = (ev) => {
      const delta = side === 'left' ? ev.clientX - startX : startX - ev.clientX;
      setWidth(CLAMP(startW + delta, min, max));
    };
    const up = () => {
      document.body.classList.remove('wb-resizing');
      window.removeEventListener('mousemove', moveRef.current);
      window.removeEventListener('mouseup', up);
      moveRef.current = null;
    };
    window.addEventListener('mousemove', moveRef.current);
    window.addEventListener('mouseup', up);
  };

  return (
    <div
      className={`wb-resizer wb-resizer--${side}`}
      role="separator"
      aria-orientation="vertical"
      title={title}
      onMouseDown={down}
      onDoubleClick={() => setWidth(side === 'left' ? 280 : 372)}
    >
      <span className="wb-resizer__grip" />
    </div>
  );
}

export default function Editor({ id }) {
  const { t, toggle } = useI18n();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [wf, setWf] = useState({ id, name: '', revision: 0 });
  const [dirty, setDirty] = useState(false);
  const [errs, setErrs] = useState([]);
  const [toast, setToast] = useState('');
  const [run, setRun] = useState(null);
  /** 本次运行的节点态：nodeId -> { status, output, error, ms }。与 nodes 分离，避免污染撤销栈 */
  const [runNodes, setRunNodes] = useState({});
  const [runOrder, setRunOrder] = useState([]);
  const [follow, setFollow] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [dockTab, setDockTab] = useState('inspector');   // inspector | run
  const [preview, setPreview] = useState(null);
  const [selId, setSelId] = useState(null);
  const [showTasks, setShowTasks] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [external, setExternal] = useState(null);
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiReply, setAiReply] = useState('');
  /** 上一次 AI 调用的 token 占用（含 contextWindow），用来做上下文告警 */
  const [aiUsage, setAiUsage] = useState(null);
  const [sideTab, setSideTab] = useState('nodes');   // nodes | ai
  const [ready, setReady] = useState(false);
  const [leftW, setLeftW] = useState(() => readW('wb.leftW', 286, LEFT[0], LEFT[1]));
  const [rightW, setRightW] = useState(() => readW('wb.rightW', 372, RIGHT[0], RIGHT[1]));

  const { fitView, screenToFlowPosition, setCenter, getNode } = useReactFlow();
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const histRef = useRef({ past: [], future: [] });
  const pollRef = useRef(null);
  const esRef = useRef(null);       // 运行事件流
  const toastRef = useRef(null);
  const runStartRef = useRef(0);    // 本次运行开始时刻（算计时器）
  const movingRef = useRef(false);  // 程序自动平移中：此时不能把「跟随」关掉
  const followRef = useRef(follow);
  followRef.current = follow;
  nodesRef.current = nodes;
  edgesRef.current = edges;

  useEffect(() => { writeW('wb.leftW', leftW); }, [leftW]);
  useEffect(() => { writeW('wb.rightW', rightW); }, [rightW]);

  /** 轻提示：2.6 秒自己消失，不占版面（原来那条常驻状态栏已挪进通知中心） */
  const say = useCallback((text) => {
    setToast(text || '');
    clearTimeout(toastRef.current);
    if (text) toastRef.current = setTimeout(() => setToast(''), 2600);
  }, []);
  useEffect(() => () => clearTimeout(toastRef.current), []);

  /* ── 载入 ── */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const g = await api.getWorkflow(id);
        if (!alive) return;
        setNodes(hydrate(g.nodes));
        setEdges((g.edges || []).map(asEdge));
        setWf({ id: g.id || id, name: g.name || '', revision: g.revision || 0 });
        say(t('editor.status.loaded'));
        setReady(true);
      } catch (e) {
        if (alive) { say(e.message); setReady(true); }
      }
    })();
    return () => { alive = false; };
  }, [id, setNodes, setEdges, t, say]);

  /* ── 刷新 / 重进：恢复上次运行（终态）的节点着色与结果，跑着的不恢复 ── */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const hist = await api.runs(id, 1);
        const last = hist.items?.[0];
        if (!alive || !last) return;
        if (!['succeeded', 'failed', 'cancelled'].includes(last.status)) return;
        const detail = await api.runStatus(last.id);
        if (!alive) return;
        const ns = detail.nodes || {};
        setRunNodes(Object.fromEntries(Object.entries(ns).map(([k, v]) => [k, {
          status: v.status, error: v.error, ms: v.ms, output: detail.outputs?.[k],
        }])));
        setRunOrder(detail.order || []);
        setRun(detail);
        setFollow(false); // 恢复历史不抢视角
        setDockTab('run'); // 有历史就把结果直接摆出来，别让用户再去找
      } catch { /* 没有历史就静默 */ }
    })();
    return () => { alive = false; };
  }, [id]);

  /* ── 图被改动 → 只提示，不覆盖。自己保存的（origin=editor）直接忽略 ── */
  useEffect(() => {
    const es = new EventSource('/api/workflows/events');
    es.addEventListener('wf:changed', (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.id !== id || d.origin === 'editor') return;
        setExternal(d);
      } catch { /* 坏事件略过 */ }
    });
    return () => es.close();
  }, [id]);

  /* ── 撤销栈 ── */
  function pushHist() {
    const h = histRef.current;
    h.past.push({ nodes: nodesRef.current, edges: edgesRef.current });
    if (h.past.length > 60) h.past.shift();
    h.future.length = 0;
  }
  function undo() {
    const h = histRef.current;
    if (!h.past.length) return;
    const prev = h.past.pop();
    h.future.push({ nodes: nodesRef.current, edges: edgesRef.current });
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setDirty(true);
  }
  function redo() {
    const h = histRef.current;
    if (!h.future.length) return;
    const nx = h.future.pop();
    h.past.push({ nodes: nodesRef.current, edges: edgesRef.current });
    setNodes(nx.nodes);
    setEdges(nx.edges);
    setDirty(true);
  }

  /* ── 连线删除按钮（DeletableEdge 发 window 事件过来） ── */
  useEffect(() => {
    const h = (e) => {
      pushHist();
      setEdges((es) => es.filter((x) => x.id !== e.detail));
      setDirty(true);
    };
    window.addEventListener('wb:delete-edge', h);
    return () => window.removeEventListener('wb:delete-edge', h);
  }, []);

  /* ── 按 F 适应画布（不拿 fitView 做初始视角：塞下全图会把字压到 0.47 糊掉） ── */
  useEffect(() => {
    const h = () => fitView({ duration: 260, padding: 0.15 });
    window.addEventListener('wb:fit', h);
    return () => window.removeEventListener('wb:fit', h);
  }, [fitView]);

  const onConnect = useCallback((conn) => {
    pushHist();
    setEdges((es) => addEdge(asEdge(conn), es));
    setDirty(true);
  }, [setEdges]);

  const addNodeAt = useCallback((type, pos) => {
    pushHist();
    setNodes((ns) => [...ns, newNode(type, pos)]);
    setDirty(true);
  }, [setNodes]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/wb-node');
    if (!type) return;
    // 必须经 screenToFlowPosition 换算，否则缩放/平移后落点会偏
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addNodeAt(type, { x: p.x - 112, y: p.y - 28 });
  }, [screenToFlowPosition, addNodeAt]);

  /* ── 节点操作 ── */
  const selected = nodes.find((n) => n.id === selId) || null;

  function patchNode(nodeId, patch) {
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)));
    setDirty(true);
  }

  function deleteNode(nodeId) {
    pushHist();
    setNodes((ns) => ns.filter((n) => n.id !== nodeId));
    setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelId(null);
    setDirty(true);
  }

  function duplicateNode() {
    if (!selected) return;
    pushHist();
    const copy = newNode(selected.type, { x: selected.position.x + 40, y: selected.position.y + 40 });
    copy.data = JSON.parse(JSON.stringify(selected.data || {}));
    setNodes((ns) => [...ns, copy]);
    setSelId(copy.id);
    setDirty(true);
  }

  function deleteSelection() {
    const selN = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
    if (!selN.size && !edges.some((e) => e.selected)) return;
    pushHist();
    setNodes((ns) => ns.filter((n) => !n.selected));
    setEdges((es) => es.filter((e) => !e.selected && !selN.has(e.source) && !selN.has(e.target)));
    setSelId(null);
    setDirty(true);
  }

  /* ── 保存 ── */
  async function save({ quiet = false } = {}) {
    try {
      const g = await api.saveWorkflow(
        id,
        { name: wf.name || t('common.untitled'), nodes: cleanNodes(nodesRef.current), edges: cleanEdges(edgesRef.current) },
        wf.revision,
      );
      setWf((w) => ({ ...w, revision: g.revision, name: g.name ?? w.name }));
      setDirty(false);
      if (!quiet) say(t('editor.status.saved'));
      return { ok: true };
    } catch (e) {
      say(e.message);
      return { ok: false, error: e.message };
    }
  }

  /* ── 运行 / 预览 / 下载 ── */
  function stopPoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }
  function closeRunStream() {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
  }

  /** 从 run.outputs 里挑第一个视频地址（不看节点类型，有什么用什么） */
  function pickVideoUrl(outs) {
    return Object.values(outs || {}).map((o) => o && o.video_url).find(Boolean) || null;
  }

  /**
   * 运行结束后的 UI 收尾：只负责「按 preview 节点设置自动展开」。
   * 这里不再下载 —— output.download 节点已在 runner 里落过盘，再下一次会存两份。
   */
  function afterRun(st) {
    const url = pickVideoUrl(st.outputs);
    if (!url) return;
    const pv = nodesRef.current.find((n) => n.type === 'output.preview');
    if (pv && pv.data?.autoOpen !== false) {
      setPreview({ url, autoPlay: pv.data?.autoPlay !== false, loop: Boolean(pv.data?.loop) });
    }
  }

  /** 单个节点事件 → 状态表（输出一起记，节点卡片与结果面板都读它） */
  function applyNodeEvent(d) {
    setRunNodes((m) => ({ ...m, [d.nodeId]: { status: d.status, output: d.output, error: d.error, ms: d.ms } }));
    focusNode(d.nodeId);
  }

  /** 运行结束：关流 + 刷通知 + 收尾 */
  function finishRun(d) {
    closeRunStream();
    stopPoll();
    setRun((v) => ({ ...(v || {}), status: d.status, outputs: d.outputs || v?.outputs, error: d.error || null }));
    pingNotifications();
    if (d.status === 'succeeded') afterRun(d);
    else if (d.error) say(d.error);
  }

  /** 跟随运行：把画布平滑移到当前节点（用户手动拖过就自动关，不抢视角） */
  function focusNode(nodeId, force = false) {
    if (!force && !followRef.current) return;
    const n = getNode(nodeId) || nodesRef.current.find((x) => x.id === nodeId);
    if (!n) return;
    const w = n.measured?.width || 240;
    const h = n.measured?.height || 120;
    movingRef.current = true;
    setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: 0.9, duration: 420 });
    setTimeout(() => { movingRef.current = false; }, 700);
  }

  /** SSE 订阅：运行时真实推送每个节点的流转，替代 1.5s 轮询 */
  function connectRun(runId) {
    closeRunStream();
    if (typeof EventSource === 'undefined') { startPolling(runId); return; }
    const es = new EventSource(api.runEventsUrl(runId));
    esRef.current = es;
    let failures = 0;
    es.addEventListener('run:start', (ev) => {
      try { setRunOrder(JSON.parse(ev.data).order || []); } catch { /* 坏事件略过 */ }
    });
    es.addEventListener('run:node', (ev) => {
      let d;
      try { d = JSON.parse(ev.data); } catch { return; }
      applyNodeEvent(d);
    });
    es.addEventListener('run:done', (ev) => {
      let d;
      try { d = JSON.parse(ev.data); } catch { d = {}; }
      finishRun(d);
    });
    es.onerror = () => {
      failures += 1;
      if (failures >= 3) { closeRunStream(); startPolling(runId); }
    };
  }

  /** SSE 断了才用的降级轮询（不承担常态更新） */
  function startPolling(runId) {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const st = await api.runStatus(runId);
        setRun(st);
        setRunOrder(st.order || []);
        const ns = st.nodes || {};
        setRunNodes(Object.fromEntries(Object.entries(ns).map(([k, v]) => [k, {
          status: v.status, error: v.error, ms: v.ms, output: st.outputs?.[k],
        }])));
        if (!['running', 'starting', 'estimating'].includes(st.status)) finishRun({ ...st, status: st.status });
      } catch (e) {
        stopPoll();
        setRun((v) => ({ ...v, error: e.message }));
      }
    }, 2000);
  }

  /**
   * @param dryRun 干跑只返回计划
   * @param opts.nodeId 只跑这个节点；opts.single=true 只跑它本身（输入用上次结果）
   */
  async function startRun(dryRun, opts = {}) {
    const { nodeId = null, single = false } = opts;
    if (!dryRun && !single) {
      const errsNow = validateGraph(nodes, edges);
      if (errsNow.length) { setErrs(errsNow); say(errsNow.map((e) => t(e.key, e.vars)).join('；')); return; }
      const scope = nodeId ? t('inspector.runTo') : t('editor.run');
      if (!window.confirm(`${scope} · ${t('editor.runConfirm', { n: nodeId ? 1 : nodes.length })}`)) return;
    }
    setErrs([]);
    stopPoll();
    closeRunStream();
    setRunNodes({});
    setRunOrder([]);
    setElapsed(0);
    setDockTab('run'); // 运行了就把结果页推到用户眼前
    try {
      const s = await save({ quiet: true });
      if (!s.ok) return;
      const r = await api.run(id, nodeId ? [nodeId] : null, { dryRun: Boolean(dryRun), single });
      setRun(r);
      if (dryRun) {
        say(t('editor.estimateLine', { cost: r.estimate, summary: r.summary || '' }));
        setDockTab('inspector');
        return;
      }
      runStartRef.current = Date.now();
      setRunOrder(r.order || []);
      connectRun(r.id);
    } catch (e) {
      setRun({ status: 'failed', error: e.message });
      say(e.message);
    }
  }

  /** 计时器：只在运行中走，结束后停在最终耗时 */
  useEffect(() => {
    if (!run || !['running', 'starting', 'estimating'].includes(run.status)) return undefined;
    const t0 = runStartRef.current || Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [run?.status]);

  async function cancelRun() {
    if (!run?.id) return;
    try {
      await api.cancelRun(run.id);
      say(t('run.cancelled'));
    } catch (e) {
      say(e.message);
    }
  }

  useEffect(() => () => { stopPoll(); closeRunStream(); }, []);

  /* ── AI 改流程 ── */
  async function runAi() {
    const instruction = aiText.trim();
    if (!instruction || aiBusy) return;
    setAiBusy(true);
    setAiReply('');
    setAiUsage(null);
    try {
      if (dirty) {
        const s = await save({ quiet: true });
        if (!s.ok) { setAiReply(`✕ ${s.error}`); return; }
      }
      const r = await api.aiEdit(id, instruction, schemaForLLM(), false);
      setAiUsage(r.usage || null);
      const filled = [...new Set(r.autoFilled || [])];
      const line = r.reply || (r.applied ? `+${r.ops.length}` : '—');
      setAiReply(filled.length ? `${line} · ${t('ai.filled', { n: filled.length })} ${filled.map((x) => t(`node.${x}`)).join(' / ')}` : line);
      if (r.applied) {
        pushHist(); // 自动补齐可能多出节点，先压栈，Ctrl+Z 能整体退回
        const g = await api.getWorkflow(id);
        setNodes(hydrate(g.nodes));
        setEdges((g.edges || []).map(asEdge));
        setWf((w) => ({ ...w, revision: g.revision, name: g.name ?? w.name }));
        setExternal(null);
        setDirty(false);
        setAiText('');
        setRunNodes({});
        setRunOrder([]);
        pingNotifications();
      }
    } catch (e) {
      setAiReply(`✕ ${e.message}`);
    } finally {
      setAiBusy(false);
    }
  }

  /* ── 快捷键 ── */
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();

      if (mod && k === 's') { e.preventDefault(); save(); return; }
      if (mod && e.key === 'Enter') { e.preventDefault(); startRun(Boolean(e.shiftKey)); return; }
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && k === 'a' && !typing) {
        e.preventDefault();
        setNodes((ns) => ns.map((n) => ({ ...n, selected: true })));
        return;
      }
      if (typing) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
      if (e.key === 'Escape') { setSelId(null); setPreview(null); return; }
      if (k === 'f') { window.dispatchEvent(new CustomEvent('wb:fit')); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // 依赖全部状态，故意不传数组

  const running = run && ['running', 'starting', 'estimating'].includes(run.status);
  const errLine = useMemo(() => (errs.length ? errs.map((e) => t(e.key, e.vars)).join(' · ') : ''), [errs, t]);

  /**
   * 画布渲染用节点 = 原始 nodes + 运行态（__status / __output）。
   * 运行态只活在 runNodes 里，绝不写回 nodes：撤销栈与保存内容都保持干净。
   */
  const displayNodes = useMemo(() => {
    if (!Object.keys(runNodes).length) return nodes;
    return nodes.map((n) => (runNodes[n.id]
      ? { ...n, data: { ...n.data, __status: runNodes[n.id].status, __output: runNodes[n.id].output } }
      : n));
  }, [nodes, runNodes]);

  /** 运行时间线：按拓扑顺序列出本次要跑的节点及其状态，给运行条与结果面板共用 */
  const timeline = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return runOrder.map((nodeId) => {
      const node = byId.get(nodeId);
      const st = runNodes[nodeId] || {};
      return { nodeId, type: node?.type || '', status: st.status, ms: st.ms, error: st.error, output: st.output };
    });
  }, [runOrder, runNodes, nodes]);

  const doneCount = timeline.filter((x) => ['success', 'error', 'skipped', 'cancelled'].includes(x.status)).length;
  const current = timeline.find((x) => x.status === 'running') || null;
  const progress = timeline.length ? Math.round((doneCount / timeline.length) * 100) : 0;
  /**
   * 本次运行的成品：视频地址 / 落盘文件 / 任务号，结果面板与节点卡片都从这里取。
   * 运行中的节点输出也算 —— watch 一完成就能看片，不用等整条链路跑完。
   */
  const artifacts = useMemo(() => {
    const outs = { ...(run?.outputs || {}) };
    for (const [nodeId, st] of Object.entries(runNodes)) if (st.output) outs[nodeId] = st.output;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return Object.entries(outs).map(([nodeId, o]) => ({
      nodeId,
      type: byId.get(nodeId)?.type || '',
      taskId: o?.task_id || '',
      videoUrl: o?.video_url || '',
      file: o?.file || '',
    })).filter((x) => x.taskId || x.videoUrl || x.file);
  }, [run?.outputs, runNodes, nodes]);

  if (!ready) return <div className="wb-empty wb-empty--big">{t('common.loading')}</div>;

  return (
    <div className="wb-editor">
      <header className="wb-topbar">
        <div className="wb-topbar__brand">
          <button type="button" className="wb-icon-btn" onClick={() => go('#/')} title={t('nav.home')} aria-label={t('nav.home')}>
            <Ic n="back" size={17} />
          </button>
          <LogoMark size={24} />
          <input
            className="wb-title-input"
            value={wf.name}
            placeholder={t('common.untitled')}
            onChange={(e) => { setWf((w) => ({ ...w, name: e.target.value })); setDirty(true); }}
          />
          {dirty && <span className="wb-dot-dirty" title={t('editor.unsaved')} />}
        </div>

        <div className="wb-topbar__spacer" />

        <div className="wb-topbar__actions">
          <button
            type="button"
            className="wb-icon-btn"
            title={t('editor.validate')}
            aria-label={t('editor.validate')}
            onClick={() => {
              const next = validateGraph(nodes, edges);
              setErrs(next);
              say(next.length ? next.map((e) => t(e.key, e.vars)).join('；') : t('editor.status.validated'));
            }}
          >
            <Ic n="validate" size={17} />
          </button>
          <button
            type="button"
            className={`wb-icon-btn${dirty ? ' is-active' : ''}`}
            title={t('common.save')}
            aria-label={t('common.save')}
            onClick={() => save()}
            disabled={!dirty}
          >
            <Ic n="save" size={17} />
          </button>
          <button type="button" className="wb-icon-btn" title={t('editor.estimate')} aria-label={t('editor.estimate')} onClick={() => startRun(true)}>
            <Ic n="estimate" size={17} />
          </button>
          <button
            type="button"
            className={`wb-icon-btn wb-run-btn${running ? ' is-running' : ''}`}
            onClick={() => startRun(false)}
            disabled={Boolean(running)}
            title={t('editor.run')}
            aria-label={t('editor.run')}
          >
            <Ic n={running ? 'running' : 'run'} size={17} className={running ? 'wb-spin' : ''} />
          </button>

          <span className="wb-topbar__divider" />

          <NotificationCenter onOpenWorkflow={(wfId) => go(`#/wf/${encodeURIComponent(wfId)}`)} />
          <button
            type="button"
            className={`wb-icon-btn${showTasks ? ' is-active' : ''}`}
            title={t('editor.tasks')}
            aria-label={t('editor.tasks')}
            onClick={() => setShowTasks((v) => !v)}
          >
            <Ic n="tasks" size={17} />
          </button>
          <button type="button" className="wb-icon-btn" title={t('nav.lang')} aria-label={t('nav.lang')} onClick={toggle}>
            <Ic n="lang" size={17} />
          </button>
          <button type="button" className="wb-icon-btn" title={t('editor.settings')} aria-label={t('editor.settings')} onClick={() => setShowSettings(true)}>
            <Ic n="settings" size={17} />
          </button>
        </div>
      </header>

      {/* 只在有异常时出现的薄条：正常提示已经走 toast + 通知中心 */}
      {(external || errLine) && (
        <div className="wb-alertbar">
          {external && (
            <span className="wb-alertbar__item">
              <Ic n="warn" size={14} />
              {t('editor.external', { rev: external.revision })}
              <button type="button" className="wb-btn wb-btn--xs" onClick={async () => {
                const g = await api.getWorkflow(id);
                setNodes(hydrate(g.nodes));
                setEdges((g.edges || []).map(asEdge));
                setWf((w) => ({ ...w, revision: g.revision, name: g.name ?? w.name }));
                setExternal(null); setDirty(false);
                say(t('editor.status.loaded'));
              }}>{t('editor.external.reload')}</button>
              <button type="button" className="wb-btn wb-btn--xs" onClick={() => setExternal(null)}>{t('editor.external.ignore')}</button>
            </span>
          )}
          {errLine && (
            <span className="wb-alertbar__item wb-alertbar__item--err">
              <Ic n="fail" size={14} />
              {errLine}
              <button type="button" className="wb-btn wb-btn--xs" onClick={() => setErrs([])}>{t('common.close')}</button>
            </span>
          )}
        </div>
      )}

      {/* 运行条：跑到哪个节点、还剩几个、跑了多久，一眼看全 */}
      {run && !run.dryRun && timeline.length > 0 && (
        <div className="wb-runbar" data-state={run.status}>
          <span className="wb-runbar__dot" />
          <span className="wb-runbar__label">{t(`run.status.${run.status}`)}</span>
          <span className="wb-runbar__meta">
            {`${doneCount}/${timeline.length}`}
            {current ? ` · ${t(`node.${current.type}`) || current.type}` : ''}
            {` · ${fmtDuration(elapsed)}`}
          </span>
          <span className="wb-runbar__bar"><i style={{ width: `${progress}%` }} /></span>
          <button
            type="button"
            className={`wb-btn wb-btn--xs${follow ? ' is-on' : ''}`}
            onClick={() => {
              const next = !follow;
              setFollow(next);
              if (next && current) focusNode(current.nodeId, true);
            }}
            title={t('run.followHint')}
          >
            {t('run.follow')}
          </button>
          {running && (
            <button type="button" className="wb-btn wb-btn--xs wb-btn--danger" onClick={cancelRun}>
              {t('run.cancel')}
            </button>
          )}
        </div>
      )}

      <div className="wb-main">
        <aside className="wb-sidebar" style={{ width: leftW }}>
          <div className="wb-sidebar__tabs">
            <button type="button" className={sideTab === 'nodes' ? 'is-on' : ''} onClick={() => setSideTab('nodes')}>
              <Ic n="layers" size={14} />
              {t('editor.palette')}
            </button>
            <button type="button" className={sideTab === 'ai' ? 'is-on' : ''} onClick={() => setSideTab('ai')}>
              <Ic n="sparkles" size={14} />
              {t('editor.ai.tag')}
            </button>
          </div>
          {sideTab === 'nodes'
            ? <Palette onAdd={(type) => addNodeAt(type, { x: 80 + nodes.length * 12, y: 120 + (nodes.length % 5) * 40 })} />
            : <AiPanel value={aiText} onChange={setAiText} onRun={runAi} busy={aiBusy} reply={aiReply} usage={aiUsage} />}
        </aside>

        <Resizer side="left" width={leftW} setWidth={setLeftW} min={LEFT[0]} max={LEFT[1]} title={t('editor.resizeHint')} />

        <div className="wb-canvas" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            // 挂载时 React Flow 会派发 dimensions/select 变更，那不是用户编辑，不能算脏
            onNodesChange={(c) => { onNodesChange(c); if (c.some((x) => x.type !== 'select' && x.type !== 'dimensions')) setDirty(true); }}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => { setSelId(n.id); setDockTab('inspector'); }}
            onPaneClick={() => setSelId(null)}
            // 用户自己拖动/缩放就关掉「跟随」，别跟他抢视角（程序平移时 movingRef 为真）
            onMoveStart={() => { if (!movingRef.current) setFollow(false); }}
            deleteKeyCode={null}
            defaultEdgeOptions={{ type: 'wb', markerEnd: MARKER }}
            defaultViewport={{ x: 48, y: 64, zoom: 0.78 }}
            minZoom={0.45}
            maxZoom={1.6}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} size={1} color="#262633" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor="#4a4a5e" maskColor="rgba(0,0,0,.62)" />
          </ReactFlow>
          {nodes.length === 0 && (
            <div className="wb-canvas__empty">
              <Ic n="brand" size={26} />
              <span>{t('editor.canvas.empty')}</span>
            </div>
          )}
        </div>

        <Resizer side="right" width={rightW} setWidth={setRightW} min={RIGHT[0]} max={RIGHT[1]} title={t('editor.resizeHint')} />

        <div className="wb-dock" style={{ width: rightW }}>
          <div className="wb-dock__tabs">
            <button type="button" className={dockTab === 'inspector' ? 'is-on' : ''} onClick={() => setDockTab('inspector')}>
              {t('dock.tab.params')}
            </button>
            <button type="button" className={dockTab === 'run' ? 'is-on' : ''} onClick={() => setDockTab('run')}>
              {t('dock.tab.run')}
              {artifacts.length > 0 && <em className="wb-dock__badge">{artifacts.length}</em>}
            </button>
          </div>
          {dockTab === 'inspector' ? (
            <Inspector
              node={selected}
              dirty={dirty}
              runBusy={Boolean(running)}
              notify={async (body) => {
                await api.addNotification(body).catch(() => {});
                pingNotifications();
              }}
              onPatch={(patch) => { pushHist(); patchNode(selected.id, patch); }}
              onDelete={() => deleteNode(selected.id)}
              onDuplicate={duplicateNode}
              onRun={(nodeId, single) => startRun(false, { nodeId, single })}
            />
          ) : (
            <RunPanel
              run={run}
              timeline={timeline}
              artifacts={artifacts}
              running={Boolean(running)}
              elapsed={elapsed}
              progress={progress}
              follow={follow}
              onToggleFollow={() => setFollow((v) => !v)}
              onCancel={cancelRun}
              onFocus={(nodeId) => { setSelId(nodeId); focusNode(nodeId, true); }}
              onPreview={(url) => setPreview({ url, autoPlay: true })}
              wfId={id}
            />
          )}
        </div>
      </div>

      {toast && <div className="wb-toast">{toast}</div>}

      {showTasks && <TaskPanel onPreview={(url) => setPreview({ url, autoPlay: true })} onClose={() => setShowTasks(false)} />}

      {preview && (
        <div className="wb-preview">
          <div className="wb-preview__head">
            <strong><Ic n="film" size={15} /> {t('editor.preview')}</strong>
            <button type="button" className="wb-icon-btn wb-icon-btn--sm" onClick={() => setPreview(null)} aria-label={t('common.close')}>
              <Ic n="close" size={14} />
            </button>
          </div>
          <video src={preview.url} controls autoPlay={preview.autoPlay !== false} loop={Boolean(preview.loop)} playsInline />
          <div className="wb-preview__foot">
            <a className="wb-btn" href={preview.url} target="_blank" rel="noreferrer">
              <Ic n="external" size={14} /> {t('common.open')}
            </a>
          </div>
        </div>
      )}

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
