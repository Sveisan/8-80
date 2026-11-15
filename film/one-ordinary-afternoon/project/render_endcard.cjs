// Renders the end card to PNG frames (24 fps). Usage: node render_endcard.js <outDir> <seconds>
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const out = process.argv[2], secs = parseFloat(process.argv[3] || '6.7'), fps = 24;
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto('file://' + path.resolve(__dirname, 'endcard.html')); await p.evaluate(() => document.fonts.ready);
  for (let i = 0; i < Math.round(secs * fps); i++) {
    await p.evaluate(t => window.setT(t), i / fps);
    await p.screenshot({ path: path.join(out, `f${String(i).padStart(4, '0')}.png`) });
  }
  await b.close();
})();
