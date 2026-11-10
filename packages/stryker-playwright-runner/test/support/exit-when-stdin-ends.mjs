process.stdin.on('end', () => process.exit());
process.stdin.resume();
process.stdin.unref();
