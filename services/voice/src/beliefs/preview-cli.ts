import { previewServer } from './preview.ts';
const port=Number(process.env['BELIEFS_PREVIEW_PORT']??8770);
const server=previewServer();
server.listen(port,'127.0.0.1',()=>console.log(`Beliefs preview: http://127.0.0.1:${port}/beliefs — no calls, messages or payments.`));
for(const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,()=>server.close(()=>process.exit(0)));
