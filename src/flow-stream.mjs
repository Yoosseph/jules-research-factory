// Keeps stream clients and timers separate from research work and HTTP routing.
export function createFlowStream(snapshot) {
  const clients = new Set();
  let lastFrame = '';
  const timer = setInterval(() => {
    if (!clients.size) return;
    const current = snapshot();
    const frame = JSON.stringify({ ...current, serverTime: undefined });
    if (frame === lastFrame) return;
    lastFrame = frame;
    const event = `event: snapshot\ndata: ${JSON.stringify(current)}\n\n`;
    for (const client of clients) {
      if (client.writableLength > 1024 * 1024) { client.destroy(); clients.delete(client); }
      else client.write(event);
    }
  }, 1000);
  timer.unref();
  const heartbeat = setInterval(() => { for (const client of clients) client.write(': heartbeat\n\n'); }, 15000);
  heartbeat.unref();

  return {
    attach(response) {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
      clients.add(response);
      response.on('close', () => clients.delete(response));
    },
    close() {
      clearInterval(timer);
      clearInterval(heartbeat);
      for (const client of clients) client.end();
      clients.clear();
    },
  };
}
