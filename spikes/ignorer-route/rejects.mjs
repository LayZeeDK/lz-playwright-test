// Spike: a config that imports a module whose top-level await rejects. SPIKE_MODE=throw makes it reject.
await (process.env.SPIKE_MODE === 'throw' ? Promise.reject(new Error('SPIKE-IMPORT-ERROR from the install')) : Promise.resolve());
