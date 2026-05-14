import net from "node:net";
import tls from "node:tls";
import { Readable, Writable } from "node:stream";

export function connect(address, options = {}) {
  const hostname = address.hostname;
  const port = Number(address.port);
  const socket = options.secureTransport === "on"
    ? tls.connect({ host: hostname, port, servername: hostname, allowHalfOpen: !!options.allowHalfOpen })
    : net.connect({ host: hostname, port, allowHalfOpen: !!options.allowHalfOpen });

  return {
    readable: Readable.toWeb(socket),
    writable: Writable.toWeb(socket),
    async close() {
      if (socket.destroyed) return;
      await new Promise((resolve) => socket.end(resolve));
      socket.destroy();
    },
  };
}

