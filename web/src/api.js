/** 极薄的 API 封装：统一错误语义 + revision 冲突提示 */
async function request(path, { method = 'GET', body, headers } = {}) {
  const res = await fetch(path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const enc = encodeURIComponent;
/** 编辑器自己发起的写入带这个头：服务端据此推 origin=editor，前端不弹「外部改动」 */
const FROM_UI = { 'X-WB-Origin': 'editor' };

export const api = {
  /* 设置 */
  settings: () => request('/api/settings'),
  saveSettings: (patch) => request('/api/settings', { method: 'POST', body: patch }),

  /* 分类 */
  categories: () => request('/api/categories'),
  createCategory: (body) => request('/api/categories', { method: 'POST', body }),
  updateCategory: (id, patch) => request(`/api/category/${enc(id)}`, { method: 'PATCH', body: patch }),
  removeCategory: (id) => request(`/api/category/${enc(id)}`, { method: 'DELETE' }),
  reorderCategories: (ids) => request('/api/categories/reorder', { method: 'POST', body: { ids } }),

  /* 工作流（多画布 + 分类归属） */
  workflows: (categoryId) =>
    request(`/api/workflows${categoryId === undefined ? '' : `?categoryId=${enc(categoryId ?? 'none')}`}`),
  createWorkflow: (name, categoryId) => request('/api/workflows', { method: 'POST', body: { name, categoryId } }),
  duplicateWorkflow: (id) => request(`/api/workflow/${enc(id)}/duplicate`, { method: 'POST' }),
  getWorkflow: (id) => request(`/api/workflow/${enc(id)}`),
  saveWorkflow: (id, graph, revision) =>
    request(`/api/workflow/${enc(id)}`, {
      method: 'PUT',
      body: graph,
      headers: revision == null ? FROM_UI : { ...FROM_UI, 'If-Match': String(revision) },
    }),
  deleteWorkflow: (id) => request(`/api/workflow/${enc(id)}`, { method: 'DELETE' }),
  patchWorkflow: (id, ops) => request(`/api/workflow/${enc(id)}/patch`, { method: 'POST', body: { ops }, headers: FROM_UI }),
  moveWorkflows: (ids, categoryId) => request('/api/workflows/move', { method: 'POST', body: { ids, categoryId } }),

  /* AI 改流程 / AI 优化提示词 */
  aiEdit: (id, instruction, schema, dryRun = false) =>
    request(`/api/workflow/${enc(id)}/ai`, { method: 'POST', body: { instruction, schema, dryRun }, headers: FROM_UI }),
  optimizePrompt: (payload) => request('/api/llm/optimize', { method: 'POST', body: payload }),

  /* 执行（nodeIds + single 支持单步） */
  run: (wfId, nodeIds, opts = {}) => request('/api/run', { method: 'POST', body: { wfId, nodeIds, ...opts } }),
  runStatus: (id) => request(`/api/run/${enc(id)}`),
  cancelRun: (id) => request(`/api/run/${enc(id)}/cancel`, { method: 'POST' }),
  /** 运行事件流（SSE）：run:start / run:node / run:done */
  runEventsUrl: (id) => `/api/run/${enc(id)}/events`,
  /** 运行历史：结果面板下拉 + 刷新后恢复节点状态 */
  runs: (wfId, limit = 20) => request(`/api/runs?wfId=${enc(wfId)}&limit=${limit}`),

  /* 通知中心 */
  notifications: (limit = 50) => request(`/api/notifications?limit=${limit}`),
  addNotification: (body) => request('/api/notifications', { method: 'POST', body }),
  markNotificationsRead: (ids) => request('/api/notifications/read', { method: 'POST', body: { ids } }),
  clearNotifications: (onlyRead = false) => request(`/api/notifications${onlyRead ? '?onlyRead=1' : ''}`, { method: 'DELETE' }),

  /* 素材与产物 */
  uploadAsset: (payload) => request('/api/assets', { method: 'POST', body: payload }),
  download: (url, name) => request('/api/download', { method: 'POST', body: { url, name } }),

  /* 网关任务 */
  tasks: (qs = '') => request(`/api/tasks${qs}`),
  task: (id) => request(`/api/task?id=${enc(id)}`),
  removeTask: (id) => request(`/api/task?id=${enc(id)}`, { method: 'DELETE' }),
};
