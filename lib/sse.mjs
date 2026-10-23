/**
 * 极简 SSE 广播：按 channel 分发，带心跳与 Last-Event-ID 重放。
 * 零依赖，单进程够用。
 */
export function createSse() {
  const clients = new Map(); // id -> { res, channel }
  const history = new Map(); // channel -> [{ id, event, data }]
  const MAX_HISTORY = 300;
  let seq = 0;

  function write(res, rec) {
    res.write(`id: ${rec.id}\nevent: ${rec.event}\ndata: ${JSON.stringify(rec.data)}\n\n`);
  }

  function push(channel, event, data) {
    seq += 1;
    const rec = { id: seq, event, data };
    const list = history.get(channel) || [];
    list.push(rec);
    if (list.length > MAX_HISTORY) list.shift();
    history.set(channel, list);
    for (const c of clients.values()) {
      if (c.channel !== channel) continue;
      try { write(c.res, rec); } catch { /* 客户端已断，靠 close 清理 */ }
    }
  }

  function attach(req, res, channel, lastEventId = 0) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    const since = Number(lastEventId) || 0;
    for (const rec of history.get(channel) || []) {
      if (rec.id > since) write(res, rec);
    }

    const cid = `c${++seq}`;
    clients.set(cid, { res, channel });
    const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* ignore */ } }, 15000);
    req.on('close', () => { clearInterval(hb); clients.delete(cid); });
  }

  return { push, attach, size: () => clients.size };
}
