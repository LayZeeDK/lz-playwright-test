import http from 'node:http';

const server = http.createServer();
server.on('error', () => process.stdout.write('failed\n'));
server.listen(Number(process.argv[2]), '127.0.0.1');
