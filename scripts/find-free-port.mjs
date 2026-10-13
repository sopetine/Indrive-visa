import net from "node:net";

const server = net.createServer();
server.unref();
server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  process.stdout.write(String(port));
  server.close();
});
