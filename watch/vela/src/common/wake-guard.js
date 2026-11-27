// Local silent motor bridge for Gadgetbridge. Business requests and hub state stay separate.
export function createWakeGuard(vibrate, send, now, schedule, unschedule) {
  const protocol = 'gadgetbridge.wake_guard.v1';
  let current = null;
  let timer = null;
  function clear() {
    if (timer !== null) unschedule(timer);
    timer = null;
  }
  function reply(op) {
    send({ protocol: protocol, id: current.id, op: op });
  }
  return {
    receive(body) {
      if (!body || body.protocol !== protocol) return false;
      if (typeof body.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(body.id)) return true;
      if (body.op === 'prepare') {
        if (!current || current.id !== body.id) {
          clear();
          current = { id: body.id, deadline: now() + 3000, started: false, count: 0 };
        }
        reply('ready');
      } else if (current && current.id === body.id) {
        if (body.op === 'cancel') {
          clear();
          current.started = true;
        } else if (body.op === 'vibrate' && !current.started && now() < current.deadline) {
          current.started = true;
          const pulse = () => {
            try {
              vibrate({ mode: 'long' });
              current.count++;
              if (current.count < 3) timer = schedule(pulse, 1000);
              else {
                timer = null;
                reply('executed');
              }
            } catch (error) {
              clear();
              reply('failed');
            }
          };
          pulse();
        }
      }
      return true;
    },
    close() {
      clear();
      current = null;
    },
  };
}
