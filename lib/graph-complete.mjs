/**
 * AI 改图的「结构性补齐」：模型负责内容，可运行性由确定性代码兜底。
 *
 * 起因：模型只加 param.video + gen.video 就交差，缺 task.watch（拿不到 video_url）、
 * 缺 output.*（成品没出口）、缺 text.negative。靠提示词无法保证，于是加这一层：
 * 纯函数、幂等、只补结构不改内容，返回语义化 ops 交给 wfStore.patch。
 *
 * 规则来源：前端 schema.rules（web/src/graph/model.js 的 FLOW_RULES），
 * 服务端不重复定义，只做兜底默认值。
 */

const DEFAULT_RULES = {
  watchAfter: ['gen.video', 'gen.regen'],
  outputAfter: ['output.preview', 'output.download'],
  defaultNegative: 'blurry, watermark, distorted faces, extra limbs, morphing, flickering, text artifacts',
};

const tail4 = (id) => String(id || 'x').replace(/^n_/, '').slice(-4) || 'x';

export function completeGraph({ nodes = [], edges = [], schema } = {}) {
  if (!Array.isArray(nodes) || !nodes.length) return { ops: [], added: [], notes: [] };

  const defs = Array.isArray(schema) ? schema : schema?.nodes || [];
  const rawRules = (Array.isArray(schema) ? null : schema?.rules) || {};
  const rules = {
    ...DEFAULT_RULES,
    ...rawRules,
    watchAfter: rawRules.watchAfter || DEFAULT_RULES.watchAfter,
    outputAfter: rawRules.outputAfter || DEFAULT_RULES.outputAfter,
  };
  const defaultsOf = (type) => ({ ...(defs.find((d) => d?.type === type)?.defaults || {}) });

  // 工作副本：边补边算，让后面的 pass 能看到前面新增的节点
  const ns = nodes.map((n) => ({ ...n }));
  const es = edges.map((e) => ({ ...e }));
  const ops = [];
  const added = [];

  const byId = (id) => ns.find((n) => n.id === id) || null;
  const uniqueId = (base) => {
    let id = base;
    let i = 2;
    while (ns.some((n) => n.id === id)) id = `${base}_${i++}`;
    return id;
  };
  const addNode = (type, position, id, data) => {
    const node = { id, type, position, data: data || defaultsOf(type) };
    ns.push(node);
    ops.push({ op: 'add_node', node });
    return node;
  };
  const connect = (source, sourceHandle, target, targetHandle) => {
    const edge = { id: `e_tmp_${es.length}`, source, sourceHandle, target, targetHandle };
    es.push(edge);
    ops.push({ op: 'connect', source, sourceHandle, target, targetHandle });
  };
  /** 某个 sourceHandle 已经连到的下游节点类型集合 */
  const targetsOf = (nodeId, handle) =>
    new Set(
      es.filter((e) => e.source === nodeId && (handle ? e.sourceHandle === handle : true))
        .map((e) => byId(e.target)?.type)
        .filter(Boolean),
    );

  /* pass 1：产出 task_id 的节点必须有 task.watch 消费，否则永远拿不到 video_url */
  for (const node of ns.filter((n) => rules.watchAfter.includes(n.type))) {
    if (targetsOf(node.id, 'task_id').has('task.watch')) continue;
    const id = uniqueId(`n_watch_${tail4(node.id)}`);
    addNode('task.watch', { x: (node.position?.x ?? 0) + 340, y: node.position?.y ?? 0 }, id);
    connect(node.id, 'task_id', id, 'task_id');
    added.push('task.watch');
  }

  /* pass 2：每个 task.watch 的 video_url 都要有成品出口（含 pass 1 新建的） */
  for (const watch of ns.filter((n) => n.type === 'task.watch')) {
    const have = targetsOf(watch.id, 'video_url');
    rules.outputAfter.forEach((type, i) => {
      if (have.has(type)) return;
      const id = uniqueId(`n_${type.split('.').pop()}_${tail4(watch.id)}`);
      const pos = { x: (watch.position?.x ?? 0) + 340, y: (watch.position?.y ?? 0) + i * 150 };
      addNode(type, pos, id);
      connect(watch.id, 'video_url', id, 'video_url');
      added.push(type);
    });
  }

  /* pass 3：gen.video 没有负向词时补一个（内容写在节点上，用户可改） */
  for (const gen of ns.filter((n) => n.type === 'gen.video')) {
    const hasNeg = es.some(
      (e) => e.target === gen.id && e.targetHandle === 'text' && byId(e.source)?.type === 'text.negative',
    );
    if (hasNeg) continue;
    const id = uniqueId(`n_neg_${tail4(gen.id)}`);
    const pos = { x: (gen.position?.x ?? 0) - 340, y: (gen.position?.y ?? 0) + 170 };
    addNode('text.negative', pos, id, { text: rules.defaultNegative });
    connect(id, 'text', gen.id, 'text');
    added.push('text.negative');
  }

  return { ops, added, notes: [] };
}
